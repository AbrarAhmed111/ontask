-- Clear completed tasks from active task views without deleting task history.
-- The task row, task_events, task_time_entries, Daily Updates, Daily Reports,
-- blockers, Slack references and every FK-backed historical reference remain
-- intact. Reopening a task makes it visible again.

alter table public.workspace_tasks
  add column if not exists completed_cleared_at timestamptz;

create index if not exists workspace_tasks_completed_cleared_idx
  on public.workspace_tasks (workspace_id, goal_id, completed_cleared_at)
  where completed_cleared_at is not null;

create or replace function public.clear_completed_workspace_tasks(
  p_workspace_id uuid,
  p_goal_id uuid default null
)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_user_id
  ) then
    raise exception 'not a member of this workspace'
      using errcode = '42501';
  end if;

  if p_goal_id is not null and not exists (
    select 1
    from public.goals
    where id = p_goal_id and workspace_id = p_workspace_id
  ) then
    raise exception 'goal not found';
  end if;

  update public.workspace_tasks
    set completed_cleared_at = now()
    where workspace_id = p_workspace_id
      and (
        (p_goal_id is null and goal_id is null)
        or (p_goal_id is not null and goal_id = p_goal_id)
      )
      and status in ('completed', 'skipped')
      and completed_cleared_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clear_completed_workspace_tasks(uuid, uuid)
  from public, anon;
grant execute on function public.clear_completed_workspace_tasks(uuid, uuid)
  to authenticated;

create or replace function public.reopen_workspace_task(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_goal_id uuid;
  v_assigned_to uuid;
  v_status text;
  v_result public.workspace_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select workspace_id, goal_id, assigned_to, status
    into v_workspace_id, v_goal_id, v_assigned_to, v_status
    from public.workspace_tasks where id = p_task_id for update;

  if v_workspace_id is null then
    raise exception 'task not found';
  end if;

  perform public.assert_workspace_task_timer_controller(v_workspace_id, v_assigned_to, v_user_id);
  perform set_config('ontask.timer_write', 'on', true);

  update public.workspace_tasks
    set status = 'queued',
        started_at = null,
        completed_at = null,
        completed_cleared_at = null
    where id = p_task_id
    returning * into v_result;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_workspace_id, v_goal_id, v_user_id, 'reopened',
      jsonb_build_object('title', v_result.title));

  return v_result;
end;
$$;

grant execute on function public.reopen_workspace_task(uuid) to authenticated;
