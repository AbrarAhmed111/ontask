import type { SupabaseClient } from '@supabase/supabase-js'

// Creating executable work from an Idea means it is no longer just captured.
// Only promote fresh Ideas; never downgrade work already underway, done, or
// archived.
export function markIdeaPlannedFromExecution(
  supabase: SupabaseClient,
  ideaId: string | null | undefined,
  workspaceId: string,
) {
  if (!ideaId) return Promise.resolve()
  return supabase
    .from('ideas')
    .update({ status: 'planned' })
    .eq('id', ideaId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .then(() => undefined)
}
