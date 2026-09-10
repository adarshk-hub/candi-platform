// path: components/lead/tabs/CallLogTab.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Phone, Plus } from 'lucide-react'
import LogCallModal from '../LogCallModal'

interface CallEntry {
  id: string
  title: string
  description: string | null
  actor_name: string | null
  created_at: string
}

// Calls that have already happened, logged by hand.
//
// Deliberately separate from Bookings, which is for calls *scheduled* for
// later. Mixing the two would blur the line the Activity page depends on:
// booking a call for Friday must not make a lead look contacted today.
//
// Read back out of the activity trail rather than a calls table, because
// POST /api/leads/[id]/call already writes both the counters on the lead
// and a "Call Logged" entry, and that entry is what carries who called and
// what was said.
export default function CallLogTab({ leadId }: { leadId: string }) {
  const [calls, setCalls] = useState<CallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

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
          {calls.length === 0
            ? 'No calls logged yet.'
            : `${calls.length} call${calls.length === 1 ? '' : 's'} logged`}
        </p>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          <Plus size={15} /> Log Call
        </button>
      </div>

      {/* Newest first — the API returns activity in that order, and the last
          conversation is the one anyone picking this lead up needs. */}
      <div className="space-y-2">
        {calls.map((c) => (
          <div key={c.id} className="flex items-start gap-3 rounded-card border border-border bg-card2 p-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-500">
              <Phone size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">
                {new Date(c.created_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
                <span className="ml-2 font-normal text-muted2">
                  {new Date(c.created_at).toLocaleTimeString('en-IN', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted2">{c.description || 'Call logged'}</p>
              {c.actor_name && <p className="mt-1 text-xs text-muted">{c.actor_name}</p>}
            </div>
          </div>
        ))}

        {calls.length === 0 && !loading && (
          <p className="py-10 text-center text-sm text-muted">
            Log a call after speaking to the parent — this is what the "never called" and "calls logged"
            figures on Activity, My Day and Team Day are counted from.
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
