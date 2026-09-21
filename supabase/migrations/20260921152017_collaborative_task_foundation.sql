-- Collaborative task foundation.
--
-- One workspace_tasks row can now have multiple active collaborators. Each
-- collaborator has their own participation status and timer start, while the
-- task row keeps the single overall status used by existing views, Goal
-- progress, Daily Updates, Daily Reports and Slack.

create table if not exists public.task_collaborators (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.workspace_tasks(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  participation_status text not null default 'queued'
    check (participation_status in ('queued', 'working', 'paused', 'blocked', 'completed', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  constraint task_collaborators_status_timestamps check (
    (participation_status = 'working' and started_at is not null and completed_at is null)
    or (participation_status in ('queued', 'paused', 'blocked') and completed_at is null)
    or (participation_status in ('completed', 'skipped') and started_at is null and completed_at is not null)
  )
);

create unique index if not exists task_collaborators_one_active_user
  on public.task_collaborators (task_id, user_id)
  where removed_at is null;
create index if not exists task_collaborators_task_active_idx
  on public.task_collaborators (task_id)
  where removed_at is null;
create index if not exists task_collaborators_workspace_user_idx
  on public.task_collaborators (workspace_id, user_id)
  where removed_at is null;

drop trigger if exists trg_task_collaborators_updated_at on public.task_collaborators;
create trigger trg_task_collaborators_updated_at
  before update on public.task_collaborators
  for each row execute function public.set_updated_at();

alter table public.task_collaborators enable row level security;

drop policy if exists "task_collaborators_select_member" on public.task_collaborators;
create policy "task_collaborators_select_member" on public.task_collaborators
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.task_collaborators from public, anon, authenticated;
grant select on public.task_collaborators to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.task_collaborators;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end;
$$;

create or replace function public.enforce_task_collaborator_workspace()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.workspace_tasks
  where id = new.task_id;

  if v_workspace_id is null then
    raise exception 'task not found';
  end if;
  if new.workspace_id is distinct from v_workspace_id then
    raise exception 'task collaborator workspace must match task workspace';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = new.workspace_id and user_id = new.user_id
  ) then
    raise exception 'collaborator must be a workspace member'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_task_collaborators_workspace on public.task_collaborators;
create trigger trg_task_collaborators_workspace
  before insert or update of task_id, workspace_id, user_id on public.task_collaborators
  for each row execute function public.enforce_task_collaborator_workspace();

insert into public.task_collaborators (
  task_id, workspace_id, user_id, participation_status, started_at, completed_at
)
select
  wt.id,
  wt.workspace_id,
  coalesce(wt.assigned_to, wt.created_by),
  wt.status,
  wt.started_at,
  wt.completed_at
from public.workspace_tasks wt
where coalesce(wt.assigned_to, wt.created_by) is not null
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = wt.workspace_id
      and wm.user_id = coalesce(wt.assigned_to, wt.created_by)
  )
on conflict do nothing;

create or replace function public.sync_primary_assignee_collaborator()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_active_count integer;
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into public.task_collaborators (task_id, workspace_id, user_id, participation_status)
      values (new.id, new.workspace_id, new.assigned_to, new.status)
      on conflict (task_id, user_id) where removed_at is null do nothing;
    end if;
    return new;
  end if;

  if old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;

  select count(*)::integer into v_active_count
  from public.task_collaborators
  where task_id = new.id and removed_at is null;

  -- Existing UI reassignment means replacement for a single-assignee task.
  -- When the task already has multiple active collaborators, changing the
  -- primary assignee only changes the owner/assignee concept; collaborator
  -- membership is managed separately.
  if old.assigned_to is not null and v_active_count <= 1 then
    update public.task_collaborators
      set removed_at = now(),
          removed_by = v_actor,
          participation_status = case
            when participation_status = 'working' then 'paused'
            else participation_status
          end,
          started_at = null
      where task_id = new.id
        and user_id = old.assigned_to
        and removed_at is null;
  end if;

  if new.assigned_to is not null then
    insert into public.task_collaborators (task_id, workspace_id, user_id, participation_status)
    values (new.id, new.workspace_id, new.assigned_to, 'queued')
    on conflict (task_id, user_id) where removed_at is null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workspace_tasks_sync_primary_collaborator on public.workspace_tasks;
create trigger trg_workspace_tasks_sync_primary_collaborator
  after insert or update of assigned_to on public.workspace_tasks
  for each row execute function public.sync_primary_assignee_collaborator();

create or replace function public.resolve_workspace_task_status(p_task_id uuid)
returns text
language plpgsql security definer stable set search_path = public
as $$
declare
  v_has_active_blocker boolean;
  v_total integer;
  v_working integer;
  v_blocked integer;
  v_paused integer;
  v_completed integer;
  v_skipped integer;
begin
  select exists (
    select 1 from public.task_blockers
    where task_id = p_task_id and status = 'active'
  ) into v_has_active_blocker;
  if v_has_active_blocker then
    return 'blocked';
  end if;

  select
    count(*)::integer,
    count(*) filter (where participation_status = 'working')::integer,
    count(*) filter (where participation_status = 'blocked')::integer,
    count(*) filter (where participation_status = 'paused')::integer,
    count(*) filter (where participation_status = 'completed')::integer,
    count(*) filter (where participation_status = 'skipped')::integer
  into v_total, v_working, v_blocked, v_paused, v_completed, v_skipped
  from public.task_collaborators
  where task_id = p_task_id and removed_at is null;

  if coalesce(v_total, 0) = 0 then
    return coalesce((select status from public.workspace_tasks where id = p_task_id), 'queued');
  end if;
  if v_blocked > 0 then return 'blocked'; end if;
  if v_completed = v_total then return 'completed'; end if;
  if v_skipped = v_total then return 'skipped'; end if;
  if v_working > 0 then return 'working'; end if;
  if v_paused > 0 then return 'paused'; end if;
  return 'queued';
end;
$$;

revoke all on function public.resolve_workspace_task_status(uuid) from public, anon;
grant execute on function public.resolve_workspace_task_status(uuid) to authenticated;

create or replace function public.apply_workspace_task_status_resolution(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_result public.workspace_tasks%rowtype;
begin
  v_status := public.resolve_workspace_task_status(p_task_id);

  select min(started_at) into v_started_at
  from public.task_collaborators
  where task_id = p_task_id
    and removed_at is null
    and participation_status = 'working';

  select case when v_status in ('completed', 'skipped') then max(completed_at) end
    into v_completed_at
  from public.task_collaborators
  where task_id = p_task_id
    and removed_at is null;

  perform set_config('ontask.timer_write', 'on', true);
  update public.workspace_tasks
    set status = v_status,
        started_at = case when v_status = 'working' then v_started_at else null end,
        completed_at = v_completed_at,
        completed_cleared_at = case when v_status in ('completed', 'skipped') then completed_cleared_at else null end
    where id = p_task_id
    returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_workspace_task_status_resolution(uuid) from public, anon;

create or replace function public.is_workspace_task_timer_controller(
  p_workspace_id uuid, p_assigned_to uuid, p_user_id uuid
)
returns boolean
language sql security definer stable set search_path = public
as $$
  select coalesce(
    p_user_id is not null
    and exists (
      select 1 from public.workspace_members
      where workspace_id = p_workspace_id and user_id = p_user_id
    )
    and (
      p_assigned_to = p_user_id
      or p_assigned_to is null
    ),
    false
  );
$$;

-- Task-specific controller helper used by the collaborative RPCs.
create or replace function public.is_workspace_task_collaborator(
  p_task_id uuid, p_user_id uuid
)
returns boolean
language sql security definer stable set search_path = public
as $$
  select coalesce(
    p_user_id is not null
    and exists (
      select 1
      from public.workspace_tasks wt
      where wt.id = p_task_id
        and public.is_workspace_member(wt.workspace_id, p_user_id)
        and (
          exists (
            select 1 from public.task_collaborators tc
            where tc.task_id = wt.id
              and tc.user_id = p_user_id
              and tc.removed_at is null
          )
          or (wt.assigned_to = p_user_id)
          or (
            wt.assigned_to is null
            and not exists (
              select 1 from public.task_collaborators tc
              where tc.task_id = wt.id and tc.removed_at is null
            )
          )
        )
    ),
    false
  );
$$;

revoke all on function public.is_workspace_task_collaborator(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_task_collaborator(uuid, uuid) to authenticated;

create or replace function public.assert_workspace_task_collaborator(
  p_task_id uuid, p_user_id uuid
)
returns void
language plpgsql set search_path = public
as $$
begin
  if public.is_workspace_task_collaborator(p_task_id, p_user_id) then
    return;
  end if;
  raise exception 'only a collaborator on this task can control their work'
    using errcode = '42501';
end;
$$;

grant execute on function public.assert_workspace_task_collaborator(uuid, uuid) to authenticated;

drop policy if exists "task_time_entries_insert_own" on public.task_time_entries;
create policy "task_time_entries_insert_own" on public.task_time_entries
  for insert with check (
    auth.uid() = user_id
    and (
      task_kind <> 'workspace'
      or public.is_workspace_task_collaborator(task_id, auth.uid())
    )
  );

drop policy if exists "task_time_entries_update_own" on public.task_time_entries;
create policy "task_time_entries_update_own" on public.task_time_entries
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      task_kind <> 'workspace'
      or ended_at is not null
      or public.is_workspace_task_collaborator(task_id, auth.uid())
    )
  );

create or replace function public.start_workspace_task(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_open_entry public.task_time_entries%rowtype;
  v_duration int;
  v_result public.workspace_tasks%rowtype;
  v_parent_title text;
  v_was_worked_before boolean;
  v_blocked boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if not public.is_workspace_member(v_task.workspace_id, v_user_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);

  if v_task.status = 'blocked' then
    raise exception 'this task is blocked -- resolve its blocker first'
      using errcode = '55000';
  end if;

  if v_task.goal_id is not null then
    select exists (
      select 1
      from public.task_dependencies td
      join public.workspace_tasks bt on bt.id = td.blocking_task_id
      where td.blocked_task_id = p_task_id
        and bt.status not in ('completed', 'skipped')
    ) into v_blocked;
    if v_blocked then
      raise exception 'this task is blocked by an incomplete dependency';
    end if;
  end if;

  select exists (
    select 1 from public.task_time_entries
    where task_id = p_task_id and task_kind = 'workspace'
  ) into v_was_worked_before;

  select * into v_open_entry from public.task_time_entries
    where user_id = v_user_id and ended_at is null for update;

  if found then
    v_duration := greatest(0, extract(epoch from (now() - v_open_entry.started_at))::int);
    update public.task_time_entries
      set ended_at = now(), duration_seconds = v_duration
      where id = v_open_entry.id;

    if v_open_entry.task_kind = 'personal' then
      update public.personal_tasks
        set actual_seconds = actual_seconds + v_duration,
            status = case when id = p_task_id then status else 'paused' end,
            started_at = case when id = p_task_id then started_at else null end
        where id = v_open_entry.task_id;
    else
      perform set_config('ontask.timer_write', 'on', true);
      update public.workspace_tasks
        set actual_seconds = actual_seconds + v_duration
        where id = v_open_entry.task_id;

      update public.task_collaborators
        set participation_status = 'paused',
            started_at = null
        where task_id = v_open_entry.task_id
          and user_id = v_user_id
          and removed_at is null
          and participation_status = 'working';

      perform public.apply_workspace_task_status_resolution(v_open_entry.task_id);
    end if;
  end if;

  insert into public.task_collaborators (
    task_id, workspace_id, user_id, participation_status, started_at
  )
  values (p_task_id, v_task.workspace_id, v_user_id, 'working', now())
  on conflict (task_id, user_id) where removed_at is null
  do update set participation_status = 'working',
                started_at = excluded.started_at,
                completed_at = null;

  insert into public.task_time_entries (task_id, task_kind, workspace_id, user_id, started_at)
    values (p_task_id, 'workspace', v_task.workspace_id, v_user_id, now());

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  if v_result.parent_task_id is not null then
    select title into v_parent_title from public.workspace_tasks
      where id = v_result.parent_task_id;
  end if;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id,
      case when v_was_worked_before then 'resumed' else 'started' end,
      jsonb_build_object('title', v_result.title, 'parent_title', v_parent_title));

  return v_result;
end;
$$;

create or replace function public.pause_workspace_task(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_open_entry public.task_time_entries%rowtype;
  v_duration int := 0;
  v_result public.workspace_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);
  if v_task.status = 'blocked' then
    raise exception 'this task is blocked -- resolve its blocker instead of pausing it'
      using errcode = '55000';
  end if;

  select * into v_open_entry from public.task_time_entries
    where user_id = v_user_id and task_id = p_task_id and task_kind = 'workspace'
      and ended_at is null for update;

  if found then
    v_duration := greatest(0, extract(epoch from (now() - v_open_entry.started_at))::int);
    update public.task_time_entries
      set ended_at = now(), duration_seconds = v_duration
      where id = v_open_entry.id;
  end if;

  perform set_config('ontask.timer_write', 'on', true);
  update public.workspace_tasks
    set actual_seconds = actual_seconds + v_duration
    where id = p_task_id;

  update public.task_collaborators
    set participation_status = 'paused',
        started_at = null
    where task_id = p_task_id
      and user_id = v_user_id
      and removed_at is null;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id, 'paused',
      jsonb_build_object('title', v_result.title));

  return v_result;
end;
$$;

create or replace function public.complete_workspace_task(
  p_task_id uuid, p_skip boolean default false
)
returns public.workspace_tasks
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_open_entry public.task_time_entries%rowtype;
  v_duration int := 0;
  v_result public.workspace_tasks%rowtype;
  v_dep record;
  v_event_type text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  if v_task.status = 'blocked' then
    raise exception 'this task is blocked -- resolve its blocker before finishing it'
      using errcode = '55000';
  end if;
  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);

  select * into v_open_entry from public.task_time_entries
    where user_id = v_user_id and task_id = p_task_id and task_kind = 'workspace'
      and ended_at is null for update;

  if found then
    v_duration := greatest(0, extract(epoch from (now() - v_open_entry.started_at))::int);
    update public.task_time_entries
      set ended_at = now(), duration_seconds = v_duration
      where id = v_open_entry.id;
  end if;

  perform set_config('ontask.timer_write', 'on', true);
  update public.workspace_tasks
    set actual_seconds = actual_seconds + v_duration
    where id = p_task_id;

  update public.task_collaborators
    set participation_status = case when p_skip then 'skipped' else 'completed' end,
        started_at = null,
        completed_at = now()
    where task_id = p_task_id
      and user_id = v_user_id
      and removed_at is null;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  v_event_type := case
    when v_result.status in ('completed', 'skipped') then v_result.status
    when p_skip then 'skipped'
    else 'completed'
  end;

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id,
      v_event_type,
      jsonb_build_object(
        'title', v_result.title,
        'collaborator_user_id', v_user_id,
        'task_overall_status', v_result.status
      ));

  if v_task.goal_id is not null and v_result.status in ('completed', 'skipped') then
    for v_dep in
      select td.blocked_task_id, wt.title, wt.workspace_id
      from public.task_dependencies td
      join public.workspace_tasks wt on wt.id = td.blocked_task_id
      where td.blocking_task_id = p_task_id
    loop
      if not exists (
        select 1
        from public.task_dependencies td2
        join public.workspace_tasks bt on bt.id = td2.blocking_task_id
        where td2.blocked_task_id = v_dep.blocked_task_id
          and bt.status not in ('completed', 'skipped')
      ) then
        insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
          values (v_dep.blocked_task_id, v_dep.workspace_id, v_task.goal_id, v_user_id, 'task_unblocked',
            jsonb_build_object('title', v_dep.title));
      end if;
    end loop;
  end if;

  return v_result;
end;
$$;

create or replace function public.reopen_workspace_task(p_task_id uuid)
returns public.workspace_tasks
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.workspace_tasks%rowtype;
  v_result public.workspace_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.workspace_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  perform public.assert_workspace_task_collaborator(p_task_id, v_user_id);

  update public.task_collaborators
    set participation_status = 'queued',
        started_at = null,
        completed_at = null
    where task_id = p_task_id
      and user_id = v_user_id
      and removed_at is null;

  v_result := public.apply_workspace_task_status_resolution(p_task_id);

  insert into public.task_events (task_id, workspace_id, goal_id, actor_id, event_type, metadata)
    values (p_task_id, v_task.workspace_id, v_task.goal_id, v_user_id, 'reopened',
      jsonb_build_object('title', v_result.title, 'collaborator_user_id', v_user_id));

  return v_result;
end;
$$;

grant execute on function public.start_workspace_task(uuid) to authenticated;
grant execute on function public.pause_workspace_task(uuid) to authenticated;
grant execute on function public.complete_workspace_task(uuid, boolean) to authenticated;
grant execute on function public.reopen_workspace_task(uuid) to authenticated;
