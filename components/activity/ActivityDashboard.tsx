// path: components/activity/ActivityDashboard.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, PhoneCall, Search, Snowflake, UserPlus, Users } from 'lucide-react'
import { clsx } from 'clsx'
import { useStages } from '@/lib/StagesContext'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import ColdReasonModal, { ColdReasonValue } from '@/components/lead/ColdReasonModal'
import NotificationBell from '@/components/NotificationBell'

type Bucket =
  | 'not_called'
  | 'new_today_not_called'
  | 'not_called_today'
  | 'unassigned'
  | 'cold'
  | 'cold_no_reason'
  | 'all'

interface LeadRow {
  id: string
  lead_number: number
  client_id: string
  full_name: string
  whatsapp_number: string
  grade: string | null
  source: string
  pipeline_stage: string
  lead_score: number
  created_at: string
  assigned_counsellor_id: string | null
  counsellor_name: string | null
  first_called_at: string | null
  last_called_at: string | null
  call_attempt_count: number
  cold_reason: string | null
  cold_reason_note: string | null
}

interface Overview {
  migrationNeeded?: boolean
  error?: string
  summary: {
    total: number
    newToday: number
    notCalled: number
    newTodayNotCalled: number
    notCalledToday: number
    unassigned: number
    cold: number
    coldNoReason: number
  }
  coldReasons: { reason: string; count: number }[]
  counsellorLoad: { id: string | null; full_name: string; assigned: number; notCalled: number; notCalledToday: number }[]
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
  bucket: Bucket
  canAssign: boolean
}

interface Counsellor {
  id: string
  full_name: string
}

const BUCKET_LABEL: Record<Bucket, string> = {
  not_called: 'Never called',
  new_today_not_called: "Today's new leads, not called",
  not_called_today: 'Not called today',
  unassigned: 'Unassigned',
  cold: 'Cold leads',
  cold_no_reason: 'Cold without a reason',
  all: 'All leads',
}

const EMPTY_SUMMARY: Overview['summary'] = {
  total: 0,
  newToday: 0,
  notCalled: 0,
  newTodayNotCalled: 0,
  notCalledToday: 0,
  unassigned: 0,
  cold: 0,
  coldNoReason: 0,
}

function shortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function StatCard({
  label,
  value,
  hint,
  active,
  tone = 'default',
  onClick,
}: {
  label: string
  value: number
  hint?: string
  active: boolean
  tone?: 'default' | 'warn' | 'cold'
  onClick: () => void
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
          'text-3xl font-bold',
          tone === 'warn' ? 'text-amber-400' : tone === 'cold' ? 'text-blue-400' : 'text-fg'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted2">{hint}</p>}
    </button>
  )
}

