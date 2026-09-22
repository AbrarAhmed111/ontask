-- Collaborator-aware RPCs manage task_collaborators themselves. The legacy
-- assigned_to sync trigger must stand down during those writes, otherwise it
-- can remove/reinsert collaborator rows while the RPC is still assembling the
-- new active set.

create or replace function public.sync_primary_assignee_collaborator()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_active_count integer;
  v_actor uuid := auth.uid();
begin
  if current_setting('ontask.skip_assignee_collaborator_sync', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into public.task_collaborators (task_id, workspace_id, user_id, participation_status)
      values (new.id, new.workspace_id, new.assigned_to, new.status)
      on conflict (task_id, user_id) where removed_at is null do nothing;
    end if;
    return new;
  end if;

  if old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;

  select count(*)::integer into v_active_count
  from public.task_collaborators
  where task_id = new.id and removed_at is null;

  if old.assigned_to is not null and v_active_count <= 1 then
    update public.task_collaborators
      set removed_at = now(),
          removed_by = v_actor,
          participation_status = case
            when participation_status = 'working' then 'paused'
            else participation_status
          end,
          started_at = null
      where task_id = new.id
        and user_id = old.assigned_to
        and removed_at is null;
  end if;

  if new.assigned_to is not null then
    insert into public.task_collaborators (task_id, workspace_id, user_id, participation_status)
    values (new.id, new.workspace_id, new.assigned_to, 'queued')
    on conflict (task_id, user_id) where removed_at is null do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.set_workspace_task_collaborators(
  p_task_id uuid,
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
  v_added_seconds int := 0;
  v_result public.workspace_tasks%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task
  from public.workspace_tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'task not found';
  end if;

  if not public.is_workspace_member(v_task.workspace_id, v_actor_id) then
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
    where wm.workspace_id = v_task.workspace_id
      and wm.user_id = selected.user_id
  )
  limit 1;

  if v_invalid_user_id is not null then
    raise exception 'assignee must be a current workspace member'
      using errcode = '42501';
  end if;

  if v_task.status = 'blocked' and array_length(v_user_ids, 1) is null then
    raise exception 'a blocked task must keep at least one assignee'
      using errcode = '55000';
  end if;

  v_primary_user_id := v_user_ids[1];

  with closed_entries as (
    update public.task_time_entries tte
    set ended_at = now(),
        duration_seconds = greatest(
          0,
          extract(epoch from (now() - tte.started_at))::int
        )
    where tte.task_id = p_task_id
      and tte.task_kind = 'workspace'
      and tte.ended_at is null
      and not (tte.user_id = any(v_user_ids))
    returning duration_seconds
  )
  select coalesce(sum(duration_seconds), 0)::int
  into v_added_seconds
  from closed_entries;

  perform set_config('ontask.timer_write', 'on', true);
  perform set_config('ontask.skip_assignee_collaborator_sync', 'on', true);

  update public.workspace_tasks
  set assigned_to = v_primary_user_id,
      actual_seconds = actual_seconds + v_added_seconds
  where id = p_task_id;

  update public.task_collaborators tc
  set removed_at = now(),
      removed_by = v_actor_id,
      participation_status = case
        when tc.participation_status = 'working' then 'paused'
        else tc.participation_status
      end,
      started_at = null
  where tc.task_id = p_task_id
    and tc.removed_at is null
    and not (tc.user_id = any(v_user_ids));

  insert into public.task_collaborators (
    task_id,
    workspace_id,
    user_id,
    participation_status
  )
  select p_task_id, v_task.workspace_id, selected.user_id, 'queued'
  from unnest(v_user_ids) as selected(user_id)
  on conflict (task_id, user_id) where removed_at is null do nothing;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  insert into public.task_events (
    task_id,
    workspace_id,
    goal_id,
    actor_id,
    event_type,
    metadata
  )
  values (
    p_task_id,
    v_task.workspace_id,
    v_task.goal_id,
    v_actor_id,
    'collaborators_changed',
    jsonb_build_object('user_ids', to_jsonb(v_user_ids))
  );

  return v_result;
end;
$$;

revoke all on function public.set_workspace_task_collaborators(uuid, uuid[])
  from public;

grant execute on function public.set_workspace_task_collaborators(uuid, uuid[])
  to authenticated;
