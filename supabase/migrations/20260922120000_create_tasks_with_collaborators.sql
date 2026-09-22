-- Create collaborative tasks in one database transaction so realtime and Slack
-- never observe the task before its collaborator rows exist.

create or replace function public.log_workspace_task_created()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_event_type text;
  v_goal_name text;
begin
  if current_setting('ontask.defer_task_created_event', true) = 'on' then
    return new;
  end if;

  if new.goal_id is not null then
    select name into v_goal_name from public.goals where id = new.goal_id;
    v_event_type := case when new.parent_task_id is not null
      then 'goal_subtask_created' else 'goal_task_created' end;
  else
    v_event_type := 'created';
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (new.id, new.workspace_id, new.goal_id, new.created_by, v_event_type,
      jsonb_build_object(
        'title', new.title,
        'goal_name', v_goal_name,
        'to_user_id', new.assigned_to,
        'to_user_ids', case
          when new.assigned_to is null then '[]'::jsonb
          else jsonb_build_array(new.assigned_to)
        end
      ));

  if new.assigned_to is not null then
    insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
      values (new.id, new.workspace_id, new.goal_id, new.created_by, 'assigned',
        jsonb_build_object(
          'title', new.title,
          'to_user_id', new.assigned_to,
          'to_user_ids', jsonb_build_array(new.assigned_to),
          'at_creation', true
        ));
  end if;

  return new;
end;
$$;

create or replace function public.create_workspace_task_with_collaborators(
  p_id uuid,
  p_workspace_id uuid,
  p_parent_task_id uuid,
  p_goal_id uuid,
  p_idea_id uuid,
  p_title text,
  p_description text,
  p_planned_seconds integer,
  p_progress_label text,
  p_progress_percentage integer,
  p_user_ids uuid[]
)
returns public.workspace_tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_user_ids uuid[];
  v_primary_user_id uuid;
  v_invalid_user_id uuid;
  v_event_type text;
  v_goal_name text;
begin
  if v_actor_id is null then
    raise exception 'not authenticated';
  end if;

  if nullif(btrim(p_title), '') is null then
    raise exception 'task title is required' using errcode = '23514';
  end if;

  if not public.is_workspace_member(p_workspace_id, v_actor_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(array_agg(user_id order by ordinality), array[]::uuid[])
  into v_user_ids
  from (
    select distinct on (user_id) user_id, ordinality
    from unnest(coalesce(p_user_ids, array[]::uuid[])) with ordinality
      as selected(user_id, ordinality)
    where user_id is not null
    order by user_id, ordinality
  ) deduped;

  select selected.user_id
  into v_invalid_user_id
  from unnest(v_user_ids) as selected(user_id)
  where not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = selected.user_id
  )
  limit 1;

  if v_invalid_user_id is not null then
    raise exception 'assignee must be a current workspace member'
      using errcode = '42501';
  end if;

  v_primary_user_id := v_user_ids[1];

  perform set_config('ontask.defer_task_created_event', 'on', true);

  insert into public.workspace_tasks (
    id,
    workspace_id,
    parent_task_id,
    goal_id,
    idea_id,
    created_by,
    assigned_to,
    title,
    description,
    planned_seconds,
    progress_label,
    progress_percentage
  )
  values (
    p_id,
    p_workspace_id,
    p_parent_task_id,
    p_goal_id,
    p_idea_id,
    v_actor_id,
    v_primary_user_id,
    btrim(p_title),
    p_description,
    p_planned_seconds,
    p_progress_label,
    p_progress_percentage
  )
  returning * into v_task;

  insert into public.task_collaborators (
    task_id,
    workspace_id,
    user_id,
    participation_status
  )
  select v_task.id, v_task.workspace_id, selected.user_id, 'queued'
  from unnest(v_user_ids) as selected(user_id);

  if v_task.goal_id is not null then
    select name into v_goal_name from public.goals where id = v_task.goal_id;
    v_event_type := case when v_task.parent_task_id is not null
      then 'goal_subtask_created' else 'goal_task_created' end;
  else
    v_event_type := 'created';
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (v_task.id, v_task.workspace_id, v_task.goal_id, v_actor_id, v_event_type,
      jsonb_build_object(
        'title', v_task.title,
        'goal_name', v_goal_name,
        'to_user_id', v_primary_user_id,
        'to_user_ids', to_jsonb(v_user_ids)
      ));

  if v_primary_user_id is not null then
    insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
      values (v_task.id, v_task.workspace_id, v_task.goal_id, v_actor_id, 'assigned',
        jsonb_build_object(
          'title', v_task.title,
          'to_user_id', v_primary_user_id,
          'to_user_ids', to_jsonb(v_user_ids),
          'at_creation', true
        ));
  end if;

  return v_task;
end;
$$;

revoke all on function public.create_workspace_task_with_collaborators(
  uuid, uuid, uuid, uuid, uuid, text, text, integer, text, integer, uuid[]
) from public;

grant execute on function public.create_workspace_task_with_collaborators(
  uuid, uuid, uuid, uuid, uuid, text, text, integer, text, integer, uuid[]
) to authenticated;

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
    'previousAssigneeId', nullif(new.metadata->>'from_user_id', ''),
    'selfRemoved', coalesce((new.metadata->>'self_removed')::boolean, false),
    'blockerReason', nullif(new.metadata->>'reason', ''),
    'createdAt', new.created_at
  );
end;
$$;

grant execute on function public.slack_payload_for_task_event(public.task_events) to authenticated;
