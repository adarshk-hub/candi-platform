// path: components/broadcast/BroadcastTemplatesPanel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, Paperclip, RefreshCw, XCircle } from 'lucide-react'
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
  // Optional media at the top of the message. Meta calls this the header,
  // and an image or PDF there is what turns a fee list or an invitation
  // into something a parent can actually open.
  const [headerType, setHeaderType] = useState<'none' | 'text' | 'image' | 'document'>('none')
  const [headerText, setHeaderText] = useState('')
  const [headerFile, setHeaderFile] = useState<File | null>(null)
  const [headerHandle, setHeaderHandle] = useState<string | null>(null)
  const [headerMediaData, setHeaderMediaData] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // Rejected templates can never be sent, so they are noise in a list whose
  // job is "what can I use". Kept rather than auto-deleted, because the
  // rejection reason is the only way to learn what Meta objected to.
  const [showRejected, setShowRejected] = useState(false)

  // Meta approves a template against a *sample* file, then wants the real
  // file re-uploaded on every send. So two things are kept: the handle Meta
  // returns for approval, and the bytes themselves for later sends.
  async function uploadHeaderMedia(file: File) {
    setHeaderFile(file)
    setHeaderHandle(null)
    setHeaderMediaData(null)
    setUploading(true)
    setError('')
    try {
      const [handle, base64] = await Promise.all([
        (async () => {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch(`/api/clients/${clientId}/templates/upload-media`, {
            method: 'POST',
            body: form,
          })
          const b = await res.json().catch(() => ({}))
          if (!res.ok || !b.ok) throw new Error(b.error || 'Meta rejected the sample file.')
          return b.handle as string
        })(),
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          // Strip the "data:<mime>;base64," prefix — only the payload is
          // stored, with mime and filename kept separately.
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
          reader.onerror = () => reject(new Error('Could not read that file.'))
          reader.readAsDataURL(file)
        }),
      ])
      setHeaderHandle(handle)
      setHeaderMediaData(base64)
    } catch (err: any) {
      setError(err?.message || 'Could not upload that file.')
      setHeaderFile(null)
    } finally {
      setUploading(false)
    }
  }

  async function submitTemplate() {
    const components: any[] = []
    if (headerType === 'text' && headerText.trim()) {
      components.push({ type: 'HEADER', format: 'TEXT', text: headerText.trim() })
    } else if ((headerType === 'image' || headerType === 'document') && headerHandle) {
      components.push({
        type: 'HEADER',
        format: headerType.toUpperCase(),
        example: { header_handle: [headerHandle] },
      })
    }
    components.push({ type: 'BODY', text: body.trim() })

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
          components,
          headerFormat: headerType === 'none' ? null : headerType.toUpperCase(),
          headerText: headerType === 'text' ? headerText.trim() : null,
          headerMediaData: headerType === 'image' || headerType === 'document' ? headerMediaData : null,
          headerMediaMime: headerFile?.type || null,
          headerMediaFilename: headerFile?.name || null,
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

  async function removeTemplate(id?: string) {
    const url = id
      ? `/api/templates/${clientId}?id=${id}`
      : `/api/templates/${clientId}?all=rejected`
    setBusy('delete')
    setError('')
    try {
      const res = await fetch(url, { method: 'DELETE' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not remove that template.')
        return
      }
      load()
    } finally {
      setBusy('')
    }
  }

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

  // Rejected ones are hidden unless asked for: the list exists to answer
  // "which templates can I send", and six permanent failures crowd out the
  // one that works.
  const visible = showRejected ? templates : templates.filter((t) => t.status !== 'rejected')

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

        <p className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted2">
          <span>
            {counts.approved} approved · {counts.pending} awaiting Meta · {counts.rejected} rejected
          </span>
          {counts.rejected > 0 && (
            <>
              <button onClick={() => setShowRejected((v) => !v)} className="text-blue-400 hover:underline">
                {showRejected ? 'Hide rejected' : `Show ${counts.rejected} rejected`}
              </button>
              <button
                onClick={() => removeTemplate()}
                disabled={!!busy}
                className="text-red-400 hover:underline disabled:opacity-50"
              >
                Delete all rejected
              </button>
            </>
          )}
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

        <div className="mt-4">
          <label className="mb-1 block text-xs text-muted">Attachment (optional)</label>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: 'none' as const, label: 'None' },
              { key: 'text' as const, label: 'Heading' },
              { key: 'image' as const, label: 'Image' },
              { key: 'document' as const, label: 'PDF' },
            ]).map((h) => (
              <button
                key={h.key}
                onClick={() => {
                  setHeaderType(h.key)
                  setHeaderFile(null)
                  setHeaderHandle(null)
                  setHeaderMediaData(null)
                }}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs',
                  headerType === h.key
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-border text-muted2 hover:text-fg'
                )}
              >
                {h.label}
              </button>
            ))}
          </div>

          {headerType === 'text' && (
            <input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Admissions now open"
              className="mt-2 w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          )}

          {(headerType === 'image' || headerType === 'document') && (
            <div className="mt-2">
              <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted2 hover:text-fg">
                <Paperclip size={14} />
                {headerFile ? 'Choose a different file' : headerType === 'image' ? 'Choose an image' : 'Choose a PDF'}
                <input
                  type="file"
                  accept={headerType === 'image' ? 'image/jpeg,image/png' : 'application/pdf'}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadHeaderMedia(f)
                    e.target.value = ''
                  }}
                  className="hidden"
                />
              </label>
              {uploading && <p className="mt-1 text-xs text-muted">Uploading sample to Meta…</p>}
              {headerFile && headerHandle && (
                <p className="mt-1 text-xs text-green-400">{headerFile.name} — ready</p>
              )}
              {/* Meta approves the template against this sample, and the
                  real file is sent with each message. Parents see whatever
                  is attached at send time, not this one. */}
              <p className="mt-1 text-xs text-muted2">
                {headerType === 'image' ? 'JPG or PNG.' : 'PDF.'} Meta approves the template against this sample
                file.
              </p>
            </div>
          )}
        </div>

        <button
          onClick={submitTemplate}
          disabled={
            !name.trim() ||
            !body.trim() ||
            !!busy ||
            uploading ||
            ((headerType === 'image' || headerType === 'document') && !headerHandle)
          }
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-card">
        {visible.map((t) => {
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
              {t.status === 'rejected' && (
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {t.rejection_reason && <p className="text-xs text-red-400">{t.rejection_reason}</p>}
                  <button
                    onClick={() => removeTemplate(t.id)}
                    disabled={!!busy}
                    className="text-xs text-muted2 hover:text-red-400 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
              {t.bodyPreview && <p className="mt-1 text-xs text-muted2">{t.bodyPreview}</p>}
            </div>
          )
        })}
        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {loading
              ? 'Loading…'
              : templates.length > 0
              ? 'Nothing approved or pending — only rejected templates, hidden above.'
              : 'No templates submitted yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
