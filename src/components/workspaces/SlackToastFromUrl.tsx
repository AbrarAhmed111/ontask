'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

// What went wrong while connecting GitHub, in words (the reasons are set by
// api/integrations/github/callback).
const GITHUB_ERRORS: Record<string, string> = {
  expired: 'The GitHub connection took too long. Please try again.',
  different_user: 'Please finish connecting GitHub with the same account.',
  approval_pending:
    'An organisation owner on GitHub has to approve the OnTask app first.',
  missing_installation: 'GitHub did not say which installation to use.',
  authorization_required:
    'GitHub did not confirm your account. Please try connecting again.',
  authorization_cancelled: 'GitHub connection cancelled.',
  authorization_failed:
    'GitHub could not confirm your account. Please try connecting again.',
  installation_not_yours:
    'That GitHub installation is not available to your GitHub account.',
  save_failed: "Couldn't save the GitHub connection.",
  github_unavailable: "Couldn't reach GitHub. Please try again.",
}

export function SlackToastFromUrl({
  onSlackConnected,
}: {
  onSlackConnected?: () => void
} = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!searchParams) return
    const slack = searchParams.get('slack')
    const slackError = searchParams.get('slack_error')
    const github = searchParams.get('github')
    const githubError = searchParams.get('github_error')

    // The integrations' OAuth round trips land back here with their outcome in
    // the URL: say it once, then drop it from the address bar.
    if (github === 'connected' || githubError) {
      if (github === 'connected') showSuccessToast('GitHub connected.')
      else
        showErrorToast(
          GITHUB_ERRORS[githubError ?? ''] ?? "Couldn't connect GitHub.",
        )
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('github')
      newParams.delete('github_error')
      const queryString = newParams.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname)
      return
    }

    if (slack === 'connected') {
      showSuccessToast('Slack workspace connected successfully!')
      onSlackConnected?.()
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('slack')
      const queryString = newParams.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname)
    } else if (slackError) {
      showErrorToast(`Slack connection error: ${slackError}`)
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('slack_error')
      const queryString = newParams.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname)
    }
  }, [searchParams, router, pathname, onSlackConnected])

  return null
}
