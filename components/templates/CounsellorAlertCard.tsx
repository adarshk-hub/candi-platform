// path: components/templates/CounsellorAlertCard.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, RefreshCw } from 'lucide-react'

// Counsellor alerts (new lead, call or visit booked) go to staff, and
// WhatsApp only delivers plain text to someone who messaged the school in
// the last 24 hours — which a counsellor never has. So the alerts need one
// approved template, and this is the one-click way to get it, rather than
// asking somebody to hand-write a template with the exact right name.
export default function CounsellorAlertCard({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<string>('loading')
  const [templates, setTemplates] = useState<
    { name: string; purpose: string; body: string; status: string; rejectionReason: string | null }[]
  >([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch(`/api/templates/counsellor-alert?clientId=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setStatus(d?.status || 'none')
        setTemplates(Array.isArray(d?.templates) ? d.templates : [])
      })
      .catch(() => setStatus('none'))
  }, [clientId])

  useEffect(load, [load])

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/templates/counsellor-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not submit the alert template.')
        return
      }
      load()
    } catch (err: any) {
      setError(err?.message || 'Network error — could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  const label =
    status === 'approved'
      ? 'Approved — counsellor alerts are being delivered.'
      : status === 'pending'
        ? 'Submitted — waiting for Meta to approve it. Alerts start once approved.'
        : status === 'rejected'
          ? 'Meta rejected one of them — see below, then submit again.'
          : 'Not set up yet — counsellors with a WhatsApp number saved will not receive alerts.'

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
        <BellRing size={17} /> Counsellor alerts
      </h2>
      <p className="mt-1 text-sm text-muted2">
        Sends a WhatsApp message to a counsellor when a new lead arrives, or when a call or visit is booked on one of
        their leads. Add the number under Settings &gt; Counsellors; this template is what lets WhatsApp deliver it at
        any time of day.
      </p>

      <p
        className={`mt-3 text-sm ${
          status === 'approved' ? 'text-green-500' : status === 'rejected' ? 'text-red-400' : 'text-amber-500'
        }`}
      >
        {status === 'loading' ? 'Checking…' : label}
      </p>

      {templates.length > 0 && (
        <div className="mt-3 space-y-2">
          {templates.map((t) => (
            <div key={t.name} className="rounded-md border border-border bg-card2 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-fg">{t.name}</span>
                <span className="text-muted2">— {t.purpose}</span>
                <span
                  className={
                    t.status === 'approved'
                      ? 'text-green-500'
                      : t.status === 'rejected'
                        ? 'text-red-400'
                        : 'text-amber-500'
                  }
                >
                  {t.status === 'none' ? 'not submitted' : t.status}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted2">{t.body}</p>
              {t.rejectionReason && <p className="mt-1 text-red-400">Meta said: {t.rejectionReason}</p>}
            </div>
          ))}
        </div>
      )}

      {status !== 'approved' && status !== 'loading' && (
        <button
          onClick={submit}
          disabled={busy}
          className="mt-3 flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Submitting…' : status === 'pending' ? 'Check again' : 'Set up counsellor alerts'}
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
