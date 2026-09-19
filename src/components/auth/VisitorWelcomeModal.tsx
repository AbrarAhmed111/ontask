'use client'

import { LogIn, UserRound } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export function VisitorWelcomeModal({
  onContinue,
  onLogin,
}: {
  onContinue: () => void
  onLogin: () => void
}) {
  return (
    <Modal
      eyebrow="Start with OnTask"
      title="Welcome to OnTask"
      onClose={onContinue}
    >
      <p className="text-sm font-semibold leading-6 text-ink">
        You can start working right away — no account required.
      </p>
      <p className="mt-3 text-xs leading-5 text-muted">
        Use OnTask as a guest to create tasks, track your focused time, and
        organize your work.
      </p>
      <div className="mt-5 rounded-xl border border-sage/40 bg-sage/10 p-3.5">
        <p className="text-xs font-semibold text-ink">Want more?</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Create an account to unlock Shared Workspaces, realtime collaboration,
          Slack integration, notifications, synced data, and more.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Button type="button" className="w-full" onClick={onContinue}>
          <UserRound size={15} /> Continue as Guest
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={onLogin}
        >
          <LogIn size={15} /> Login / Sign Up
        </Button>
      </div>
    </Modal>
  )
}
