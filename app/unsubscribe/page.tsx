// path: app/unsubscribe/page.tsx
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

// The page the unsubscribe link in every broadcast footer opens.
//
// Public, and outside the app's authenticated layout — the person clicking
// it is a parent with no login. It asks for one confirming click rather than
// acting on load, because mail clients and scanners open links in messages
// automatically and would otherwise unsubscribe people who never clicked.
export default function UnsubscribePage() {
  const token = useSearchParams().get('t') || ''
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  async function confirm() {
    setState('working')
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setState(res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-card border border-border bg-card p-8 text-center">
      {state === 'done' ? (
        <>
          <h1 className="text-xl font-bold text-fg">You've been unsubscribed</h1>
          <p className="mt-2 text-sm text-muted2">
            You won't receive any more broadcast emails from us. If you're in the middle of an admission, the
            school may still contact you directly about it.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-fg">Unsubscribe from emails?</h1>
          <p className="mt-2 text-sm text-muted2">
            You'll stop receiving newsletters and announcements. This won't cancel anything else.
          </p>
          {!token && <p className="mt-3 text-sm text-red-400">This link is missing its code — check the email again.</p>}
          {state === 'error' && <p className="mt-3 text-sm text-red-400">Something went wrong. Try again.</p>}
          <button
            onClick={confirm}
            disabled={!token || state === 'working'}
            className="mt-5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {state === 'working' ? 'Unsubscribing…' : 'Yes, unsubscribe me'}
          </button>
        </>
      )}
    </div>
  )
}
