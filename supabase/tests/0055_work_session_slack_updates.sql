-- Manual verification for migration 0055.
-- Work session start/end should create exactly one task_events row for Slack,
-- while repeated calls and break/resume should not spam the channel.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_ws uuid;
  v_session public.work_sessions%rowtype;
  v_count integer;
begin
  insert into auth.users (id, email) values
    (v_owner, 'work-session-slack.test.owner@example.com'),
    (v_member, 'work-session-slack.test.member@example.com');

  insert into public.workspaces (name, owner_id, timezone)
    values ('Work Session Slack Test', v_owner, 'UTC')
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
  select count(*) into v_count
    from public.task_events
    where workspace_id = v_ws
      and actor_id = v_member
      and event_type = 'work_session_started'
      and metadata->>'session_id' = v_session.id::text;
  if v_count <> 1 then
    raise exception 'start_work_session should emit one work_session_started event, saw %', v_count;
  end if;

  perform public.start_work_session(v_ws);
  select count(*) into v_count
    from public.task_events
    where workspace_id = v_ws
      and actor_id = v_member
      and event_type = 'work_session_started';
  if v_count <> 1 then
    raise exception 'repeated start_work_session should not duplicate Slack events, saw %', v_count;
  end if;

  perform public.take_work_break(v_ws);
  perform public.resume_work_session(v_ws);
  select count(*) into v_count
    from public.task_events
    where workspace_id = v_ws
      and actor_id = v_member
      and event_type like 'work_session_%';
  if v_count <> 1 then
    raise exception 'break/resume should not emit work session Slack events, saw %', v_count;
  end if;

  v_session := public.end_work_session(v_ws);
  select count(*) into v_count
    from public.task_events
    where workspace_id = v_ws
      and actor_id = v_member
      and event_type = 'work_session_ended'
      and metadata->>'session_id' = v_session.id::text;
  if v_count <> 1 then
    raise exception 'end_work_session should emit one work_session_ended event, saw %', v_count;
  end if;

  perform public.end_work_session(v_ws);
  select count(*) into v_count
    from public.task_events
    where workspace_id = v_ws
      and actor_id = v_member
      and event_type = 'work_session_ended';
  if v_count <> 1 then
    raise exception 'repeated end_work_session should not duplicate Slack events, saw %', v_count;
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

delete from auth.users where email like 'work-session-slack.test.%@example.com';
