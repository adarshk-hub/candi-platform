// path: components/lead/tabs/SmsTab.tsx
'use client'

import { useEffect, useState } from 'react'
import { formatDateTime } from '@/lib/format'

interface SmsTemplateRow {
  stage: string
  name: string
  text: string
}

interface SentSms {
  id: string
  template_name: string
  body: string
  mobile: string
  trigger: string
  broadcast_name: string | null
  created_at: string
}

const TRIGGER_LABEL: Record<string, string> = {
  auto: 'Automatic',
  manual: 'Stage prompt',
  direct: 'Sent by hand',
  broadcast: 'Broadcast',
}

// Local Octo only: send any of the fixed MSG91 templates to this lead by hand,
// and see the SMS already sent to them. Values are filled from the lead.
export default function SmsTab({ leadId }: { leadId: string }) {
  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [messages, setMessages] = useState<SentSms[]>([])
  const [stage, setStage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function load() {
    fetch(`/api/leads/${leadId}/sms`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setTemplates(d?.templates || [])
        setMessages(d?.messages || [])
      })
      .catch(() => {})
  }
  useEffect(load, [leadId])

  async function send() {
    if (!stage) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/leads/${leadId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, direct: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'SMS was not sent.')
        return
      }
      setNotice('SMS sent.')
      setStage('')
      load()
    } finally {
      setSending(false)
    }
  }

  const chosen = templates.find((t) => t.stage === stage)

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-4">
        <p className="mb-2 text-sm font-medium text-fg">Send an SMS</p>
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value)
            setError('')
            setNotice('')
          }}
          className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.stage} value={t.stage}>
              {t.name}
            </option>
          ))}
        </select>
        {chosen && <p className="mt-2 rounded-md bg-card2 px-3 py-2 text-xs text-muted2">{chosen.text}</p>}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-2 text-sm text-green-500">{notice}</p>}
        <div className="mt-3 flex justify-end">
          <button
            onClick={send}
            disabled={!stage || sending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted">Sent SMS</p>
        {messages.length === 0 ? (
          <p className="text-sm text-muted">No SMS sent yet.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="rounded-md border border-border bg-card2 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono">{m.template_name}</span>
                  <span>· {TRIGGER_LABEL[m.trigger] || m.trigger}</span>
                  {m.broadcast_name && <span>· {m.broadcast_name}</span>}
                  <span className="ml-auto">{formatDateTime(m.created_at)}</span>
                </div>
                <p className="text-sm text-fg">{m.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
