-- Member availability belongs to a user's membership in a specific workspace.
-- Values are nullable so "Not configured" is explicit and no default schedule
-- is implied.

alter table public.workspace_members
  add column if not exists working_hours_start time,
  add column if not exists working_hours_end time,
  add column if not exists working_timezone text,
  add column if not exists working_days int[] not null default '{}',
  add column if not exists standup_availability_start time,
  add column if not exists standup_availability_end time,
  add column if not exists standup_availability_days int[] not null default '{}',
  add column if not exists minimum_working_minutes integer;

create or replace function public.is_valid_weekday_list(p_days int[])
returns boolean
language sql immutable
as $$
  select coalesce(
    p_days <@ array[0, 1, 2, 3, 4, 5, 6]
    and cardinality(p_days) = cardinality(array(select distinct unnest(p_days))),
    false
  );
$$;

create or replace function public.is_valid_timezone_name(p_timezone text)
returns boolean
language sql stable
set search_path = public, pg_catalog
as $$
  select p_timezone is null
    or exists (select 1 from pg_timezone_names where name = p_timezone);
$$;

grant execute on function public.is_valid_weekday_list(int[]) to authenticated;
grant execute on function public.is_valid_timezone_name(text) to authenticated;

alter table public.workspace_members
  drop constraint if exists workspace_members_working_hours_pair_check,
  add constraint workspace_members_working_hours_pair_check check (
    (working_hours_start is null and working_hours_end is null)
    or (working_hours_start is not null and working_hours_end is not null and working_hours_start < working_hours_end)
  ),
  drop constraint if exists workspace_members_standup_availability_pair_check,
  add constraint workspace_members_standup_availability_pair_check check (
    (standup_availability_start is null and standup_availability_end is null)
    or (
      standup_availability_start is not null
      and standup_availability_end is not null
      and standup_availability_start < standup_availability_end
    )
  ),
  drop constraint if exists workspace_members_working_days_check,
  add constraint workspace_members_working_days_check check (
    public.is_valid_weekday_list(working_days)
  ),
  drop constraint if exists workspace_members_standup_days_check,
  add constraint workspace_members_standup_days_check check (
    public.is_valid_weekday_list(standup_availability_days)
  ),
  drop constraint if exists workspace_members_minimum_working_minutes_check,
  add constraint workspace_members_minimum_working_minutes_check check (
    minimum_working_minutes is null
    or (minimum_working_minutes >= 0 and minimum_working_minutes <= 1440)
  ),
  drop constraint if exists workspace_members_working_timezone_check,
  add constraint workspace_members_working_timezone_check check (
    public.is_valid_timezone_name(working_timezone)
  );

revoke update on public.workspace_members from authenticated;
grant update (
  working_hours_start,
  working_hours_end,
  working_timezone,
  working_days,
  standup_availability_start,
  standup_availability_end,
  standup_availability_days,
  minimum_working_minutes
) on public.workspace_members to authenticated;

drop policy if exists "workspace_members_update_availability_self_or_owner" on public.workspace_members;
create policy "workspace_members_update_availability_self_or_owner" on public.workspace_members
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );
