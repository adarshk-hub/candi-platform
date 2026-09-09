// path: components/myday/MyDayBoard.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarCheck, CalendarClock, Plus, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import NotificationBell from '@/components/NotificationBell'

interface ActivityRow {
  id: string
  title: string
  description: string | null
  action_type: string | null
  created_at: string
  lead_id: string | null
  lead_name: string | null
  lead_number: number | null
}

interface NoteRow {
  id: string
  title: string
  details: string | null
  is_done: boolean
  created_at: string
  lead_id: string | null
  lead_name: string | null
  lead_number: number | null
}

interface NextActionRow {
  id: string
  lead_number: number
  full_name: string
  next_action: string | null
  next_action_at: string | null
  assigned_at: string | null
}

interface NextActions {
  overdue: NextActionRow[]
  unplanned: NextActionRow[]
  dueToday: NextActionRow[]
  error?: string
}

interface DayData {
  migrationNeeded?: boolean
  error?: string
  date: string
  userId: string
  activity: ActivityRow[]
  notes: NoteRow[]
  summary: {
    stageMoves: number
    calls: number
    emails: number
    notes: number
    notesDone: number
    leadsTouched: number
  }
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clock(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// Colour-codes the timeline by what kind of work it was, so a day of stage
// movement reads differently at a glance from a day of pure call attempts.
function toneFor(title: string): string {
  if (title === 'Stage Updated') return 'bg-blue-500'
  if (title === 'Call Logged') return 'bg-green-500'
  if (title.startsWith('Email')) return 'bg-purple-500'
  if (title.includes('Assigned')) return 'bg-amber-500'
  return 'bg-zinc-500'
}

export default function MyDayBoard() {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [actions, setActions] = useState<NextActions | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/my-day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [date])

  useEffect(load, [load])

  // Next actions are always "as of now", not as of the date being viewed —
  // what's overdue doesn't change because you scrolled back to look at last
  // Tuesday, and showing it as if it did would be misleading.
  const loadActions = useCallback(() => {
    fetch('/api/next-actions')
      .then((r) => (r.ok ? r.json() : null))
      .then(setActions)
      .catch(() => {})
  }, [])

  useEffect(loadActions, [loadActions])

  async function toggleNote(note: NoteRow) {
    await fetch(`/api/my-day/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDone: !note.is_done }),
    }).catch(() => {})
    load()
  }

  async function removeNote(note: NoteRow) {
    await fetch(`/api/my-day/${note.id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  const summary = data?.summary

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <CalendarCheck size={22} /> My Day
        </h1>
        <NotificationBell />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
        />
        {date !== today() && (
          <button onClick={() => setDate(today())} className="text-sm text-blue-400 hover:underline">
            Back to today
          </button>
        )}
      </div>

      {data?.error && (
        <p className="mb-4 rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">{data.error}</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Stage moves" value={summary?.stageMoves ?? 0} />
        <Stat label="Calls logged" value={summary?.calls ?? 0} />
        <Stat label="Emails sent" value={summary?.emails ?? 0} />
        <Stat label="Leads touched" value={summary?.leadsTouched ?? 0} />
        <Stat label="Tasks done" value={`${summary?.notesDone ?? 0}/${summary?.notes ?? 0}`} />
      </div>

      {/* Sits above the day itself: these are the things already behind, and
          burying them under a timeline of work already done gets the priority
          backwards. */}
      {actions && (actions.overdue.length > 0 || actions.unplanned.length > 0 || actions.dueToday.length > 0) && (
        <div className="mb-6 space-y-3">
          {actions.overdue.length > 0 && (
            <div className="rounded-card border border-red-500/50 bg-red-500/10 p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-red-400">
                <AlertTriangle size={14} /> Not executed — {actions.overdue.length} overdue
              </p>
              <div className="space-y-2">
                {actions.overdue.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <button onClick={() => setActiveLead(a.id)} className="font-medium text-fg hover:underline">
                      #{a.lead_number} {a.full_name}
                    </button>
                    <span className="text-muted2">{a.next_action}</span>
                    <span className="text-red-400">
                      due {new Date(a.next_action_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {actions.unplanned.length > 0 && (
            <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                <AlertTriangle size={14} /> No next action planned — {actions.unplanned.length} lead
                {actions.unplanned.length === 1 ? '' : 's'}
              </p>
              <p className="mb-3 text-xs text-muted2">
                Assigned to you more than a day ago with nothing planned.
              </p>
              <div className="space-y-2">
                {actions.unplanned.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <button onClick={() => setActiveLead(a.id)} className="font-medium text-fg hover:underline">
                      #{a.lead_number} {a.full_name}
                    </button>
                    <span className="text-muted2">
                      yours since{' '}
                      {a.assigned_at
                        ? new Date(a.assigned_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {actions.dueToday.length > 0 && (
            <div className="rounded-card border border-border bg-card p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
                <CalendarClock size={14} /> Due today — {actions.dueToday.length}
              </p>
              <div className="space-y-2">
                {actions.dueToday.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <button onClick={() => setActiveLead(a.id)} className="font-medium text-fg hover:underline">
                      #{a.lead_number} {a.full_name}
                    </button>
                    <span className="text-muted2">{a.next_action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
            Recorded automatically
          </p>
          <div className="space-y-3">
            {(data?.activity || []).map((a) => (
              <div key={a.id} className="flex gap-3">
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', toneFor(a.title))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{a.title}</p>
                    <span className="shrink-0 text-[11px] text-muted">{clock(a.created_at)}</span>
                  </div>
                  {a.description && <p className="text-xs text-muted2">{a.description}</p>}
                  {a.lead_id && (
                    <button
                      onClick={() => setActiveLead(a.lead_id!)}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      #{a.lead_number} {a.lead_name}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(data?.activity || []).length === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                {loading ? 'Loading…' : 'Nothing recorded for this day yet.'}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">My own notes</p>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg hover:border-blue-500"
            >
              <Plus size={14} /> Add
            </button>
          </div>

          {adding && (
            <NoteForm
              date={date}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false)
                load()
              }}
            />
          )}

          <div className="space-y-2">
            {(data?.notes || []).map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-md border border-border bg-card2 p-3">
                <input
                  type="checkbox"
                  checked={n.is_done}
                  onChange={() => toggleNote(n)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <div className="min-w-0 flex-1">
                  <p className={clsx('text-sm', n.is_done ? 'text-muted2 line-through' : 'text-fg')}>{n.title}</p>
                  {n.details && <p className="mt-0.5 text-xs text-muted2">{n.details}</p>}
                  {n.lead_id && (
                    <button
                      onClick={() => setActiveLead(n.lead_id!)}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      #{n.lead_number} {n.lead_name}
                    </button>
                  )}
                </div>
                <button onClick={() => removeNote(n)} className="text-muted2 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {(data?.notes || []).length === 0 && !adding && (
              <p className="py-8 text-center text-sm text-muted">
                Nothing written down for this day.
              </p>
            )}
          </div>
        </div>
      </div>

      {activeLead && (
        <LeadSlideOver
          leadId={activeLead}
          onClose={() => {
            setActiveLead(null)
            load()
            loadActions()
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p className="text-2xl font-bold text-fg">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
    </div>
  )
}

function NoteForm({ date, onCancel, onSaved }: { date: string; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/my-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, details, date }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not save.')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border bg-card2 p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing, or what happened?"
          className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
        />
        <button onClick={onCancel} className="text-muted2 hover:text-fg">
          <X size={16} />
        </button>
      </div>
      <textarea
        value={details}
        rows={2}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Any detail worth keeping (optional)"
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
