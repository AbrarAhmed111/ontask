<div align="center">

# OnTask

**A calm place to plan work, focus deeply, and move projects forward together.**

Start instantly as a guest, or sign in for a private Personal Workspace and
invite-only Shared Workspaces. Plan daily tasks and larger Goals with
dependencies, track the focused time you actually spend, flag what's blocking
work, share notes and files, see teammates work in real time, and get an
AI-written Daily Report of what got done — without losing the simple,
local-first dashboard where it all started.

Built by **[Abrar Ahmed](https://www.abrarahmed.pro)**

</div>

---

OnTask started as an intentionally simple personal timer: open the dashboard,
add today's work, start one task, pause when needed, keep moving. It's grown
from there into two cooperating services — this Next.js app and a companion AI
microservice ([`ontask-llm`](ontask-llm)) — that add authenticated accounts,
Personal and Shared Workspaces with Goals, blockers, notes, files and live
presence, and a daily AI-generated narrative of a workspace's work, without
giving up the original single-dashboard simplicity for solo use.

## Core Concepts

OnTask keeps three measurements separate:

- **Daily focus target**: how much focused work you want to complete today.
- **Actual work time**: the time recorded by active task timers. Paused time
  does not count.
- **Long-term goal progress**: a percentage that you update manually for an
  optional larger goal.

Working for two hours does not automatically change goal progress. For example,
you can work on a course for two hours and manually update its overall progress
from 60% to 70%.

## Guest, Personal Workspace, Shared Workspaces

OnTask has three clear places to work:

> Guest → try OnTask · Personal Workspace → work privately · Shared Workspace →
> work collaboratively

|                        | Where                            | Who                                  | What you get                                                                                                                                                                                                       |
| ---------------------- | -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Guest**              | `/`                              | Anyone, no account                   | The local-first dashboard below. Data stays in the browser.                                                                                                                                                        |
| **Personal Workspace** | `/workspaces/personal-workspace` | Every registered user, automatically | A private, owner-only workspace: goals, tasks and subtasks, focused time, progress, activity/history, resources, and an optional AI Daily Report (off until you turn it on). Nothing to create, nothing to invite. |
| **Shared Workspaces**  | `/workspaces/<slug>`             | Invited members                      | The same workspace features plus members, invitations, assignments and team activity.                                                                                                                              |

`/workspaces` is a signed-in user's hub: their pending invitations, their
Personal Workspace, and their shared workspaces — "which workspace do I want to
work in?".

**Where sign-in lands you**

- First login with no pending invitation → the Personal Workspace, with a
  one-time welcome (remembered on the user's profile, so it never repeats).
- First login **with** a pending invitation → `/workspaces`, where the
  invitation waits for an explicit Accept or Reject. Nothing is ever
  auto-accepted.
- Every later login → `/workspaces`.
- A signed-in user who opens `/` is sent to their Personal Workspace (by the
  middleware, not by client-side JS). A signed-out visitor who opens anything
  under `/workspaces` is sent to the sign-in prompt.

**One implementation, two workspace types.** A Personal Workspace is a row in
the same `workspaces` table as a shared one, with `type = 'personal'`. Goals,
tasks, time entries, activity, resources, notifications and Daily Reports all
key off `workspace_id`, so it reuses every one of them — it just has one member,
its owner. The rules are enforced in Postgres, not only in the UI
([`0028_personal_workspaces.sql`](supabase/migrations/0028_personal_workspaces.sql)):
one personal workspace per user (unique index), no invitations and no other
members (triggers), `type` never changes, it can't be deleted or left through
the API, and row-level security keeps it invisible to everyone else. Because
`/workspaces/personal-workspace` is the same URL for every user, it's an alias
that resolves to _the signed-in user's own_ personal workspace — it can never
reach anyone else's — and the slug is reserved so a shared workspace can't take
it.

**Guest work carries over.** When a guest signs in with tasks on their device
they're asked _"Save it to your Personal Workspace?"_ — **Save My Work** imports
them (subtasks become a Goal, recorded time is kept) in one atomic database
call; **Start Fresh** leaves them on the device untouched.

**Welcome is separate from onboarding.** A first-time visitor sees a small
welcome dialog explaining that OnTask works without an account and can choose
**Continue as Guest** or **Login / Sign Up**. The choice is remembered on that
device. Account onboarding is a separate contextual tour shown to eligible new
users, while Shared Workspace tours are available through manual replay.

## Features

Everything below lives in one of the three places above. Here is what each one
includes:

| Feature                                                      |     Guest      |            Personal            |         Shared         |
| ------------------------------------------------------------ | :------------: | :----------------------------: | :--------------------: |
| Where your data lives                                        |    Browser     |            Supabase            |        Supabase        |
| Tasks with planned durations and a one-at-a-time focus timer |       ✓        |               ✓                |           ✓            |
| Subtasks                                                     | Under any task |          Inside Goals          |      Inside Goals      |
| Daily focus target                                           |       ✓        |               —                |           —            |
| Goals and task dependencies                                  |       —        |               ✓                |           ✓            |
| Shared notes on tasks                                        |       —        |               ✓                |           ✓            |
| Resources (file uploads)                                     |       —        |               ✓                |           ✓            |
| Activity feed                                                |       —        |               ✓                |           ✓            |
| Notifications                                                |       —        | Own + every shared workspace's |    That workspace's    |
| Automatic AI Daily Report                                    |       —        |   Opt-in; days with activity   | ✓ (owner can turn off) |
| Slack Integration                                            |       —        |               —                |           ✓            |
| Members, invitations, assignments, live presence             |       —        |               —                |           ✓            |
| Task blockers                                                |       —        |               —                |           ✓            |
| Guided tour                                                  |       —        |  Once on sign-up, then replay  |  Replay from Settings  |


### Guest Dashboard

- Add tasks with a planned duration, optionally nested as subtasks under a
  parent task.
- Start, pause, and resume one task at a time.
- Finish a task early when the planned duration is not needed.
- Automatically mark a task complete when its planned duration is reached.
- See actual work for each task and total focused work for the day.
- Track the day against a daily focus target (8 hours by default), with the time
  still remaining.
- Drag tasks to reorder them, or move a task under a parent task (or back out to
  the top level). Deleting a parent lets you keep its subtasks as standalone
  tasks or delete them along with it.
- Restart a finished task as a new task.
- Edit task names, durations, goal details, and goal percentages.
- Attach an optional long-term goal to a task and track its percentage
  independently from tracked time.
- Desktop notifications and a completion sound when a task finishes.
- Works immediately as a guest (data kept in the browser) — no account required
  to try it, and it stays fully usable without one. An inline prompt offers to
  create an account to keep your progress.

### Goals and Dependencies

- Create larger outcomes with a name, a description, an optional target date,
  and active, completed, or archived states.
- Organize Goal work as a Goal → task → subtask tree. Goals are the only place
  tasks nest; ordinary Personal and Shared Workspace tasks stay flat.
- See a Goal's progress (the share of its tasks that are done), its focused
  time, and how many of its tasks are blocked.
- Link tasks inside a Goal with dependencies: a task can wait on one or more
  others and becomes ready once every one of them is completed or skipped.
  Blocked and ready states are derived from the tasks themselves, and the model
  is deliberately simple — no Gantt charts or critical-path tooling.
- Keep time tracking, task progress, and Goal progress as separate measurements.

### Focused Time

- A user can run one active task per workspace, so Personal and Shared
  Workspaces can each have an independent focus timer.
- Starting another task pauses the user's active task in that same workspace,
  preserving recorded focused time.
- Assigned members control Shared Workspace timers; owners can emergency-stop a
  member's running timer without taking ownership of the work.
- Working Now excludes paused, blocked, completed, and skipped tasks.
- Reassigning a running task stops its timer and keeps the time already recorded
  with whoever worked it; the new assignee resumes it. A Shared Workspace task
  needs an assignee before its timer can start.
- Raising a completed task's planned time above the time already worked reopens
  it as paused, ready to resume. Nothing ever starts on its own, and a skipped
  task stays skipped.
- When a running task's planned time runs out it is completed automatically — by
  the assigned member's open browser, and only on the database's say-so: the app
  names the timer run it saw and the database, on its own clock and holding the
  task's row lock, completes it only if that run is still going and really is
  out of time. A task paused, restarted, extended or already completed elsewhere
  is left alone, and a repeated request never logs the completion twice. Nothing
  is completed from data the app has only cached; it waits for the server's
  answer first.

### Shared Notes and Resources

- Add shared notes to any workspace task — a plain task or one inside a Goal —
  with realtime updates and note counts on task cards. Everyone who can see the
  task can read its notes; only a note's author can edit or delete it.
- Upload several files at once. Each file uploads independently with its own
  status, so one failure never blocks the rest.
- Search resources and filter them by Documents, Images, PDFs, or Other. Cards
  preview images and the first lines of text and CSV files, and label Word,
  Excel, PowerPoint, and PDF files with a type badge.
- Download files through short-lived signed links. Only the uploader or the
  workspace owner can delete a file, and deleting removes the stored file too.
- Files sit in a private Supabase Storage bucket and are isolated per workspace
  by storage policies, so Personal and Shared Workspaces never see each other's.

### Accounts & Sign-in

- Email/password accounts and Google Sign-In (One Tap), via Supabase Auth.
- Password reset flow.
- A Personal Workspace is created automatically for every account.
- Guest → Personal Workspace: tasks created before signing in can be saved into
  the new account's Personal Workspace instead of being lost.
- An account menu with your name, a link to **All workspaces**, and Log out.
  Signing out also stops Google One Tap from silently picking the same account
  again.

### Shared Workspaces

- Create workspaces with a name, description, timezone, and accent color; the
  accent themes the workspace for everyone in it. Each one has a readable URL
  (`/workspaces/<slug>`) with separate Overview, Members, and Settings pages.
- Invite teammates by email (owners only). Invitations move through pending,
  accepted, rejected, expired, and cancelled, expire after 14 days, and arrive
  as an email whose link picks up where the invitee left off once they sign in.
  Invitees accept or reject from **All workspaces**, optionally giving the owner
  a reason; owners can cancel or clear invitations, and other members only see
  the pending ones.
- Owner and member roles per workspace. Owners can remove members; members can
  leave.
- Flat workspace tasks, each with a planned duration, an assignee, and an
  optional progress label, reordered by dragging. Nesting is reserved for
  [Goals](#goals-and-dependencies).
- An overview that leads with live counts (members, working, queued, completed
  today), a **Working now** panel showing who is on what, and a **Blocked**
  panel, then the task queue and completed tasks — followed by Goals, Resources,
  the Daily Report, and Activity.
- Shared timers sync in real time via Supabase Realtime — teammates see a task
  move between queued, working, paused, blocked, completed, and skipped as it
  happens.
- Live presence: a status dot on each member's avatar shows who currently has
  the workspace open, with a brief animation on the moment someone comes online
  or goes offline.
- An activity feed of what happened across the workspace: tasks created, edited,
  started, paused, resumed, finished, reopened, deleted, assigned, reassigned,
  and moved; progress changes; Goals and dependencies; blockers; notes;
  resources; and invitations and membership changes.

### Task Blockers

A blocker answers _why can't this task move forward?_ It is not a paused task
(stopped on purpose) and not a Goal dependency (a derived link between two
tasks). It is a shared-workspace feature — a Personal Workspace has no one to
wait on.

- The task's assignee marks it **Blocked** with a reason and can `@mention`
  workspace members. Blocking a running task stops its timer and keeps the
  focused time so far; blocked time is never focused time.
- Everyone in the workspace sees the blocker and who was asked. Only the
  **current assignee** or a **member mentioned in it** can resolve it — the
  workspace owner gets no bypass, and reassigning a task moves the right to the
  new assignee. Resolving puts the task back in the queue and never starts a
  timer.
- A **Blocked** panel on the workspace overview lists every blocked task with
  its reason and who was asked.
- A mentioned member gets an in-app notification that opens the task (once per
  new mention, never for a wording edit); the assignee is told when someone else
  resolves their blocker.
- Blockers appear in the activity feed and in the Daily Report as recorded facts
  (the reason, who was asked, who resolved it); the AI narration can only
  describe them.

The rules are enforced in Postgres, not just the UI
([`0041_task_blockers.sql`](supabase/migrations/0041_task_blockers.sql)); check
them with
[`supabase/tests/0041_task_blockers.sql`](supabase/tests/0041_task_blockers.sql)
against a scratch project.

### First-Time Visitor Welcome

- Explain guest use without requiring an account before work can begin.
- Continue as Guest keeps the local-first dashboard unchanged.
- Login / Sign Up opens the existing email/password and Google authentication
  flow; it does not create a second auth experience.
- The welcome is remembered with `localStorage` and does not replace the
  authenticated product onboarding tour.

### Notifications

In-app notifications live in one `notifications` table keyed by `workspace_id`
and are scoped by where you are — the bell only appears _inside_ a workspace,
never on the guest page or the `/workspaces` hub:

- **A shared workspace** shows only that workspace's notifications. Another
  shared workspace's never appear, and "Mark all read" only touches its own.
- **The Personal Workspace** shows its own plus every shared workspace's,
  grouped by workspace, with the workspace's name (in its accent colour) on
  every entry.

Access is enforced in Postgres, not just the UI: a user can read a notification
only while they are a member of its workspace, and can update only its read
state
([`0034_notifications_workspace_scoped_access.sql`](supabase/migrations/0034_notifications_workspace_scoped_access.sql)).

Notifications are in-app only and are created by database triggers reacting to
workspace activity, never by a client insert. Each one opens the task, Goal, or
page it is about and is marked read when opened. They cover tasks assigned or
reassigned, tasks completed or reopened, tasks unblocked, new notes, Goals
completed, invitation responses, members joining or leaving, a Daily Report
becoming ready, an owner stopping your timer, and blocker mentions and
resolutions.

### Guided Tours

A short, contextual tour points at the real interface instead of a setup wizard:
the rest of the app is dimmed, the section being explained stays lit, and a
small card says what it is and what to do there.

- **Personal Workspace tour** — daily tasks, goals, resources and settings.
  Opens once as part of initial user onboarding, after the one-time welcome.
- **Shared Workspace tour** — members, who is working now, tasks, task notes,
  goals, resources and activity. It does not open automatically when you join or
  visit a shared workspace; use **Settings → Help & guidance** to replay it.
- Every tour has Back, Next, Skip and Close, a progress indicator, Escape to
  skip and Left/Right to step. Skipping or finishing is remembered, so a tour
  never comes back on its own; **Settings → Help & guidance** replays it.
- A step is only shown if the thing it points at is on screen, so a workspace
  without tasks yet simply has no "Task notes" step.

Progress is stored in Supabase per user, workspace and tour
([`0039_user_tour_progress.sql`](supabase/migrations/0039_user_tour_progress.sql)),
so it follows you across devices. The Personal Workspace row is the user's
initial onboarding checkpoint; existing members are backfilled as onboarded when
that migration runs.

### Automatic Daily Report

- A workspace's **Daily Report** is written automatically **at a configured time
  of day (12:00 PM by default) in its own configured timezone**, covering the
  exact previous rolling 24 hours (not a calendar day) — no one has to click
  "Generate," and OnTask doesn't need to be open. The owner can change both the
  timezone and the report time per workspace at any time (workspace settings). A
  Supabase `pg_cron` job ticks every 5 minutes, finds workspaces whose
  configured local time has arrived, and calls the Next.js app server-side to
  build and save the report; a secondary "Regenerate" action stays available to
  any workspace member for the current report.
- **Daily Reports can be turned On or Off per workspace** (Settings → Daily
  Reports, owner only). A Shared Workspace starts **On**; a Personal Workspace
  starts **Off**, so nobody gets an AI report they didn't ask for. Off means no
  new reports are generated (the scheduler skips the workspace, so no AI call is
  made), the Daily Report section is hidden — no empty card, no "no reports yet"
  placeholder — and reports already written are kept. Turning it back On resumes
  future reports; it doesn't back-fill the one missed while it was off. It is
  enforced in the database, not just hidden in the UI.
- The report reads as a **short narrative, not an activity log**: the AI turns
  the verified facts into one short paragraph (Personal) or one to three
  (Shared) about what actually got done — the tasks worked on, by their real
  titles; what was completed, reopened, blocked or resolved — with repetitive
  pausing and resuming folded together. A Personal Workspace's report is about
  the owner's own work, never "1 member". The exact figures stay separate and
  deterministic, straight from the database: focused time, tasks completed
  (distinct tasks still completed at the end), each task's current status, and
  the report period; the AI never states or recalculates them. The details view
  adds the tasks and their status, workspace changes and blockers; the raw event
  list stays in the Activity feed. If AI narration is unavailable the report
  says so and falls back to a short summary written from those same facts.
- Personal Workspaces that have turned reports on get one only on days with
  recorded activity, so idle accounts never trigger an AI call. Shared
  Workspaces get one every day, even if it just says nothing was recorded.
  Members are notified when a report is ready.
- Generation is structured-first: the app aggregates the window's task events
  into a factual snapshot, hands it to the separate [`ontask-llm`](ontask-llm)
  service, and validates the returned narrative against that snapshot before
  saving it — so the AI can narrate the window but can't invent facts.
- Idempotent by construction: a database uniqueness constraint on
  `(workspace_id, report_end)` plus an atomic claim means the scheduler can run
  concurrently with itself without ever producing duplicate reports; a failed
  generation is retried automatically on the next tick.
- `ontask-llm` is a stateless FastAPI service with a multi-provider LLM gateway
  (Gemini, Groq, OpenAI, Mistral, Cerebras via LangChain) with automatic
  failover and a deterministic non-AI fallback if every provider is unavailable.

### Slack Integration

Connect any Shared Workspace to a Slack workspace to receive real-time updates and Daily Reports directly inside a chosen Slack channel:

- **Official OAuth 2.0 Integration** — Click **Add to Slack** in workspace settings to authorize via Slack's v2 OAuth flow (`/api/integrations/slack/oauth/authorize` & `callback`).
- **Real-Time Workspace Event Alerts** — Automatic Slack Block Kit notifications dispatched for key workspace events:
  - Task assignments & reassignments (`assigned`, `reassigned`)
  - Task completions & reopens (`completed`, `reopened`)
  - Task blockers created, blocker `@mentions`, resolutions, and unblocks (`blockers`, `mentions`, `resolutions`)
  - Automated Daily Team Activity Reports directly to your channel (`daily_reports`)
- **Granular Notification Settings** — Owners and admins can toggle specific notification categories on or off per workspace.
- **Destination Channel Selection** — Live fetching of accessible public and private Slack channels (`conversations.list`) with single-click selection.
- **Workspace-Scoped Initialization & Zero-Flash Loading** — Slack status is loaded during workspace initialization (`useWorkspaceSlack` hook) and cached per `userId` + `workspaceId` using `SNAPSHOTS.slackStatus`. Navigating between workspace pages (Tasks → Settings → Activity) renders the Slack card immediately without visual loading or "Not Connected" flashes.
- **Security & Token Isolation** — Sensitive Slack access tokens remain encrypted and isolated in Supabase with RLS/RPC bounds; client-side state receives only safe metadata (`connected`, `slack_team_name`, `channel_name`, `connection_status`).
- **Rich Slack Block Kit Formatting** — Formatted notification blocks with workspace accent headers, direct clickable task/report links, actor display names, and blocker reason quotes.

### Settings

**Guest dashboard.** Open the settings icon in the header to configure:

- Daily focus target in hours and minutes.
- Completion sound when a task reaches its target.
- Whether the next pending task starts automatically after completion.
- Reset of all locally stored tasks and settings.

**Workspaces.** Every Personal and Shared Workspace has its own Settings page:

- **Workspace details** — name, description (Shared Workspaces only), timezone,
  Daily Report time, and accent theme. Only the owner can edit them; members see
  them read-only. A Personal Workspace keeps its fixed name.
- **Daily Reports** — an On/Off switch for the workspace's automatic Daily
  Report. Only the owner can change it; it saves immediately.
- **Slack Integration** — connect Slack workspace, select destination channel, toggle notification event types, and manage authorization (Shared Workspaces only).
- **Your preferences** — the completion sound, saved on this device.
- **Help & guidance** — replay the workspace's guided tour.


## What OnTask Does Not Include

OnTask is not intended to become a general productivity suite. It does not
include:

- Calendars or scheduling
- Pomodoro sessions
- Habit tracking or streaks
- Productivity scores or analytics dashboards
- Kanban boards or general project management
- Gantt charts, dependency graphs, or critical-path planning
- Public/social features beyond invited workspace members

## Technology

**App (this repo)**

- Next.js 15 App Router, React 18, TypeScript
- Tailwind CSS, Lucide React / React Icons
- Redux Toolkit + React Redux for client-side workspace cache/state
- Supabase (Postgres, Auth, Realtime, Storage, Row Level Security, `pg_cron`)
  for accounts, workspaces, tasks, Goals, notes, files, presence, notifications,
  and activity
- Google One Tap for one-click Google Sign-In
- Nodemailer for workspace invitation emails
- Browser `localStorage` for the guest dashboard, device preferences, and a
  paint-first workspace cache
- Vitest for unit and component tests

**AI microservice ([`ontask-llm`](ontask-llm), separate service)**

- Python, FastAPI, LangChain
- Multi-provider LLM gateway with automatic failover between providers

The guest dashboard is local-first and works without any backend configured.
Signing in, workspaces, and the Daily Report require a configured Supabase
project (and, for the Daily Report specifically, a running `ontask-llm` instance
plus the scheduler env vars above).

## Project Structure

```text
src/
├── app/
│   ├── page.tsx                    # Guest dashboard (signed-in users are redirected away)
│   ├── workspaces/                 # Workspace hub + per-workspace pages (shared and personal)
│   │   └── [workspaceSlug]/        # Overview, plus members/ and settings/ routes
│   └── api/
│       ├── workspace-invitations/  # Invitation email delivery
│       ├── workspace-summaries/    # Manual "Regenerate" route (secondary to the scheduler)
│       └── cron/daily-reports/     # Automatic Daily Report scheduler entry point (pg_cron -> here)
├── middleware.ts                   # Session refresh and sign-in / Personal Workspace redirects
├── components/
│   ├── auth/                       # Sign-in/sign-up, Google One Tap, visitor welcome, guest-work prompt
│   ├── blockers/                   # Task blocker dialogs, badges, and the Blocked panel
│   ├── dashboard/                  # Guest task cards, list, empty state
│   ├── goals/                      # Goal cards, progress, and the dependency picker
│   ├── layout/                     # Header, footer, account menu, workspace shell
│   ├── mentions/                   # @mention picker for workspace members
│   ├── notifications/              # Notification bell and panel
│   ├── resources/                  # Resource cards, previews, upload queue
│   ├── settings/                   # Guest settings modal
│   ├── tasks/                      # Task forms, notes panel, and modals
│   ├── tour/                       # Onboarding tour engine (provider, highlight, popover)
│   ├── ui/                         # Shared primitives (Button, Modal, ...)
│   └── workspaces/                 # Workspace cards, members, tasks, activity, Daily Report
├── hooks/                          # useAuth, useTasks, useTimer, useWorkspace*, ...
├── lib/
│   ├── auth/, email/, goals/, realtime/, redux/, supabase/, tasks/
│   ├── notifications.ts, storage.ts, time.ts, dailyReportWindow.ts
│   ├── mentions.ts, resources.ts, resourceUploads.ts
│   ├── tour/                       # Tour definitions, layout maths, persistence
│   ├── tourAnchors.ts              # `data-tour` ids the tours point at
│   ├── workspaces.ts               # Personal-workspace alias + row mapping
│   ├── workspaceNotifications.ts   # Notification scoping (personal vs shared) + grouping
│   └── workspaceThemes.ts
└── types/
    ├── index.ts
    └── workspace.ts

ontask-llm/        # Companion AI microservice (its own README, deployed separately)
supabase/          # SQL migrations (migrations/) and database rule tests (tests/)
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file with at least:

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=
ONTASK_LLM_SERVICE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

The guest dashboard runs with none of these set. Supabase variables are required
for sign-in and workspaces; the `SMTP_*` variables are required to send
workspace invitation emails; `ONTASK_LLM_SERVICE_URL` should point at a running
[`ontask-llm`](ontask-llm) instance to enable the automatic Daily Report.
`SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project's API settings —
**server-only, never expose it to the browser**) and `CRON_SECRET` (any random
string you generate) are required for the automatic scheduler
(`/api/cron/daily-reports`); without them the Daily Report feature falls back to
being unavailable rather than insecure. `SMTP_REPLY_TO` is optional: it sets the
reply-to address on invitation emails and defaults to `SMTP_FROM_EMAIL`.

Apply the SQL migrations in [`supabase/migrations`](supabase/migrations), in
order, to your Supabase project before using auth, workspaces, or the Daily
Report — including
[`0018_automatic_daily_reports.sql`](supabase/migrations/0018_automatic_daily_reports.sql),
which also schedules the `pg_cron` job that drives the automatic scheduler.
After applying it (and deploying the app), set the job's target once:

```sql
update public.app_cron_config
set target_url = 'https://<your-deployed-app>/api/cron/daily-reports',
    cron_secret = '<the CRON_SECRET value above>';
```

Migration `0026` also creates the private `workspace-resources` Storage bucket
that Resources uploads go into.

Migrations `0028`–`0032` introduce Personal Workspaces. They give every existing
account a Personal Workspace, add the first-login state and the invitation
display data the sign-in flow needs, and copy existing signed-in users' personal
tasks into their new Personal Workspace (non-destructively — the old
`personal_tasks` table is left untouched). To check them, run
[`supabase/tests/0028_personal_workspaces.sql`](supabase/tests/0028_personal_workspaces.sql)
against a scratch project.

Migration `0043` adds `auto_complete_workspace_task`, the guarded completion
behind a task finishing when its planned time runs out (see Focused Time). The
app works without it — it then re-reads the task and completes it with
`complete_workspace_task`, which does not check that the task is still running
or due — but apply it so the database, not the browser, has the last word. To
check it, run `supabase/tests/0043_guarded_task_auto_completion.sql` against a
scratch project.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm run start     # Serve the production build
npm run lint      # Run ESLint with the repository configuration
npm run format    # Format project files with Prettier
npm test          # Run the Vitest suite
```

The AI service has its own tests (`uv run pytest` in
[`ontask-llm`](ontask-llm)). The database rules — timers, Personal Workspaces,
Daily Reports (including the On/Off setting), blockers — have SQL tests in
[`supabase/tests`](supabase/tests) to run against a scratch Supabase project.

## Local Data

The guest dashboard stores its data in the browser:

- `ontask-tasks-v2`: today's tasks, timer state, and goal associations.
- `ontask-settings-v1`: daily target and notification preferences.
- `ontask-guest-work-resolved-v2`: ids of guest tasks the user has already
  answered the "save to your Personal Workspace?" prompt for.

Two more keys hold no task data. `ontask_welcome_seen` records that the visitor
welcome was answered on this device. `ontask-workspace-cache-v1` is a
paint-first cache of a signed-in user's workspace name, accent, and timezone, so
a refresh doesn't flash defaults; Supabase overwrites it on every load.

Use **Settings → Reset local data** to remove the three guest keys and return to
the initial empty state (the welcome flag stays, so the welcome doesn't come
back). Signed-in users' Personal Workspace and shared workspace data instead
lives in Supabase, guarded by Row Level Security, and so does their guided-tour
progress.

## Philosophy

> Work when you are ready. Focus on one thing. Track the work you actually do.
> Keep moving toward the bigger goal.

## Status

OnTask is under active development.

## License

OnTask is released under the [MIT License](LICENSE).

## Author

OnTask is designed and built by **[Abrar Ahmed](https://www.abrarahmed.pro)**.
