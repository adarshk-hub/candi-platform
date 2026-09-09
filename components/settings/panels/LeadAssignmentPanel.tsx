// path: components/settings/panels/LeadAssignmentPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'

type Mode = 'manual' | 'round_robin'

const MODES: { key: Mode; title: string; blurb: string }[] = [
  {
    key: 'manual',
    title: 'Manual',
    blurb:
      'New leads arrive unassigned. Pick who takes each one from the lead itself, or select several at once on the Activity page.',
  },
  {
    key: 'round_robin',
    title: 'Round robin',
    blurb:
      'Every new lead goes straight to whichever counsellor currently holds the fewest open leads. Anyone added later joins the rotation on their own.',
  },
]

export default function LeadAssignmentPanel({ clientId }: { clientId: string }) {
  const [mode, setMode] = useState<Mode>('manual')
  const [waWelcomeConfirm, setWaWelcomeConfirm] = useState(true)
  const [counsellorCount, setCounsellorCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [migrationNeeded, setMigrationNeeded] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/lead-automation?clientId=${clientId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/counsellors?clientId=${clientId}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([data, people]) => {
        if (data) {
          setMode(data.mode === 'round_robin' ? 'round_robin' : 'manual')
          setWaWelcomeConfirm(data.waWelcomeConfirm !== false)
          setMigrationNeeded(!!data.migrationNeeded)
        }
        setCounsellorCount(Array.isArray(people) ? people.length : 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  async function save() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/lead-automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, mode, waWelcomeConfirm }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not save.')
        return
      }
      setMessage('Saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>

  return (
    <div className="space-y-4">
      {migrationNeeded && (
        <p className="rounded-card border border-amber-500/40 bg-card p-4 text-sm text-amber-400">
          This database is missing the assignment columns. Run scripts/phase2-migration.sql against it, then reload.
        </p>
      )}

      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">Automatic WhatsApp</h2>
        <p className="mt-1 text-sm text-muted2">
          Whether the welcome message goes out the moment a lead arrives, or waits for someone to say yes.
        </p>
        <label className="mt-4 flex items-start gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={waWelcomeConfirm}
            onChange={(e) => setWaWelcomeConfirm(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>
            Ask before sending
            <span className="mt-0.5 block text-xs text-muted2">
              A “Send the welcome message?” prompt appears on top of the lead. Nothing is sent until someone
              answers it. Turn this off to go back to sending immediately.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">Lead assignment</h2>
        <p className="mt-1 text-sm text-muted2">Who a new lead goes to before anybody touches it.</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={clsx(
                'rounded-card border p-4 text-left transition-colors',
                mode === m.key ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-card2 hover:border-blue-500/50'
              )}
            >
              <p className="text-sm font-semibold text-fg">{m.title}</p>
              <p className="mt-1 text-xs text-muted2">{m.blurb}</p>
            </button>
          ))}
        </div>

        {/* Round robin with nobody to rotate between silently behaves like
            manual, which looks like the setting simply didn't work. Better to
            say so here than to let it be discovered a week later. */}
        {mode === 'round_robin' && counsellorCount === 0 && (
          <p className="mt-3 text-sm text-amber-400">
            There are no counsellors yet, so leads will keep arriving unassigned. Add them under Settings &gt;
            Counsellors first.
          </p>
        )}

        {mode === 'manual' && (
          <p className="mt-3 text-xs text-muted2">
            Assign from the Counsellor dropdown on any lead, or select several rows on the Activity page and
            assign them together.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-sm text-muted2">{message}</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  )
}
