-- Development Tasks: Needs Attention, and reconciliation behind the webhooks.
--
-- The lifecycle stays Queued -> In Development -> In Review -> Completed
-- (derived in src/lib/development/tracking.ts). This adds the one exception
-- state, Needs Attention, for what GitHub did that a person has to act on:
--
--   - the tracked branch was deleted before any Pull Request was opened
--     (tracking_status 'branch_detected' + branch_deleted_at);
--   - the Pull Request was closed WITHOUT merging (tracking_status
--     'pr_closed' -- until now shown as In Development);
--   - the connection no longer reaches the task's repository (derived from
--     workspace_github_connections.status, never written per task).
--
-- Needs Attention never deletes, completes or resets the task. What does NOT
-- cause it, by construction:
--   - a branch deleted while its PR is open (the PR is what is tracked then);
--   - a branch deleted after the PR was merged (merged is final);
--   - a GitHub API failure: reconciliation only reports a deleted branch
--     after GitHub has answered 404 for the branch AND 200 for the
--     repository (src/lib/integrations/github/githubApp.ts). Anything else
--     changes nothing and is tried again later.
--
-- Every transition is written once, under the row lock, and only when the
-- state really changes -- so repeated webhook deliveries and reconciliation
-- runs write no new events and so send no new notifications. Slack hears
-- about the transitions the usual way (task_events ->
-- slack_payload_for_task_event), with its own count-based guard on top.
--
-- Missed webhooks: besides the existing check when someone opens a task, a
-- pg_cron job asks the app every 15 minutes to re-check a small batch of
-- active Development Tasks (list_development_tasks_to_reconcile), each at most
-- once every 30 minutes.

alter table public.task_development
  add column if not exists branch_deleted_at timestamptz;

-- ── vocabularies ────────────────────────────────────────────────────────────
alter table public.task_events drop constraint if exists task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'created', 'edited', 'deleted',
    'assigned', 'reassigned', 'unassigned',
    'started', 'paused', 'resumed', 'completed', 'skipped', 'reopened',
    'progress_changed', 'parent_changed', 'reordered',
    'member_invited', 'invitation_accepted', 'invitation_rejected',
    'invitation_cancelled', 'member_joined', 'member_removed',
    'goal_created', 'goal_updated', 'goal_completed', 'goal_archived',
    'goal_deleted',
    'goal_task_created', 'goal_subtask_created',
    'dependency_added', 'dependency_removed', 'task_blocked', 'task_unblocked',
    'note_added', 'note_updated', 'note_deleted',
    'resource_uploaded', 'resource_updated', 'resource_deleted',
    'task_blocker_added', 'task_blocker_updated', 'task_blocker_mention',
    'task_blocker_resolved',
    'work_session_started', 'work_session_ended',
    'development_tracking_enabled',
    'development_branch_detected',
    'development_pr_opened',
    'development_pr_closed',
    'development_pr_merged',
    'development_branch_deleted',
    'development_branch_restored'
  )
);

alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'assigned', 'reassigned', 'completed', 'reopened', 'task_unblocked',
    'goal_completed', 'invitation_accepted', 'invitation_rejected',
    'member_joined', 'member_removed', 'note_added', 'daily_report_ready',
    'timer_stopped', 'blocker_mention', 'blocker_resolved',
    'daily_update_mention',
    'development_branch_detected', 'development_pr_opened',
    'development_pr_merged', 'development_needs_attention'
  )
);

