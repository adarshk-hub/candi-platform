// path: components/broadcast/BroadcastsShell.tsx
'use client'

import { useState } from 'react'
import NotificationBell from '@/components/NotificationBell'
import { Radio, MessageCircle, Mail } from 'lucide-react'
import BroadcastTemplatesPanel from './BroadcastTemplatesPanel'
import EmailDesignsPanel from './EmailDesignsPanel'
import BroadcastComposer from './BroadcastComposer'
import BroadcastHistory from './BroadcastHistory'
import EmailBroadcastComposer from './EmailBroadcastComposer'
import EmailBroadcastHistory from './EmailBroadcastHistory'
import AudienceBoard from '@/components/audience/AudienceBoard'

interface Institute {
  id: string
  name: string
}

export default function BroadcastsShell({
  institutes,
  lockedToClientId,
}: {
  institutes: Institute[]
  lockedToClientId: string | null
}) {
  // Read-only now — whichever institute the sidebar has selected.
  const clientId = lockedToClientId || institutes[0]?.id || ''
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [tab, setTab] = useState<'new' | 'audience' | 'templates' | 'history'>('new')
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  if (!clientId) {
    return <p className="text-muted">No institution to broadcast to yet.</p>
  }

  function switchChannel(next: 'whatsapp' | 'email') {
    setChannel(next)
    setTab('new')
  }

  // Audiences are the same set of groups whichever channel you're sending
  // through, so the WhatsApp/Email switch is hidden on that tab rather than
  // left showing a choice that changes nothing.
  // The WhatsApp/Email switch stays put on every tab. Hiding it on some of
  // them made the row above the content appear and disappear as you moved
  // between tabs, which is more disorienting than a switch that does
  // nothing — and on Templates it does something anyway, since the two
  // channels have entirely different template models.
  //
  // Audience is the one place it genuinely has no effect: a saved audience
  // is the same set of people either way. It's left enabled rather than
  // disabled, because the choice carries over to the tab you visit next.

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Radio size={22} className="text-fg" />
        <h1 className="text-2xl font-bold text-fg">Broadcasts</h1>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      {/* The institute picker has been removed. It duplicated the switcher
          in the sidebar, and two controls over the same choice is how a
          broadcast ends up going to the wrong school's parents — which is
          not recoverable. The institute is shown, not chosen. */}
      {institutes.length > 1 && (
        <p className="mb-5 text-sm text-muted2">
          Broadcasting as <span className="font-semibold text-fg">{institutes.find((i) => i.id === clientId)?.name || '—'}</span>
          . Switch institute from the sidebar.
        </p>
      )}

      <div className="mb-5 flex gap-2">
        <button
          onClick={() => switchChannel('whatsapp')}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
            channel === 'whatsapp' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-border bg-card2 text-muted2 hover:text-fg'
          }`}
        >
          <MessageCircle size={16} /> WhatsApp
        </button>
        <button
          onClick={() => switchChannel('email')}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
            channel === 'email' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-border bg-card2 text-muted2 hover:text-fg'
          }`}
        >
          <Mail size={16} /> Email
        </button>
      </div>

      <div className="mb-5 flex gap-1 border-b border-border">
        {(['new', 'audience', 'templates', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? 'border-blue-500 text-fg' : 'border-transparent text-muted2 hover:text-fg'
            }`}
          >
            {t === 'new'
              ? 'Send Broadcast'
              : t === 'audience'
              ? 'Audience'
              : t === 'templates'
              ? 'Templates'
              : 'History'}
          </button>
        ))}
      </div>

      {tab === 'templates' ? (
        channel === 'email' ? (
          <EmailDesignsPanel clientId={clientId} instituteName={institutes.find((i) => i.id === clientId)?.name || ''} />
        ) : (
          <BroadcastTemplatesPanel clientId={clientId} />
        )
      ) : tab === 'audience' ? (
        <AudienceBoard clientId={clientId} embedded />
      ) : channel === 'whatsapp' ? (
        tab === 'new' ? (
          <BroadcastComposer
            clientId={clientId}
            onSent={() => {
              setTab('history')
              setHistoryRefreshKey((k) => k + 1)
            }}
          />
        ) : (
          <BroadcastHistory clientId={clientId} refreshKey={historyRefreshKey} />
        )
      ) : tab === 'new' ? (
        <EmailBroadcastComposer
          clientId={clientId}
          instituteName={institutes.find((i) => i.id === clientId)?.name || ''}
          onSent={() => {
            setTab('history')
            setHistoryRefreshKey((k) => k + 1)
          }}
        />
      ) : (
        <EmailBroadcastHistory clientId={clientId} refreshKey={historyRefreshKey} />
      )}
    </div>
  )
}
