// path: components/lead/tabs/StageEmailTab.tsx
'use client'

import { useEffect, useState } from 'react'
import { formatDateTime } from '@/lib/format'

interface Tpl {
  stage: string
  label: string
  subject: string
  body: string
}
interface Sent {
  id: string
  template_key: string | null
  subject: string
  body: string
  to_email: string
  status: string
  error: string | null
  created_at: string
  sent_by_name: string | null
}

// Local Octo only: send any stage email to this lead by hand (filled in from
// the lead, editable before sending), and see the emails sent to them.
export default function StageEmailTab({ leadId }: { leadId: string }) {
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [messages, setMessages] = useState<Sent[]>([])
  const [hasEmail, setHasEmail] = useState(true)
  const [stage, setStage] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function load() {
    fetch(`/api/leads/${leadId}/stage-email`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setTemplates(d?.templates || [])
        setMessages(d?.messages || [])
        setHasEmail(d?.hasEmail !== false)
      })
      .catch(() => {})
  }
  useEffect(load, [leadId])

  function choose(key: string) {
    setStage(key)
    setError('')
    setNotice('')
    const t = templates.find((x) => x.stage === key)
    setSubject(t?.subject || '')
    setBody(t?.body || '')
  }

  async function send() {
    if (!stage) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/leads/${leadId}/stage-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, direct: true, subject, body }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Email was not sent.')
        return
      }
      setNotice('Email sent.')
      setStage('')
      setSubject('')
      setBody('')
      load()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-border bg-card p-4">
        <p className="mb-2 text-sm font-medium text-fg">Send an email</p>
        {!hasEmail ? (
          <p className="text-sm text-muted">This lead has no email address. Add one in the Info tab first.</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted">No stage emails written yet. Write them in Settings → Stage Emails.</p>
        ) : (
          <>
            <select
              value={stage}
              onChange={(e) => choose(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            >
              <option value="">Choose an email…</option>
              {templates.map((t) => (
                <option key={t.stage} value={t.stage}>
                  {t.label} — {t.subject}
                </option>
              ))}
            </select>
            {stage && (
              <div className="mt-3 space-y-2">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                />
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            {notice && <p className="mt-2 text-sm text-green-500">{notice}</p>}
            <div className="mt-3 flex justify-end">
              <button
                onClick={send}
                disabled={!stage || !subject.trim() || !body.trim() || sending}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted">Emails</p>
        {messages.length === 0 ? (
          <p className="text-sm text-muted">No emails sent yet.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="rounded-md border border-border bg-card2 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className={m.status === 'sent' ? 'text-green-500' : 'text-red-400'}>
                    {m.status === 'sent' ? 'Sent' : 'Failed'}
                  </span>
                  <span>· {m.to_email}</span>
                  {m.sent_by_name && <span>· by {m.sent_by_name}</span>}
                  <span className="ml-auto">{formatDateTime(m.created_at)}</span>
                </div>
                <p className="text-sm font-medium text-fg">{m.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted2">{m.body}</p>
                {m.error && <p className="mt-1 text-xs text-red-400">{m.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
