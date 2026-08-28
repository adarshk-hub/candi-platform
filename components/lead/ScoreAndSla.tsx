'use client'

import { useEffect, useState } from 'react'
import { Lead } from '@/lib/types'
import { useStages } from '@/lib/StagesContext'
import { elapsedLabel } from '@/lib/format'

export default function ScoreAndSla({ lead }: { lead: Lead }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const { stageMaxMinutes } = useStages()
  const maxMinutes = stageMaxMinutes(lead.pipeline_stage, lead.client_id)
  const elapsedMs = now - new Date(lead.stage_updated_at).getTime()
  const overdue = maxMinutes !== null && elapsedMs > maxMinutes * 60000

  return (
    <div className="border-t border-border px-6 py-5">
      <p className="text-sm">
        <span className="text-muted2">Time in current stage: </span>
        <span className={overdue ? 'font-semibold text-red-400' : 'text-amber-400'}>
          {elapsedLabel(lead.stage_updated_at)}
        </span>
      </p>
    </div>
  )
}
