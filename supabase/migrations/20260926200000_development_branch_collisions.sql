-- Development Tasks: branch collisions. Follows
-- 20260926190000_development_needs_attention.sql.
--
-- One branch is tracked by at most one Development Task per workspace -- that
-- was already true (task_development_branch_uniq), and a repeated name was
-- numbered -02, -03 (20260926160000). What changes:
--
--   - The app now says so before creating: the form names the task that
--     already has the branch (src/components/development/
--     DevelopmentTaskForm.tsx). An ACTIVE task's branch is never shared: the
--     new task gets the next numbered name, exactly as before.
--   - A FINISHED task (completed or skipped) no longer keeps its branch name
--     forever. When someone creating a task explicitly chooses to reuse it
--     (p_take_over_branch), the finished task's branch is released
--     (branch_released_at) and the new task takes the exact name. The
--     finished task keeps its branch_name, its PR and its history; it simply
--     stops receiving events for that branch. Nothing is ever released
--     implicitly.
--
-- GitHub events for a branch go to the one task that holds it (released rows
-- are ignored); PR events still find a task by the PR's own id first.

alter table public.task_development
  add column if not exists branch_released_at timestamptz;

drop index if exists public.task_development_branch_uniq;
create unique index task_development_branch_uniq
  on public.task_development (workspace_id, branch_name)
  where branch_released_at is null;

-- ── claiming a name ─────────────────────────────────────────────────────────
-- As in 20260926160000, plus p_take_over_finished: the exact name asked for
-- may be taken from a finished task (which is then released). Never from an
-- active one, and never a numbered variant.
drop function if exists public.claim_development_branch_name(uuid, text, uuid);

create or replace function public.claim_development_branch_name(
  p_workspace_id uuid, p_branch_name text, p_task_id uuid,
  p_take_over_finished boolean default false
)
returns text
language plpgsql set search_path = public
as $$
declare
  v_base text := lower(btrim(coalesce(p_branch_name, '')));
  v_name text;
  v_n integer := 1;
  v_holder uuid;
  v_holder_status text;
begin
  if char_length(v_base) < 3 or char_length(v_base) > 90
     or v_base !~ '^[a-z0-9]+([-/][a-z0-9]+)*$' then
    raise exception 'invalid branch name: use lowercase letters, numbers, "-" and "/"'
      using errcode = '22023';
  end if;

  select d.task_id, t.status into v_holder, v_holder_status
    from public.task_development d
    join public.workspace_tasks t on t.id = d.task_id
    where d.workspace_id = p_workspace_id
      and d.branch_name = v_base
      and d.branch_released_at is null
      and d.task_id is distinct from p_task_id
    for update of d;

  if v_holder is null then
    return v_base;
  end if;
  if p_take_over_finished and v_holder_status in ('completed', 'skipped') then
    update public.task_development set branch_released_at = now()
      where task_id = v_holder;
    return v_base;
  end if;

  v_name := v_base;
  while exists (
    select 1 from public.task_development
    where workspace_id = p_workspace_id
      and branch_name = v_name
      and branch_released_at is null
      and task_id is distinct from p_task_id
  ) loop
    v_n := v_n + 1;
    v_name := v_base || '-' || lpad(v_n::text, 2, '0');
  end loop;
  return v_name;
end;
$$;

revoke all on function public.claim_development_branch_name(uuid, text, uuid, boolean)
  from public, anon, authenticated;

-- ── creating a Development Task ─────────────────────────────────────────────
-- As in 20260926180000, plus p_take_over_branch (see above).
drop function if exists public.create_development_task(
  uuid, uuid, text, text, uuid, uuid, text, text, text
);

create or replace function public.create_development_task(
  p_id uuid,
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_goal_id uuid,
  p_assignee_id uuid,
  p_priority text,
  p_work_type text,
  p_branch_name text,
  p_take_over_branch boolean default false
)
returns public.task_development
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_result public.task_development%rowtype;
begin
  perform public.assert_development_enabled(p_workspace_id, v_actor_id);

  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'invalid priority' using errcode = '22023';
  end if;

  if coalesce(p_work_type, '') not in (
    'feature', 'bug', 'hotfix', 'improvement', 'refactor', 'chore', 'docs'
  ) then
    raise exception 'invalid task type' using errcode = '22023';
  end if;

  if p_goal_id is not null and not exists (
    select 1 from public.goals
    where id = p_goal_id and workspace_id = p_workspace_id and status = 'active'
  ) then
    raise exception 'goal not found in this workspace' using errcode = '22023';
  end if;

  -- The shared task RPC writes the ordinary created/goal_task_created event
  -- before task_development exists. Suppress only that Slack payload in this
  -- transaction, then write the Development-specific event below once the
  -- branch/work type are available.
  perform set_config('ontask.suppress_development_task_base_created_slack', 'on', true);

  v_task := public.create_workspace_task_with_collaborators(
    p_id, p_workspace_id, null, p_goal_id, null,
    p_title, nullif(btrim(coalesce(p_description, '')), ''),
    null, null, null,
    case when p_assignee_id is null then array[]::uuid[] else array[p_assignee_id] end
  );

  if p_priority is not null then
    update public.workspace_tasks set priority = p_priority where id = v_task.id;
  end if;

  insert into public.task_development (task_id, workspace_id, branch_name, work_type, created_by)
  values (
    v_task.id, p_workspace_id,
    public.claim_development_branch_name(
      p_workspace_id, p_branch_name, v_task.id, coalesce(p_take_over_branch, false)),
    p_work_type,
    v_actor_id
  )
  returning * into v_result;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
  values (
    v_task.id, v_task.workspace_id, v_task.goal_id, v_actor_id,
    'development_tracking_enabled',
    jsonb_build_object(
      'title', v_task.title,
      'branch', v_result.branch_name,
      'work_type', v_result.work_type,
      'source', 'create_development_task'
    )
  );

  return v_result;
