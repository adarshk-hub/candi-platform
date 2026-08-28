'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'

interface Entry {
  id: string
  user_name: string
  section: string
  description: string
  created_at: string
}

export default function SettingsActivityPanel({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clients/${clientId}/settings-activity?page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries || [])
        setTotal(data.total || 0)
        setPageSize(data.pageSize || 50)
      })
      .finally(() => setLoading(false))
  }, [clientId, page])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <History size={18} className="text-muted2" />
        <h2 className="text-lg font-semibold text-fg">Activity</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Every change made anywhere in Settings for this institute — who made it, what section, and when.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No settings changes recorded yet.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Section</th>
                <th className="px-4 py-2.5">What changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted2">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-fg">{e.user_name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted2">{e.section}</td>
                  <td className="px-4 py-2.5 text-fg">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
