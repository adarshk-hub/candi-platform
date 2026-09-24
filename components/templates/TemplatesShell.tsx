// path: components/templates/TemplatesShell.tsx
'use client'

import { useState } from 'react'
import { MessageSquareText, CalendarClock, FilePlus2 } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import SequenceStepsPanel from './SequenceStepsPanel'
import BroadcastTemplatesPanel from '@/components/broadcast/BroadcastTemplatesPanel'

// One home for messages: when they go out (Schedule) and what they say
// (Messages). Both used to be buried inside Settings > WhatsApp, next to
// API credentials, with a second copy of the message list under Broadcast.
export default function TemplatesShell({
  institutes,
  lockedToClientId,
}: {
  institutes: { id: string; name: string }[]
  lockedToClientId: string | null
}) {
  const clientId = lockedToClientId || institutes[0]?.id || ''
  const [tab, setTab] = useState<'schedule' | 'messages'>('schedule')

  if (!clientId) return <p className="text-muted">No institution selected.</p>

  const tabs = [
    { key: 'schedule' as const, label: 'Schedule', hint: 'Which message goes out when', icon: CalendarClock },
    { key: 'messages' as const, label: 'Messages', hint: 'Write and submit for approval', icon: FilePlus2 },
  ]

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <MessageSquareText size={22} /> WhatsApp Templates
        </h1>
        <NotificationBell />
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-blue-500 text-fg' : 'border-transparent text-muted2 hover:text-fg'
            }`}
            title={t.hint}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'schedule' ? (
        <SequenceStepsPanel clientId={clientId} />
      ) : (
        <BroadcastTemplatesPanel clientId={clientId} />
      )}
    </div>
  )
}
