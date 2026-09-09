// path: components/lead/StagePill.tsx
'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStages, StageRow } from '@/lib/StagesContext'
import ColdReasonModal, { ColdReasonValue } from './ColdReasonModal'

export default function StagePill({
  stage,
  clientId,
  onChange,
}: {
  stage: string
  clientId: string
  // coldReason is supplied only when the new stage is a cold one — every
  // other move passes it as undefined and the API leaves the reason columns
  // alone.
  onChange: (next: string, coldReason?: ColdReasonValue) => void
}) {
  const [open, setOpen] = useState(false)
  const [pendingCold, setPendingCold] = useState<StageRow | null>(null)
  const { stagesFor, stageLabel, stageColor } = useStages()
  const stages = stagesFor(clientId)

  function isCold(s: StageRow): boolean {
    return s.status_group === 'cold' || s.is_cold_lane
  }

  function pick(s: StageRow) {
    setOpen(false)
    if (s.key === stage) return
    // The reason is collected before anything is sent, so a cancelled prompt
    // leaves the lead exactly where it was rather than moving it and then
    // asking.
    if (isCold(s)) setPendingCold(s)
    else onChange(s.key)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium text-zinc-900"
        style={{ backgroundColor: stageColor(stage, clientId) }}
      >
        {stageLabel(stage, clientId)}
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-card border border-border bg-card2 p-1 shadow-xl">
            {stages.map((s) => (
              <button
                key={s.key}
                onClick={() => pick(s)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-card"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {pendingCold && (
        <ColdReasonModal
          clientId={clientId}
          stageLabel={pendingCold.label}
          onCancel={() => setPendingCold(null)}
          onConfirm={(value) => {
            const target = pendingCold.key
            setPendingCold(null)
            onChange(target, value)
          }}
        />
      )}
    </div>
  )
}
