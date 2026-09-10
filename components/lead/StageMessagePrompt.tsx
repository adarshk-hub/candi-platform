// path: components/lead/StageMessagePrompt.tsx
'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'

interface Assignment {
  day_number: number
  template_name: string
  stage_key: string | null
}

interface WaTemplate {
  id: string
  name: string
  status: string
  language: string
  bodyPreview: string
  variableCount: number
}

// Asks before sending the WhatsApp template attached to a stage.
//
// Mounted by whichever screen changed the stage — the lead panel and the
// leads table both use it — so the question is the same wherever the change
// happened. It renders nothing at all unless a template is actually
// configured for the new stage, which is why callers can mount it
// unconditionally.
//
// Day 0 is deliberately excluded: that step is the welcome message, which
// fires on its own when a lead is created (see lib/welcomeMessage.ts).
// Prompting for it here would mean asking twice about the same message.
export default function StageMessagePrompt({
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
  const [template, setTemplate] = useState<WaTemplate | null>(null)
  const [checked, setChecked] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function findTemplate() {
      try {
        const assignments: Assignment[] = await fetch(
          `/api/clients/${clientId}/whatsapp-sequence-templates`
        ).then((r) => (r.ok ? r.json() : []))

        const match = (Array.isArray(assignments) ? assignments : []).find(
          (a) => a.stage_key === stageKey && a.day_number !== 0 && a.template_name
        )
        if (!match) {
          // Nothing configured for this stage — resolve immediately so the
          // caller isn't left waiting on a prompt that will never appear.
          if (!cancelled) {
            setChecked(true)
            onDone()
          }
          return
        }

        const templates: WaTemplate[] = await fetch(`/api/leads/${leadId}/whatsapp/templates`).then((r) =>
          r.ok ? r.json() : []
        )
        const found = (Array.isArray(templates) ? templates : []).find(
          (t) => t.name === match.template_name && t.status === 'approved'
        )

        if (cancelled) return
        setChecked(true)
        // An assignment pointing at a template Meta hasn't approved (or has
        // since revoked) is treated as no template rather than as an error:
        // the stage change itself already succeeded, and a red box about
        // template approval is not the counsellor's problem in that moment.
        if (found) setTemplate(found)
        else onDone()
      } catch {
        if (!cancelled) {
          setChecked(true)
          onDone()
        }
      }
    }

    findTemplate()
    return () => {
      cancelled = true
    }
  }, [leadId, clientId, stageKey, onDone])

  async function send() {
    if (!template) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/whatsapp/template-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          // The first variable is the parent's name in every template this
          // app ships; anything beyond that is left blank rather than
          // guessed at.
          variables: Array.from({ length: template.variableCount }, (_, i) => (i === 0 ? leadName : '')),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not send that message.')
        return
      }
      onDone()
    } finally {
      setSending(false)
    }
  }

  if (!checked || !template) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <MessageCircle size={18} className="text-green-500" />
              Send the {stageLabel} message?
            </h2>
            <p className="mt-1 text-xs text-muted2">
              {leadName} has moved to {stageLabel}. This stage has a WhatsApp template set up for it.
            </p>
          </div>
          <button onClick={onDone} className="text-muted2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <p className="mb-1 text-xs uppercase tracking-widest text-muted">{template.name}</p>
        <p className="mb-4 rounded-md bg-card2 px-3 py-2 text-sm text-muted2">{template.bodyPreview}</p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={onDone}
            disabled={sending}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg disabled:opacity-50"
          >
            Don't send
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </div>
    </div>
  )
}
