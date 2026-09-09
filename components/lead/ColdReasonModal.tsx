// path: components/lead/ColdReasonModal.tsx
'use client'

import { useEffect, useState } from 'react'
import { Snowflake, X } from 'lucide-react'
import { COLD_REASON_LIST_KEY, DEFAULT_COLD_REASONS } from '@/lib/coldReasons'

export interface ColdReasonValue {
  reason: string
  note: string
}

// Shown the moment someone moves a lead into a cold stage, from anywhere the
// stage can change (the lead's stage pill, or dropping a card into a cold
// Kanban column). Asking here — while the person still has the call fresh in
// mind — is the only reliable way to end up with a cold breakdown on the
// Activity page that means anything.
export default function ColdReasonModal({
  clientId,
  stageLabel,
  initialReason = '',
  initialNote = '',
  onCancel,
  onConfirm,
}: {
  clientId: string
  stageLabel: string
  initialReason?: string
  initialNote?: string
  onCancel: () => void
  onConfirm: (value: ColdReasonValue) => void
}) {
  const [reasons, setReasons] = useState<string[]>(DEFAULT_COLD_REASONS)
  const [reason, setReason] = useState(initialReason)
  const [note, setNote] = useState(initialNote)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/option-items?clientId=${clientId}&listKey=${COLD_REASON_LIST_KEY}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data)
          ? data.filter((o: any) => o.is_active).map((o: any) => o.value as string)
          : []
        // Falls back to the built-in list rather than rendering an empty
        // dropdown — an institute that hasn't configured its own reasons yet
        // still needs to be able to move a lead to cold.
        if (list.length > 0) setReasons(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) return
    onConfirm({ reason, note: note.trim() })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
              <Snowflake size={18} className="text-blue-400" />
              Why is this lead going cold?
            </h2>
            <p className="mt-1 text-xs text-muted2">
              Moving to “{stageLabel}”. The reason shows up in the cold breakdown on the Activity page.
            </p>
          </div>
          <button onClick={onCancel} className="text-muted2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Reason *</label>
            <select
              required
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            >
              <option value="">Select a reason…</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Note (optional)</label>
            <textarea
              value={note}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth remembering if they come back later"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Move to cold
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
