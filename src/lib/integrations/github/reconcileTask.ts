import type { createServiceRoleClient } from '@/lib/supabase/service'
import { reconcileEvents } from '@/lib/integrations/github/githubApp'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export type ReconcileTarget = {
  installationId: number
  repositoryId: number
  repositoryFullName: string
  branchName: string
  branchDetectedAt: string | null
  prNumber: number | null
  prState: 'open' | 'closed' | 'merged' | null
}

// Ask GitHub about one Development Task and apply the answer through
// apply_github_development_event() -- the webhook's own path, so the same
// state rules and duplicate guards hold. Throws when GitHub (or the database)
// can't be reached: the caller changes nothing and tries again later.
// Returns the kinds of events applied.
export async function reconcileDevelopmentTask(
  service: ServiceClient,
  target: ReconcileTarget,
) {
  const events = await reconcileEvents({
    installationId: target.installationId,
    repositoryId: target.repositoryId,
    repositoryFullName: target.repositoryFullName,
    branchName: target.branchName,
    branchDetected: target.branchDetectedAt !== null,
    prNumber: target.prNumber,
    prState: target.prState,
  })
  for (const event of events) {
    const { error } = await service.rpc('apply_github_development_event', {
      p_delivery_id: null,
      p_event: event,
    })
    if (error) throw error
  }
  return events.map(event => event.kind)
}
