// path: components/lead/tabs/NextActionTab.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, ChevronDown, ChevronRight, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'

interface NextActionState {
  next_action: string | null
  next_action_at: string | null
  next_action_set_at: string | null
  next_action_done_at: string | null
  assigned_counsellor_id: string | null
}

interface HistoryEntry {
  id: string
  title: string
  description: string | null
  actor_name: string | null
  created_at: string
}

const QUICK_ACTIONS = [
  'Call to introduce the school',
  'Follow up on the brochure',
  'Confirm campus visit date',
  'Share fee structure',
  'Check on documents',
  'Call back after parent discussion',
]

// Titles written by the next-action endpoints. Filtering on these keeps the
// history to decisions about what happens next, rather than repeating the
// full activity trail that already has its own tab.
const HISTORY_TITLES = ['Next Action Set', 'Next Action Done', 'Next Action Cancelled']

// "3 hr 20 min", "45 min", "2 days 4 hr". Rounded units rather than a
// timestamp because the question being asked is "how long has this lead been
// sitting untouched", and a date makes you do that arithmetic yourself.
function elapsed(since: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) {
    const rem = mins % 60
    return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`
  }
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  return remHrs ? `${days} day${days === 1 ? '' : 's'} ${remHrs} hr` : `${days} day${days === 1 ? '' : 's'}`
}

export default function NextActionTab({ leadId, onChanged }: { leadId: string; onChanged?: () => void }) {
  const [state, setState] = useState<NextActionState | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [action, setAction] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch(`/api/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((lead) => {
        if (!lead) return
        setState({
          next_action: lead.next_action ?? null,
          next_action_at: lead.next_action_at ?? null,
          next_action_set_at: lead.next_action_set_at ?? null,
          next_action_done_at: lead.next_action_done_at ?? null,
          assigned_counsellor_id: lead.assigned_counsellor_id ?? null,
        })
      })
      .catch(() => {})

    fetch(`/api/leads/${leadId}/activity`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) =>
        setHistory((Array.isArray(rows) ? rows : []).filter((a: HistoryEntry) => HISTORY_TITLES.includes(a.title)))
      )
      .catch(() => {})
  }, [leadId])

  useEffect(load, [load])

  const open = !!state?.next_action_at && !state?.next_action_done_at
  const overdue = open && !!state?.next_action_at && new Date(state.next_action_at) < new Date()
  const hasCounsellor = !!state?.assigned_counsellor_id

  async function save() {
    if (!hasCounsellor) {
      setError('Assign a counsellor to this lead before planning a next action.')
      return
    }
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

  async function resolve(method: 'POST' | 'DELETE') {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/next-action`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not update that action.')
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

          {/* Mark done and Cancel, laid out like the call booking actions so
              the same shape of decision looks the same everywhere. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => resolve('POST')}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              <Check size={13} /> Mark done
            </button>
            <button
              onClick={() => resolve('DELETE')}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg disabled:opacity-50"
            >
              <XIcon size={13} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-300">
            {state?.next_action_done_at
              ? 'The last action was completed. Plan the next one so this lead doesn’t go quiet.'
              : 'No next action planned for this lead yet; this should be always filled.'}
          </p>
          {/* How long this lead has been without a plan. A lead with nothing
              scheduled is invisible until someone notices — this is the
              number that makes "nobody has touched this since Tuesday"
              obvious without opening History. */}
          {state?.next_action_done_at && (
            <p className="mt-1 text-xs text-amber-300/80">
              Nothing planned for {elapsed(state.next_action_done_at)} since the last action was completed.
            </p>
          )}
        </div>
      )}

      {!hasCounsellor && (
        <p className="rounded-card border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          This lead has no counsellor. A next action is somebody's commitment, so assign one first — use the
          Counsellor dropdown at the top of this panel.
        </p>
      )}

      <div className={clsx(!hasCounsellor && 'pointer-events-none opacity-40')}>
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
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Collapsed by default: on most leads this is a short list nobody
          needs, and it would otherwise push the planning form off screen. */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted hover:text-fg"
        >
          {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Action history
          {history.length > 0 && <span className="font-normal normal-case text-muted2">({history.length})</span>}
        </button>

        {showHistory && (
          <div className="mt-3 space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-md border border-border bg-card2 px-3 py-2">
                <p className="text-sm text-fg">{h.title.replace('Next Action ', '')}</p>
                {h.description && <p className="mt-0.5 text-xs text-muted2">{h.description}</p>}
                <p className="mt-1 text-[11px] text-muted">
                  {new Date(h.created_at).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {h.actor_name ? ` · ${h.actor_name}` : ''}
                </p>
              </div>
            ))}
            {history.length === 0 && <p className="py-4 text-center text-sm text-muted">Nothing yet.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
