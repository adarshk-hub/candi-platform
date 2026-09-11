// path: components/myday/TeamDayBoard.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarRange } from 'lucide-react'
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

interface NextActionCounts {
  id: string
  full_name: string
  overdue: number
  unplanned: number
  upcoming: number
}

interface NextActionRow {
  id: string
  lead_number: number
  full_name: string
  counsellor_name: string | null
  assigned_counsellor_id: string | null
  next_action: string | null
  next_action_at: string | null
  assigned_at: string | null
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
  const [actions, setActions] = useState<{
    overdue: NextActionRow[]
    unplanned: NextActionRow[]
    byCounsellor: NextActionCounts[]
  } | null>(null)

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

  // Deliberately not filtered by the date picker: overdue is overdue as of
  // right now, whichever day's work you happen to be reading.
  const loadActions = useCallback(() => {
    fetch('/api/next-actions?scope=all')
      .then((r) => (r.ok ? r.json() : null))
      .then(setActions)
      .catch(() => {})
  }, [])

  useEffect(loadActions, [loadActions])

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

      {actions && (actions.overdue.length > 0 || actions.unplanned.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {actions.overdue.length > 0 && (
            <div className="rounded-card border border-red-500/50 bg-red-500/10 p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-red-400">
                <AlertTriangle size={14} /> Not executed — {actions.overdue.length} across the team
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {actions.overdue
                  .filter((a) => !selected || a.assigned_counsellor_id === selected)
                  .map((a) => (
                    <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <button onClick={() => setActiveLead(a.id)} className="font-medium text-fg hover:underline">
                        #{a.lead_number} {a.full_name}
                      </button>
                      <span className="text-muted2">{a.next_action}</span>
                      <span className="text-red-400">
                        due{' '}
                        {new Date(a.next_action_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </span>
                      <span className="text-xs text-muted">{a.counsellor_name}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {actions.unplanned.length > 0 && (
            <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                <AlertTriangle size={14} /> No next action planned — {actions.unplanned.length}
              </p>
              <p className="mb-3 text-xs text-muted2">Assigned more than a day ago with nothing planned.</p>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {actions.unplanned
                  .filter((a) => !selected || a.assigned_counsellor_id === selected)
                  .map((a) => (
                    <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <button onClick={() => setActiveLead(a.id)} className="font-medium text-fg hover:underline">
                        #{a.lead_number} {a.full_name}
                      </button>
                      <span className="text-xs text-muted">{a.counsellor_name}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

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
              <th className="px-4 py-3 text-right">Next actions</th>
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
                <td className="px-4 py-3 text-right">
                  {(() => {
                    const n = actions?.byCounsellor.find((b) => b.id === c.id)
                    if (!n) return <span className="text-muted">—</span>
                    // "all planned" is only true when nothing is outstanding
                    // AND nothing is still waiting for a plan. Ignoring the
                    // second half is what made this column claim a lead was
                    // planned while the Next Actions page said otherwise.
                    if (n.overdue === 0 && n.unplanned === 0)
                      return <span className="text-green-400">all planned</span>
                    return (
                      <span className="flex items-center justify-end gap-2">
                        {n.overdue > 0 && <span className="text-red-400">{n.overdue} overdue</span>}
                        {n.unplanned > 0 && <span className="text-amber-400">{n.unplanned} unplanned</span>}
                      </span>
                    )
                  })()}
                </td>
              </tr>
            ))}
            {(data?.counsellors || []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
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
