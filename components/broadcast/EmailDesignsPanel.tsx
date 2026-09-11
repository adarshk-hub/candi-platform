// path: components/broadcast/EmailDesignsPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { EMAIL_TEMPLATE_PRESETS } from '@/lib/emailBroadcastTemplates'

// The email half of the Templates tab.
//
// Unlike WhatsApp, email needs no approval from anyone — the three designs
// are built in and always available. There is nothing to submit, so this is
// a gallery rather than a form: pick the one you want when you compose.
export default function EmailDesignsPanel({
  clientId,
  instituteName,
}: {
  clientId: string
  instituteName: string
}) {
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  // Bumped after an upload so the preview iframe refetches the image
  // instead of showing the cached previous logo.
  const [logoVersion, setLogoVersion] = useState(Date.now())
  const [hasLogo, setHasLogo] = useState<boolean | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const logoUrl = `/api/clients/${clientId}/email-logo?v=${logoVersion}`

  useEffect(() => {
    // A HEAD would be tidier, but the route only implements GET — and a
    // 404 here simply means no logo has been uploaded.
    fetch(logoUrl)
      .then((r) => setHasLogo(r.ok))
      .catch(() => setHasLogo(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, logoVersion])

  async function upload(file: File) {
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/clients/${clientId}/email-logo`, { method: 'POST', body: form })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not upload that logo.')
        return
      }
      setLogoVersion(Date.now())
    } finally {
      setUploading(false)
    }
  }

  async function removeLogo() {
    await fetch(`/api/clients/${clientId}/email-logo`, { method: 'DELETE' }).catch(() => {})
    setLogoVersion(Date.now())
  }
  const preview = EMAIL_TEMPLATE_PRESETS.find((p) => p.key === previewKey)

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">Email designs</h2>
        <p className="mt-1 text-sm text-muted2">
          No approval needed — unlike WhatsApp, email designs are ready to use. Choose one while composing a
          broadcast; your message is dropped into it and each recipient gets their own unsubscribe link.
        </p>
      </div>

      <div className="rounded-card border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-fg">Logo</h2>
        <p className="mt-1 text-sm text-muted2">
          Shown at the top of every email. Without one, the institute's initials are used instead.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-40 items-center justify-center rounded-md border border-border bg-white p-2">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Current logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-zinc-400">No logo</span>
            )}
          </div>

          <label className="cursor-pointer rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg">
            {hasLogo ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload(f)
                e.target.value = ''
              }}
              className="hidden"
            />
          </label>

          {hasLogo && (
            <button onClick={removeLogo} className="text-sm text-muted2 hover:text-red-400">
              Remove
            </button>
          )}

          {uploading && <span className="text-sm text-muted">Uploading…</span>}
        </div>

        {/* Displayed at 150px wide on a white tile, so a wide wordmark works
            better than a tall crest, and a dark logo reads better than a
            white one. */}
        <p className="mt-2 text-xs text-muted2">
          PNG, JPG or GIF, under 300 KB. Landscape works best — it's shown 150px wide on a white background.
        </p>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {EMAIL_TEMPLATE_PRESETS.map((p) => (
          <div key={p.key} className="rounded-card border border-border bg-card p-4">
            <p className="text-sm font-semibold text-fg">{p.name}</p>
            <p className="mt-1 text-xs text-muted2">{p.description}</p>
            <button
              onClick={() => setPreviewKey(previewKey === p.key ? null : p.key)}
              className={clsx(
                'mt-3 rounded-md border px-3 py-1.5 text-xs',
                previewKey === p.key ? 'border-blue-500 text-blue-300' : 'border-border text-muted2 hover:text-fg'
              )}
            >
              {previewKey === p.key ? 'Hide preview' : 'Preview'}
            </button>
          </div>
        ))}
      </div>

      {preview && (
        <div className="rounded-card border border-border bg-card2 p-2">
          {/* An iframe, not dangerouslySetInnerHTML — the email is a full
              document with its own styles, and injecting it into this page
              would let those styles leak into the app. */}
          <iframe
            title={`${preview.name} preview`}
            srcDoc={preview.build({
              institute: instituteName || 'Your school',
              parentName: 'Priya Sharma',
              body: 'This is how your message will look.\n\nLeave a blank line between paragraphs and each one is spaced like this.',
              ctaLabel: 'Book a campus visit',
              ctaUrl: '#',
              unsubscribeUrl: '#',
              logoUrl: hasLogo ? `${window.location.origin}${logoUrl}` : null,
            })}
            sandbox=""
            className="h-[520px] w-full rounded-md border border-border bg-white"
          />
        </div>
      )}
    </div>
  )
}
