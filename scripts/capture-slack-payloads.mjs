// Regenerates src/lib/integrations/slack/__fixtures__/slackEventPayloads.json
// from a real database.
//
// The fixture is the input half of slackPipeline.test.ts, which asserts the
// exact Slack message each payload ends up as. Hand-writing those payloads
// would defeat the point: the bug that test exists to catch lived in the
// payload, not in the formatting, so a payload written to match the formatter
// would have passed all along. These come out of Postgres, from
// slack_payload_for_task_event() run over rows that real RPCs and real
// triggers wrote, by executing supabase/tests/0048_slack_entity_resolution.sql
// and reading the capture table it leaves behind.
//
//   node scripts/capture-slack-payloads.mjs [--check]
//
// Needs PGlite, which is a devDependency of this script rather than of the
// app: npm i --no-save @electric-sql/pglite
//
// --check regenerates into memory and exits non-zero if the committed fixture
// differs, which is what CI would run.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(
  repo,
  'src/lib/integrations/slack/__fixtures__/slackEventPayloads.json',
)
const check = process.argv.includes('--check')

let PGlite
try {
  ;({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  console.error(
    'capture-slack-payloads: @electric-sql/pglite is not installed.\n' +
      '  npm i --no-save @electric-sql/pglite',
  )
  process.exit(2)
}

// Supabase's own objects, which the migrations assume exist. Only the parts
// the Slack path touches: auth.uid() (every logging trigger reads it), the
// storage bucket resources live in, and no-op cron/net so a trigger that
// posts to pg_net does not fail the transaction it is running inside.
const BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid, owner_id text, metadata jsonb
);
create function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
  language sql as $$ select 1::bigint $$;
create function cron.unschedule(job_id bigint) returns boolean
  language sql as $$ select true $$;

create schema net;
create function net.http_post(
  url text, body jsonb default null, params jsonb default null,
  headers jsonb default null, timeout_milliseconds int default 1000
) returns bigint language sql as $$ select 1::bigint $$;

create publication supabase_realtime;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

const db = new PGlite()
await db.exec(BOOTSTRAP)

const migrations = path.join(repo, 'supabase', 'migrations')
for (const file of fs
  .readdirSync(migrations)
  .filter(f => /^\d{4}_.*\.sql$/.test(f))
  .sort()) {
  // pg_cron / pg_net are Supabase-hosted extensions; the stubs above stand in.
  const sql = fs
    .readFileSync(path.join(migrations, file), 'utf8')
    .replace(/^\s*create extension[^;]*;/gim, '')
  try {
    await db.exec(sql)
  } catch (error) {
    // 0038 rewrites a storage policy against columns the stub above does not
    // carry. Nothing on the Slack path depends on it.
    if (file.startsWith('0038')) continue
    console.error(`migration ${file} failed: ${error.message}`)
    process.exit(2)
  }
}

const scenario = path.join(
  repo,
  'supabase',
  'tests',
  '0048_slack_entity_resolution.sql',
)
// The scenario ends by deleting its test users, which cascades their profiles
// away -- and the display names in those profiles are half of what the final
// Slack messages say. So it runs in two halves, with the people read out in
// between. The SQL executed is the file's own, unmodified.
const scenarioSql = fs.readFileSync(scenario, 'utf8')
const cleanupAt = scenarioSql.lastIndexOf('delete from auth.users')
if (cleanupAt === -1) {
  console.error(
    'capture-slack-payloads: the scenario no longer ends in a cleanup',
  )
  process.exit(2)
}
await db.exec(scenarioSql.slice(0, cleanupAt))

const { rows } = await db.query(
  'select step, payload from public.slack_pipeline_capture order by step_order',
)
if (rows.length === 0) {
  console.error('capture-slack-payloads: the scenario captured no payloads')
  process.exit(2)
}

// The people the payloads point at. The test needs them because the dispatcher
// turns every id in a payload into a display name, and a message that names
// the wrong person is exactly the kind of thing this test is for.
const { rows: people } = await db.query(`
  select p.id, p.full_name, p.email from public.profiles p
  union all
  select u.id, u.raw_user_meta_data->>'full_name', u.email from auth.users u
  where not exists (select 1 from public.profiles p2 where p2.id = u.id)
`)

// The Daily Report the scenario stored. Its narration and its snapshot are
// what the Slack message is MADE of, not just what it points at, so the test
// needs the row itself rather than the payload that announced it. Read before
// the cleanup, which cascades the workspace away with its users.
const { rows: reports } = await db.query(`
  select id, workspace_id, generation_status, narrative, structured_snapshot
  from public.workspace_daily_summaries
  order by report_end, id
`)
if (reports.length === 0) {
  console.error('capture-slack-payloads: the scenario stored no Daily Report')
  process.exit(2)
}

await db.exec(scenarioSql.slice(cleanupAt))

// Ids are regenerated on every run, so they are normalised to stable
// placeholders: a diff should show a change in what the pipeline RESOLVED, not
// that gen_random_uuid() did its job again. Everything else is verbatim.
const ids = new Map()
const placeholder = (raw, hint) => {
  if (!ids.has(raw)) ids.set(raw, `00000000-0000-4000-8000-${hint}`)
  return ids.get(raw)
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const captured = rows.map(({ step, payload }, index) => {
  const normalised = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && UUID.test(value)) {
      normalised[key] = placeholder(
        value,
        String(index).padStart(6, '0') + key.slice(0, 6).padEnd(6, '0'),
      )
    } else if (key === 'createdAt') {
      normalised[key] = '2026-09-20T00:00:00+00:00'
    } else {
      normalised[key] = value
    }
  }
  return { step, payload: normalised }
})

