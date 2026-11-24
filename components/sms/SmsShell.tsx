// path: components/sms/SmsShell.tsx
'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MessageSquare, Search } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import { formatDateTime } from '@/lib/format'
import SmsBroadcastComposer from './SmsBroadcastComposer'

interface SentSms {
  id: string
  lead_id: string
  template_name: string
  body: string
  mobile: string
  trigger: string
  broadcast_name: string | null
  created_at: string
  full_name: string
  child_name: string | null
  lead_number: number
  sent_by_name: string | null
}

const TRIGGER_LABEL: Record<string, string> = {
  auto: 'Automatic',
  manual: 'Stage prompt',
  direct: 'Sent by hand',
  broadcast: 'Broadcast',
}

// Local Octo only. Inbox lists SMS that MSG91 accepted (failed ones are only
// in each lead's Activity). Broadcast sends one template to many leads.
export default function SmsShell({ clientId, canBroadcast }: { clientId: string; canBroadcast: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = canBroadcast && searchParams.get('tab') === 'broadcast' ? 'broadcast' : 'inbox'

  const [messages, setMessages] = useState<SentSms[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openLead, setOpenLead] = useState<string | null>(null)

  function load(search = q) {
    setLoading(true)
    fetch(`/api/sms/messages?clientId=${clientId}&q=${encodeURIComponent(search)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setMessages(d?.messages || [])
        setError(d?.error || '')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (tab === 'inbox') load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId])

  function setTab(next: 'inbox' | 'broadcast') {
    router.replace(next === 'inbox' ? pathname : `${pathname}?tab=broadcast`, { scroll: false })
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <MessageSquare size={22} className="text-fg" />
        <h1 className="text-2xl font-bold text-fg">SMS</h1>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {(canBroadcast ? (['inbox', 'broadcast'] as const) : (['inbox'] as const)).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? 'border-blue-500 text-fg' : 'border-transparent text-muted2 hover:text-fg'
            }`}
          >
            {t === 'inbox' ? 'Sent SMS' : 'Send Broadcast'}
          </button>
        ))}
      </div>

      {tab === 'broadcast' ? (
        <SmsBroadcastComposer clientId={clientId} onSent={() => setTab('inbox')} />
      ) : (
        <div className="rounded-card border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border p-4">
            <div className="relative w-full max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load(q)}
                placeholder="Search name, company, phone or template — press Enter"
                className="w-full rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
              />
            </div>
            <span className="ml-auto text-sm text-muted2">{messages.length} sent</span>
          </div>

          {error && <p className="p-4 text-sm text-red-400">{error}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted">
                  <th className="px-4 py-2">Sent</th>
                  <th className="px-4 py-2">Lead</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">Template</th>
                  <th className="px-4 py-2">Message</th>
                  <th className="px-4 py-2">How</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {messages.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted2">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setOpenLead(m.lead_id)} className="text-left font-medium text-blue-500 hover:underline">
                        {m.full_name}
                      </button>
                      {m.child_name && <div className="text-xs text-muted">{m.child_name}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted2">{m.mobile}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted2">{m.template_name}</td>
                    <td className="max-w-md px-4 py-3 text-fg">{m.body}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted2">
                      {TRIGGER_LABEL[m.trigger] || m.trigger}
                      {m.broadcast_name && <div>{m.broadcast_name}</div>}
                      {m.sent_by_name && <div>by {m.sent_by_name}</div>}
                    </td>
                  </tr>
                ))}
                {!loading && messages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      No SMS sent yet.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openLead && (
        <LeadSlideOver
          leadId={openLead}
          initialTab="sms"
          onClose={() => {
            setOpenLead(null)
            if (tab === 'inbox') load()
          }}
        />
      )}
    </div>
  )
}
