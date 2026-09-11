// path: components/broadcast/EmailDesignsPanel.tsx
'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { EMAIL_TEMPLATE_PRESETS } from '@/lib/emailBroadcastTemplates'

// The email half of the Templates tab.
//
// Unlike WhatsApp, email needs no approval from anyone — the three designs
// are built in and always available. There is nothing to submit, so this is
// a gallery rather than a form: pick the one you want when you compose.
export default function EmailDesignsPanel({ instituteName }: { instituteName: string }) {
  const [previewKey, setPreviewKey] = useState<string | null>(null)
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
            })}
            sandbox=""
            className="h-[520px] w-full rounded-md border border-border bg-white"
          />
        </div>
      )}
    </div>
  )
}
