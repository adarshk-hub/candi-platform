// path: components/settings/panels/LeadDateRangePanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { CalendarRange, AlertTriangle } from 'lucide-react'

export default function LeadDateRangePanel({ clientId }: { clientId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clients/${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setFrom(data?.lead_range_from ? String(data.lead_range_from).slice(0, 10) : '')
        setTo(data?.lead_range_to ? String(data.lead_range_to).slice(0, 10) : '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  async function save() {
    if (from && to && from > to) {
      setError('The "from" date must be on or before the "to" date.')
      return
    }
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadRangeFrom: from || null, leadRangeTo: to || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Could not save the date range.')
        return
      }
      setStatus(
        from || to
          ? 'Saved. Only leads created inside this range are visible across the CRM now.'
          : 'Saved. The range is cleared — all leads are visible again.'
      )
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>

  const active = Boolean(from || to)

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-fg">
        <CalendarRange size={18} /> Lead Date Range
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted2">
        Limits the whole CRM to leads created inside this window, by lead creation date. Leads outside it are
        hidden from the leads list, Kanban, Follow Up, Calendar, dashboard numbers, broadcast audiences and
        exports. Every other date filter in the app is held inside this range too.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">From</label>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">To</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          />
        </div>
        {active && (
          <button
            onClick={() => {
              setFrom('')
              setTo('')
            }}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted2 hover:text-fg"
          >
            Clear range
          </button>
        )}
      </div>

      <p className="mb-4 flex max-w-2xl items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Leaving a side blank means no limit on that side — set only "from" to show everything since a date.
        Hidden leads are not deleted; clearing the range brings them all back.
      </p>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {status && <p className="mb-3 text-sm text-green-400">{status}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Date Range'}
      </button>
    </div>
  )
}