end;
$$;

revoke all on function public.create_development_task(
  uuid, uuid, text, text, uuid, uuid, text, text, text, boolean
) from public, anon;
grant execute on function public.create_development_task(
  uuid, uuid, text, text, uuid, uuid, text, text, text, boolean
) to authenticated;

-- ── the one entry point ─────────────────────────────────────────────────────
-- As in 20260926190000, except that a branch (and a PR not yet linked, by its
-- source branch) only ever reaches the task currently holding the branch.
create or replace function public.apply_github_development_event(
  p_delivery_id text, p_event jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text := p_event->>'kind';
  v_installation_id bigint := nullif(p_event->>'installation_id', '')::bigint;
  v_repository_id bigint := nullif(p_event->>'repository_id', '')::bigint;
  v_repository_ids bigint[];
  v_conn record;
  v_task_id uuid;
  v_outcome text;
  v_results jsonb := '[]'::jsonb;
begin
  if p_delivery_id is not null then
    insert into public.github_webhook_deliveries (delivery_id, event_kind)
      values (p_delivery_id, v_kind)
      on conflict (delivery_id) do nothing;
    if not found then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
    delete from public.github_webhook_deliveries
      where received_at < now() - interval '14 days';
  end if;

  if v_kind = 'installation_deleted' then
    update public.workspace_github_connections set status = 'disconnected'
      where installation_id = v_installation_id;
    return jsonb_build_object('outcome', 'installation_deleted');
  elsif v_kind = 'installation_suspended' then
    update public.workspace_github_connections set status = 'suspended'
      where installation_id = v_installation_id and status <> 'disconnected';
    return jsonb_build_object('outcome', 'installation_suspended');
  elsif v_kind = 'installation_unsuspended' then
    update public.workspace_github_connections
      set status = case when repository_id is null then 'repository_required' else 'connected' end
      where installation_id = v_installation_id and status = 'suspended';
    return jsonb_build_object('outcome', 'installation_unsuspended');
  elsif v_kind in ('repositories_removed', 'repositories_added') then
    select coalesce(array_agg(value::bigint), array[]::bigint[]) into v_repository_ids
      from jsonb_array_elements_text(coalesce(p_event->'repository_ids', '[]'::jsonb));
    if v_kind = 'repositories_removed' then
      update public.workspace_github_connections set status = 'repository_access_lost'
        where installation_id = v_installation_id
          and repository_id = any(v_repository_ids)
          and status = 'connected';
    else
      update public.workspace_github_connections set status = 'connected'
        where installation_id = v_installation_id
          and repository_id = any(v_repository_ids)
          and status = 'repository_access_lost';
    end if;
    return jsonb_build_object('outcome', v_kind);
  end if;

  if v_kind not in ('branch', 'branch_deleted', 'pull_request') or v_repository_id is null then
    return jsonb_build_object('outcome', 'ignored');
  end if;

  -- Every workspace tracking this repository through this installation.
  for v_conn in
    select c.workspace_id, c.repository_full_name
    from public.workspace_github_connections c
    join public.workspaces w on w.id = c.workspace_id
    where c.repository_id = v_repository_id
      and c.installation_id = v_installation_id
      and c.status = 'connected'
      and w.development_enabled
  loop
    v_task_id := null;

    if v_kind in ('branch', 'branch_deleted') then
      -- Exact name only: a branch named differently is never adopted. How the
      -- branch came to exist (created, pushed, renamed) doesn't matter.
      select task_id into v_task_id from public.task_development
        where workspace_id = v_conn.workspace_id
          and branch_name = p_event->>'branch'
          and branch_released_at is null;
      if v_task_id is not null and v_kind = 'branch' then
        v_outcome := case when public.apply_development_branch_seen(
          v_task_id, v_repository_id, v_conn.repository_full_name,
          nullif(p_event->>'seen_at', '')::timestamptz
        ) then 'branch_detected' else 'unchanged' end;
      elsif v_task_id is not null then
        v_outcome := case when public.apply_development_branch_deleted(v_task_id)
          then 'needs_attention' else 'unchanged' end;
      end if;
    else
      -- The PR's stable id first; its source branch only for a PR not yet linked.
      select task_id into v_task_id from public.task_development
        where workspace_id = v_conn.workspace_id
          and pr_id = (p_event->'pull_request'->>'id')::bigint;
      if v_task_id is null then
        select task_id into v_task_id from public.task_development
          where workspace_id = v_conn.workspace_id
            and branch_name = p_event->>'branch'
            and branch_released_at is null;
      end if;
      if v_task_id is not null then
        v_outcome := public.apply_development_pull_request(
          v_task_id, v_repository_id, v_conn.repository_full_name,
          p_event->'pull_request');
      end if;
    end if;

    if v_task_id is not null then
      v_results := v_results || jsonb_build_object('task_id', v_task_id, 'outcome', v_outcome);
    end if;
  end loop;

  return jsonb_build_object('outcome', 'processed', 'tasks', v_results);
end;
$$;

revoke all on function public.apply_github_development_event(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_github_development_event(text, jsonb) to service_role;
