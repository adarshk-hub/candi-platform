// path: components/reports/CounsellorPerformance.tsx
'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Trophy } from 'lucide-react'
import { clsx } from 'clsx'
import NotificationBell from '@/components/NotificationBell'

interface Row {
  id: string
  name: string
  assigned: number
  enrolled: number
  cold: number
  neverCalled: number
  calls: number
  stageMoves: number
  coldMoves: number
  conversionPct: number | null
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function CounsellorPerformance() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    fetch(`/api/reports/counsellor-performance?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setRows(Array.isArray(data?.rows) ? data.rows : [])
        setNotice(data?.error || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [from, to])

  // The scale for the bar column. Taken from the top performer rather than a
  // fixed number so the comparison stays readable whether a team moves 20
  // leads a month or 2,000.
  const maxMoves = rows.reduce((m, r) => Math.max(m, r.stageMoves), 0)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <BarChart3 size={22} /> Counsellor performance
        </h1>
        <NotificationBell />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted2">
          From:
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-card2 px-2 py-1 text-fg"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted2">
          To:
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-card2 px-2 py-1 text-fg"
          />
        </label>
        <p className="text-xs text-muted2">
          Stage moves and calls are counted in this window. Assigned, enrolled and cold reflect where each
          counsellor's leads stand right now.
        </p>
      </div>

      {notice && <p className="mb-4 rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">{notice}</p>}

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Counsellor</th>
              <th className="px-4 py-3">Stage moves</th>
              <th className="px-4 py-3 text-right">Calls logged</th>
              <th className="px-4 py-3 text-right">Assigned</th>
              <th className="px-4 py-3 text-right">Enrolled</th>
              <th className="px-4 py-3 text-right">Cold</th>
              <th className="px-4 py-3 text-right">Never called</th>
              <th className="px-4 py-3 text-right">Lead → Enrolled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-card2">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-fg">
                    {i === 0 && r.stageMoves > 0 && <Trophy size={14} className="text-amber-400" />}
                    {r.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right text-fg">{r.stageMoves}</span>
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-card2">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${maxMoves > 0 ? (r.stageMoves / maxMoves) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted2">{r.calls}</td>
                <td className="px-4 py-3 text-right text-fg">{r.assigned}</td>
                <td className="px-4 py-3 text-right text-green-400">{r.enrolled}</td>
                <td className="px-4 py-3 text-right text-blue-400">{r.cold}</td>
                <td className={clsx('px-4 py-3 text-right', r.neverCalled > 0 ? 'text-amber-400' : 'text-muted2')}>
                  {r.neverCalled}
                </td>
                <td className="px-4 py-3 text-right text-fg">
                  {r.conversionPct !== null ? `${r.conversionPct.toFixed(0)}%` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {loading ? 'Loading…' : 'No counsellors to report on yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
