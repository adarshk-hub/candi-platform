// path: components/settings/panels/StageEmailPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { STAGE_EMAIL_VARIABLES } from '@/lib/stageEmailRender'

type EmailMode = 'auto' | 'manual' | 'off'
interface Entry {
  mode: EmailMode
  subject: string
  body: string
}

// Local Octo only: write an email for any stage and choose how it's sent.
// Email needs no approval, so the wording is edited right here.
export default function StageEmailPanel({ clientId }: { clientId: string }) {
  const [stages, setStages] = useState<{ key: string; label: string }[]>([])
  const [config, setConfig] = useState<Record<string, Entry>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/clients/${clientId}/email-config`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pipeline-stages?clientId=${clientId}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([cfg, st]) => {
        setEnabled(cfg?.enabled !== false)
        setConfig(cfg?.config || {})
        setStages((Array.isArray(st) ? st : []).filter((s: any) => s.is_active !== false))
      })
      .finally(() => setLoading(false))
  }, [clientId])

  function entry(key: string): Entry {
    return config[key] || { mode: 'off', subject: '', body: '' }
  }
  function update(key: string, patch: Partial<Entry>) {
    setConfig((prev) => ({ ...prev, [key]: { ...entry(key), ...patch } }))
    setMessage('')
  }

  async function save() {
    // An Automatic / Ask stage with nothing written would never send — say so.
    const missing = stages.find((s) => entry(s.key).mode !== 'off' && (!entry(s.key).subject.trim() || !entry(s.key).body.trim()))
    if (missing) {
      setError(`Write a subject and message for "${missing.label}", or set it to Off.`)
      setOpen(missing.key)
      return
    }
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/email-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not save.')
        return
      }
      setConfig(b.config || config)
      setMessage('Saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>
  if (!enabled) return <p className="text-muted">Stage emails are not set up for this institute.</p>

  const modeLabel: Record<EmailMode, string> = { auto: 'Automatic', manual: 'Ask before sending', off: 'Off' }

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <h2 className="mb-1 text-lg font-bold text-fg">Stage Emails</h2>
      <p className="mb-2 text-sm text-muted2">
        Write an email for any stage. <b>Automatic</b> sends it as soon as the lead reaches the stage (for Lead, when a
        new lead comes in). <b>Ask before sending</b> shows a prompt when the stage is changed. <b>Off</b> never sends on
        its own, but you can still send it from the lead&apos;s Email tab. Emails go from the address in Settings → School
        Email.
      </p>
      <p className="mb-4 text-xs text-muted">
        Variables:{' '}
        {STAGE_EMAIL_VARIABLES.map((v) => (
          <code key={v.key} className="mr-2 rounded bg-card2 px-1 py-0.5" title={v.label}>
            {`{{${v.key}}}`}
          </code>
        ))}
      </p>

      <div className="divide-y divide-border rounded-md border border-border">
        {stages.map((s) => {
          const e = entry(s.key)
          const isOpen = open === s.key
          return (
            <div key={s.key} className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setOpen(isOpen ? null : s.key)} className="min-w-0 flex-1 text-left">
                  <div className="text-sm font-medium text-fg">{s.label}</div>
                  <div className="truncate text-xs text-muted">
                    {e.subject.trim() ? e.subject : 'No email written — click to write one'}
                  </div>
                </button>
                <select
                  value={e.mode}
                  onChange={(ev) => update(s.key, { mode: ev.target.value as EmailMode })}
                  className="w-48 rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                >
                  {(['auto', 'manual', 'off'] as EmailMode[]).map((m) => (
                    <option key={m} value={m}>
                      {modeLabel[m]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setOpen(isOpen ? null : s.key)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted2 hover:text-fg"
                >
                  {isOpen ? 'Close' : e.subject.trim() ? 'Edit' : 'Write'}
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2">
                  <input
                    value={e.subject}
                    onChange={(ev) => update(s.key, { subject: ev.target.value })}
                    placeholder="Subject, e.g. Thanks for your interest, {{name}}"
                    className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                  />
                  <textarea
                    value={e.body}
                    onChange={(ev) => update(s.key, { body: ev.target.value })}
                    rows={7}
                    placeholder={'Hi {{name}},\n\nThanks for your interest in Local Octo for {{company}}…'}
                    className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Stage Emails'}
        </button>
        {message && <span className="text-sm text-green-500">{message}</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  )
}
