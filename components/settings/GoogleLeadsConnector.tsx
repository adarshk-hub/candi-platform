// path: components/settings/GoogleLeadsConnector.tsx
'use client'

import { useState } from 'react'
import { Copy, Check, RefreshCw } from 'lucide-react'

// Agency Settings card for Google Ads lead forms. A school only receives
// Google leads while this is switched on; the key shown here is what goes
// into the Google Ads lead form's webhook settings, together with the URL.
export default function GoogleLeadsConnector({
  clientId,
  webhookUrl,
  initialEnabled,
  initialKey,
}: {
  clientId: string
  webhookUrl: string
  initialEnabled: boolean
  initialKey: string | null
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [key, setKey] = useState(initialKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'' | 'url' | 'key'>('')

  async function save(body: Record<string, unknown>) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to save')
        return
      }
      setEnabled(!!data.google_leads_enabled)
      setKey(data.google_leads_key || null)
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  function copy(value: string, which: 'url' | 'key') {
    navigator.clipboard.writeText(value)
    setCopied(which)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="rounded-card border border-border bg-card2 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fg">Google Ads Lead Forms</h3>
          <p className="mt-1 text-sm text-muted2">
            Leads from Google Ads lead forms. Only received while this is on.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            enabled ? 'bg-green-500/15 text-green-400' : 'bg-card text-muted'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1 text-xs text-muted">Webhook URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-fg">
              {webhookUrl}
            </code>
            <button
              onClick={() => copy(webhookUrl, 'url')}
              className="shrink-0 rounded-md border border-border p-2 text-muted2 hover:text-fg"
              title="Copy"
            >
              {copied === 'url' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {key && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs text-muted">Key</p>
              <button
                onClick={() => {
                  if (confirm('Create a new key? The old key stops working, so the Google Ads lead form must be updated with the new one.')) {
                    save({ googleLeadsRegenerateKey: true })
                  }
                }}
                disabled={saving}
                className="flex items-center gap-1 text-xs text-muted2 hover:text-fg disabled:opacity-50"
              >
                <RefreshCw size={11} /> New key
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-fg">
                {key}
              </code>
              <button
                onClick={() => copy(key, 'key')}
                className="shrink-0 rounded-md border border-border p-2 text-muted2 hover:text-fg"
                title="Copy"
              >
                {copied === 'key' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => save({ googleLeadsEnabled: !enabled })}
          disabled={saving}
          className={`w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            enabled ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
          }`}
        >
          {saving ? 'Saving…' : enabled ? 'Turn off Google leads' : 'Turn on Google leads'}
        </button>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {enabled && (
          <p className="text-xs text-muted">
            In Google Ads, open the lead form &gt; webhook settings, paste this URL and key, then use “Send test data”.
            Test leads show in the CRM with “[TEST]” in front of the name.
          </p>
        )}
      </div>
    </div>
  )
}
