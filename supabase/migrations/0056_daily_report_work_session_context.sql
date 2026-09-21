-- Daily Reports: include Work Sessions in the deterministic work context.
--
-- Work Sessions are contextual evidence for "when was this person actually
-- logged in for work?" They are not productivity scores and are not used as a
-- report headline. The snapshot keeps them beside each member so ontask-llm can
-- narrate actual work context without querying the database.

alter function public.generate_workspace_daily_snapshot(uuid, timestamptz, timestamptz, text)
  rename to generate_workspace_daily_snapshot_with_daily_updates;

revoke all on function public.generate_workspace_daily_snapshot_with_daily_updates(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;

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

  with sessions_by_member as (
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
    where ws.workspace_id = p_workspace_id
      and ws.started_at < p_report_end
      and coalesce(ws.ended_at, p_report_end) > p_report_start
    group by ws.user_id
  ),
  existing_members as (
    select member
    from jsonb_array_elements(coalesce(v_snapshot -> 'members', '[]'::jsonb)) as member
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
