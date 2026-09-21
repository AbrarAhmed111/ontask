-- Daily Reports: keep the member population scoped to current workspace members.
--
-- Historical task/time/work-session records remain in the database, but the
-- current Daily Report must not narrate a removed member merely because old
-- evidence overlaps a regenerated report window.

create or replace function public.generate_workspace_daily_snapshot(
  p_workspace_id uuid,
  p_report_start timestamptz,
  p_report_end timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_members jsonb;
begin
  -- The wrapped function performs the caller checks (service role, or a member)
  -- and returns the existing task/blocker/Daily Update snapshot.
  v_snapshot := public.generate_workspace_daily_snapshot_with_daily_updates(
    p_workspace_id, p_report_start, p_report_end, p_timezone
  );

  with current_member_ids as (
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
  ),
  sessions_by_member as (
    select
      ws.user_id,
      jsonb_agg(
        jsonb_build_object(
          'session_id', ws.id,
          'started_at', ws.started_at,
          'ended_at', case
            when ws.ended_at is not null and ws.ended_at < p_report_end
              then ws.ended_at
          end,
          'status_at_report_end', case
            when ws.ended_at is not null and ws.ended_at < p_report_end
              then 'working'
            else ws.status
          end,
          'current_break_started_at', case
            when ws.ended_at is null
             and ws.current_break_started_at is not null
             and ws.current_break_started_at < p_report_end
              then ws.current_break_started_at
          end,
          'total_break_seconds', ws.total_break_seconds,
          'overlapped_seconds', greatest(
            0,
            round(extract(epoch from (
              least(coalesce(ws.ended_at, p_report_end), p_report_end)
              - greatest(ws.started_at, p_report_start)
            )))::bigint
          ),
          'active_seconds', greatest(
            0,
            round(extract(epoch from (
              least(coalesce(ws.ended_at, p_report_end), p_report_end)
              - greatest(ws.started_at, p_report_start)
            )))::bigint - ws.total_break_seconds
          ),
          'still_active_at_report_end',
            ws.ended_at is null or ws.ended_at >= p_report_end
        )
        order by ws.started_at asc, ws.id
      ) as work_sessions
    from public.work_sessions ws
    join current_member_ids cmi on cmi.user_id = ws.user_id
    where ws.workspace_id = p_workspace_id
      and ws.started_at < p_report_end
      and coalesce(ws.ended_at, p_report_end) > p_report_start
    group by ws.user_id
  ),
  existing_members as (
    select jsonb_set(
      member,
      '{task_activity}',
      coalesce((
        select jsonb_agg(
          item.task || jsonb_build_object(
            'participation_status', tc.participation_status,
            'overall_status', coalesce(item.task ->> 'current_status', item.task ->> 'status_end')
          )
          order by item.ordinality
        )
        from jsonb_array_elements(coalesce(member -> 'task_activity', '[]'::jsonb))
          with ordinality as item(task, ordinality)
        left join public.task_collaborators tc
          on tc.task_id = (item.task ->> 'task_id')::uuid
         and tc.user_id = (member ->> 'user_id')::uuid
         and tc.removed_at is null
      ), '[]'::jsonb),
      true
    ) as member
    from jsonb_array_elements(coalesce(v_snapshot -> 'members', '[]'::jsonb)) as member
    join current_member_ids cmi on cmi.user_id = (member ->> 'user_id')::uuid
  ),
  session_only_members as (
    select jsonb_build_object(
      'user_id', sbm.user_id,
      'display_name', coalesce(nullif(btrim(p.full_name), ''), p.email, 'Member'),
      'focused_seconds', 0,
      'events', '[]'::jsonb,
      'task_activity', '[]'::jsonb
    ) as member
    from sessions_by_member sbm
    join public.profiles p on p.id = sbm.user_id
    where not exists (
      select 1
      from existing_members em
      where em.member ->> 'user_id' = sbm.user_id::text
    )
  ),
  all_members as (
    select member from existing_members
    union all
    select member from session_only_members
  )
  select coalesce(jsonb_agg(
    member || jsonb_build_object(
      'work_sessions',
      coalesce(sbm.work_sessions, '[]'::jsonb)
    )
    order by (member ->> 'focused_seconds')::bigint desc, member ->> 'display_name'
  ), '[]'::jsonb)
  into v_members
  from all_members am
  left join sessions_by_member sbm on sbm.user_id = (am.member ->> 'user_id')::uuid;

  return jsonb_set(v_snapshot, '{members}', v_members, true);
end;
$$;

grant execute on function public.generate_workspace_daily_snapshot(uuid, timestamptz, timestamptz, text)
  to authenticated, service_role;
