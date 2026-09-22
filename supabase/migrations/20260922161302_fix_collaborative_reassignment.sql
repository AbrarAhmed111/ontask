-- The task insert still runs the existing sync_primary_assignee_collaborator()
-- trigger. Make the collaborative create RPC tolerate that primary row already
-- existing before it inserts the full collaborator list.

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
  from unnest(v_user_ids) as selected(user_id)
  on conflict (task_id, user_id) where removed_at is null do nothing;

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
