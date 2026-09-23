import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import { mergeById } from '@/lib/realtime/mergeById'
import {
  buildStoragePath,
  classifyDeleteError,
  SignedUrlGetter,
} from '@/lib/resources'
import {
  classifyUploadError,
  isCleanFinish,
  runWithConcurrency,
  uploadQueueReducer,
} from '@/lib/resourceUploads'
import { WorkspaceResource } from '@/types/workspace'
import { onResync } from '@/lib/realtime/onResync'

type WorkspaceResourceRow = {
  id: string
  workspace_id: string
  goal_id: string | null
  uploaded_by: string
  file_name: string
  file_type: string
  file_size: number
  storage_path: string
  description: string | null
  created_at: string
  updated_at: string
}

function rowToResource(row: WorkspaceResourceRow): WorkspaceResource {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    goalId: row.goal_id,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const NO_RESOURCES: WorkspaceResource[] = []

const BUCKET = 'workspace-resources'
// A few files at a time: quick for a batch, without opening a connection per
// file. Each file is independent, so one failing never stops the others.
const UPLOAD_CONCURRENCY = 3
// How long a finished, fully successful batch stays on screen.
const UPLOAD_CLEAR_DELAY_MS = 2500
const SIGNED_URL_TTL_SECONDS = 60 * 5
// A signed URL is reused for a while (thumbnails re-mount as the list is
// filtered or scrolled) but retired well before it expires.
const SIGNED_URL_REUSE_MS = (SIGNED_URL_TTL_SECONDS - 90) * 1000

const createdAtMs = (resource: WorkspaceResource) =>
  new Date(resource.createdAt).getTime()

// Insert-or-replace by id, newest first. Every path that adds a row -- our
// own add right after an upload and the realtime INSERT/UPDATE event that
// follows it -- goes through this, so the same resource arriving twice can
// never render twice (nor replay its entrance animation: same id, same key).
const upsertResource = (
  current: WorkspaceResource[],
  incoming: WorkspaceResource,
) => mergeById(current, [incoming], createdAtMs)

// Files belong to the workspace (Supabase Storage holds the bytes, this
// table holds metadata) -- same postgres_changes realtime pattern as
// everything else. Upload is a two-step client flow (storage object, then
// metadata row) mirroring how a couple of other event types in this app are
// already client-logged rather than RPC-atomic; a failed second step is
// cleaned up best-effort rather than left to leak indefinitely. Several files
// can be uploaded at once: each runs that flow on its own and reports into an
// upload queue, so a failure is per file and never rolls back the others.
export function useWorkspaceResources(
  workspaceId: string,
  user: AuthUser | null,
) {
  const userId = user?.id
  // What is cached is the metadata -- name, type, size, storage path -- never the
  // files: their bytes stay in Supabase Storage and are fetched (as signed URLs)
  // only when previewed or downloaded.
  const snapshot = useWorkspaceSnapshot<WorkspaceResource[]>({
    userId,
    workspaceId,
    descriptor: SNAPSHOTS.resources,
    initial: NO_RESOURCES,
  })
  const { data: resources, setData: setResources, confirm } = snapshot
  const fetchKey = userId && workspaceId ? `${userId}|${workspaceId}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load resources.",
    refresh:
      "Couldn't refresh resources — you may be seeing an out-of-date list.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  const { ready, error } = status
  const [uploads, dispatchUploads] = useReducer(uploadQueueReducer, [])
  const signedUrls = useRef(
    new Map<string, { url: string; reuseUntil: number }>(),
  )

  useEffect(() => {
    if (!userId || !workspaceId || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchResources = () => {
      supabase
        .from('workspace_resources')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (fetchError) {
            markFailed()
            return
          }
          confirm(((data ?? []) as WorkspaceResourceRow[]).map(rowToResource))
          markSucceeded()
        })
    }

    fetchResources()

    const stopResync = onResync(() => fetchResources())

    const channel = supabase
      .channel(`workspace-resources-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_resources',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id
            if (deletedId)
              setResources(current => current.filter(r => r.id !== deletedId))
            return
          }
          const incoming = rowToResource(payload.new as WorkspaceResourceRow)
          setResources(current => upsertResource(current, incoming))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [
    userId,
    workspaceId,
    fetchKey,
    confirm,
    setResources,
    markFailed,
    markSucceeded,
  ])

  // Uploads one file: storage object, then its metadata row. Never throws --
  // the outcome goes to the queue -- so it is safe to run several at once.
  const uploadOne = async (id: string, file: File, goalId: string | null) => {
    const supabase = createClient()
    const storagePath = buildStoragePath(workspaceId, id, file.name)
    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file)
      if (uploadError) {
        dispatchUploads({
          type: 'finished',
          id,
          error: classifyUploadError(uploadError),
        })
        return false
      }

      const { data, error: insertError } = await supabase
        .from('workspace_resources')
        .insert({
          workspace_id: workspaceId,
          goal_id: goalId,
          uploaded_by: userId,
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          storage_path: storagePath,
        })
        .select('*')
        .single()
      if (insertError || !data) {
        void supabase.storage.from(BUCKET).remove([storagePath])
        dispatchUploads({ type: 'finished', id, error: "Couldn't save" })
        return false
      }

      // Show it right away rather than waiting for the realtime event;
      // upsertResource makes that event (which still arrives) a no-op.
      setResources(current =>
        upsertResource(current, rowToResource(data as WorkspaceResourceRow)),
      )
      dispatchUploads({ type: 'finished', id })
      return true
    } catch {
      void supabase.storage.from(BUCKET).remove([storagePath])
      dispatchUploads({ type: 'finished', id, error: 'Upload failed' })
      return false
    }
  }

  const uploadMany = async (files: File[], goalId: string | null = null) => {
    if (!userId || files.length === 0) return { succeeded: 0, failed: 0 }
    const jobs = files.map(file => ({ id: crypto.randomUUID(), file }))
    dispatchUploads({
      type: 'queued',
      items: jobs.map(({ id, file }) => ({
        id,
        fileName: file.name,
        fileSize: file.size,
        status: 'uploading' as const,
      })),
    })
    let succeeded = 0
    await runWithConcurrency(jobs, UPLOAD_CONCURRENCY, async ({ id, file }) => {
      if (await uploadOne(id, file, goalId)) succeeded++
    })
    return { succeeded, failed: jobs.length - succeeded }
  }

  const dismissUploads = useCallback(
    () => dispatchUploads({ type: 'dismissed' }),
    [],
  )

  // A batch with nothing to report clears itself; one with a failure stays
  // until dismissed.
  useEffect(() => {
    if (!isCleanFinish(uploads)) return
    const timer = window.setTimeout(dismissUploads, UPLOAD_CLEAR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [uploads, dismissUploads])

  // Removes the card at once (optimistic) and puts it back if the server
  // refuses. Two server steps, in this order: the RPC authorises the caller
  // and deletes the metadata row; then the file itself is removed through the
  // Storage API (SQL deletes from storage.objects are blocked by Supabase and
  // would leave the bytes behind anyway -- see migration 0038). The outcome is
  // returned rather than parked in `error`, so the caller reports exactly this
  // delete: a shared error string would never re-toast a repeated failure.
  const remove = async (
    id: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const removed = resources.find(r => r.id === id)
    setResources(current => current.filter(r => r.id !== id))
    const supabase = createClient()

    const { error: rpcError } = await supabase.rpc(
      'delete_workspace_resource',
      { p_resource_id: id },
    )
    if (rpcError) {
      console.error('delete_workspace_resource failed:', rpcError)
      const failure = classifyDeleteError(rpcError)
      if (failure.alreadyGone) return { ok: true }
      if (removed) setResources(current => upsertResource(current, removed))
      return { ok: false, message: failure.message }
    }

    if (removed) {
      signedUrls.current.delete(removed.storagePath)
      // The resource is already gone from the user's point of view, so a
      // storage hiccup is logged rather than reported: at worst an
      // unreachable file is left behind.
      const { data, error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([removed.storagePath])
      if (storageError || !data || data.length === 0) {
        console.warn(
          'Resource deleted, but its file was not removed from storage:',
          storageError ?? 'no matching object (missing storage delete policy?)',
        )
      }
    }
    return { ok: true }
  }

  const getSignedUrl: SignedUrlGetter = useCallback(
    async (storagePath, options) => {
      // Download URLs carry a filename, so they aren't shared with previews.
      const reusable = !options?.download
      const cached = signedUrls.current.get(storagePath)
      if (reusable && cached && cached.reuseUntil > Date.now())
        return cached.url

      const supabase = createClient()
      const { data, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(
          storagePath,
          SIGNED_URL_TTL_SECONDS,
          options?.download ? { download: options.download } : undefined,
        )
      if (signError || !data) return null
      if (reusable) {
        signedUrls.current.set(storagePath, {
          url: data.signedUrl,
          reuseUntil: Date.now() + SIGNED_URL_REUSE_MS,
        })
      }
      return data.signedUrl
    },
    [],
  )

  return {
    resources,
    ready,
    error,
    uploads,
    uploadMany,
    dismissUploads,
    remove,
    getSignedUrl,
  }
}