// The stored report, normalised the same way but all the way down: its snapshot
// carries ids and timestamps at every depth, and a fixture that changed on
// every run would make --check permanently red. Ids already seen in a payload
// keep that placeholder, so the report and the message announcing it still
// agree about who is who. Timestamps become one fixed instant -- nothing
// downstream reads them, and the alternative is a diff on every capture.
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+([+-]\d{2}:?\d{2}|Z)$/
let deep = 0
const normaliseDeep = value => {
  if (Array.isArray(value)) return value.map(normaliseDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, normaliseDeep(inner)]),
    )
  }
  if (typeof value === 'string' && UUID.test(value)) {
    return placeholder(value, `deep${String(deep++).padStart(8, '0')}`)
  }
  if (typeof value === 'string' && STAMP.test(value)) {
    return '2026-09-20T00:00:00+00:00'
  }
  return value
}

const capturedReports = reports.map(report => ({
  id: normaliseDeep(report.id),
  workspace_id: normaliseDeep(report.workspace_id),
  generation_status: report.generation_status,
  narrative: normaliseDeep(report.narrative),
  structured_snapshot: normaliseDeep(report.structured_snapshot),
}))

const serialised =
  JSON.stringify(
    {
      // Read by slackPipeline.test.ts. Regenerate with
      // `node scripts/capture-slack-payloads.mjs` after changing
      // slack_payload_for_task_event().
      generatedFrom: 'supabase/tests/0048_slack_entity_resolution.sql',
      profiles: people
        .filter(person => ids.has(person.id))
        .map(person => ({
          id: ids.get(person.id),
          full_name: person.full_name,
          email: person.email,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      events: captured,
      dailyReports: capturedReports,
    },
    null,
    2,
  ) + '\n'

if (check) {
  const current = fs.existsSync(fixture) ? fs.readFileSync(fixture, 'utf8') : ''
  if (current.replace(/\r\n/g, '\n') !== serialised) {
    console.error(
      'capture-slack-payloads: the committed fixture is out of date.\n' +
        '  node scripts/capture-slack-payloads.mjs',
    )
    process.exit(1)
  }
  console.log(`fixture is current (${captured.length} payloads)`)
} else {
  fs.mkdirSync(path.dirname(fixture), { recursive: true })
  fs.writeFileSync(fixture, serialised)
  console.log(
    `wrote ${captured.length} payloads to ${path.relative(repo, fixture)}`,
  )
}

await db.close()
