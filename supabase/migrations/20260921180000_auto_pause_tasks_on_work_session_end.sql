-- Work-session logout, not auth sign-out, is what should stop the member's
-- active task timers. Undo the auth-signout helper and fold the pause into
-- end_work_session.

drop function if exists public.pause_my_running_workspace_tasks();

create or replace function public.end_work_session(p_workspace_id uuid)
returns public.work_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.work_sessions%rowtype;
  v_entry record;
  v_duration int;
  v_task public.workspace_tasks%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_workspace_member(p_workspace_id, v_user_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  update public.work_sessions
    set total_break_seconds = total_break_seconds
          + case
              when current_break_started_at is null then 0
              else greatest(0, extract(epoch from (now() - current_break_started_at))::int)
            end,
        status = 'working',
        current_break_started_at = null,
        ended_at = now(),
        updated_at = now()
    where workspace_id = p_workspace_id
      and user_id = v_user_id
      and ended_at is null
    returning * into v_result;

  if found then
    for v_entry in
      select tte.*, wt.title, wt.goal_id
      from public.task_time_entries tte
      join public.workspace_tasks wt on wt.id = tte.task_id
      where tte.workspace_id = p_workspace_id
        and tte.user_id = v_user_id
        and tte.task_kind = 'workspace'
        and tte.ended_at is null
      for update of tte
    loop
      v_duration := greatest(0, extract(epoch from (now() - v_entry.started_at))::int);

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

      v_task := public.apply_workspace_task_status_resolution(v_entry.task_id);

      insert into public.task_events (
        task_id, workspace_id, goal_id, actor_id, event_type, metadata
      )
      values (
        v_entry.task_id,
        p_workspace_id,
        v_entry.goal_id,
        v_user_id,
        'paused',
        jsonb_build_object(
          'title', coalesce(v_task.title, v_entry.title),
          'reason', 'work_session_ended'
        )
      );
    end loop;

    insert into public.task_events (
      task_id, workspace_id, actor_id, event_type, metadata
    )
    values (
      null,
      p_workspace_id,
      v_user_id,
      'work_session_ended',
      jsonb_build_object('session_id', v_result.id)
    );

    return v_result;
  end if;

  select * into v_result
    from public.work_sessions
    where workspace_id = p_workspace_id
      and user_id = v_user_id
    order by ended_at desc nulls last, started_at desc
    limit 1;

  if not found then
    raise exception 'active work session not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.end_work_session(uuid) from public, anon;
grant execute on function public.end_work_session(uuid) to authenticated;
