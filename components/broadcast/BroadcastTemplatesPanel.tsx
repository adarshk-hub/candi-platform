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
  const [name, setName] = useState('')
  const [category, setCategory] = useState('UTILITY')
  const [body, setBody] = useState('')

  async function submitTemplate() {
    setBusy('submit')
    setNotice('')
    setError('')
    try {
      const res = await fetch('/api/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          name: name.trim(),
          category,
          language: 'en',
          components: [{ type: 'BODY', text: body.trim() }],
        }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not submit that template.')
        return
      }
      setNotice(`Submitted "${name.trim()}" to Meta. Approval usually takes a few minutes.`)
      setName('')
      setBody('')
      load()
    } catch (err: any) {
      setError(err?.message || 'Network error.')
    } finally {
      setBusy('')
    }
  }

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

        {/* The "submit starter templates" and "submit reminder templates"
            buttons are gone. They generated names from the institute's name
            — CANDID_day0_welcome — and Meta only accepts lower-case letters
            and underscores, so every one came back rejected. A button whose
            only outcome is a rejection is worse than no button: it looks
            like the system is broken rather than like nothing was set up.
            Write the templates you actually want below instead. */}
        <div className="mt-4 flex flex-wrap gap-2">
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

      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">New template</h2>
        <p className="mt-1 text-sm text-muted2">
          Meta requires the name to be lower-case letters, numbers and underscores only — it's corrected as you
          type. Use <span className="font-mono text-fg">{'{{1}}'}</span> where the parent's name should go.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Template name</label>
            <input
              value={name}
              // Corrected on the way in rather than validated on submit:
              // the rule is Meta's, it is not negotiable, and a rejection
              // takes minutes to come back.
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="summer_offer_2026"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 font-mono text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            >
              <option value="UTILITY">Utility — updates about something in progress</option>
              <option value="MARKETING">Marketing — offers and promotion</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-muted">Message</label>
          <textarea
            value={body}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{1}}, admissions for the new session are now open..."
            className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
          />
          {/* Marketing templates cost roughly 7x what utility ones do
              (₹1.09 vs ₹0.145), so the category is a pricing decision as
              much as a compliance one. */}
          {category === 'MARKETING' && (
            <p className="mt-1 text-xs text-amber-500">
              Marketing templates cost about 7× a utility one to send, and Meta rejects them more often.
            </p>
          )}
        </div>

        <button
          onClick={submitTemplate}
          disabled={!name.trim() || !body.trim() || !!busy}
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
        </button>
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
