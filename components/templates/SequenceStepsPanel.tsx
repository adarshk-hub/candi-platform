// path: components/templates/SequenceStepsPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { SEQUENCE_STEPS } from '@/lib/nurtureSequenceSteps'
import { useStages } from '@/lib/StagesContext'

// "Which message goes out when" — moved out of Settings > WhatsApp so the
// people who write and schedule messages have one page for it, instead of
// hunting through a credentials screen.
const NO_MESSAGE = '__none__'

interface TemplateRow {
  id: string
  name: string
  language: string
  status: string
}

export default function SequenceStepsPanel({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [assignments, setAssignments] = useState<Record<number, string>>({})
  const [stageByDay, setStageByDay] = useState<Record<number, string>>({})
  const [confirmByDay, setConfirmByDay] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [savingDay, setSavingDay] = useState<number | null>(null)
  // Per-step result, shown in the step's own row — a page-level line would
  // be too far from the control that failed.
  const [rowMsg, setRowMsg] = useState<Record<number, { ok: boolean; text: string }>>({})
  const { stagesFor } = useStages()

  function loadTemplates() {
    fetch(`/api/templates/${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setTemplates(rows || []))
      .catch(() => {})
  }

  // quiet = refresh after a save without swapping the rows for "Loading…"
  function loadAssignments(quiet = false) {
    if (!quiet) setLoading(true)
    fetch(`/api/clients/${clientId}/whatsapp-sequence-templates`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { day_number: number; template_name: string; stage_key?: string | null; require_confirmation?: boolean }[]) => {
        const stageMap: Record<number, string> = {}
        const confirmMap: Record<number, boolean> = {}
        const map: Record<number, string> = {}
        for (const row of rows || []) {
          stageMap[row.day_number] = row.stage_key || ''
          confirmMap[row.day_number] = !!row.require_confirmation
          map[row.day_number] = row.template_name
        }
        setStageByDay(stageMap)
        setConfirmByDay(confirmMap)
        setAssignments(map)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadTemplates()
    loadAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // templateName '' clears the step: the server deletes the row and the
  // sequence skips that day entirely.
  async function assignTemplate(dayNumber: number, templateName: string, stageOverride?: string, confirmOverride?: boolean) {
    setSavingDay(dayNumber)
    setRowMsg((prev) => {
      const next = { ...prev }
      delete next[dayNumber]
      return next
    })

    // Snapshot all three fields so a failed save puts back exactly what the
    // database still holds.
    const prevTemplate = assignments[dayNumber]
    const prevStage = stageByDay[dayNumber] || ''
    const prevConfirm = !!confirmByDay[dayNumber]
    const nextStage = stageOverride !== undefined ? stageOverride : prevStage
    const nextConfirm = confirmOverride !== undefined ? confirmOverride : prevConfirm

    setAssignments((prev) => ({ ...prev, [dayNumber]: templateName }))
    setStageByDay((prev) => ({ ...prev, [dayNumber]: templateName ? nextStage : '' }))
    setConfirmByDay((prev) => ({ ...prev, [dayNumber]: templateName ? nextConfirm : false }))

    const revert = (text: string) => {
      setAssignments((prev) => ({ ...prev, [dayNumber]: prevTemplate }))
      setStageByDay((prev) => ({ ...prev, [dayNumber]: prevStage }))
      setConfirmByDay((prev) => ({ ...prev, [dayNumber]: prevConfirm }))
      setRowMsg((prev) => ({ ...prev, [dayNumber]: { ok: false, text } }))
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-sequence-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayNumber,
          templateName,
          // Meta matches name AND language exactly (#132001 otherwise), so
          // save the language the template was actually approved in.
          languageCode: templates.find((t) => t.name === templateName)?.language || 'en',
          stageKey: templateName ? nextStage : '',
          requireConfirmation: templateName ? nextConfirm : false,
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        revert(b.error || 'Not saved — the server rejected this change.')
        return
      }
      setRowMsg((prev) => ({ ...prev, [dayNumber]: { ok: true, text: 'Saved' } }))
    } catch (err: any) {
      revert(err?.message || 'Not saved — could not reach the server.')
    } finally {
      setSavingDay(null)
      // Re-read what the database actually holds, so the screen can never
      // drift from what the sending code will use.
      loadAssignments(true)
    }
  }

  const approvedTemplates = templates.filter((t) => t.status === 'approved')

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <h2 className="mb-1 text-lg font-bold text-fg">Message schedule</h2>
      <p className="mb-4 text-sm text-muted2">
        Pick the message that goes out at each step. Choose <strong className="text-fg">No message</strong> to skip a
        step entirely — nothing is sent on that day. A step&apos;s stage and &quot;Ask first&quot; only apply once a
        message is chosen, so they stay locked until then.
      </p>

      {approvedTemplates.length === 0 && (
        <p className="mb-3 rounded-md border border-dashed border-border px-3 py-3 text-xs text-amber-500">
          No approved messages yet. Write one on the Create tab and wait for Meta to approve it.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-2">
          {SEQUENCE_STEPS.map((def, i) => {
            const current = assignments[def.day] || ''
            const stage = stageByDay[def.day] || ''
            const chosen = !!current
            const currentApproved = chosen && approvedTemplates.some((t) => t.name === current)
            const msg = rowMsg[def.day]

            return (
              <div key={def.day} className="rounded-md border border-border bg-card2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-28 shrink-0">
                    <span className="block text-xs font-semibold text-fg">Step {i + 1}</span>
                    <span className="block text-[11px] text-muted2">{def.label}</span>
                  </span>

                  {/* The message comes first now: it is the decision, and
                      everything else on the row only makes sense after it. */}
                  <select
                    value={chosen ? current : NO_MESSAGE}
                    onChange={(e) => {
                      const v = e.target.value
                      assignTemplate(def.day, v === NO_MESSAGE ? '' : v)
                    }}
                    disabled={savingDay === def.day}
                    className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value={NO_MESSAGE}>No message — skip this step</option>
                    {/* A saved template that is no longer approved must be
                        shown as itself, or the browser silently displays the
                        first approved one instead and the screen lies about
                        what will be sent. */}
                    {chosen && !currentApproved && <option value={current}>{current} (not approved — pick another)</option>}
                    {approvedTemplates.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={stage}
                    onChange={(e) => {
                      const next = e.target.value
                      setStageByDay((prev) => ({ ...prev, [def.day]: next }))
                      if (currentApproved) assignTemplate(def.day, current, next)
                    }}
                    disabled={savingDay === def.day || !currentApproved}
                    title={currentApproved ? 'Only send this step to leads in this stage' : 'Choose a message first'}
                    className="w-44 shrink-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="">Any stage</option>
                    {stagesFor(clientId).map((st) => (
                      <option key={st.key} value={st.key}>
                        {st.label}
                      </option>
                    ))}
                  </select>

                  {/* Step 1 is the welcome message. It fires when the lead is
                      created, not on a stage change, and has its own
                      ask-first setting under Lead Assignment — a second
                      switch here would be two controls over one message with
                      no way to tell which won. */}
                  {i === 0 ? (
                    <span className="w-32 shrink-0 text-[11px] text-muted">Sends automatically</span>
                  ) : (
                    <label
                      className="flex w-32 shrink-0 items-center gap-1.5 text-[11px] text-muted2"
                      title={currentApproved ? 'Ask before this message is sent on a stage change' : 'Choose a message first'}
                    >
                      <input
                        type="checkbox"
                        checked={!!confirmByDay[def.day]}
                        disabled={savingDay === def.day || !currentApproved}
                        onChange={(e) => {
                          if (currentApproved) assignTemplate(def.day, current, undefined, e.target.checked)
                        }}
                        className="h-3.5 w-3.5 rounded border-border disabled:opacity-50"
                      />
                      Ask first
                    </label>
                  )}

                  {savingDay === def.day && <RefreshCw size={12} className="shrink-0 animate-spin text-muted" />}
                  {savingDay !== def.day && msg?.ok && <span className="shrink-0 text-[11px] text-green-500">✓ Saved</span>}
                </div>

                {msg && !msg.ok && <p className="mt-1.5 text-[11px] text-red-400">Not saved: {msg.text}</p>}

                {chosen && !currentApproved && (
                  <p className="mt-1.5 text-[11px] text-amber-500">
                    &quot;{current}&quot; is not approved, so this step will fail to send. Pick an approved message, or
                    choose No message.
                  </p>
                )}

                {/* A step with no stage and "Ask first" ticked is never sent
                    by anything: the timer skips ask-first steps and the
                    stage-change prompt only looks for a matching stage. */}
                {i > 0 && currentApproved && !stage && !!confirmByDay[def.day] && (
                  <p className="mt-1.5 text-[11px] text-amber-500">
                    With &quot;Any stage&quot; and Ask first ticked, this message will never be sent. Choose a stage, or
                    untick Ask first to send it on day {def.day}.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
