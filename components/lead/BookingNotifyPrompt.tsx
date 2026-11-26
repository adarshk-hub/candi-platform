// path: components/lead/BookingNotifyPrompt.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarCheck, X } from 'lucide-react'

const LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' }

// Local Octo only: right after a call is booked, offers the booking messages
// set to "Ask before sending" in Settings > Booking Reminders. Finishes
// straight away when there are none (other schools, or all Automatic/Off).
export default function BookingNotifyPrompt({
  leadId,
  eventId,
  onDone,
}: {
  leadId: string
  eventId: string
  onDone: () => void
}) {
  const [channels, setChannels] = useState<{ channel: string; preview: string }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [show, setShow] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const done = () => onDoneRef.current()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leads/${leadId}/booking-notify?eventId=${encodeURIComponent(eventId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const list = d?.channels || []
        if (list.length === 0) {
          done()
          return
        }
        setChannels(list)
        setPicked(new Set(list.map((c: any) => c.channel)))
        setShow(true)
      })
      .catch(() => {
        if (!cancelled) done()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, eventId])

  async function send() {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/${leadId}/booking-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, channels: Array.from(picked) }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Not sent.')
        return
      }
      done()
    } finally {
      setSending(false)
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
            <CalendarCheck size={18} className="text-green-500" />
            Send the booking confirmation?
          </h2>
          <button onClick={done} className="text-muted2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {channels.map((c) => (
            <label key={c.channel} className="block cursor-pointer rounded-md border border-border p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium text-fg">
                <input
                  type="checkbox"
                  checked={picked.has(c.channel)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(c.channel)) next.delete(c.channel)
                      else next.add(c.channel)
                      return next
                    })
                  }
                />
                {LABEL[c.channel] || c.channel}
              </div>
              <p className="whitespace-pre-wrap text-xs text-muted2">{c.preview}</p>
            </label>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={done}
            disabled={sending}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg disabled:opacity-50"
          >
            Don&apos;t send
          </button>
          <button
            onClick={send}
            disabled={sending || picked.size === 0}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