-- ── branch seen (created, pushed to, or re-created) ─────────────────────────
-- Returns true when that is news: first detection, or the branch coming back
-- after it was deleted.
create or replace function public.apply_development_branch_seen(
  p_task_id uuid, p_repository_id bigint, p_repository_full_name text, p_seen_at timestamptz
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.task_development%rowtype;
  v_task public.workspace_tasks%rowtype;
  v_event_id uuid;
begin
  select * into v_row from public.task_development where task_id = p_task_id for update;
  if v_row.task_id is null then
    return false;
  end if;

  if v_row.branch_detected_at is not null then
    if v_row.branch_deleted_at is null then
      return false;
    end if;
    -- The branch is back (pushed again with the same name).
    update public.task_development set branch_deleted_at = null where task_id = p_task_id;
    select * into v_task from public.workspace_tasks where id = p_task_id;
    -- Only a deletion that had put the task in Needs Attention is worth
    -- announcing as undone. With a PR open, closed or merged, the PR is what
    -- decides the stage and the branch coming back changes nothing visible.
    if v_row.tracking_status <> 'branch_detected'
       or v_task.status in ('completed', 'skipped') then
      return false;
    end if;
    insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id,
      coalesce(v_task.assigned_to, v_task.created_by), 'development_branch_restored',
      jsonb_build_object('title', v_task.title, 'branch', v_row.branch_name,
        'repository', coalesce(v_row.repository_full_name, p_repository_full_name),
        'source', 'github'));
    return true;
  end if;

  update public.task_development
    set branch_detected_at = coalesce(p_seen_at, now()),
        branch_deleted_at = null,
        repository_id = p_repository_id,
        repository_full_name = p_repository_full_name,
        tracking_status = case when tracking_status = 'waiting' then 'branch_detected' else tracking_status end
    where task_id = p_task_id;

  select * into v_task from public.workspace_tasks where id = p_task_id;
  -- A finished task keeps what GitHub says, without new activity or alerts.
  if v_task.status in ('completed', 'skipped') then
    return true;
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
  values (p_task_id, v_task.workspace_id, v_task.goal_id,
    coalesce(v_task.assigned_to, v_task.created_by), 'development_branch_detected',
    jsonb_build_object('title', v_task.title, 'branch', v_row.branch_name,
      'repository', p_repository_full_name, 'source', 'github'))
  returning id into v_event_id;

  perform public.notify_development_assignee(v_task, v_event_id,
    'development_branch_detected', 'Your branch was detected',
    v_task.title || E'\n' || v_row.branch_name);
  return true;
end;
$$;

revoke all on function public.apply_development_branch_seen(uuid, bigint, text, timestamptz)
  from public, anon, authenticated;

