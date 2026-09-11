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
  const [counts, setCounts] = useState({
    upcoming: 0,
    overdue: 0,
    unplanned: 0,
    neverCalled: 0,
    notCalledToday: 0,
    unassigned: 0,
    coldNoReason: 0,
  })
  // The lead-condition filters absorbed from the old Activity page.
  const [bucket, setBucket] = useState<'' | 'never_called' | 'not_called_today' | 'unassigned' | 'cold_no_reason'>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [canAssign, setCanAssign] = useState(false)
  const [counsellors, setCounsellors] = useState<CounsellorCount[]>([])
  const [counsellorId, setCounsellorId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'open' | 'all' | 'done'>('open')
  // Which of the three figures is being looked at. 'planned' is the default
  // view — upcoming and overdue — because those are rows of work. Leads with
  // nothing planned are a gap rather than a task, so they're counted but not
  // listed until you ask for them.
  const [view, setView] = useState<'planned' | 'upcoming' | 'overdue' | 'unplanned'>('planned')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { stageLabel, stageColor } = useStages()

  const load = useCallback(() => {
    setLoading(true)
    const statesFor: Record<string, string> = {
      planned: 'upcoming,overdue',
      upcoming: 'upcoming',
      overdue: 'overdue',
      unplanned: 'unplanned',
    }
    const params = new URLSearchParams({ view: 'list', status, states: statesFor[view] })
    if (bucket) params.set('bucket', bucket)
    if (counsellorId) params.set('counsellorId', counsellorId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    fetch(`/api/next-actions?${params.toString()}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        setRows(body?.rows || [])
        setCounts(
          body?.counts || {
            upcoming: 0,
            overdue: 0,
            unplanned: 0,
            neverCalled: 0,
            notCalledToday: 0,
            unassigned: 0,
            coldNoReason: 0,
          }
        )
        setCounsellors(body?.counsellors || [])
        setNotice(body?.error || (ok ? '' : 'Could not load next actions.'))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [counsellorId, search, status, from, to, view, bucket])

  useEffect(load, [load])

  // Changing what's on screen drops the selection with it — otherwise
  // "assign 12 leads" could act on rows nobody can see any more.
  useEffect(() => {
    setSelected(new Set())
  }, [bucket, view, counsellorId, search, status])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanAssign(!!me && ['agency_admin', 'agency_staff', 'client_admin'].includes(me.role)))
      .catch(() => {})
  }, [])

  async function assignSelected() {
    if (selected.size === 0 || !assignTo) return
    await fetch('/api/activity/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: Array.from(selected), counsellorId: assignTo }),
    }).catch(() => {})
    setSelected(new Set())
    load()
  }

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
          what was never planned at all. Each one filters the table — which
          is how leads with no plan are reached, since they aren't listed by
          default. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Upcoming Action"
          value={counts.upcoming}
          active={view === 'upcoming'}
          onClick={() => setView(view === 'upcoming' ? 'planned' : 'upcoming')}
        />
        <Stat
          label="Not Executed"
          value={counts.overdue}
          tone="bad"
          active={view === 'overdue'}
          onClick={() => setView(view === 'overdue' ? 'planned' : 'overdue')}
        />
        <Stat
          label="No Action Planned"
          value={counts.unplanned}
          tone="warn"
          active={view === 'unplanned'}
          onClick={() => setView(view === 'unplanned' ? 'planned' : 'unplanned')}
        />
      </div>

      {/* Lead condition, as opposed to plan state. A lead can be overdue
          *and* never called, so these sit on their own row rather than
          competing with the three figures above. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          { key: '' as const, label: 'All leads', n: null },
          { key: 'never_called' as const, label: 'Never called', n: counts.neverCalled },
          { key: 'not_called_today' as const, label: 'Not called today', n: counts.notCalledToday },
          { key: 'unassigned' as const, label: 'Unassigned', n: counts.unassigned },
          { key: 'cold_no_reason' as const, label: 'Cold, no reason', n: counts.coldNoReason },
        ]).map((b) => (
          <button
            key={b.key || 'all'}
            onClick={() => setBucket(b.key)}
            className={clsx(
              'rounded-full border px-3 py-1 text-xs',
              bucket === b.key
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-border text-muted2 hover:text-fg'
            )}
          >
            {b.label}
            {b.n !== null && <span className="ml-1.5 text-muted">{b.n}</span>}
          </button>
        ))}
      </div>

      {canAssign && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-3">
          <span className="text-sm text-muted2">{selected.size} selected</span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
          >
            <option value="">Assign to…</option>
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          <button
            onClick={assignSelected}
            disabled={!assignTo}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Assign
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-muted2 hover:text-fg">
            Clear
          </button>
        </div>
      )}

      {view !== 'planned' && (
        <p className="mb-3 flex items-center gap-3 text-sm text-muted2">
          Showing {view === 'unplanned' ? 'leads with no action planned' : view === 'overdue' ? 'missed actions' : 'upcoming actions'} only
          <button onClick={() => setView('planned')} className="text-blue-400 hover:underline">
            Show all planned
          </button>
        </p>
      )}

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

      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              {canAssign && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                    className="h-4 w-4 rounded border-border"
                  />
                </th>
              )}
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
                {canAssign && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(r.id)) next.delete(r.id)
                          else next.add(r.id)
                          return next
                        })
                      }
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                )}
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
                <td colSpan={canAssign ? 9 : 8} className="px-4 py-12 text-center text-muted">
                  {loading
                    ? 'Loading…'
                    : view === 'unplanned'
                    ? 'Every assigned lead has a plan.'
                    : 'Nothing outstanding.'}
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

function Stat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: 'warn' | 'bad'
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-card border p-4 text-left transition-colors',
        active ? 'border-blue-500 bg-card2' : 'border-border bg-card hover:bg-card2'
      )}
    >
      <p
        className={clsx(
          'text-2xl font-bold',
          tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-fg'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
    </button>
  )
}
