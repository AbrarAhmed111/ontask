-- Collaborative task cards need per-member focused time, but raw
-- task_time_entries stay private behind RLS. Expose only workspace-scoped
-- aggregates to current workspace members.

create index if not exists task_time_entries_workspace_task_user_idx
  on public.task_time_entries (workspace_id, task_id, user_id)
  where task_kind = 'workspace';

create or replace function public.list_workspace_task_focus_totals(
  p_workspace_id uuid,
  p_goal_id uuid default null
)
returns table (
  task_id uuid,
  user_id uuid,
  focused_seconds bigint
)
language sql stable security definer set search_path = public
as $$
  select
    tte.task_id,
    tte.user_id,
    coalesce(
      sum(
        case
          when tte.ended_at is null then 0
          else coalesce(
            tte.duration_seconds,
            greatest(0, extract(epoch from (tte.ended_at - tte.started_at))::int)
          )
        end
      ),
      0
    )::bigint as focused_seconds
  from public.task_time_entries tte
  join public.workspace_tasks wt
    on wt.id = tte.task_id
   and wt.workspace_id = p_workspace_id
  where tte.workspace_id = p_workspace_id
    and tte.task_kind = 'workspace'
    and (
      (p_goal_id is null and wt.goal_id is null)
      or wt.goal_id = p_goal_id
    )
    and public.is_workspace_member(p_workspace_id, auth.uid())
  group by tte.task_id, tte.user_id;
$$;

revoke all on function public.list_workspace_task_focus_totals(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.list_workspace_task_focus_totals(uuid, uuid)
  to authenticated;
