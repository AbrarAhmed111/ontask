-- Work Sessions
-- Explicit "logged in for work" state, separate from ephemeral Realtime
-- Presence and separate from task timers/focused time.

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'working' check (status in ('working', 'break')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  current_break_started_at timestamptz,
  total_break_seconds integer not null default 0 check (total_break_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sessions_break_consistent check (
    (status = 'working' and current_break_started_at is null)
    or (status = 'break' and current_break_started_at is not null)
  ),
  constraint work_sessions_end_consistent check (
    (ended_at is null) or (ended_at >= started_at)
  )
);

create unique index work_sessions_one_active_per_member
  on public.work_sessions (workspace_id, user_id)
  where ended_at is null;
create index work_sessions_workspace_active_idx
  on public.work_sessions (workspace_id)
  where ended_at is null;
create index work_sessions_user_started_idx
  on public.work_sessions (user_id, started_at desc);

create trigger trg_work_sessions_updated_at
  before update on public.work_sessions
  for each row execute function public.set_updated_at();

alter table public.work_sessions enable row level security;

create policy "work_sessions_select_member" on public.work_sessions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.work_sessions from public, anon, authenticated;
grant select on public.work_sessions to authenticated;

alter publication supabase_realtime add table public.work_sessions;

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

  insert into public.work_sessions (workspace_id, user_id)
  values (p_workspace_id, v_user_id)
  on conflict (workspace_id, user_id) where ended_at is null
  do update set updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.take_work_break(p_workspace_id uuid)
returns public.work_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.work_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  update public.work_sessions
    set status = 'break',
        current_break_started_at = coalesce(current_break_started_at, now()),
        updated_at = now()
    where workspace_id = p_workspace_id
      and user_id = v_user_id
      and ended_at is null
    returning * into v_result;

  if not found then
    raise exception 'active work session not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.resume_work_session(p_workspace_id uuid)
returns public.work_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.work_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  update public.work_sessions
    set total_break_seconds = total_break_seconds
          + greatest(0, extract(epoch from (now() - current_break_started_at))::int),
        status = 'working',
        current_break_started_at = null,
        updated_at = now()
    where workspace_id = p_workspace_id
      and user_id = v_user_id
      and ended_at is null
      and status = 'break'
    returning * into v_result;

  if found then return v_result; end if;

  select * into v_result
    from public.work_sessions
    where workspace_id = p_workspace_id
      and user_id = v_user_id
      and ended_at is null;

  if not found then
    raise exception 'active work session not found' using errcode = 'P0002';
  end if;

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

  if found then return v_result; end if;

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
revoke all on function public.take_work_break(uuid) from public, anon;
revoke all on function public.resume_work_session(uuid) from public, anon;
revoke all on function public.end_work_session(uuid) from public, anon;
grant execute on function public.start_work_session(uuid) to authenticated;
grant execute on function public.take_work_break(uuid) to authenticated;
grant execute on function public.resume_work_session(uuid) to authenticated;
grant execute on function public.end_work_session(uuid) to authenticated;
