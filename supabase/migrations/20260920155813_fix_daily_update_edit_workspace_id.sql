-- Fix migration 0051's submit_daily_update replacement:
--   * daily_update_items.workspace_id is not nullable and is required for RLS
--     and realtime filters.
--   * daily_update_item_mentions.workspace_id is also not nullable.
--   * mention notifications live in public.notifications, not a separate
--     workspace_notifications table.

create or replace function public.submit_daily_update(
  p_workspace_id uuid,
  p_report_date date,
  p_items jsonb
)
returns public.daily_updates
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace public.workspaces%rowtype;
  v_update public.daily_updates%rowtype;
  v_existing boolean;
  v_element jsonb;
  v_type text;
  v_content text;
  v_task_text text;
  v_task_id uuid;
  v_mentions uuid[];
  v_mention uuid;
  v_mention_text text;
  v_clean jsonb := '[]'::jsonb;
  v_new_canon jsonb;
  v_old_canon jsonb;
  v_position int;
  v_item_id uuid;
  v_actor_name text;
  v_notified uuid;
  v_counts jsonb := '{"done":0,"blocker":0,"next":0}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_workspace from public.workspaces where id = p_workspace_id;
  if v_workspace.id is null or not public.is_workspace_member(p_workspace_id, v_user_id) then
    raise exception 'workspace not found';
  end if;
  if v_workspace.type = 'personal' then
    raise exception 'Daily Updates are only available in shared workspaces';
  end if;
  if p_report_date is null
     or (
       p_report_date <> public.workspace_local_date(p_workspace_id)
       and p_report_date <> (public.workspace_local_date(p_workspace_id) - 1)
     ) then
    raise exception 'you can only report for today or yesterday in the workspace''s timezone'
      using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a list';
  end if;

  select * into v_update from public.daily_updates
    where workspace_id = p_workspace_id and user_id = v_user_id and report_date = p_report_date
    for update;
  v_existing := found;

  for v_element in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'each item must be an object';
    end if;
    v_type := v_element ->> 'type';
    if v_type is null or v_type not in ('done', 'blocker', 'next') then
      raise exception 'item type must be done, blocker or next';
    end if;

    v_content := btrim(regexp_replace(coalesce(v_element ->> 'content', ''), '\s*[\r\n]+\s*', ' ', 'g'));
    if v_content = '' then
      raise exception 'an item cannot be empty';
    end if;
    if char_length(v_content) > 500 then
      raise exception 'an item is too long (500 characters at most)';
    end if;
    v_counts := jsonb_set(v_counts, array[v_type], to_jsonb((v_counts ->> v_type)::int + 1));
    if (v_counts ->> v_type)::int > 20 then
      raise exception 'at most 20 items per section';
    end if;

    v_task_id := null;
    v_task_text := nullif(v_element ->> 'task_id', '');
    if v_task_text is not null then
      begin
        v_task_id := v_task_text::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid task reference';
      end;
      if not exists (
           select 1 from public.workspace_tasks
           where id = v_task_id and workspace_id = p_workspace_id
         )
         and not (
           v_existing and exists (
             select 1 from public.daily_update_items
             where daily_update_id = v_update.id and task_id = v_task_id
           )
         ) then
        raise exception 'a referenced task does not belong to this workspace';
      end if;
    end if;

    v_mentions := '{}'::uuid[];
    if jsonb_typeof(coalesce(v_element -> 'mentioned_user_ids', '[]'::jsonb)) <> 'array' then
      raise exception 'mentioned_user_ids must be a list';
    end if;
    for v_mention_text in
      select jsonb_array_elements_text(coalesce(v_element -> 'mentioned_user_ids', '[]'::jsonb))
    loop
      begin
        v_mention := v_mention_text::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid mention';
      end;
      if v_mention = v_user_id or v_mention = any (v_mentions) then
        continue;
      end if;
      if not public.is_workspace_member(p_workspace_id, v_mention)
         and not (
           v_existing and exists (
             select 1
             from public.daily_update_item_mentions m
             join public.daily_update_items i on i.id = m.item_id
             where i.daily_update_id = v_update.id and m.mentioned_user_id = v_mention
           )
         ) then
        raise exception 'only current workspace members can be mentioned';
      end if;
      v_mentions := v_mentions || v_mention;
    end loop;
    if coalesce(array_length(v_mentions, 1), 0) > 10 then
      raise exception 'mention at most 10 members per item';
    end if;

    v_clean := v_clean || jsonb_build_object(
      'type', v_type,
      'content', v_content,
      'task_id', v_task_id,
      'mentions', (select coalesce(jsonb_agg(u order by u), '[]'::jsonb) from unnest(v_mentions) as u)
    );
  end loop;

  if jsonb_array_length(v_clean) = 0 then
    raise exception 'add at least one item before submitting';
  end if;

  select jsonb_agg(e.value order by
      case e.value ->> 'type' when 'done' then 0 when 'blocker' then 1 else 2 end,
      e.ordinality)
    into v_new_canon
    from jsonb_array_elements(v_clean) with ordinality as e(value, ordinality);

  if v_existing then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'type', i.item_type,
               'content', i.content,
               'task_id', i.task_id,
               'mentions', (
                 select coalesce(jsonb_agg(m.mentioned_user_id order by m.mentioned_user_id), '[]'::jsonb)
                 from public.daily_update_item_mentions m where m.item_id = i.id
               )
             )
             order by case i.item_type when 'done' then 0 when 'blocker' then 1 else 2 end, i.position
           ), '[]'::jsonb)
      into v_old_canon
      from public.daily_update_items i
      where i.daily_update_id = v_update.id;

    if v_old_canon = v_new_canon then
      return v_update;
    end if;

    update public.daily_updates set edited_at = now()
      where id = v_update.id
      returning * into v_update;
    delete from public.daily_update_items where daily_update_id = v_update.id;
  else
    insert into public.daily_updates (workspace_id, user_id, report_date)
      values (p_workspace_id, v_user_id, p_report_date)
      returning * into v_update;
  end if;

  v_counts := '{"done":0,"blocker":0,"next":0}'::jsonb;
  for v_element in select * from jsonb_array_elements(v_clean) loop
    v_type := v_element ->> 'type';
    v_position := (v_counts ->> v_type)::int;
    v_counts := jsonb_set(v_counts, array[v_type], to_jsonb(v_position + 1));

    insert into public.daily_update_items
      (daily_update_id, workspace_id, item_type, content, task_id, position)
      values (
        v_update.id,
        p_workspace_id,
        v_type,
        v_element ->> 'content',
        nullif(v_element ->> 'task_id', '')::uuid,
        v_position
      )
      returning id into v_item_id;

    insert into public.daily_update_item_mentions (item_id, workspace_id, mentioned_user_id)
      select v_item_id, p_workspace_id, m::uuid
      from jsonb_array_elements_text(v_element -> 'mentions') as m;
  end loop;

  select coalesce(nullif(btrim(full_name), ''), email, 'Someone') into v_actor_name
    from public.profiles where id = v_user_id;

  for v_notified in
    select distinct m.mentioned_user_id
    from public.daily_update_item_mentions m
    join public.daily_update_items i on i.id = m.item_id
    where i.daily_update_id = v_update.id
      and m.mentioned_user_id <> v_user_id
      and public.is_workspace_member(p_workspace_id, m.mentioned_user_id)
  loop
    insert into public.notifications
      (user_id, workspace_id, event_id, goal_id, notification_type, entity_type, entity_id, title, body, actor_id)
    select v_notified, p_workspace_id, null, null, 'daily_update_mention', 'daily_update', v_update.id,
           coalesce(v_actor_name, 'Someone') || ' mentioned you in a Daily Update',
           (select left(i.content, 140)
              from public.daily_update_items i
              join public.daily_update_item_mentions m on m.item_id = i.id
              where i.daily_update_id = v_update.id and m.mentioned_user_id = v_notified
              order by case i.item_type when 'done' then 0 when 'blocker' then 1 else 2 end, i.position
              limit 1),
           v_user_id
    on conflict do nothing;
  end loop;

  return v_update;
end;
$$;

revoke all on function public.submit_daily_update(uuid, date, jsonb) from public, anon;
grant execute on function public.submit_daily_update(uuid, date, jsonb) to authenticated;
