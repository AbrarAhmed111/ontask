-- Slack updates for Work Sessions.
--
-- Work sessions are not task timers. They get their own lightweight workspace
-- events so Slack can say when a member logged in for work and logged out,
-- while break/resume stays quiet.

alter table public.task_events drop constraint if exists task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'created', 'edited', 'deleted',
    'assigned', 'reassigned', 'unassigned',
    'started', 'paused', 'resumed', 'completed', 'skipped', 'reopened',
    'progress_changed', 'parent_changed', 'reordered',
    'member_invited', 'invitation_accepted', 'invitation_rejected',
    'invitation_cancelled', 'member_joined', 'member_removed',
    'goal_created', 'goal_updated', 'goal_completed', 'goal_archived',
    'goal_deleted',
    'goal_task_created', 'goal_subtask_created',
    'dependency_added', 'dependency_removed', 'task_blocked', 'task_unblocked',
    'note_added', 'note_updated', 'note_deleted',
    'resource_uploaded', 'resource_updated', 'resource_deleted',
    'task_blocker_added', 'task_blocker_updated', 'task_blocker_mention',
    'task_blocker_resolved',
    'work_session_started', 'work_session_ended'
  )
);

create or replace function public.start_work_session(p_workspace_id uuid)
returns public.work_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.work_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_workspace_member(p_workspace_id, v_user_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select * into v_result
    from public.work_sessions
    where workspace_id = p_workspace_id
      and user_id = v_user_id
      and ended_at is null
    for update;

  if found then
    update public.work_sessions
      set updated_at = now()
      where id = v_result.id
      returning * into v_result;
    return v_result;
  end if;

  insert into public.work_sessions (workspace_id, user_id)
  values (p_workspace_id, v_user_id)
  returning * into v_result;

  insert into public.task_events (
    task_id, workspace_id, actor_id, event_type, metadata
  )
  values (
    null,
    p_workspace_id,
    v_user_id,
    'work_session_started',
    jsonb_build_object('session_id', v_result.id)
  );

  return v_result;
end;
$$;

create or replace function public.end_work_session(p_workspace_id uuid)
returns public.work_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.work_sessions%rowtype;
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

revoke all on function public.start_work_session(uuid) from public, anon;
revoke all on function public.end_work_session(uuid) from public, anon;
grant execute on function public.start_work_session(uuid) to authenticated;
grant execute on function public.end_work_session(uuid) to authenticated;

create or replace function public.dispatch_slack_from_task_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_target_url text;
  v_has_conn boolean;
  v_body jsonb;
begin
  select exists (
    select 1 from public.workspace_slack_connections
    where workspace_id = new.workspace_id and channel_id is not null and channel_id <> ''
  ) into v_has_conn;

  if not v_has_conn then
    return new;
  end if;

  if new.event_type in ('work_session_started', 'work_session_ended') then
    v_body := jsonb_build_object(
      'workspaceId', new.workspace_id,
      'eventType', case
        when new.event_type = 'work_session_started'
          then 'work_session_started'
        else 'work_session_ended'
      end,
      'eventId', new.id,
      'entityType', 'work_session',
      'entityId', nullif(new.metadata->>'session_id', ''),
      'actorId', new.actor_id,
      'createdAt', new.created_at
    );
  else
    v_body := public.slack_payload_for_task_event(new);
  end if;

  if v_body is null then
    return new;
  end if;

  select target_url into v_target_url from public.app_cron_config limit 1;
  if v_target_url is not null and v_target_url <> '' then
    v_target_url := regexp_replace(v_target_url, '/api/cron/daily-reports.*$', '/api/integrations/slack/dispatch');
  end if;

  if v_target_url is null or v_target_url = '' then
    v_target_url := 'http://localhost:3000/api/integrations/slack/dispatch';
  end if;

  begin
    perform net.http_post(
      url := v_target_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := v_body
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

alter table public.workspace_slack_connections
  alter column notification_settings set default '{
    "created": true,
    "assigned": true,
    "started": true,
    "completed": true,
    "deleted": true,
    "notes": true,
    "goals": true,
    "blockers": true,
    "resolutions": true,
    "mentions": true,
    "resources": true,
    "members": true,
    "work_sessions": true,
    "daily_reports": true
  }'::jsonb;

update public.workspace_slack_connections
  set notification_settings = jsonb_build_object('work_sessions', true) || notification_settings
  where not (notification_settings ? 'work_sessions');
