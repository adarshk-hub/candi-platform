// path: components/templates/TemplatesShell.tsx
'use client'

import { useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import BroadcastTemplatesPanel, { TemplateView } from '@/components/broadcast/BroadcastTemplatesPanel'

// WhatsApp > Templates. Automation lives on its own page
// (/templates/automation), and Inbox and Broadcast on theirs — all four
// sit together in the sidebar's WhatsApp group.
export default function TemplatesShell({
  institutes,
  lockedToClientId,
}: {
  institutes: { id: string; name: string }[]
  lockedToClientId: string | null
}) {
  const clientId = lockedToClientId || institutes[0]?.id || ''
  const [view, setView] = useState<TemplateView>('apply')

  if (!clientId) return <p className="text-muted">No institution selected.</p>

  // Apply is the submission form; the other three are the same list split by
  // what Meta has said about each template.
  const views: { key: TemplateView; label: string }[] = [
    { key: 'apply', label: 'Apply' },
    { key: 'approved', label: 'Approved' },
    { key: 'pending', label: 'Pending' },
    { key: 'rejected', label: 'Rejected' },
  ]

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <FilePlus2 size={22} /> Templates
        </h1>
        <NotificationBell />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              view === v.key
                ? 'border-blue-500 bg-blue-500/10 font-medium text-fg'
                : 'border-border bg-card2 text-muted2 hover:text-fg'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <BroadcastTemplatesPanel clientId={clientId} view={view} />
    </div>
  )
}
