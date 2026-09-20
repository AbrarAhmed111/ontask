-- Fix Goal dependency RPCs under RLS.
--
-- task_dependencies intentionally has no INSERT/DELETE policies so clients
-- cannot bypass cycle checks or event logging with raw table writes. The
-- original RPCs were SECURITY INVOKER, so their own INSERT/DELETE statements
-- were still blocked by RLS. Keep the table locked down and make the guarded
-- RPCs the write boundary.

create or replace function public.add_task_dependency(
  p_blocking_task_id uuid, p_blocked_task_id uuid
)
returns public.task_dependencies
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_blocking public.workspace_tasks%rowtype;
  v_blocked public.workspace_tasks%rowtype;
  v_would_cycle boolean;
  v_row public.task_dependencies%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_blocking_task_id = p_blocked_task_id then
    raise exception 'a task cannot block itself';
  end if;

  select * into v_blocking from public.workspace_tasks
    where id = p_blocking_task_id;
  select * into v_blocked from public.workspace_tasks
    where id = p_blocked_task_id;
  if v_blocking.id is null or v_blocked.id is null then
    raise exception 'task not found';
  end if;
  if v_blocking.goal_id is null
     or v_blocking.goal_id is distinct from v_blocked.goal_id
     or v_blocking.workspace_id is distinct from v_blocked.workspace_id then
    raise exception 'dependencies are only allowed between tasks in the same goal';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = v_blocking.workspace_id and user_id = v_user_id
  ) then
    raise exception 'not a member of this workspace'
      using errcode = '42501';
  end if;

  with recursive upstream(task_id, depth) as (
    select p_blocked_task_id, 0
    union all
    select td.blocking_task_id, upstream.depth + 1
    from public.task_dependencies td
    join upstream on td.blocked_task_id = upstream.task_id
    where upstream.depth < 50
  )
  select exists (select 1 from upstream where task_id = p_blocking_task_id)
    into v_would_cycle;
  if v_would_cycle then
    raise exception 'this would create a circular dependency';
  end if;

  insert into public.task_dependencies (
    workspace_id, goal_id, blocking_task_id, blocked_task_id, created_by
  )
  values (
    v_blocking.workspace_id,
    v_blocking.goal_id,
    p_blocking_task_id,
    p_blocked_task_id,
    v_user_id
  )
  returning * into v_row;

  insert into public.task_events (
    task_id, workspace_id, goal_id, actor_id, event_type, metadata
  )
  values (
    p_blocked_task_id,
    v_blocking.workspace_id,
    v_blocking.goal_id,
    v_user_id,
    'dependency_added',
    jsonb_build_object(
      'title', v_blocked.title,
      'blocking_task_id', p_blocking_task_id,
      'blocking_title', v_blocking.title
    )
  );

  if v_blocking.status not in ('completed', 'skipped') then
    insert into public.task_events (
      task_id, workspace_id, goal_id, actor_id, event_type, metadata
    )
    values (
      p_blocked_task_id,
      v_blocking.workspace_id,
      v_blocking.goal_id,
      v_user_id,
      'task_blocked',
      jsonb_build_object(
        'title', v_blocked.title,
        'blocking_task_id', p_blocking_task_id,
        'blocking_title', v_blocking.title
      )
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.remove_task_dependency(p_dependency_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.task_dependencies%rowtype;
  v_blocked_title text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.task_dependencies
    where id = p_dependency_id;
  if v_row.id is null then
    raise exception 'dependency not found';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = v_row.workspace_id and user_id = v_user_id
  ) then
    raise exception 'not a member of this workspace'
      using errcode = '42501';
  end if;

  select title into v_blocked_title from public.workspace_tasks
    where id = v_row.blocked_task_id;

  delete from public.task_dependencies where id = p_dependency_id;

  insert into public.task_events (
    task_id, workspace_id, goal_id, actor_id, event_type, metadata
  )
  values (
    v_row.blocked_task_id,
    v_row.workspace_id,
    v_row.goal_id,
    v_user_id,
    'dependency_removed',
    jsonb_build_object('title', v_blocked_title)
  );
end;
$$;

revoke all on function public.add_task_dependency(uuid, uuid)
  from public, anon;
revoke all on function public.remove_task_dependency(uuid)
  from public, anon;
grant execute on function public.add_task_dependency(uuid, uuid)
  to authenticated;
grant execute on function public.remove_task_dependency(uuid)
  to authenticated;
