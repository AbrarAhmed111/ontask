-- Some deployed databases have the current generate_workspace_daily_snapshot()
-- wrapper from 20260921162000, but not the helper name introduced by 0056.
-- Recreate the helper explicitly so the current wrapper can call it, then make
-- the report rows that failed on this exact missing-helper error retryable.

create or replace function public.generate_workspace_daily_snapshot_with_daily_updates(
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
  v_updates jsonb;
begin
  -- The base function performs the caller checks (service role, or a member).
  v_snapshot := public.generate_workspace_daily_snapshot_base(
    p_workspace_id, p_report_start, p_report_end, p_timezone
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', u.user_id,
      'display_name', coalesce(nullif(btrim(p.full_name), ''), p.email, 'Member'),
      'report_date', u.report_date,
      'submitted_at', u.submitted_at,
      'edited_at', u.edited_at,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'type', i.item_type,
            'content', i.content,
            'task_id', t.id,
            'task_title', t.title,
            'parent_title', pt.title,
            'goal_name', g.name,
            'task_status', t.status,
            'mentioned', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'user_id', m.mentioned_user_id,
                  'display_name', coalesce(nullif(btrim(mp.full_name), ''), mp.email, 'Member')
                )
                order by m.created_at, m.mentioned_user_id
              )
              from public.daily_update_item_mentions m
              join public.profiles mp on mp.id = m.mentioned_user_id
              where m.item_id = i.id
                and exists (
                  select 1 from public.workspace_members wm
                  where wm.workspace_id = u.workspace_id
                    and wm.user_id = m.mentioned_user_id
                )
            ), '[]'::jsonb)
          )
          order by case i.item_type when 'done' then 0 when 'blocker' then 1 else 2 end, i.position
        )
        from public.daily_update_items i
        left join public.workspace_tasks t
          on t.id = i.task_id and t.workspace_id = u.workspace_id
        left join public.goals g on g.id = t.goal_id
        left join public.workspace_tasks pt on pt.id = t.parent_task_id
        where i.daily_update_id = u.id
      ), '[]'::jsonb)
    )
    order by u.submitted_at, u.user_id
  ), '[]'::jsonb)
  into v_updates
  from public.daily_updates u
  join public.profiles p on p.id = u.user_id
  where u.workspace_id = p_workspace_id
    and u.submitted_at >= p_report_start
    and u.submitted_at < p_report_end
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = u.workspace_id and wm.user_id = u.user_id
    );

  if jsonb_array_length(v_updates) = 0 then
    return v_snapshot;
  end if;

  return v_snapshot || jsonb_build_object('daily_updates', v_updates);
end;
$$;

revoke all on function public.generate_workspace_daily_snapshot_with_daily_updates(
  uuid, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;

update public.workspace_daily_summaries
set attempt_count = 0,
    error_message = 'Retry scheduled after Daily Report helper repair',
    updated_at = now()
where generation_status = 'failed'
  and error_message = 'function public.generate_workspace_daily_snapshot_with_daily_updates(uuid, timestamp with time zone, timestamp with time zone, text) does not exist';
