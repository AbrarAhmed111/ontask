import { DailyUpdatesClient } from '@/components/daily-updates/DailyUpdatesClient'

// Who has reported for a day, and what each person said is done, blocked and
// next. Its data (the day's updates, live) is fetched by the client component,
// not the shared workspace layout -- it is specific to this page.
export default function WorkspaceDailyUpdatesPage() {
  return <DailyUpdatesClient />
}
