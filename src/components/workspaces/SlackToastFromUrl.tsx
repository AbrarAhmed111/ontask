'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

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