export default function ActivityDashboard({ canAssign: canAssignHint }: { canAssign: boolean }) {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket] = useState<Bucket>('not_called')
  const [counsellorId, setCounsellorId] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState('')
  const [splitEvenly, setSplitEvenly] = useState(false)
  const [counsellors, setCounsellors] = useState<Counsellor[]>([])
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<LeadRow | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const { stageLabel, stageColor } = useStages()

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ bucket, page: String(page) })
    if (counsellorId) params.set('counsellorId', counsellorId)
    if (search) params.set('search', search)
    fetch(`/api/activity?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [bucket, counsellorId, search, page])

  useEffect(load, [load])

  useEffect(() => {
    fetch('/api/counsellors')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setCounsellors(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }, [])

  // Changing what's on screen has to drop the selection with it — otherwise
  // "Assign 12 leads" could quietly act on rows the person can no longer see.
  useEffect(() => {
    setSelected(new Set())
  }, [bucket, counsellorId, search, page])

  const summary = data?.summary || EMPTY_SUMMARY
  const canAssign = data?.canAssign ?? canAssignHint
  const leads = data?.leads || []

  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function pick(next: Bucket) {
    setBucket(next)
    setPage(1)
  }

  async function assign() {
    if (selected.size === 0) return
    if (!splitEvenly && !assignTo) {
      setMessage('Pick a counsellor first.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/activity/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: Array.from(selected),
          counsellorId: splitEvenly ? null : assignTo,
          roundRobinIds: splitEvenly ? counsellors.map((c) => c.id) : [],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(body.error || 'Could not assign those leads.')
        return
      }
      setMessage(`Assigned ${body.updated} lead${body.updated === 1 ? '' : 's'}.`)
      setSelected(new Set())
      load()
    } finally {
      setBusy(false)
    }
  }

  async function logCall(lead: LeadRow) {
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setMessage(body.error || 'Could not log that call.')
        return
      }
      load()
    } finally {
      setBusy(false)
    }
  }

  async function saveReason(lead: LeadRow, value: ColdReasonValue) {
    setBusy(true)
    try {
      await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cold_reason: value.reason, cold_reason_note: value.note }),
      })
      load()
    } finally {
      setBusy(false)
    }
  }

  const coldTotal = useMemo(
    () => (data?.coldReasons || []).reduce((sum, r) => sum + r.count, 0),
    [data?.coldReasons]
  )

  if (data?.migrationNeeded) {
    return (
      <div className="rounded-card border border-amber-500/40 bg-card p-6">
        <h1 className="mb-2 text-xl font-bold text-fg">Activity</h1>
        <p className="text-sm text-muted2">{data.error}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Activity size={22} /> Activity
        </h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search name or number…"
              className="w-64 rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <NotificationBell />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard
          label="Not called yet"
          value={summary.notCalled}
          hint="No call ever logged"
          tone="warn"
          active={bucket === 'not_called'}
          onClick={() => pick('not_called')}
        />
        <StatCard
          label="New today, not called"
          value={summary.newTodayNotCalled}
          hint={`${summary.newToday} came in today`}
          tone="warn"
          active={bucket === 'new_today_not_called'}
          onClick={() => pick('new_today_not_called')}
        />
        <StatCard
          label="Not called today"
          value={summary.notCalledToday}
          hint="No call logged since midnight"
          active={bucket === 'not_called_today'}
          onClick={() => pick('not_called_today')}
        />
        <StatCard
          label="Unassigned"
          value={summary.unassigned}
          hint="No counsellor yet"
          tone="warn"
          active={bucket === 'unassigned'}
          onClick={() => pick('unassigned')}
        />
        <StatCard
          label="Cold"
          value={summary.cold}
          tone="cold"
          active={bucket === 'cold'}
          onClick={() => pick('cold')}
        />
        <StatCard
          label="Cold, no reason"
          value={summary.coldNoReason}
          hint="Needs a reason recorded"
          tone="cold"
          active={bucket === 'cold_no_reason'}
          onClick={() => pick('cold_no_reason')}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-5">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
            <Snowflake size={14} /> Why leads go cold
          </p>
          {(data?.coldReasons || []).length === 0 ? (
            <p className="text-sm text-muted">No cold leads in this range.</p>
          ) : (
            <ul className="space-y-2">
              {data!.coldReasons.map((r) => (
                <li key={r.reason} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className={clsx(r.reason === 'No reason recorded' ? 'text-amber-400' : 'text-fg')}>
                      {r.reason}
                    </span>
                    <span className="text-muted2">
                      {r.count} · {coldTotal > 0 ? Math.round((r.count / coldTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card2">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${coldTotal > 0 ? (r.count / coldTotal) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-card border border-border bg-card p-5">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
            <Users size={14} /> Counsellor workload
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2">Counsellor</th>
                <th className="pb-2 text-right">Leads</th>
                <th className="pb-2 text-right">Never called</th>
                <th className="pb-2 text-right">Not called today</th>
              </tr>
            </thead>
            <tbody>
              {(data?.counsellorLoad || []).map((c) => (
                <tr key={c.id || 'unassigned'} className="border-t border-border">
                  <td className="py-2">
                    <button
                      onClick={() => {
                        setCounsellorId(c.id || 'unassigned')
                        setPage(1)
                      }}
                      className={clsx('hover:underline', c.id ? 'text-fg' : 'text-amber-400')}
                    >
                      {c.full_name}
                    </button>
                  </td>
                  <td className="py-2 text-right text-fg">{c.assigned}</td>
                  <td className="py-2 text-right text-amber-400">{c.notCalled}</td>
                  <td className="py-2 text-right text-muted2">{c.notCalledToday}</td>
                </tr>
              ))}
              {(data?.counsellorLoad || []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted">
                    No leads in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-fg">
          {BUCKET_LABEL[bucket]} — {data?.total ?? 0}
        </p>
        <select
          value={counsellorId}
          onChange={(e) => {
            setCounsellorId(e.target.value)
            setPage(1)
          }}
          className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
        >
          <option value="">All counsellors</option>
          <option value="unassigned">Unassigned only</option>
          {counsellors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        {bucket !== 'all' && (
          <button onClick={() => pick('all')} className="text-sm text-blue-400 hover:underline">
            Show all leads
          </button>
        )}
      </div>

      {canAssign && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-3">
          <span className="flex items-center gap-2 text-sm text-muted2">
            <UserPlus size={16} />
            {selected.size} selected
          </span>
          <select
            value={assignTo}
            disabled={splitEvenly}
            onChange={(e) => setAssignTo(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value="">Assign to…</option>
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted2">
            <input
              type="checkbox"
              checked={splitEvenly}
              onChange={(e) => setSplitEvenly(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Split evenly across all counsellors
          </label>
          <button
            onClick={assign}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Assign
          </button>
          {message && <span className="text-sm text-muted2">{message}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              {canAssign && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border"
                  />
                </th>
              )}
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Counsellor</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Calls</th>
              <th className="px-4 py-3">Cold reason</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0 hover:bg-card2">
                {canAssign && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleOne(l.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <p className="text-fg">{l.full_name}</p>
                  <p className="font-mono text-xs text-green-400">#{l.lead_number}</p>
                </td>
                <td className="px-4 py-3 text-muted2">{l.whatsapp_number}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-900"
                    style={{ backgroundColor: stageColor(l.pipeline_stage, l.client_id) }}
                  >
                    {stageLabel(l.pipeline_stage, l.client_id)}
                  </span>
                </td>
                <td className={clsx('px-4 py-3', l.counsellor_name ? 'text-muted2' : 'text-amber-400')}>
                  {l.counsellor_name || 'Unassigned'}
                </td>
                <td className="px-4 py-3 text-muted2">{shortDate(l.created_at)}</td>
                <td className="px-4 py-3">
                  {l.first_called_at ? (
                    <span className="text-muted2">
                      {l.call_attempt_count || 1} · last {shortDate(l.last_called_at)}
                    </span>
                  ) : (
                    <span className="text-amber-400">Never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted2">
                  {l.cold_reason ? (
                    <span title={l.cold_reason_note || undefined}>{l.cold_reason}</span>
                  ) : (
                    <button onClick={() => setReasonFor(l)} className="text-blue-400 hover:underline">
                      Add reason
                    </button>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button
                    onClick={() => logCall(l)}
                    disabled={busy}
                    title="Record a call attempt against this lead"
                    className="mr-3 inline-flex items-center gap-1 text-blue-400 hover:underline disabled:opacity-50"
                  >
                    <PhoneCall size={14} /> Log call
                  </button>
                  <button onClick={() => setActiveLead(l.id)} className="text-blue-400 hover:underline">
                    View
                  </button>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={canAssign ? 9 : 8} className="px-4 py-10 text-center text-muted">
                  {loading ? 'Loading…' : `Nothing in “${BUCKET_LABEL[bucket]}”.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted2">
          <span>
            Page {data.page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-md border border-border px-3 py-1.5 hover:text-fg disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= Math.ceil(data.total / data.pageSize)}
              className="rounded-md border border-border px-3 py-1.5 hover:text-fg disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {reasonFor && (
        <ColdReasonModal
          clientId={reasonFor.client_id}
          stageLabel={stageLabel(reasonFor.pipeline_stage, reasonFor.client_id)}
          onCancel={() => setReasonFor(null)}
          onConfirm={(value) => {
            const lead = reasonFor
            setReasonFor(null)
            saveReason(lead, value)
          }}
        />
      )}

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
