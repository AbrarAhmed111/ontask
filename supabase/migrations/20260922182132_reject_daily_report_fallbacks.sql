-- Daily Reports should only be marked completed when ontask-llm produced a
-- real AI narrative. Older app code saved deterministic fallback rows as
-- completed when the service contract drifted or the AI was unavailable; make
-- those rows retryable so the scheduler/manual retry can replace them.

update public.workspace_daily_summaries
set generation_status = 'failed',
    attempt_count = 0,
    error_message = left(
      coalesce(
        nullif(meta #>> '{validation_warnings,0}', ''),
        'AI narration fallback was rejected; retry scheduled'
      ),
      2000
    ),
    updated_at = now()
where generation_status = 'completed'
  and meta @> '{"used_fallback_template": true}'::jsonb;

-- The matching application fix now sends `{ snapshot: ... }` to ontask-llm.
-- Retry reports that failed because the old `{ work_context: ... }` request
-- shape made the service respond 422.
update public.workspace_daily_summaries
set attempt_count = 0,
    error_message = 'Retry scheduled after Daily Report AI request contract repair',
    updated_at = now()
where generation_status = 'failed'
  and error_message like 'AI summary service unreachable: ontask-llm responded 422%';
