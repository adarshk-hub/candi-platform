// path: components/lead/WelcomePrompt.tsx
'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'

// Sits at the very top of a lead whose automatic WhatsApp welcome is being
// held. Deliberately a strip inside the lead rather than a modal: a lead can
// arrive at any moment, and a modal that steals focus mid-call is worse than
// a question that waits patiently until the lead is opened.
export default function WelcomePrompt({
  leadId,
  leadName,
  onAnswered,
}: {
  leadId: string
  leadName: string
  onAnswered: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function answer(send: boolean) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Could not save that choice.')
        return
      }
      onAnswered()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-blue-500/10 px-6 py-3">
      <MessageCircle size={18} className="text-blue-400" />
      <p className="flex-1 text-sm text-fg">
        Send the WhatsApp welcome message to <span className="font-medium">{leadName}</span>?
      </p>
      <button
        onClick={() => answer(true)}
        disabled={busy}
        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        Yes, send
      </button>
      <button
        onClick={() => answer(false)}
        disabled={busy}
        className="rounded-md border border-border px-4 py-1.5 text-sm text-muted2 hover:text-fg disabled:opacity-50"
      >
        No
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </div>
  )
}
