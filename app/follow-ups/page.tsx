// path: app/follow-ups/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useStages } from '@/lib/StagesContext'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import NotificationBell from '@/components/NotificationBell'

// The Next Actions worklist. Replaces the follow-up list that used to live
// here, and reads leads.next_action_* rather than the follow_ups table.
//
// The route path is unchanged so existing links and bookmarks keep working.
//
// The difference from the old page: a follow-up only existed if somebody
// created one, so a lead with nothing planned simply didn't appear. Here the
// leads with no plan are the first thing shown — a lead nobody has decided
// anything about is the most urgent row on the page, not an absent one.
type State = 'overdue' | 'unplanned' | 'upcoming' | 'done'

interface Row {
  id: string
  lead_number: number
  full_name: string
  whatsapp_number: string
  pipeline_stage: string
  client_id: string
  counsellor_name: string | null
  next_action: string | null
  next_action_at: string | null
  next_action_done_at: string | null
  assigned_at: string | null
  state: State
}

interface CounsellorCount {
  id: string
  full_name: string
  overdue: number
  unplanned: number
  dueToday: number
}

const STATE_LABEL: Record<State, string> = {
  upcoming: 'Upcoming action',
  overdue: 'Not executed',
  unplanned: 'No action planned',
  done: 'Done',
}

const STATE_STYLE: Record<State, string> = {
  upcoming: 'bg-blue-500/15 text-blue-300',
  overdue: 'bg-red-500/15 text-red-400',
  unplanned: 'bg-amber-500/15 text-amber-400',
  done: 'bg-green-500/15 text-green-400',
}

function shortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function NextActionsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [counsellors, setCounsellors] = useState<CounsellorCount[]>([])
  const [counsellorId, setCounsellorId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'open' | 'all' | 'done'>('open')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { stageLabel, stageColor } = useStages()

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ view: 'list', status })
    if (counsellorId) params.set('counsellorId', counsellorId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    fetch(`/api/next-actions?${params.toString()}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        setRows(body?.rows || [])
        setCounsellors(body?.counsellors || [])
        setNotice(body?.error || (ok ? '' : 'Could not load next actions.'))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [counsellorId, search, status, from, to])

  useEffect(load, [load])

  async function complete(row: Row) {
    setBusy(true)
    try {
      await fetch(`/api/leads/${row.id}/next-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {})
      load()
    } finally {
      setBusy(false)
    }
  }

  const counts = rows.reduce(
    (acc, r) => ({ ...acc, [r.state]: (acc as any)[r.state] + 1 }),
    { upcoming: 0, overdue: 0, unplanned: 0, done: 0 } as Record<State, number>
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <CalendarClock size={22} /> Next Actions
        </h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-72 rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <NotificationBell />
        </div>
      </div>

      {notice && (
        <p className="mb-4 rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">{notice}</p>
      )}

      {/* Three, in the order they matter: what's coming, what was missed,
          what was never planned at all. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Upcoming Action" value={counts.upcoming} />
        <Stat label="Not Executed" value={counts.overdue} tone="bad" />
        <Stat label="No Action Planned" value={counts.unplanned} tone="warn" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {counsellors.length > 0 && (
          <select
            value={counsellorId}
            onChange={(e) => setCounsellorId(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
          >
            <option value="">All counsellors</option>
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
                {c.overdue > 0 ? ` — ${c.overdue} overdue` : ''}
              </option>
            ))}
          </select>
        )}

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
        >
          <option value="open">Outstanding</option>
          <option value="done">Completed</option>
          <option value="all">Everything</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-muted2">
          Due from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-card2 px-2 py-1 text-fg"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted2">
          to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-card2 px-2 py-1 text-fg"
          />
        </label>
        {(from || to) && (
          <button
            onClick={() => {
              setFrom('')
              setTo('')
            }}
            className="text-sm text-blue-400 hover:underline"
          >
            Clear dates
          </button>
        )}
        {/* Leads with nothing planned have no due date to filter on, so they
            stay visible whatever range is chosen — hiding them behind a date
            filter would hide exactly the rows that need attention most. */}
        <span className="text-xs text-muted2">Unplanned leads always show, whatever the dates.</span>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Counsellor</th>
              <th className="px-4 py-3">Next action</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={clsx(
                  'border-b border-border last:border-0 hover:bg-card2',
                  r.state === 'overdue' && 'bg-red-500/[0.05]',
                  r.state === 'unplanned' && 'bg-amber-500/[0.05]'
                )}
              >
                <td className="px-4 py-3">
                  <button onClick={() => setActiveLead(r.id)} className="text-fg hover:underline">
                    {r.full_name}
                  </button>
                  <p className="font-mono text-xs text-green-400">#{r.lead_number}</p>
                </td>
                <td className="px-4 py-3 text-muted2">{r.whatsapp_number}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-900"
                    style={{ backgroundColor: stageColor(r.pipeline_stage, r.client_id) }}
                  >
                    {stageLabel(r.pipeline_stage, r.client_id)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted2">{r.counsellor_name || '—'}</td>
                <td className="px-4 py-3 text-fg">
                  {r.next_action || (
                    r.state === 'unplanned' ? (
                      <span className="flex items-center gap-1.5 text-amber-400">
                        <AlertTriangle size={13} /> Nothing planned since {shortDate(r.assigned_at)}
                      </span>
                    ) : (
                      <span className="text-muted2">
                        Assigned {shortDate(r.assigned_at)} — plan something
                      </span>
                    )
                  )}
                </td>
                <td className={clsx('px-4 py-3', r.state === 'overdue' ? 'text-red-400' : 'text-muted2')}>
                  {shortDate(r.next_action_at)}
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('rounded-md px-2 py-0.5 text-xs', STATE_STYLE[r.state])}>
                    {STATE_LABEL[r.state]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {r.next_action && !r.next_action_done_at && (
                    <button
                      onClick={() => complete(r)}
                      disabled={busy}
                      className="mr-3 inline-flex items-center gap-1 text-green-400 hover:underline disabled:opacity-50"
                    >
                      <Check size={14} /> Done
                    </button>
                  )}
                  {/* Opens straight onto the Next Action tab — this column
                      exists to change the plan, and landing on Info meant a
                      second click every time. */}
                  <button onClick={() => setActiveLead(r.id)} className="text-blue-400 hover:underline">
                    {r.next_action ? 'Change' : 'Plan'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted">
                  {loading ? 'Loading…' : 'Nothing outstanding — every assigned lead has a plan.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeLead && (
        <LeadSlideOver
          leadId={activeLead}
          initialTab="nextaction"
          onClose={() => {
            setActiveLead(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p
        className={clsx(
          'text-2xl font-bold',
          tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-fg'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
    </div>
  )
}
