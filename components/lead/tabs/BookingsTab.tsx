// path: components/lead/tabs/BookingsTab.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, Phone, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import VisitTab from './VisitTab'

interface CallBooking {
  id: string
  event_date: string
  event_time: string | null
  notes: string | null
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled'
  created_at: string
}

const STATUS_PILL: Record<string, string> = {
  scheduled: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-green-500/20 text-green-300',
  no_show: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-zinc-600/40 text-zinc-300',
}

// Replaces the old Visit tab. Calls and visits are both an appointment with
// a family — a date, a time, and an outcome — so they sit together under
// Bookings rather than a call being a button in the panel header with
// nothing tying it to the visit that follows.
export default function BookingsTab({ leadId }: { leadId: string }) {
  const [sub, setSub] = useState<'call' | 'visit'>('call')

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-border">
        {([
          { key: 'call' as const, label: 'Call', icon: Phone },
          { key: 'visit' as const, label: 'Visit', icon: MapPin },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={clsx(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium',
              sub === t.key ? 'border-blue-500 text-fg' : 'border-transparent text-muted2 hover:text-fg'
            )}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'call' ? <CallBookings leadId={leadId} /> : <VisitTab leadId={leadId} />}
    </div>
  )
}

function CallBookings({ leadId }: { leadId: string }) {
  const [calls, setCalls] = useState<CallBooking[]>([])
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch(`/api/leads/${leadId}/calls`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setCalls(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }, [leadId])

  useEffect(load, [load])

  async function book() {
    if (!date) {
      setError('Pick a date.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventDate: date, eventTime: time || null, notes }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not book that call.')
        return
      }
      setDate('')
      setTime('')
      setNotes('')
      load()
    } finally {
      setSaving(false)
    }
  }

  async function resolve(id: string, status: 'completed' | 'no_show' | 'cancelled') {
    await fetch(`/api/leads/${leadId}/calls`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id, status }),
    }).catch(() => {})
    load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card2 p-5">
        <p className="mb-4 font-semibold text-fg">Schedule a call:</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-fg outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Time slot</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-fg outline-none focus:border-green-500"
            />
          </div>
          {/* What the call is for. Without it a list of booked calls is just
              a column of dates, and whoever picks the lead up next has no
              idea what was promised. */}
          <div className="min-w-[12rem] flex-1">
            <label className="mb-1 block text-xs text-muted">Description</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Discuss fee structure with father"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg outline-none focus:border-green-500"
            />
          </div>
          <button
            onClick={book}
            disabled={saving}
            className="rounded-md bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {saving ? 'Booking…' : 'Book Call'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {calls.map((c) => (
        <div key={c.id} className="rounded-card border border-border bg-card2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-fg">
                Call on{' '}
                {new Date(c.event_date).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
                {c.event_time ? ` at ${c.event_time.slice(0, 5)}` : ''}
              </p>
              {c.notes && <p className="mt-0.5 text-sm text-muted2">{c.notes}</p>}
            </div>
            <span className={clsx('rounded-md px-2 py-0.5 text-xs', STATUS_PILL[c.status])}>
              {c.status.replace('_', ' ')}
            </span>
          </div>

          {c.status === 'scheduled' && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <button
                onClick={() => resolve(c.id, 'completed')}
                className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500"
              >
                <Check size={13} /> Call done
              </button>
              <button
                onClick={() => resolve(c.id, 'no_show')}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg"
              >
                Didn't answer
              </button>
              <button
                onClick={() => resolve(c.id, 'cancelled')}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg"
              >
                <XIcon size={13} /> Cancel
              </button>
            </div>
          )}
        </div>
      ))}

      {calls.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">No calls booked yet.</p>
      )}
    </div>
  )
}
