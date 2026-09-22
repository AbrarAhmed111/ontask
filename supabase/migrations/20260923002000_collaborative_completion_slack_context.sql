-- Collaborative completion notifications should distinguish "this member
-- finished their part" from "the whole task is done". Store the remaining
-- active collaborators on the completion event so Slack can name them.

create or replace function public.complete_workspace_task(
  p_task_id uuid, p_skip boolean default false
)
returns public.workspace_tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_open_entry public.task_time_entries%rowtype;
  v_duration int := 0;
  v_result public.workspace_tasks%rowtype;
  v_dep record;
  v_event_type text;
  v_remaining_user_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  if v_task.status = 'blocked' then
    raise exception 'this task is blocked -- resolve its blocker before finishing it'
      using errcode = '55000';
  end if;
  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);

  select * into v_open_entry from public.task_time_entries
    where user_id = v_user_id and task_id = p_task_id and task_kind = 'workspace'
      and ended_at is null for update;

  if found then
    v_duration := greatest(0, extract(epoch from (now() - v_open_entry.started_at))::int);
    update public.task_time_entries
      set ended_at = now(), duration_seconds = v_duration
      where id = v_open_entry.id;
  end if;

  perform set_config('ontask.timer_write', 'on', true);
  update public.workspace_tasks
    set actual_seconds = actual_seconds + v_duration
    where id = p_task_id;

  update public.task_collaborators
    set participation_status = case when p_skip then 'skipped' else 'completed' end,
        started_at = null,
        completed_at = now()
    where task_id = p_task_id
      and user_id = v_user_id
      and removed_at is null;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  select coalesce(array_agg(tc.user_id order by tc.created_at, tc.user_id), array[]::uuid[])
    into v_remaining_user_ids
    from public.task_collaborators tc
    where tc.task_id = p_task_id
      and tc.removed_at is null
      and tc.user_id <> v_user_id
      and tc.participation_status not in ('completed', 'skipped');

  v_event_type := case
    when v_result.status in ('completed', 'skipped') then v_result.status
    when p_skip then 'skipped'
    else 'completed'
  end;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id,
      v_event_type,
      jsonb_build_object(
        'title', v_result.title,
        'collaborator_user_id', v_user_id,
        'task_overall_status', v_result.status,
        'remaining_user_ids', to_jsonb(v_remaining_user_ids)
      ));

  if v_task.goal_id is not null and v_result.status in ('completed', 'skipped') then
    for v_dep in
      select td.blocked_task_id, wt.title, wt.workspace_id
      from public.task_dependencies td
      join public.workspace_tasks wt on wt.id = td.blocked_task_id
      where td.blocking_task_id = p_task_id
    loop
      if not exists (
        select 1
        from public.task_dependencies td2
        join public.workspace_tasks bt on bt.id = td2.blocking_task_id
        where td2.blocked_task_id = v_dep.blocked_task_id
          and bt.status not in ('completed', 'skipped')
      ) then
        insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
          values (v_dep.blocked_task_id, v_dep.workspace_id, v_task.goal_id, v_user_id, 'task_unblocked',
            jsonb_build_object('title', v_dep.title));
      end if;
    end loop;
  end if;

  return v_result;
end;
$$;

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
begin
  v_slack_event_type := case new.event_type
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
  v_recipient_user_ids := case
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

  if v_slack_event_type in ('goal_created', 'goal_completed', 'goal_archived', 'goal_deleted') then
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
    'blockerReason', nullif(new.metadata->>'reason', ''),
    'createdAt', new.created_at
  );
end;
$$;

grant execute on function public.slack_payload_for_task_event(public.task_events) to authenticated;
