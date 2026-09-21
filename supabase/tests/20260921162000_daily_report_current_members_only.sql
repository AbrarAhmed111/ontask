-- Manual regression for 20260921162000_daily_report_current_members_only.sql.
-- Run against a scratch/staging database after applying migrations.

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_removed uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid();
  v_report_start timestamptz := '2026-09-20 16:00:00+00';
  v_report_end timestamptz := '2026-09-21 16:00:00+00';
  v_snapshot jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner-current-members@dailyreport.test'),
    (v_removed, 'rachel-current-members@dailyreport.test');

  update public.profiles set full_name = 'Owner Current' where id = v_owner;
  update public.profiles set full_name = 'Rachel Smith' where id = v_removed;

  insert into public.workspaces (id, name, owner_id, timezone, report_time)
    values (v_workspace, 'Current Members Only', v_owner, 'UTC', '16:00:00');

  insert into public.workspace_members (workspace_id, user_id, role)
    values (v_workspace, v_removed, 'member');

  insert into public.workspace_tasks (id, workspace_id, created_by, title, position)
    values (v_task, v_workspace, v_removed, 'Removed Member Task', 1000);

  insert into public.task_time_entries
    (task_id, task_kind, workspace_id, user_id, started_at, ended_at, duration_seconds)
    values (
      v_task,
      'workspace',
      v_workspace,
      v_removed,
      v_report_start + interval '1 hour',
      v_report_start + interval '2 hours',
      3600
    );

  insert into public.work_sessions
    (workspace_id, user_id, started_at, ended_at, total_break_seconds)
    values (
      v_workspace,
      v_removed,
      v_report_start + interval '30 minutes',
      v_report_start + interval '7 hours 30 minutes',
      0
    );

  delete from public.workspace_members
    where workspace_id = v_workspace and user_id = v_removed;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  v_snapshot := public.generate_workspace_daily_snapshot(
    v_workspace,
    v_report_start,
    v_report_end,
    'UTC'
  );

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_snapshot -> 'members', '[]'::jsonb)) m
    where m ->> 'user_id' = v_removed::text
       or m ->> 'display_name' = 'Rachel Smith'
  ) then
    raise exception 'removed member leaked into Daily Report snapshot: %', v_snapshot -> 'members';
  end if;

  raise notice 'removed members are excluded from Daily Report members';
end $$;
