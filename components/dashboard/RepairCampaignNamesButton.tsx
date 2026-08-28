'use client'

import { useState } from 'react'
import { Tag } from 'lucide-react'

export default function RepairCampaignNamesButton({ clientId }: { clientId: string }) {
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function run() {
    setRunning(true)
    setMsg('')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/repair-campaign-names`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Repair failed')
        return
      }
      const unresolvedNote =
        body.stillUnresolved?.length > 0
          ? ` ${body.stillUnresolved.length} still couldn't be resolved — check server logs for why.`
          : ''
      setMsg(`Checked ${body.checked} campaign${body.checked === 1 ? '' : 's'} still on a placeholder name — fixed ${body.fixed}.${unresolvedNote}`)
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 rounded-md border border-border bg-card2 px-4 py-2 text-sm font-medium text-fg hover:border-blue-500 disabled:opacity-50"
      >
        <Tag size={16} /> {running ? 'Resolving names from Meta…' : 'Fix campaign names'}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {msg && <p className="mt-2 text-xs text-muted2">{msg}</p>}
    </div>
  )
}
