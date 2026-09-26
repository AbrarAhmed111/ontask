import { Suspense } from 'react'
import { EventsClient } from '@/components/events/EventsClient'

// Personal and workspace events. Its data (the events, live) is fetched by the
// client component, not the shared workspace layout -- it is specific to this
// page (and the Overview's Upcoming Event card).
export default function WorkspaceEventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsClient />
    </Suspense>
  )
}