-- ── branch deleted ──────────────────────────────────────────────────────────
-- GitHub says the tracked branch no longer exists. Always remembered (so the
-- UI can say so); it only puts the task in Needs Attention when nothing else
-- carries the work: the branch had been seen, no PR was ever opened from it
-- (an open PR keeps it In Review, a closed one is Needs Attention already, a
-- merged one is Completed), and the task isn't finished. Returns true when
-- that happened.
create or replace function public.apply_development_branch_deleted(p_task_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.task_development%rowtype;
  v_task public.workspace_tasks%rowtype;
  v_event_id uuid;
begin
  select * into v_row from public.task_development where task_id = p_task_id for update;
  -- Never seen, or already known to be gone: nothing new.
  if v_row.task_id is null or v_row.branch_detected_at is null
     or v_row.branch_deleted_at is not null then
    return false;
  end if;

  update public.task_development set branch_deleted_at = now() where task_id = p_task_id;

  if v_row.tracking_status <> 'branch_detected' then
    return false;
  end if;
  select * into v_task from public.workspace_tasks where id = p_task_id;
  if v_task.status in ('completed', 'skipped') then
    return false;
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
  values (p_task_id, v_task.workspace_id, v_task.goal_id,
    coalesce(v_task.assigned_to, v_task.created_by), 'development_branch_deleted',
    jsonb_build_object('title', v_task.title, 'branch', v_row.branch_name,
      'repository', v_row.repository_full_name, 'reason', 'branch_deleted',
      'source', 'github'))
  returning id into v_event_id;

  perform public.notify_development_assignee(v_task, v_event_id,
    'development_needs_attention', 'Your branch was deleted',
    v_task.title || E'\n' || v_row.branch_name
      || ' was deleted before a Pull Request was merged. Push it again to keep going.');
  return true;
end;
$$;

revoke all on function public.apply_development_branch_deleted(uuid)
  from public, anon, authenticated;

-- ── Pull Request changed ────────────────────────────────────────────────────
-- As in 20260926180000, plus:
--   - a PR closed without merging notifies the assignee (Needs Attention);
--   - a PR that is open proves the branch exists again;
--   - a different PR that is itself closed without merging never replaces the
--     linked closed one -- it would only announce the same closed state twice.
create or replace function public.apply_development_pull_request(
  p_task_id uuid, p_repository_id bigint, p_repository_full_name text, p_pr jsonb
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.task_development%rowtype;
  v_task public.workspace_tasks%rowtype;
  v_pr_id bigint := (p_pr->>'id')::bigint;
  v_updated_at timestamptz := nullif(p_pr->>'updated_at', '')::timestamptz;
  v_merged boolean := coalesce((p_pr->>'merged')::boolean, false);
  v_state text;
  v_tracking text;
  v_same_pr boolean;
  v_event_type text;
  v_event_id uuid;
  v_actor uuid;
  v_meta jsonb;
begin
  select * into v_row from public.task_development where task_id = p_task_id for update;
  if v_row.task_id is null or v_pr_id is null then
    return 'unchanged';
  end if;

  v_same_pr := v_row.pr_id is not distinct from v_pr_id;

  v_state := case
    when v_merged then 'merged'
    when p_pr->>'state' = 'closed' then 'closed'
    else 'open'
  end;

  -- One task -> one PR. A different PR only replaces the linked one when that
  -- one was closed without merging (the developer opened a fresh PR) -- and
  -- the new one is open or merged, i.e. actually moves the task.
  if v_row.pr_id is not null and not v_same_pr
     and (v_row.pr_state is distinct from 'closed' or v_state = 'closed') then
    return 'unchanged';
  end if;

  if v_same_pr then
    -- Merged is final for a PR, and an older event never overwrites a newer one.
    if v_row.pr_state = 'merged' then
      return 'unchanged';
    end if;
    if v_updated_at is not null and v_row.pr_updated_at is not null
       and v_updated_at < v_row.pr_updated_at then
      return 'stale';
    end if;
  end if;

  v_tracking := case v_state
    when 'merged' then 'merged'
    when 'closed' then 'pr_closed'
    else 'in_review'
  end;

  update public.task_development
    set pr_id = v_pr_id,
        pr_number = (p_pr->>'number')::integer,
        pr_url = p_pr->>'url',
        pr_title = p_pr->>'title',
        pr_state = v_state,
        pr_opened_at = coalesce(nullif(p_pr->>'created_at', '')::timestamptz, pr_opened_at),
        pr_closed_at = nullif(p_pr->>'closed_at', '')::timestamptz,
        pr_merged_at = nullif(p_pr->>'merged_at', '')::timestamptz,
        pr_updated_at = coalesce(v_updated_at, pr_updated_at),
        pr_base_branch = coalesce(nullif(p_pr->>'base_branch', ''), pr_base_branch),
        tracking_status = v_tracking,
        -- A PR from the branch proves the branch exists, even if its own
        -- event was missed; an open one proves it still does.
        branch_detected_at = coalesce(branch_detected_at,
          nullif(p_pr->>'created_at', '')::timestamptz, now()),
        branch_deleted_at = case when v_state = 'open' then null else branch_deleted_at end,
        repository_id = coalesce(repository_id, p_repository_id),
        repository_full_name = coalesce(repository_full_name, p_repository_full_name)
    where task_id = p_task_id;

  -- Same PR, same stage (a new commit, an edited title): nothing to announce.
  if v_same_pr and v_row.tracking_status = v_tracking then
    return 'updated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id;
  if v_task.status in ('completed', 'skipped') then
    return v_tracking;
  end if;

  v_actor := coalesce(v_task.assigned_to, v_task.created_by);
  v_event_type := case v_state
    when 'merged' then 'development_pr_merged'
    when 'closed' then 'development_pr_closed'
    else 'development_pr_opened'
  end;
  v_meta := jsonb_build_object(
    'title', v_task.title,
    'branch', v_row.branch_name,
    'pr_number', (p_pr->>'number')::integer,
    'pr_url', p_pr->>'url',
    'pr_title', p_pr->>'title',
    'base_branch', nullif(p_pr->>'base_branch', ''),
    'reopened', v_same_pr and v_row.pr_state = 'closed',
    'source', 'github'
  );
  if v_state = 'closed' then
    v_meta := v_meta || jsonb_build_object('reason', 'pr_closed');
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
  values (p_task_id, v_task.workspace_id, v_task.goal_id, v_actor, v_event_type, v_meta)
  returning id into v_event_id;

  if v_state = 'open' then
    perform public.notify_development_assignee(v_task, v_event_id,
      'development_pr_opened', 'Your Pull Request was opened',
      v_task.title || E'\n#' || (p_pr->>'number') || ' ' || coalesce(p_pr->>'title', ''));
  elsif v_state = 'closed' then
    perform public.notify_development_assignee(v_task, v_event_id,
      'development_needs_attention', 'Your Pull Request was closed without merging',
      v_task.title || E'\n#' || (p_pr->>'number') || ' ' || coalesce(p_pr->>'title', ''));
  elsif v_state = 'merged' then
    perform public.notify_development_assignee(v_task, v_event_id,
      'development_pr_merged', 'Your Pull Request was merged',
      v_task.title || E'\n#' || (p_pr->>'number') || ' ' || coalesce(p_pr->>'title', ''));
    perform public.complete_task_from_merged_pr(p_task_id, v_actor,
      jsonb_build_object(
        'pr_number', (p_pr->>'number')::integer,
        'pr_url', p_pr->>'url',
        'pr_title', p_pr->>'title',
        'branch', v_row.branch_name,
        'base_branch', nullif(p_pr->>'base_branch', '')));
  end if;

  return v_tracking;
end;
$$;

revoke all on function public.apply_development_pull_request(uuid, bigint, text, jsonb)
  from public, anon, authenticated;

-- ── the one entry point ─────────────────────────────────────────────────────
-- As in 20260926120000, plus kind 'branch_deleted' (a `delete` webhook, a
-- push that deletes the ref, or reconciliation finding the branch gone while
-- the repository itself is reachable). Reconciliation reports a repository
-- the installation can no longer reach as 'repositories_removed', exactly as
-- GitHub's own webhook would.
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
      -- Exact name only: a branch named differently is never adopted.
      select task_id into v_task_id from public.task_development
        where workspace_id = v_conn.workspace_id
          and branch_name = p_event->>'branch';
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
            and branch_name = p_event->>'branch';
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

-- ── reconciliation queue ────────────────────────────────────────────────────
-- The Development Tasks GitHub could still move, oldest check first, that
-- nobody has checked in the last 30 minutes: not finished, PR not merged, in
-- a workspace with the module on and a working connection to the repository
-- the task is tracked in. The cron route claims each one
-- (claim_development_reconcile) before asking GitHub, so it never races the
-- check a person triggers by opening the task.
create or replace function public.list_development_tasks_to_reconcile(p_limit integer)
returns table (
  task_id uuid,
  workspace_id uuid,
  branch_name text,
  branch_detected_at timestamptz,
  pr_number integer,
  pr_state text,
  installation_id bigint,
  repository_id bigint,
  repository_full_name text
)
language sql stable security definer set search_path = public
as $$
  select d.task_id, d.workspace_id, d.branch_name, d.branch_detected_at,
         d.pr_number, d.pr_state,
         c.installation_id, c.repository_id, c.repository_full_name
  from public.task_development d
  join public.workspace_tasks t on t.id = d.task_id
  join public.workspaces w on w.id = d.workspace_id
  join public.workspace_github_connections c on c.workspace_id = d.workspace_id
  where w.development_enabled
    and c.status = 'connected'
    and c.repository_id is not null
    and (d.repository_id is null or d.repository_id = c.repository_id)
    and d.tracking_status <> 'merged'
    and t.status not in ('completed', 'skipped')
    and (d.last_reconciled_at is null or d.last_reconciled_at < now() - interval '30 minutes')
  order by d.last_reconciled_at asc nulls first, d.created_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.list_development_tasks_to_reconcile(integer)
  from public, anon, authenticated;
grant execute on function public.list_development_tasks_to_reconcile(integer) to service_role;

-- Every 15 minutes, through the same app_cron_config (URL + shared secret) as
-- the daily-reports job. A no-op until target_url is set.
select cron.unschedule(jobid) from cron.job where jobname = 'development-reconcile-tick';

select cron.schedule(
  'development-reconcile-tick',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := regexp_replace(
      (select target_url from public.app_cron_config limit 1),
      '/api/cron/daily-reports.*$', '/api/cron/development-reconcile'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from public.app_cron_config limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where (select target_url from public.app_cron_config limit 1) is not null;
  $cron$
);

-- ── Slack ───────────────────────────────────────────────────────────────────
-- As in 20260926180000, plus Needs Attention and its way back:
--   development_pr_closed       -> needs_attention (reason pr_closed)
--   development_branch_deleted  -> needs_attention (reason branch_deleted)
--   development_branch_restored -> in_development
-- Each announced once per real change: a transition is only announced again
-- after the one that undoes it (a close after a reopen, a deletion after a
-- restore). Counted rather than ordered, like In Review: events written in
-- one transaction share a timestamp.
create or replace function public.slack_payload_for_task_event(
  p_event public.task_events
)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  new public.task_events := p_event;
  v_slack_event_type text;
  v_entity_type text;
  v_entity_id text;
  v_recipient_user_id text;
  v_recipient_user_ids jsonb;
  v_remaining_collaborator_user_ids jsonb;
  v_entity_name text;
  v_goal_id uuid;
  v_goal_name text;
  v_task_title text;
  v_parent_title text;
  v_parent_task_id uuid;
  v_dev public.task_development%rowtype;
  v_dev_status text;
  v_dev_reason text;
  v_dev_created boolean := false;
  v_development jsonb;
begin
  if new.event_type in ('created', 'goal_task_created', 'goal_subtask_created')
     and current_setting('ontask.suppress_development_task_base_created_slack', true) = 'on' then
    return null;
  end if;

  -- A Development Task's stage, as OnTask recorded it:
  --   development_tracking_enabled -> Created with a branch to copy
  --   development_branch_detected  -> In Development
  --   development_branch_restored  -> In Development (again)
  --   development_pr_opened        -> In Review
  --   development_pr_closed        -> Needs Attention (closed, not merged)
  --   development_branch_deleted   -> Needs Attention (no PR to carry it)
  --   completed (source = github)  -> Completed. This is the task's own
  --     completion, written by complete_task_from_merged_pr() only once the
  --     task really is completed -- a merge on a blocked task completes
  --     nothing and so announces nothing.
  -- development_pr_merged maps to nothing: a merge is announced by the
  -- completion it causes rather than twice. A commit or push never writes an
  -- event at all.
  if new.task_id is not null and (
    new.event_type in (
      'development_tracking_enabled', 'development_branch_detected',
      'development_branch_restored', 'development_pr_opened',
      'development_pr_closed', 'development_branch_deleted')
    or (new.event_type = 'completed' and new.metadata->>'source' = 'github')
  ) then
    select * into v_dev from public.task_development where task_id = new.task_id;
    if v_dev.task_id is not null then
      v_dev_created := new.event_type = 'development_tracking_enabled';
      v_dev_status := case new.event_type
        when 'development_branch_detected' then 'in_development'
        when 'development_branch_restored' then 'in_development'
        when 'development_pr_opened' then 'in_review'
        when 'development_pr_closed' then 'needs_attention'
        when 'development_branch_deleted' then 'needs_attention'
        when 'development_tracking_enabled' then null
        else 'completed'
      end;
      v_dev_reason := case new.event_type
        when 'development_pr_closed' then 'pr_closed'
        when 'development_branch_deleted' then 'branch_deleted'
      end;
    end if;
  end if;

  -- The same stage announced once. OnTask's own state machine already
  -- writes each of these events once per real change (replayed deliveries,
  -- stale events and same-stage PR updates write nothing); this checks the
  -- task's event history as well, so a stage is never announced twice in a
  -- row however the event came to be written.
  if new.event_type = 'development_branch_detected' and v_dev_status is not null and exists (
    select 1 from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
      and e.event_type in ('development_branch_detected', 'development_pr_opened')
  ) then
    return null;
  end if;
  -- In Review again only after something took it out of review: a PR
  -- closed without merging. Opened and closed alternate, so the task is
  -- already In Review when its other events hold more openings than
  -- closings.
  if new.event_type = 'development_pr_opened' and v_dev_status is not null and (
    select count(*) filter (where e.event_type = 'development_pr_opened')
         > count(*) filter (where e.event_type = 'development_pr_closed')
    from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
  ) then
    return null;
  end if;
  -- Closed again only after a (re)opening. The first close is announced even
  -- when the opening itself was never seen.
  if new.event_type = 'development_pr_closed' and v_dev_status is not null and (
    select count(*) filter (where e.event_type = 'development_pr_closed') > 0
       and count(*) filter (where e.event_type = 'development_pr_closed')
        >= count(*) filter (where e.event_type = 'development_pr_opened')
    from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
  ) then
    return null;
  end if;
  -- Deleted again only after it was restored; restored only after a deletion.
  if new.event_type = 'development_branch_deleted' and v_dev_status is not null and (
    select count(*) filter (where e.event_type = 'development_branch_deleted')
         > count(*) filter (where e.event_type = 'development_branch_restored')
    from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
  ) then
    return null;
  end if;
  if new.event_type = 'development_branch_restored' and v_dev_status is not null and (
    select count(*) filter (where e.event_type = 'development_branch_restored')
        >= count(*) filter (where e.event_type = 'development_branch_deleted')
    from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
  ) then
    return null;
  end if;

  v_slack_event_type := case
    when v_dev_created then 'development_task_created'
    when v_dev_status is not null then 'development_status_changed'
    else case new.event_type
      when 'created' then 'task_created'
      when 'deleted' then 'task_deleted'
      when 'assigned' then 'assigned'
      when 'reassigned' then 'reassigned'
      when 'unassigned' then 'unassigned'
      when 'started' then 'started'
      when 'resumed' then 'resumed'
      when 'paused' then 'paused'
      when 'completed' then 'completed'
      when 'skipped' then 'skipped'
      when 'reopened' then 'reopened'
      when 'goal_task_created' then 'goal_task_created'
      when 'goal_subtask_created' then 'goal_subtask_created'
      when 'note_added' then 'note_added'
      when 'goal_created' then 'goal_created'
      when 'goal_completed' then 'goal_completed'
      when 'goal_archived' then 'goal_archived'
      when 'goal_deleted' then 'goal_deleted'
      when 'task_blocker_added' then 'blocker_created'
      when 'task_blocker_resolved' then 'blocker_resolved'
      when 'task_blocker_mention' then 'mentioned'
      when 'task_unblocked' then 'task_unblocked'
      when 'resource_uploaded' then 'resource_added'
      when 'resource_updated' then 'resource_updated'
      when 'resource_deleted' then 'resource_deleted'
      when 'member_invited' then 'member_invited'
      when 'member_joined' then 'member_joined'
      when 'member_removed' then 'member_removed'
      else null
    end
  end;

  if v_slack_event_type is null then
    return null;
  end if;

  if v_slack_event_type = 'assigned'
     and coalesce((new.metadata->>'at_creation')::boolean, false) then
    return null;
  end if;

  if v_slack_event_type = 'paused'
     and coalesce(new.metadata->>'reason', '') <> '' then
    return null;
  end if;

  v_recipient_user_id := coalesce(
    nullif(new.metadata->>'to_user_id', ''),
    nullif(new.metadata->>'mentioned_user_id', ''),
    nullif(new.metadata->>'removed_user_id', '')
  );
  -- Everyone the Development Task is assigned to.
  if v_dev_status is not null or v_dev_created then
    select coalesce(jsonb_agg(c.user_id order by c.created_at), '[]'::jsonb)
      into v_recipient_user_ids
      from public.task_collaborators c
      where c.task_id = new.task_id and c.removed_at is null;
    if v_recipient_user_ids = '[]'::jsonb then
      select case when t.assigned_to is null then '[]'::jsonb
        else jsonb_build_array(t.assigned_to) end
        into v_recipient_user_ids
        from public.workspace_tasks t where t.id = new.task_id;
    end if;
  end if;

  v_recipient_user_ids := case
    when v_dev_status is not null or v_dev_created then coalesce(v_recipient_user_ids, '[]'::jsonb)
    when jsonb_typeof(new.metadata->'to_user_ids') = 'array'
      then new.metadata->'to_user_ids'
    when v_recipient_user_id is not null
      then jsonb_build_array(v_recipient_user_id)
    else '[]'::jsonb
  end;
  v_remaining_collaborator_user_ids := case
    when jsonb_typeof(new.metadata->'remaining_user_ids') = 'array'
      then new.metadata->'remaining_user_ids'
    else '[]'::jsonb
  end;

  v_entity_name := coalesce(
    nullif(new.metadata->>'name', ''),
    nullif(new.metadata->>'file_name', ''),
    nullif(new.metadata->>'display_name', ''),
    nullif(new.metadata->>'removed_display_name', '')
  );

  if new.event_type = 'member_invited' then
    select coalesce(nullif(btrim(p.full_name), ''), p.email)
      into v_entity_name
      from public.profiles p
      where lower(p.email) = lower(new.metadata->>'invited_email');
    v_entity_name := coalesce(v_entity_name, nullif(new.metadata->>'invited_email', ''));
  end if;

  v_task_title := nullif(new.metadata->>'title', '');
  v_parent_title := nullif(new.metadata->>'parent_title', '');

  if new.task_id is not null and (v_task_title is null or v_parent_title is null) then
    select t.title, t.parent_task_id
      into v_task_title, v_parent_task_id
      from public.workspace_tasks t
      where t.id = new.task_id;
    v_task_title := coalesce(nullif(new.metadata->>'title', ''), v_task_title);

    if v_parent_title is null and v_parent_task_id is not null then
      select p.title into v_parent_title
        from public.workspace_tasks p where p.id = v_parent_task_id;
    end if;
  end if;

  v_goal_id := coalesce(new.goal_id, nullif(new.metadata->>'goal_id', '')::uuid);
  v_goal_name := nullif(new.metadata->>'goal_name', '');
  if v_goal_name is null and new.goal_id is not null then
    select name into v_goal_name from public.goals where id = new.goal_id;
  end if;

  if v_dev_status is not null or v_dev_created then
    v_entity_type := 'development_task';
    v_entity_id := new.task_id::text;
    -- The branch, always; the Pull Request only once there is one to review
    -- (In Review), that was merged (Completed) or closed (Needs Attention).
    -- The PR details come from the event when it carries them -- what was
    -- true when it happened -- and from the task's development row otherwise.
    v_development := jsonb_build_object(
      'status', v_dev_status,
      'attentionReason', v_dev_reason,
      'workType', v_dev.work_type,
      'branch', coalesce(nullif(new.metadata->>'branch', ''), v_dev.branch_name),
      'repository', coalesce(nullif(new.metadata->>'repository', ''), v_dev.repository_full_name),
      'prNumber', case when v_dev_status = 'in_development' or v_dev_reason = 'branch_deleted' then null
        else coalesce((new.metadata->>'pr_number')::integer, v_dev.pr_number) end,
      'prUrl', case when v_dev_status = 'in_development' or v_dev_reason = 'branch_deleted' then null
        else coalesce(nullif(new.metadata->>'pr_url', ''), v_dev.pr_url) end,
      'prTitle', case when v_dev_status = 'in_development' or v_dev_reason = 'branch_deleted' then null
        else coalesce(nullif(new.metadata->>'pr_title', ''), v_dev.pr_title) end,
      'baseBranch', case when v_dev_status = 'completed'
        then coalesce(nullif(new.metadata->>'base_branch', ''), v_dev.pr_base_branch) end
    );
  elsif v_slack_event_type in ('goal_created', 'goal_completed', 'goal_archived', 'goal_deleted') then
    v_entity_type := 'goal';
    v_entity_id := v_goal_id::text;
  elsif v_slack_event_type in ('resource_added', 'resource_updated', 'resource_deleted') then
    v_entity_type := 'resource';
    v_entity_id := nullif(new.metadata->>'resource_id', '');
  elsif v_slack_event_type = 'member_invited' then
    v_entity_type := 'invitation';
    select p.id::text into v_entity_id
      from public.profiles p
      where lower(p.email) = lower(new.metadata->>'invited_email');
  elsif v_slack_event_type in ('member_joined', 'member_removed') then
    v_entity_type := 'workspace_member';
    v_entity_id := coalesce(v_recipient_user_id, new.actor_id::text);
  else
    v_entity_type := case
      when v_goal_id is null then 'task'
      when v_slack_event_type = 'goal_subtask_created' then 'goal_subtask'
      when v_slack_event_type = 'goal_task_created' then 'goal_task'
      when v_parent_title is not null then 'goal_subtask'
      else 'goal_task'
    end;
    v_entity_id := new.task_id::text;
  end if;

  return jsonb_build_object(
    'workspaceId', new.workspace_id,
    'eventType', v_slack_event_type,
    'eventId', new.id,
    'entityType', v_entity_type,
    'entityId', v_entity_id,
    'taskId', new.task_id,
    'taskTitle', v_task_title,
    'parentTitle', v_parent_title,
    'goalId', v_goal_id,
    'goalName', v_goal_name,
    'entityName', v_entity_name,
    'actorId', new.actor_id,
    'recipientUserId', v_recipient_user_id,
    'recipientUserIds', v_recipient_user_ids,
    'remainingCollaboratorUserIds', v_remaining_collaborator_user_ids,
    'previousAssigneeId', nullif(new.metadata->>'from_user_id', ''),
    'selfRemoved', coalesce((new.metadata->>'self_removed')::boolean, false),
    'blockerReason', case when v_dev_status is null then nullif(new.metadata->>'reason', '') end,
    'development', v_development,
    'createdAt', new.created_at
  );
end;
$$;

grant execute on function public.slack_payload_for_task_event(public.task_events) to authenticated;
