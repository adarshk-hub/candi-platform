// path: components/settings/panels/LeadAssignmentPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { clsx } from 'clsx'

interface Counsellor {
  id: string
  full_name: string
}

interface Rule {
  id?: string
  counsellor_id: string
  match_type: 'source' | 'campaign' | 'grade' | 'location' | 'any'
  match_value: string | null
  is_active: boolean
}

const MATCH_LABEL: Record<Rule['match_type'], string> = {
  source: 'Source is',
  campaign: 'Campaign name is',
  grade: 'Class is',
  location: 'City is',
  any: 'Everything else',
}

const MODES: { key: 'manual' | 'rules' | 'round_robin'; title: string; blurb: string }[] = [
  {
    key: 'manual',
    title: 'Manual',
    blurb: 'New leads arrive unassigned and somebody picks who takes them.',
  },
  {
    key: 'rules',
    title: 'By rule',
    blurb: 'Route leads by source, campaign, class or city. Anything no rule matches falls back to round robin.',
  },
  {
    key: 'round_robin',
    title: 'Round robin',
    blurb: 'Every new lead goes to whichever counsellor currently holds the fewest open leads.',
  },
]

export default function LeadAssignmentPanel({ clientId }: { clientId: string }) {
  const [mode, setMode] = useState<'manual' | 'rules' | 'round_robin'>('manual')
  const [waWelcomeConfirm, setWaWelcomeConfirm] = useState(true)
  const [rules, setRules] = useState<Rule[]>([])
  const [counsellors, setCounsellors] = useState<Counsellor[]>([])
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
          setMode(data.mode || 'manual')
          setWaWelcomeConfirm(data.waWelcomeConfirm !== false)
          setRules(Array.isArray(data.rules) ? data.rules : [])
          setMigrationNeeded(!!data.migrationNeeded)
        }
        setCounsellors(Array.isArray(people) ? people : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  function addRule() {
    if (counsellors.length === 0) return
    setRules((prev) => [
      ...prev,
      { counsellor_id: counsellors[0].id, match_type: 'source', match_value: '', is_active: true },
    ])
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function save() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/lead-automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, mode, waWelcomeConfirm, rules }),
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

        {mode === 'rules' && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Rules, in order</p>
              <button
                onClick={addRule}
                disabled={counsellors.length === 0}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg hover:border-blue-500 disabled:opacity-50"
              >
                <Plus size={14} /> Add rule
              </button>
            </div>
            <p className="mb-3 text-xs text-muted2">
              The first rule that matches wins, so put the specific ones above the general ones.
            </p>

            <div className="space-y-2">
              {rules.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card2 p-3">
                  <span className="w-6 text-xs text-muted">{i + 1}</span>
                  <select
                    value={r.match_type}
                    onChange={(e) => updateRule(i, { match_type: e.target.value as Rule['match_type'] })}
                    className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                  >
                    {(Object.keys(MATCH_LABEL) as Rule['match_type'][]).map((k) => (
                      <option key={k} value={k}>
                        {MATCH_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {r.match_type !== 'any' && (
                    <input
                      value={r.match_value || ''}
                      onChange={(e) => updateRule(i, { match_value: e.target.value })}
                      placeholder="value"
                      className="w-44 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                    />
                  )}
                  <span className="text-sm text-muted2">→</span>
                  <select
                    value={r.counsellor_id}
                    onChange={(e) => updateRule(i, { counsellor_id: e.target.value })}
                    className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                  >
                    {counsellors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-auto rounded-md border border-border p-1.5 text-muted2 hover:text-red-400"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {rules.length === 0 && (
                <p className="py-4 text-center text-sm text-muted">
                  No rules yet — every lead will fall back to round robin.
                </p>
              )}
            </div>
          </div>
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
