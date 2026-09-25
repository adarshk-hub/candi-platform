// path: components/templates/AutomationShell.tsx
'use client'

import { CalendarClock } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import SequenceStepsPanel from './SequenceStepsPanel'

// WhatsApp > Automation: which message goes out at each step of the
// sequence. Its own page, beside Templates in the sidebar.
export default function AutomationShell({
  institutes,
  lockedToClientId,
}: {
  institutes: { id: string; name: string }[]
  lockedToClientId: string | null
}) {
  const clientId = lockedToClientId || institutes[0]?.id || ''
  if (!clientId) return <p className="text-muted">No institution selected.</p>

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <CalendarClock size={22} /> Automation
        </h1>
        <NotificationBell />
      </div>
      <SequenceStepsPanel clientId={clientId} />
    </div>
  )
}
