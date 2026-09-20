-- Fix Work Session RPCs under RLS.
--
-- work_sessions exposes SELECT to workspace members, but direct INSERT/UPDATE
-- stays blocked. These guarded RPCs are the write boundary, so they must run
-- as SECURITY DEFINER while still checking auth.uid() and workspace membership.

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
  if not public.is_workspace_member(p_workspace_id, v_user_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

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
  if not public.is_workspace_member(p_workspace_id, v_user_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

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
