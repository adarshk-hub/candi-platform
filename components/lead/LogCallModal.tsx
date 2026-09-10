// path: components/lead/LogCallModal.tsx
'use client'

import { useState } from 'react'
import { PhoneCall, X } from 'lucide-react'
import { clsx } from 'clsx'

const OUTCOMES = [
  { key: 'connected', label: 'Connected' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'busy', label: 'Busy' },
  { key: 'call_back_later', label: 'Call back later' },
  { key: 'switched_off', label: 'Switched off' },
  { key: 'wrong_number', label: 'Wrong number' },
] as const

// Records a call attempt against a lead. This is what feeds "calls logged"
// on My Day and Team Day, and what makes "never called" answerable on the
// Activity page — a note typed into the history can't be counted, because
// its wording is up to whoever typed it.
//
// Lives on the lead rather than on My Day: the call happens while somebody
// is looking at the parent's number, and a button on a summary screen would
// mean navigating away from the thing being logged.
// The modal on its own, so both the Bookings tab's green "Add Call" button
// and any other caller can open it without inheriting a particular trigger
// button's styling.
export default function LogCallModal({
  leadId,
  onClose,
  onLogged,
}: {
  leadId: string
  onClose: () => void
  onLogged?: () => void
}) {
  const [outcome, setOutcome] = useState<string>('connected')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not log that call.')
        return
      }
      setNotes('')
      setOutcome('connected')
      onLogged?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-fg">
                <PhoneCall size={16} className="text-green-500" /> Log a call
              </h2>
              <button onClick={onClose} className="text-muted2 hover:text-fg">
                <X size={18} />
              </button>
            </div>

            <label className="mb-1.5 block text-xs text-muted">How did it go?</label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setOutcome(o.key)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs',
                    outcome === o.key
                      ? 'border-green-500 bg-green-500/15 text-green-400'
                      : 'border-border text-muted2 hover:text-fg'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <label className="mb-1.5 block text-xs text-muted">Notes (optional)</label>
            <textarea
              value={notes}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was said, what they asked for"
              className="mb-3 w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-green-500"
            />

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Log call'}
              </button>
            </div>
      </div>
    </div>
  )
}
