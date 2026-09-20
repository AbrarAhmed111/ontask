-- Manual verification for migration 0053.
-- The dependency RPC must be able to write despite table RLS, while raw
-- task_dependencies writes remain blocked.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_ws uuid;
  v_goal uuid;
  v_blocking uuid;
  v_blocked uuid;
  v_dep uuid;
  v_denied boolean;
begin
  insert into auth.users (id, email) values
    (v_owner, 'deps.test.owner@example.com'),
    (v_member, 'deps.test.member@example.com'),
    (v_outsider, 'deps.test.outsider@example.com');

  insert into public.workspaces (name, owner_id, timezone)
    values ('Dependency RLS Test', v_owner, 'UTC')
    returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, v_member, 'member');
  insert into public.goals (workspace_id, created_by, name, position)
    values (v_ws, v_owner, 'Launch', 1000)
    returning id into v_goal;
  insert into public.workspace_tasks
    (workspace_id, goal_id, created_by, assigned_to, title, planned_seconds, position)
    values (v_ws, v_goal, v_owner, v_member, 'Design', 3600, 1000)
    returning id into v_blocking;
  insert into public.workspace_tasks
    (workspace_id, goal_id, created_by, assigned_to, title, planned_seconds, position)
    values (v_ws, v_goal, v_owner, v_member, 'Build', 3600, 2000)
    returning id into v_blocked;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  v_dep := (public.add_task_dependency(v_blocking, v_blocked)).id;
  if v_dep is null then
    raise exception 'add_task_dependency did not return the new dependency';
  end if;

  v_denied := false;
  begin
    insert into public.task_dependencies (
      workspace_id, goal_id, blocking_task_id, blocked_task_id, created_by
    )
    values (v_ws, v_goal, v_blocked, v_blocking, v_member);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'raw insert into task_dependencies was allowed';
  end if;

  perform public.remove_task_dependency(v_dep);
  if exists (select 1 from public.task_dependencies where id = v_dep) then
    raise exception 'remove_task_dependency did not delete the dependency';
  end if;
  reset role;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  v_denied := false;
  begin
    perform public.add_task_dependency(v_blocking, v_blocked);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'outsider added a dependency';
  end if;
  reset role;

  perform set_config('request.jwt.claims', '', true);
end;
$$;

delete from auth.users where email like 'deps.test.%@example.com';
