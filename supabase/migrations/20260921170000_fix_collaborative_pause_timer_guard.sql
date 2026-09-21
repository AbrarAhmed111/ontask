-- Collaborative task pause: allow the RPC-owned actual_seconds write through
-- the timer-field guard.

create or replace function public.pause_workspace_task(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_open_entry public.task_time_entries%rowtype;
  v_duration int := 0;
  v_result public.workspace_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);
  if v_task.status = 'blocked' then
    raise exception 'this task is blocked -- resolve its blocker instead of pausing it'
      using errcode = '55000';
  end if;

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
    set participation_status = 'paused',
        started_at = null
    where task_id = p_task_id
      and user_id = v_user_id
      and removed_at is null;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id, 'paused',
      jsonb_build_object('title', v_result.title));

  return v_result;
end;
$$;

grant execute on function public.pause_workspace_task(uuid) to authenticated;
