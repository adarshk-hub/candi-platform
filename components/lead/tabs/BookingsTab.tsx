// path: components/lead/tabs/BookingsTab.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { MapPin, Phone, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import VisitTab from './VisitTab'
import LogCallModal from '../LogCallModal'

interface CallEntry {
  id: string
  title: string
  description: string | null
  actor_name: string | null
  created_at: string
}

// Replaces the old Visit tab. Calls and visits are both "a time we spoke to
// this family", so they belong in one place — previously a call was logged
// from a button in the panel header while a visit lived in its own tab, and
// nothing tied the two together.
export default function BookingsTab({ leadId }: { leadId: string }) {
  const [sub, setSub] = useState<'call' | 'visit'>('call')

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-border">
        {([
          { key: 'call' as const, label: 'Call', icon: Phone },
          { key: 'visit' as const, label: 'Visit', icon: MapPin },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={clsx(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium',
              sub === t.key ? 'border-blue-500 text-fg' : 'border-transparent text-muted2 hover:text-fg'
            )}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'call' ? <CallLog leadId={leadId} /> : <VisitTab leadId={leadId} />}
    </div>
  )
}

function CallLog({ leadId }: { leadId: string }) {
  const [calls, setCalls] = useState<CallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  // Read back out of the activity trail rather than from a calls table:
  // POST /api/leads/[id]/call writes both the counters on the lead and a
  // "Call Logged" entry, and the entry is the one that carries who called
  // and what was said.
  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/leads/${leadId}/activity`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setCalls(list.filter((a: CallEntry) => a.title === 'Call Logged'))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [leadId])

  useEffect(load, [load])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted2">
          {calls.length === 0 ? 'No calls logged yet.' : `${calls.length} call${calls.length === 1 ? '' : 's'} logged`}
        </p>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          <Plus size={15} /> Add Call
        </button>
      </div>

      <div className="space-y-2">
        {calls.map((c) => (
          <div key={c.id} className="rounded-card border border-border bg-card2 p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-500">
                <Phone size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{c.description || 'Call logged'}</p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(c.created_at).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {c.actor_name ? ` · ${c.actor_name}` : ''}
                </p>
              </div>
            </div>
          </div>
        ))}
        {calls.length === 0 && !loading && (
          <p className="py-10 text-center text-sm text-muted">
            Use Add Call after speaking to the parent — it's what the "never called" and "calls logged" figures
            on Activity and My Day are counted from.
          </p>
        )}
      </div>

      {adding && (
        <LogCallModal
          leadId={leadId}
          onClose={() => setAdding(false)}
          onLogged={() => {
            setAdding(false)
            load()
          }}
        />
      )}
    </div>
  )
}
