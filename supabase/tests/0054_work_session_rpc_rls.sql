-- Manual verification for migration 0054.
-- Work Session RPCs must write under RLS, while raw table writes remain
-- blocked and outsiders cannot mutate another workspace's sessions.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_ws uuid;
  v_session public.work_sessions%rowtype;
  v_denied boolean;
begin
  insert into auth.users (id, email) values
    (v_owner, 'work-session.test.owner@example.com'),
    (v_member, 'work-session.test.member@example.com'),
    (v_outsider, 'work-session.test.outsider@example.com');

  insert into public.workspaces (name, owner_id, timezone)
    values ('Work Session RLS Test', v_owner, 'UTC')
    returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, v_member, 'member');

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  v_session := public.start_work_session(v_ws);
  if v_session.workspace_id <> v_ws
     or v_session.user_id <> v_member
     or v_session.ended_at is not null
     or v_session.status <> 'working' then
    raise exception 'start_work_session returned an invalid session: %', v_session;
  end if;

  v_session := public.take_work_break(v_ws);
  if v_session.status <> 'break' or v_session.current_break_started_at is null then
    raise exception 'take_work_break did not start a break';
  end if;

  v_session := public.resume_work_session(v_ws);
  if v_session.status <> 'working' or v_session.current_break_started_at is not null then
    raise exception 'resume_work_session did not return to working';
  end if;

  v_denied := false;
  begin
    insert into public.work_sessions (workspace_id, user_id)
      values (v_ws, v_member);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'raw insert into work_sessions was allowed';
  end if;

  v_session := public.end_work_session(v_ws);
  if v_session.ended_at is null then
    raise exception 'end_work_session did not end the session';
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
    perform public.start_work_session(v_ws);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'outsider started a work session';
  end if;
  reset role;

  perform set_config('request.jwt.claims', '', true);
end;
$$;

delete from auth.users where email like 'work-session.test.%@example.com';
