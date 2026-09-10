// path: components/lead/tabs/NextActionTab.tsx
'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Check } from 'lucide-react'
import { clsx } from 'clsx'

interface NextActionState {
  next_action: string | null
  next_action_at: string | null
  next_action_set_at: string | null
  next_action_done_at: string | null
}

// Common enough to be worth one tap. Free text stays available for anything
// that isn't one of these.
const QUICK_ACTIONS = [
  'Call to introduce the school',
  'Follow up on the brochure',
  'Confirm campus visit date',
  'Share fee structure',
  'Check on documents',
  'Call back after parent discussion',
]

// Replaces the old Follow Up tab. A follow-up was optional, so a lead with
// none looked the same as a lead needing nothing. A next action is expected
// on every assigned lead, which is what makes its absence something the day
// pages can report on.
export default function NextActionTab({
  leadId,
  onChanged,
}: {
  leadId: string
  onChanged?: () => void
}) {
  const [state, setState] = useState<NextActionState | null>(null)
  const [action, setAction] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function load() {
    fetch(`/api/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((lead) => {
        if (!lead) return
        setState({
          next_action: lead.next_action ?? null,
          next_action_at: lead.next_action_at ?? null,
          next_action_set_at: lead.next_action_set_at ?? null,
          next_action_done_at: lead.next_action_done_at ?? null,
        })
      })
      .catch(() => {})
  }

  useEffect(load, [leadId])

  const open = !!state?.next_action_at && !state?.next_action_done_at
  const overdue = open && !!state?.next_action_at && new Date(state.next_action_at) < new Date()

  async function save() {
    if (!action.trim() || !dueAt) {
      setError('Both the action and a date are needed.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/next-action`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dueAt }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not save.')
        return
      }
      setAction('')
      setDueAt('')
      load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  async function complete() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/next-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not mark that done.')
        return
      }
      load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {open ? (
        <div
          className={clsx(
            'rounded-card border p-4',
            overdue ? 'border-red-500/50 bg-red-500/10' : 'border-border bg-card2'
          )}
        >
          <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-muted">
            {overdue ? <AlertTriangle size={13} className="text-red-400" /> : <CalendarClock size={13} />}
            {overdue ? 'Overdue — not executed' : 'Planned'}
          </p>
          <p className="text-base text-fg">{state?.next_action}</p>
          <p className={clsx('mt-1 text-sm', overdue ? 'text-red-400' : 'text-muted2')}>
            Due {new Date(state!.next_action_at!).toLocaleString('en-IN')}
          </p>
          <button
            onClick={complete}
            disabled={saving}
            className="mt-3 flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            <Check size={14} /> Mark done
          </button>
        </div>
      ) : (
        <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-300">
            {state?.next_action_done_at
              ? 'The last action was completed. Plan the next one so this lead doesn’t go quiet.'
              : 'No next action planned for this lead yet — every assigned lead should have one.'}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          {open ? 'Replace with a new action' : 'Plan the next action'}
        </p>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((q) => (
            <button
              key={q}
              onClick={() => setAction(q)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs',
                action === q
                  ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                  : 'border-border text-muted2 hover:text-fg'
              )}
            >
              {q}
            </button>
          ))}
        </div>

        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="What happens next?"
          className="mb-2 w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          />
          {/* Most next actions are "tomorrow" or "in a few days" — typing a
              full date and time for that is more friction than the decision
              deserves. */}
          {[
            { label: 'Tomorrow', days: 1 },
            { label: 'In 3 days', days: 3 },
            { label: 'Next week', days: 7 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() + p.days)
                d.setHours(10, 0, 0, 0)
                // datetime-local wants local time with no zone, which
                // toISOString would convert away.
                const pad = (n: number) => String(n).padStart(2, '0')
                setDueAt(
                  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                )
              }}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted2 hover:text-fg"
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save next action'}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
