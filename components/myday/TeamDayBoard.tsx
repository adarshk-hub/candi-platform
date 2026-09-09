// path: components/myday/TeamDayBoard.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { clsx } from 'clsx'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import NotificationBell from '@/components/NotificationBell'

interface CounsellorRow {
  id: string
  name: string
  stageMoves: number
  calls: number
  emails: number
  leadsTouched: number
  notes: number
  notesDone: number
  actions: number
}

interface ActivityRow {
  id: string
  actor_id: string
  title: string
  description: string | null
  created_at: string
  lead_id: string | null
  lead_name: string | null
  lead_number: number | null
}

interface NoteRow {
  id: string
  user_id: string
  title: string
  details: string | null
  is_done: boolean
  created_at: string
  lead_id: string | null
  lead_name: string | null
  lead_number: number | null
}

interface TeamDay {
  migrationNeeded?: boolean
  error?: string
  date: string
  counsellors: CounsellorRow[]
  activity: ActivityRow[]
  notes: NoteRow[]
  totals: {
    stageMoves: number
    calls: number
    emails: number
    notes: number
    notesDone: number
    leadsTouched: number
    active: number
  }
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clockTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

function toneFor(title: string): string {
  if (title === 'Stage Updated') return 'bg-blue-500'
  if (title === 'Call Logged') return 'bg-green-500'
  if (title.startsWith('Email')) return 'bg-purple-500'
  if (title.includes('Assigned')) return 'bg-amber-500'
  return 'bg-zinc-500'
}

export default function TeamDayBoard() {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<TeamDay | null>(null)
  const [loading, setLoading] = useState(true)
  // null means "everyone" — the default, because the first question is
  // usually how the day went overall, not how one person's did.
  const [selected, setSelected] = useState<string | null>(null)
  const [activeLead, setActiveLead] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/team-day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [date])

  useEffect(load, [load])

  // Changing the day can leave a filter pointing at somebody who did nothing
  // that day, which looks like a broken page rather than an empty one.
  useEffect(() => {
    setSelected(null)
  }, [date])

  const totals = data?.totals
  const activity = (data?.activity || []).filter((a) => !selected || a.actor_id === selected)
  const notes = (data?.notes || []).filter((n) => !selected || n.user_id === selected)
  const nameById = new Map((data?.counsellors || []).map((c) => [c.id, c.name]))
  const selectedName = selected ? nameById.get(selected) : null

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <CalendarRange size={22} /> Team day
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
        <p className="text-xs text-muted2">
          Everything each counsellor did on this day — recorded automatically, plus the notes they wrote
          themselves. Read-only: notes belong to whoever made them.
        </p>
      </div>

      {data?.error && (
        <p className="mb-4 rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">{data.error}</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Counsellors active" value={`${totals?.active ?? 0}/${data?.counsellors.length ?? 0}`} />
        <Stat label="Stage moves" value={totals?.stageMoves ?? 0} />
        <Stat label="Calls logged" value={totals?.calls ?? 0} />
        <Stat label="Emails sent" value={totals?.emails ?? 0} />
        <Stat label="Tasks done" value={`${totals?.notesDone ?? 0}/${totals?.notes ?? 0}`} />
      </div>

      <div className="mb-6 overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Counsellor</th>
              <th className="px-4 py-3 text-right">Stage moves</th>
              <th className="px-4 py-3 text-right">Calls</th>
              <th className="px-4 py-3 text-right">Emails</th>
              <th className="px-4 py-3 text-right">Leads touched</th>
              <th className="px-4 py-3 text-right">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(data?.counsellors || []).map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelected(selected === c.id ? null : c.id)}
                className={clsx(
                  'cursor-pointer border-b border-border last:border-0 hover:bg-card2',
                  selected === c.id && 'bg-card2'
                )}
              >
                <td className="px-4 py-3 text-fg">
                  {c.name}
                  {c.actions === 0 && c.notes === 0 && (
                    <span className="ml-2 text-xs text-muted">nothing logged</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-fg">{c.stageMoves}</td>
                <td className="px-4 py-3 text-right text-muted2">{c.calls}</td>
                <td className="px-4 py-3 text-right text-muted2">{c.emails}</td>
                <td className="px-4 py-3 text-right text-muted2">{c.leadsTouched}</td>
                <td className="px-4 py-3 text-right text-muted2">
                  {c.notesDone}/{c.notes}
                </td>
              </tr>
            ))}
            {(data?.counsellors || []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {loading ? 'Loading…' : 'No counsellors to show.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mb-3 flex items-center gap-3">
          <p className="text-sm font-semibold text-fg">Showing {selectedName} only</p>
          <button onClick={() => setSelected(null)} className="text-sm text-blue-400 hover:underline">
            Show everyone
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">Recorded automatically</p>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {activity.map((a) => (
              <div key={a.id} className="flex gap-3">
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', toneFor(a.title))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-fg">
                      {a.title}
                      {!selected && (
                        <span className="ml-2 text-xs font-normal text-muted2">
                          {nameById.get(a.actor_id) || 'Unknown'}
                        </span>
                      )}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted">{clockTime(a.created_at)}</span>
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
            {activity.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                {loading ? 'Loading…' : 'Nothing recorded for this day.'}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">Counsellors&rsquo; own notes</p>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {notes.map((n) => (
              <div key={n.id} className="rounded-md border border-border bg-card2 p-3">
                <div className="flex items-start gap-2">
                  <span
                    className={clsx(
                      'mt-1 h-2 w-2 shrink-0 rounded-full',
                      n.is_done ? 'bg-green-500' : 'bg-amber-500'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={clsx('text-sm', n.is_done ? 'text-muted2 line-through' : 'text-fg')}>{n.title}</p>
                    {n.details && <p className="mt-0.5 text-xs text-muted2">{n.details}</p>}
                    <p className="mt-1 text-[11px] text-muted">
                      {nameById.get(n.user_id) || 'Unknown'} · {clockTime(n.created_at)}
                    </p>
                    {n.lead_id && (
                      <button
                        onClick={() => setActiveLead(n.lead_id!)}
                        className="text-xs text-blue-400 hover:underline"
                      >
                        #{n.lead_number} {n.lead_name}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">Nothing written down for this day.</p>
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
