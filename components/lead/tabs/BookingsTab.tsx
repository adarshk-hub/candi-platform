// path: components/lead/tabs/BookingsTab.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, MapPin, Phone, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { canResolveBooking } from '@/lib/bookingWindow'

interface Booking {
  id: string
  event_date: string
  event_time: string | null
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled'
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  no_show: 'No show',
  cancelled: 'Cancelled',
}

const STATUS_PILL: Record<string, string> = {
  scheduled: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-green-500/20 text-green-300',
  no_show: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-zinc-600/40 text-zinc-300',
}

// Calls and visits are the same thing with a different label — a date, a
// time, and an outcome — so they share one component. Only the endpoint,
// the wording and the accent colour differ, which is what keeps the two
// from drifting into subtly different behaviour.
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

      {sub === 'call' ? (
        <BookingPanel
          leadId={leadId}
          endpoint="calls"
          noun="call"
          accent="green"
          doneLabel="Call done"
          missedLabel="Didn't answer"
        />
      ) : (
        <BookingPanel
          leadId={leadId}
          endpoint="visits"
          noun="visit"
          accent="blue"
          doneLabel="Visit done"
          missedLabel="Didn't show"
        />
      )}
    </div>
  )
}

function BookingPanel({
  leadId,
  endpoint,
  noun,
  accent,
  doneLabel,
  missedLabel,
}: {
  leadId: string
  endpoint: 'calls' | 'visits'
  noun: string
  accent: 'green' | 'blue'
  doneLabel: string
  missedLabel: string
}) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // id of the booking being moved, plus its new date/time
  const [rescheduling, setRescheduling] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')

  const load = useCallback(() => {
    fetch(`/api/leads/${leadId}/${endpoint}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setBookings(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }, [leadId, endpoint])

  useEffect(load, [load])

  const button =
    accent === 'green'
      ? 'bg-green-600 hover:bg-green-500'
      : 'bg-blue-600 hover:bg-blue-500'
  const focus = accent === 'green' ? 'focus:border-green-500' : 'focus:border-blue-500'

  async function book() {
    // Both required, and checked here as well as on the server: a booking
    // with no time never becomes resolvable and can't be reminded about.
    if (!date || !time) {
      setError(`Pick both a date and a time for the ${noun}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventDate: date, eventTime: time }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || `Could not book that ${noun}.`)
        return
      }
      setDate('')
      setTime('')
      load()
    } finally {
      setSaving(false)
    }
  }

  async function resolve(id: string, status: 'completed' | 'no_show' | 'cancelled') {
    await fetch(`/api/leads/${leadId}/${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id, status }),
    }).catch(() => {})
    load()
  }

  async function reschedule(id: string) {
    if (!newDate || !newTime) {
      setError('Pick both a date and a time.')
      return
    }
    setError('')
    await fetch(`/api/leads/${leadId}/${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id, eventDate: newDate, eventTime: newTime }),
    }).catch(() => {})
    setRescheduling(null)
    setNewDate('')
    setNewTime('')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card2 p-5">
        <p className="mb-4 font-semibold text-fg">Schedule a {noun}:</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={clsx('rounded-md border border-border bg-card px-3 py-2 text-sm text-fg outline-none', focus)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Time slot</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={clsx('rounded-md border border-border bg-card px-3 py-2 text-sm text-fg outline-none', focus)}
            />
          </div>
          <button
            onClick={book}
            disabled={saving || !date || !time}
            className={clsx(
              'rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50',
              button
            )}
          >
            {saving ? 'Booking…' : `Book ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {bookings.map((b) => {
        const resolvable = canResolveBooking(b.event_date, b.event_time)
        return (
          <div key={b.id} className="rounded-card border border-border bg-card2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-fg">
                {noun.charAt(0).toUpperCase() + noun.slice(1)} on{' '}
                {new Date(b.event_date).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
                {b.event_time ? ` at ${b.event_time.slice(0, 5)}` : ''}
              </p>
              <span className={clsx('rounded-md px-2 py-0.5 text-xs', STATUS_PILL[b.status])}>
                {STATUS_LABEL[b.status] || b.status}
              </span>
            </div>

            {b.status === 'scheduled' && (
              <>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  {/* Outcomes only from the scheduled moment onwards.
                      Marking a call done on Monday for a Friday slot is
                      either a mistake or a lie, and either way it corrupts
                      the call figures on Activity and Team Day. */}
                  <button
                    onClick={() => resolve(b.id, 'completed')}
                    disabled={!resolvable}
                    title={resolvable ? undefined : `Available from the scheduled time`}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40',
                      button
                    )}
                  >
                    <Check size={13} /> {doneLabel}
                  </button>
                  <button
                    onClick={() => resolve(b.id, 'no_show')}
                    disabled={!resolvable}
                    title={resolvable ? undefined : `Available from the scheduled time`}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg disabled:opacity-40"
                  >
                    {missedLabel}
                  </button>
                  <button
                    onClick={() => {
                      setRescheduling(rescheduling === b.id ? null : b.id)
                      setNewDate(b.event_date.slice(0, 10))
                      setNewTime(b.event_time?.slice(0, 5) || '')
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg"
                  >
                    <CalendarClock size={13} /> Reschedule
                  </button>
                  {/* Cancelling stays available before the slot — that's the
                      whole point of cancelling. */}
                  <button
                    onClick={() => resolve(b.id, 'cancelled')}
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted2 hover:text-fg"
                  >
                    <XIcon size={13} /> Cancel
                  </button>
                </div>

                {rescheduling === b.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className={clsx(
                        'rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg outline-none',
                        focus
                      )}
                    />
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className={clsx(
                        'rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg outline-none',
                        focus
                      )}
                    />
                    <button
                      onClick={() => reschedule(b.id)}
                      disabled={!newDate || !newTime}
                      className={clsx(
                        'rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50',
                        button
                      )}
                    >
                      Move {noun}
                    </button>
                    <button
                      onClick={() => setRescheduling(null)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted2 hover:text-fg"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {!resolvable && (
                  <p className="mt-2 text-xs text-muted">
                    Outcome can be recorded from the scheduled time. If the day passes without one, this
                    booking is cancelled automatically.
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}

      {bookings.length === 0 && <p className="py-8 text-center text-sm text-muted">No {noun}s booked yet.</p>}
    </div>
  )
}
