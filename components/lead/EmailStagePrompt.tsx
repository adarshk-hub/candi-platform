// path: components/lead/EmailStagePrompt.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, X } from 'lucide-react'
import { isLocalOcto } from '@/lib/localOcto'

// Local Octo only: after a stage change, asks before sending that stage's
// email when it's set to "Ask before sending" in Settings → Stage Emails.
// Finishes straight away for other schools, other modes, stages with no
// email, and leads with no email address — so callers can mount it always.
export default function EmailStagePrompt({
  leadId,
  clientId,
  leadName,
  stageKey,
  stageLabel,
  onDone,
}: {
  leadId: string
  clientId: string
  leadName: string
  stageKey: string
  stageLabel: string
  onDone: () => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [show, setShow] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const done = () => onDoneRef.current()

  useEffect(() => {
    let cancelled = false
    if (!isLocalOcto(clientId)) {
      done()
      return
    }
    fetch(`/api/leads/${leadId}/stage-email?stage=${encodeURIComponent(stageKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const t = (d?.templates || [])[0]
        if (!d?.enabled || !d?.hasEmail || !t || t.mode !== 'manual') {
          done()
          return
        }
        setSubject(t.subject)
        setBody(t.body)
        setShow(true)
      })
      .catch(() => {
        if (!cancelled) done()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, clientId, stageKey])

  async function send() {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/stage-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageKey, subject, body }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Email was not sent.')
        return
      }
      done()
    } finally {
      setSending(false)
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <Mail size={18} className="text-blue-500" />
              Send the {stageLabel} email?
            </h2>
            <p className="mt-1 text-xs text-muted2">
              {leadName} has moved to {stageLabel}. You can edit it before sending.
            </p>
          </div>
          <button onClick={done} className="text-muted2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mb-2 w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="mb-3 w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
        />

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={done}
            disabled={sending}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg disabled:opacity-50"
          >
            Don&apos;t send
          </button>
          <button
            onClick={send}
            disabled={sending || !subject.trim() || !body.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  )
}
