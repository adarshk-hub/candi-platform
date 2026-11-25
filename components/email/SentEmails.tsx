// path: components/email/SentEmails.tsx
'use client'

import { useEffect, useState } from 'react'
import { Mail, Search } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import { formatDateTime } from '@/lib/format'

interface Row {
  id: string
  lead_id: string
  template_key: string | null
  subject: string
  body: string
  to_email: string
  created_at: string
  full_name: string
  child_name: string | null
  sent_by_name: string | null
}

// Local Octo only: successfully sent emails (stage emails, ones sent by hand,
// and the CRM's other automatic emails). Failed ones show on the lead.
export default function SentEmails({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  function load(search = q) {
    setLoading(true)
    fetch(`/api/email/sent?clientId=${clientId}&q=${encodeURIComponent(search)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setRows(d?.messages || [])
        setError(d?.error || '')
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Mail size={22} className="text-fg" />
        <h1 className="text-2xl font-bold text-fg">Sent Emails</h1>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      <div className="rounded-card border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="relative w-full max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(q)}
              placeholder="Search name, company, email or subject — press Enter"
              className="w-full rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <span className="ml-auto text-sm text-muted2">{rows.length} sent</span>
        </div>
        {error && <p className="p-4 text-sm text-red-400">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted">
                <th className="px-4 py-2">Sent</th>
                <th className="px-4 py-2">Lead</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted2">{formatDateTime(m.created_at)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setOpenLead(m.lead_id)} className="text-left font-medium text-blue-500 hover:underline">
                      {m.full_name}
                    </button>
                    {m.child_name && <div className="text-xs text-muted">{m.child_name}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted2">{m.to_email}</td>
                  <td className="max-w-md px-4 py-3">
                    <button onClick={() => setExpanded(expanded === m.id ? null : m.id)} className="text-left text-fg hover:underline">
                      {m.subject}
                    </button>
                    {expanded === m.id && <p className="mt-2 whitespace-pre-wrap text-xs text-muted2">{m.body}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted2">{m.sent_by_name || 'Automatic'}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No emails sent yet.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openLead && (
        <LeadSlideOver
          leadId={openLead}
          initialTab="email"
          onClose={() => {
            setOpenLead(null)
            load()
          }}
        />
      )}
    </div>
  )
}
