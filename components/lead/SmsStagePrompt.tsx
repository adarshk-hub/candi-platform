// path: components/lead/SmsStagePrompt.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { isLocalOcto } from '@/lib/localOcto'

// Local Octo only: after a stage change, asks before sending that stage's
// MSG91 SMS when the stage is set to "Ask before sending" in Settings > SMS.
// Renders nothing (and finishes straight away) for other schools, stages set
// to Automatic or Off, and stages with no SMS — so callers can mount it
// unconditionally.
export default function SmsStagePrompt({
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
  const [text, setText] = useState('')
  const [name, setName] = useState('')
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
    fetch(`/api/clients/${clientId}/sms-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cancelled) return
        const tpl = (cfg?.templates || []).find((t: any) => t.stage === stageKey)
        if (!cfg?.enabled || !tpl || cfg.modes?.[stageKey] !== 'manual') {
          done()
          return
        }
        setText(tpl.text)
        setName(tpl.name)
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
      const res = await fetch(`/api/leads/${leadId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageKey }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'SMS was not sent.')
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
      <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <MessageSquare size={18} className="text-blue-500" />
              Send the {stageLabel} SMS?
            </h2>
            <p className="mt-1 text-xs text-muted2">
              {leadName} has moved to {stageLabel}. The details are filled in from the lead.
            </p>
          </div>
          <button onClick={done} className="text-muted2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <p className="mb-1 text-xs uppercase tracking-widest text-muted">{name}</p>
        <p className="mb-3 rounded-md bg-card2 px-3 py-2 text-sm text-muted2">{text}</p>

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
            disabled={sending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  )
}
