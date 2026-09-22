do $$
begin
  if to_regprocedure(
    'public.generate_workspace_daily_snapshot_with_daily_updates(uuid,timestamp with time zone,timestamp with time zone,text)'
  ) is null then
    raise exception 'Daily Report daily-updates helper is missing';
  end if;

  raise notice 'Daily Report daily-updates helper exists';
end $$;
