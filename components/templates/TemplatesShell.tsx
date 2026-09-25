// path: components/templates/TemplatesShell.tsx
'use client'

import { useState } from 'react'
import { MessageSquareText, CalendarClock, FilePlus2 } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'
import SequenceStepsPanel from './SequenceStepsPanel'
import BroadcastTemplatesPanel, { TemplateView } from '@/components/broadcast/BroadcastTemplatesPanel'

// WhatsApp, in the shape of the plan: Templates (apply, approved, pending,
// rejected) and Automation (the message schedule). Inbox and Broadcast stay
// where they are, as their own pages in the sidebar.
export default function TemplatesShell({
  institutes,
  lockedToClientId,
}: {
  institutes: { id: string; name: string }[]
  lockedToClientId: string | null
}) {
  const clientId = lockedToClientId || institutes[0]?.id || ''
  const [tab, setTab] = useState<'templates' | 'automation'>('templates')
  const [view, setView] = useState<TemplateView>('apply')

  if (!clientId) return <p className="text-muted">No institution selected.</p>

  const tabs = [
    { key: 'templates' as const, label: 'Templates', icon: FilePlus2 },
    { key: 'automation' as const, label: 'Automation', icon: CalendarClock },
  ]

  // Apply is the submission form; the other three are the same list filtered
  // by what Meta has said about each template.
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
          <MessageSquareText size={22} /> WhatsApp
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
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'automation' ? (
        <SequenceStepsPanel clientId={clientId} />
      ) : (
        <div>
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
      )}
    </div>
  )
}
