// path: components/settings/panels/SmsSettingsPanel.tsx
'use client'

import { useEffect, useState } from 'react'

type SmsMode = 'auto' | 'manual' | 'off'

interface SmsTemplateRow {
  stage: string
  name: string
  text: string
}

// Local Octo only: per stage, whether its MSG91 SMS goes out automatically,
// asks first, or is off. The templates are DLT-approved and fixed, so only
// the mode can be changed here.
export default function SmsSettingsPanel({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [modes, setModes] = useState<Record<string, SmsMode>>({})
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/clients/${clientId}/sms-config`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pipeline-stages?clientId=${clientId}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([cfg, stages]) => {
        setTemplates(cfg?.templates || [])
        setModes(cfg?.modes || {})
        const map: Record<string, string> = {}
        for (const s of Array.isArray(stages) ? stages : []) map[s.key] = s.label
        setLabels(map)
      })
      .finally(() => setLoading(false))
  }, [clientId])

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/sms-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modes }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not save.')
        return
      }
      setModes(body.modes || modes)
      setMessage('Saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>
  if (templates.length === 0) return <p className="text-muted">SMS is not set up for this institute.</p>

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <h2 className="mb-1 text-lg font-bold text-fg">SMS (MSG91)</h2>
      <p className="mb-4 text-sm text-muted2">
        Choose how each stage&apos;s SMS is sent. <b>Automatic</b> sends it as soon as the lead reaches the stage (for
        Lead, when a new lead comes in). <b>Ask before sending</b> shows a prompt when the stage is changed.{' '}
        <b>Off</b> never sends. The wording is fixed by DLT; names, company, dates and amounts are filled from the lead.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted">
              <th className="px-3 py-2">CRM Stage</th>
              <th className="px-3 py-2">SMS</th>
              <th className="px-3 py-2">Send</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {templates.map((t) => (
              <tr key={t.stage} className="align-top">
                <td className="px-3 py-3 text-fg">
                  {labels[t.stage] || t.stage}
                  <div className="text-xs text-muted">Key: {t.stage}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-mono text-xs text-muted">{t.name}</div>
                  <div className="mt-1 max-w-xl text-xs text-muted2">{t.text}</div>
                </td>
                <td className="px-3 py-3">
                  <select
                    value={modes[t.stage] || 'off'}
                    onChange={(e) => setModes((prev) => ({ ...prev, [t.stage]: e.target.value as SmsMode }))}
                    className="w-48 rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg outline-none focus:border-blue-500"
                  >
                    <option value="auto">Automatic</option>
                    <option value="manual">Ask before sending</option>
                    <option value="off">Off</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save SMS Settings'}
        </button>
        {message && <span className="text-sm text-green-500">{message}</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  )
}
