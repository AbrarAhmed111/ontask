-- Sign-out should not leave the caller's workspace timers running. The client
-- calls this before ending the Supabase session, while auth.uid() is still
-- available.

create or replace function public.pause_my_running_workspace_tasks()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry record;
  v_duration int;
  v_paused_count int := 0;
  v_result public.workspace_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  for v_entry in
    select tte.*, wt.title, wt.goal_id
    from public.task_time_entries tte
    join public.workspace_tasks wt on wt.id = tte.task_id
    where tte.user_id = v_user_id
      and tte.task_kind = 'workspace'
      and tte.ended_at is null
    for update of tte
  loop
    v_duration := greatest(
      0,
      extract(epoch from (now() - v_entry.started_at))::int
    );

    update public.task_time_entries
    set ended_at = now(),
        duration_seconds = v_duration
    where id = v_entry.id;

    perform set_config('ontask.timer_write', 'on', true);

    update public.workspace_tasks
    set actual_seconds = actual_seconds + v_duration
    where id = v_entry.task_id;

    update public.task_collaborators
    set participation_status = 'paused',
        started_at = null
    where task_id = v_entry.task_id
      and user_id = v_user_id
      and removed_at is null
      and participation_status = 'working';

    v_result := public.apply_workspace_task_status_resolution(v_entry.task_id);

    insert into public.task_events (
      task_id,
      workspace_id,
      goal_id,
      actor_id,
      event_type,
      metadata
    )
    values (
      v_entry.task_id,
      v_entry.workspace_id,
      v_entry.goal_id,
      v_user_id,
      'paused',
      jsonb_build_object(
        'title', coalesce(v_result.title, v_entry.title),
        'reason', 'signout'
      )
    );

    v_paused_count := v_paused_count + 1;
  end loop;

  return v_paused_count;
end;
$$;

revoke all on function public.pause_my_running_workspace_tasks()
  from public, anon;

grant execute on function public.pause_my_running_workspace_tasks()
  to authenticated;
