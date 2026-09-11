// path: components/broadcast/BroadcastTemplatesPanel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react'
import { clsx } from 'clsx'

interface Template {
  id: string
  name: string
  category: string | null
  language: string
  status: string
  submitted_at: string | null
  rejection_reason: string | null
  bodyPreview?: string
}

const STATUS_ICON: Record<string, any> = {
  approved: CheckCircle2,
  pending: Clock,
  rejected: XCircle,
}

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-green-500/15 text-green-400',
  pending: 'bg-amber-500/15 text-amber-400',
  rejected: 'bg-red-500/15 text-red-400',
}

// Template approval, moved out of Settings.
//
// Approving a template is something you do *because* you are about to
// broadcast, not a configuration chore — having it two screens away in
// Settings meant hitting "no approved templates" in the composer and then
// going hunting for where to fix it.
//
// Only submission and approval status live here. Assigning templates to
// nurture steps stays in Settings > WhatsApp, because that is about the
// automated sequence rather than about sending a broadcast today.
export default function BroadcastTemplatesPanel({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/templates/${clientId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setTemplates(Array.isArray(rows) ? rows : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  useEffect(load, [load])

  async function run(label: string, url: string) {
    setBusy(label)
    setNotice('')
    setError('')
    try {
      const res = await fetch(url, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'That did not work.')
        return
      }
      setNotice(body.message || 'Done.')
      load()
    } catch (err: any) {
      setError(err?.message || 'Network error.')
    } finally {
      setBusy('')
    }
  }

  const counts = templates.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc as any)[t.status] + 1 }),
    { approved: 0, pending: 0, rejected: 0 } as Record<string, number>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">WhatsApp templates</h2>
        <p className="mt-1 text-sm text-muted2">
          Meta has to approve every template before it can be sent. Submit the starter set, then check back —
          approval usually takes minutes but can take a day.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => run('defaults', `/api/clients/${clientId}/whatsapp-templates/seed-defaults`)}
            disabled={!!busy}
            className="rounded-md border border-border bg-card2 px-4 py-2 text-sm text-fg hover:border-blue-500 disabled:opacity-50"
          >
            {busy === 'defaults' ? 'Submitting…' : 'Submit starter templates'}
          </button>
          <button
            onClick={() => run('operational', `/api/clients/${clientId}/whatsapp-templates/seed-operational`)}
            disabled={!!busy}
            className="rounded-md border border-border bg-card2 px-4 py-2 text-sm text-fg hover:border-blue-500 disabled:opacity-50"
          >
            {busy === 'operational' ? 'Submitting…' : 'Submit reminder templates'}
          </button>
          <button
            onClick={() => run('sync', `/api/templates/sync/${clientId}`)}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : undefined} />
            Check approval status
          </button>
        </div>

        {notice && <p className="mt-3 text-sm text-green-400">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <p className="mt-4 text-xs text-muted2">
          {counts.approved} approved · {counts.pending} awaiting Meta · {counts.rejected} rejected
        </p>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card">
        {templates.map((t) => {
          const Icon = STATUS_ICON[t.status] || Clock
          return (
            <div key={t.id} className="border-b border-border px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm text-fg">{t.name}</span>
                <span className={clsx('flex items-center gap-1 rounded-md px-2 py-0.5 text-xs', STATUS_STYLE[t.status])}>
                  <Icon size={12} />
                  {t.status}
                </span>
                <span className="text-xs uppercase tracking-wide text-muted">{t.category || '—'}</span>
                <span className="text-xs text-muted">{t.language}</span>
                {t.submitted_at && (
                  <span className="ml-auto text-xs text-muted">
                    Submitted {new Date(t.submitted_at).toLocaleDateString('en-IN')}
                  </span>
                )}
              </div>
              {/* Meta's rejection text is the only actionable thing about a
                  rejected template, so it is shown in full rather than
                  hidden behind a hover. */}
              {t.status === 'rejected' && t.rejection_reason && (
                <p className="mt-1 text-xs text-red-400">{t.rejection_reason}</p>
              )}
              {t.bodyPreview && <p className="mt-1 text-xs text-muted2">{t.bodyPreview}</p>}
            </div>
          )
        })}
        {templates.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {loading ? 'Loading…' : 'No templates submitted yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
