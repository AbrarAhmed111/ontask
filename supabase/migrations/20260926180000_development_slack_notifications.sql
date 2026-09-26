-- Slack notifications for Development Tasks.
--
-- OnTask is the source of truth. GitHub only reports development state to
-- OnTask (api/integrations/github/webhook + reconcile ->
-- apply_github_development_event()), which moves the Development Task and
-- records that as OnTask task_events. Slack then hears about the task exactly
-- the way it hears about every other task: dispatch_slack_from_task_event()
-- on task_events asks slack_payload_for_task_event() what to post. There is no
-- GitHub-specific Slack path.
--
-- This migration:
--   - remembers which branch a Pull Request targets (task_development.
--     pr_base_branch), so "PR merged into main" can be said;
--   - carries that and the PR title on the events apply_development_pull_request()
--     writes, including the completion a merge causes;
--   - maps three OnTask events to a distinct Slack event type,
--     'development_status_changed' (entityType 'development_task'), with the
--     branch, repository and Pull Request attached. Normal task and goal
--     messages are unchanged -- except that the completion a merged PR causes
--     is announced as the Development Task's Completed message instead of,
--     not as well as, the generic "completed" one (it is the same event).

alter table public.task_development add column if not exists pr_base_branch text;

create or replace function public.create_development_task(
  p_id uuid,
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_goal_id uuid,
  p_assignee_id uuid,
  p_priority text,
  p_work_type text,
  p_branch_name text
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
    public.claim_development_branch_name(p_workspace_id, p_branch_name, v_task.id),
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
  uuid, uuid, text, text, uuid, uuid, text, text, text
) from public, anon;
grant execute on function public.create_development_task(
  uuid, uuid, text, text, uuid, uuid, text, text, text
) to authenticated;

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

  -- One task -> one PR. A different PR only replaces the linked one when that
  -- one was closed without merging (the developer opened a fresh PR).
  if v_row.pr_id is not null and not v_same_pr
     and v_row.pr_state is distinct from 'closed' then
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

  v_state := case
    when v_merged then 'merged'
    when p_pr->>'state' = 'closed' then 'closed'
    else 'open'
  end;
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
        -- event was missed.
        branch_detected_at = coalesce(branch_detected_at,
          nullif(p_pr->>'created_at', '')::timestamptz, now()),
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

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
  values (p_task_id, v_task.workspace_id, v_task.goal_id, v_actor, v_event_type, v_meta)
  returning id into v_event_id;

  if v_state = 'open' then
    perform public.notify_development_assignee(v_task, v_event_id,
      'development_pr_opened', 'Your Pull Request was opened',
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
  v_dev_created boolean := false;
  v_development jsonb;
begin
  if new.event_type in ('created', 'goal_task_created', 'goal_subtask_created')
     and current_setting('ontask.suppress_development_task_base_created_slack', true) = 'on' then
    return null;
  end if;

  -- A Development Task's stage, as OnTask recorded it. Only these three
  -- events move a Development Task forward in a way worth announcing:
  --   development_tracking_enabled -> Created with a branch to copy
  --   development_branch_detected  -> In Development
  --   development_pr_opened        -> In Review
  --   completed (source = github)  -> Completed. This is the task's own
  --     completion, written by complete_task_from_merged_pr() only once the
  --     task really is completed -- a merge on a blocked task completes
  --     nothing and so announces nothing.
  -- development_pr_closed and development_pr_merged map to nothing below:
  -- a PR closed without merging is not Completed, and a merge is announced
  -- by the completion it causes rather than twice. A commit or push never
  -- writes an event at all.
  if new.task_id is not null and (
    new.event_type = 'development_tracking_enabled'
    or
    new.event_type in ('development_branch_detected', 'development_pr_opened')
    or (new.event_type = 'completed' and new.metadata->>'source' = 'github')
  ) then
    select * into v_dev from public.task_development where task_id = new.task_id;
    if v_dev.task_id is not null then
      v_dev_created := new.event_type = 'development_tracking_enabled';
      v_dev_status := case new.event_type
        when 'development_branch_detected' then 'in_development'
        when 'development_pr_opened' then 'in_review'
        when 'development_tracking_enabled' then null
        else 'completed'
      end;
    end if;
  end if;

  -- The same stage announced once. OnTask's own state machine already
  -- writes each of these events once per real change (replayed deliveries,
  -- stale events and same-stage PR updates write nothing); this checks the
  -- task's event history as well, so a stage is never announced twice in a
  -- row however the event came to be written.
  if v_dev_status = 'in_development' and exists (
    select 1 from public.task_events e
    where e.task_id = new.task_id and e.id <> new.id
      and e.event_type in ('development_branch_detected', 'development_pr_opened')
  ) then
    return null;
  end if;
  -- In Review again only after something took it out of review: a PR
  -- closed without merging. Opened and closed alternate, so the task is
  -- already In Review when its other events hold more openings than
  -- closings. (Counted rather than ordered: events written in one
  -- transaction share a timestamp.)
  if v_dev_status = 'in_review' and (
    select count(*) filter (where e.event_type = 'development_pr_opened')
         > count(*) filter (where e.event_type = 'development_pr_closed')
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
    -- (In Review) or that was merged (Completed). The PR details come from
    -- the event when it carries them -- what was true when it happened --
    -- and from the task's development row otherwise.
    v_development := jsonb_build_object(
      'status', v_dev_status,
      'workType', v_dev.work_type,
      'branch', coalesce(nullif(new.metadata->>'branch', ''), v_dev.branch_name),
      'repository', coalesce(nullif(new.metadata->>'repository', ''), v_dev.repository_full_name),
      'prNumber', case when v_dev_status = 'in_development' then null
        else coalesce((new.metadata->>'pr_number')::integer, v_dev.pr_number) end,
      'prUrl', case when v_dev_status = 'in_development' then null
        else coalesce(nullif(new.metadata->>'pr_url', ''), v_dev.pr_url) end,
      'prTitle', case when v_dev_status = 'in_development' then null
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
