// path: components/inbox/InboxShell.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Inbox, Mail, MessageCircle, RefreshCw, Search, Send, X } from 'lucide-react'
import { clsx } from 'clsx'
import LeadSlideOver from '@/components/lead/LeadSlideOver'
import NotificationBell from '@/components/NotificationBell'

// Two channels at the top level. Inbox and Sent are two views of the same
// mailbox, not two separate places, so they sit inside Email rather than
// beside it — otherwise WhatsApp looks like one third of the screen's
// subject matter when it's actually one half.
type Channel = 'email' | 'whatsapp'
type Box = 'inbox' | 'sent'

interface EmailRow {
  id: string
  lead_id: string | null
  direction: string
  subject: string
  body: string
  to_email: string
  from_email: string | null
  status: string
  is_read: boolean
  created_at: string
  received_at: string | null
  lead_name: string | null
  lead_number: number | null
  sent_by_name: string | null
}

interface Conversation {
  lead_id: string
  body: string
  direction: string
  created_at: string
  full_name: string
  lead_number: number
  whatsapp_number: string
  counsellor_name: string | null
  recent_inbound: number
}

interface WaMessage {
  id: string
  direction: string
  message_type: string
  body: string
  status: string
  created_at: string
  template_name: string | null
  sent_by_name: string | null
}

function when(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function InboxShell() {
  const [channel, setChannel] = useState<Channel>('email')
  const [box, setBox] = useState<Box>('inbox')
  const [search, setSearch] = useState('')
  const [emails, setEmails] = useState<EmailRow[]>([])
  const [unread, setUnread] = useState(0)
  const [openEmail, setOpenEmail] = useState<EmailRow | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [threadLead, setThreadLead] = useState<any | null>(null)
  const [threadMessages, setThreadMessages] = useState<WaMessage[]>([])
  const [reply, setReply] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [activeLead, setActiveLead] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    if (channel === 'whatsapp') {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      fetch(`/api/inbox/whatsapp?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setConversations(data?.conversations || [])
          setLoading(false)
        })
        .catch(() => setLoading(false))
      return
    }

    const params = new URLSearchParams({ box })
    if (search) params.set('search', search)
    fetch(`/api/inbox/email?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setEmails(data?.rows || [])
        setUnread(data?.unread || 0)
        setNotice(data?.error || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [channel, box, search])

  useEffect(load, [load])

  const loadThread = useCallback(() => {
    if (!openThread) return
    fetch(`/api/inbox/whatsapp?leadId=${openThread}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setThreadMessages(data?.messages || [])
        setThreadLead(data?.lead || null)
      })
      .catch(() => {})
  }, [openThread])

  useEffect(loadThread, [loadThread])

  // Replies go through the existing per-lead endpoint rather than a new one,
  // so the 24-hour window check, the tracked-link rewrite and the nurture
  // pause all still happen — this screen is a different door to the same
  // send, not a second implementation of it.
  async function sendReply() {
    if (!openThread || !reply.trim()) return
    setReplySending(true)
    setReplyError('')
    try {
      const res = await fetch(`/api/leads/${openThread}/whatsapp/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setReplyError(body.error || 'Could not send that message.')
        return
      }
      setReply('')
      loadThread()
      load()
    } finally {
      setReplySending(false)
    }
  }

  async function sync() {
    setSyncing(true)
    setNotice('')
    try {
      const res = await fetch('/api/inbox/email/sync', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(body.error || 'Could not reach the mailbox.')
        return
      }
      setNotice(
        body.fetched > 0
          ? `${body.fetched} new message${body.fetched === 1 ? '' : 's'}, ${body.matched} matched to a lead.`
          : 'Nothing new.'
      )
      load()
    } finally {
      setSyncing(false)
    }
  }

  async function openMessage(row: EmailRow) {
    setOpenEmail(row)
    if (!row.is_read && row.direction === 'inbound') {
      await fetch('/api/inbox/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      }).catch(() => {})
      setEmails((prev) => prev.map((e) => (e.id === row.id ? { ...e, is_read: true } : e)))
      setUnread((n) => Math.max(0, n - 1))
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Inbox size={22} /> Inbox
        </h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-64 rounded-md border border-border bg-card2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <NotificationBell />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          { key: 'email' as Channel, label: 'Email', icon: Mail },
          { key: 'whatsapp' as Channel, label: 'WhatsApp', icon: MessageCircle },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setChannel(t.key)
              setOpenEmail(null)
              setOpenThread(null)
            }}
            className={clsx(
              'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              channel === t.key ? 'bg-blue-500 text-white' : 'text-muted2 hover:text-fg'
            )}
          >
            <t.icon size={15} />
            {t.label}
            {t.key === 'email' && unread > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>
            )}
          </button>
        ))}

        {channel === 'email' && (
          <div className="ml-auto flex items-center gap-2">
            {/* Inbox / Sent as a segmented switch: same mailbox, two
                directions, so it reads as a filter rather than navigation. */}
            <div className="flex overflow-hidden rounded-md border border-border">
              {([
                { key: 'inbox' as Box, label: 'Inbox' },
                { key: 'sent' as Box, label: 'Sent' },
              ]).map((b) => (
                <button
                  key={b.key}
                  onClick={() => {
                    setBox(b.key)
                    setOpenEmail(null)
                  }}
                  className={clsx(
                    'px-3 py-2 text-sm',
                    box === b.key ? 'bg-card2 font-medium text-fg' : 'text-muted2 hover:text-fg'
                  )}
                >
                  {b.label}
                  {b.key === 'inbox' && unread > 0 ? ` (${unread})` : ''}
                </button>
              ))}
            </div>
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted2 hover:text-fg disabled:opacity-50"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : undefined} /> Refresh
            </button>
            <button
              onClick={() => setComposing(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Compose
            </button>
          </div>
        )}
      </div>

      {notice && <p className="mb-4 rounded-card border border-border bg-card p-3 text-sm text-muted2">{notice}</p>}

      {channel === 'whatsapp' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {conversations.map((c) => (
              <button
                key={c.lead_id}
                onClick={() => {
                  setOpenThread(c.lead_id)
                  setReply('')
                  setReplyError('')
                }}
                className={clsx(
                  'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-card2',
                  openThread === c.lead_id && 'bg-card2'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{c.full_name}</span>
                  <span className="shrink-0 text-[11px] text-muted">{when(c.created_at)}</span>
                </div>
                <p className="truncate text-xs text-muted2">
                  {c.direction === 'inbound' ? '' : 'You: '}
                  {c.body}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span>{c.whatsapp_number}</span>
                  {c.counsellor_name && <span>· {c.counsellor_name}</span>}
                  {c.recent_inbound > 0 && (
                    <span className="rounded-full bg-green-500/20 px-1.5 text-green-400">replied today</span>
                  )}
                </div>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {loading ? 'Loading…' : 'No WhatsApp conversations yet.'}
              </p>
            )}
          </div>

          <div className="rounded-card border border-border bg-card p-4">
            {!openThread ? (
              <p className="py-16 text-center text-sm text-muted">Pick a conversation to read it.</p>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <p className="text-sm font-semibold text-fg">
                      {threadLead?.full_name || 'Conversation'}
                    </p>
                    {threadLead && (
                      <p className="text-xs text-muted2">
                        {threadLead.whatsapp_number}
                        {threadLead.counsellor_name ? ` · ${threadLead.counsellor_name}` : ' · unassigned'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setActiveLead(openThread)}
                    className="text-sm text-blue-400 hover:underline"
                  >
                    Open lead
                  </button>
                </div>
                <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                  {threadMessages.map((m) => (
                    <div
                      key={m.id}
                      className={clsx(
                        'max-w-[80%] rounded-card px-3 py-2 text-sm',
                        m.direction === 'inbound'
                          ? 'bg-card2 text-fg'
                          : 'ml-auto bg-blue-500/15 text-fg'
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-[11px] text-muted">
                        {when(m.created_at)}
                        {m.sent_by_name ? ` · ${m.sent_by_name}` : ''}
                        {m.message_type === 'template' ? ' · template' : ''}
                      </p>
                    </div>
                  ))}
                  {threadMessages.length === 0 && (
                    <p className="py-10 text-center text-sm text-muted">No messages in this thread.</p>
                  )}
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      rows={2}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter sends, Shift+Enter breaks the line — the
                        // convention people already have from WhatsApp itself.
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendReply()
                        }
                      }}
                      placeholder="Type a reply…"
                      className="flex-1 resize-none rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={sendReply}
                      disabled={replySending || !reply.trim()}
                      className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      <Send size={15} /> {replySending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                  {replyError && (
                    <p className="mt-2 text-sm text-red-400">
                      {replyError}
                      {/* The 24-hour rule is Meta's, not ours, and the only
                          way out of it is an approved template — which lives
                          on the lead's WhatsApp tab. */}
                      {replyError.includes('24-hour') && (
                        <button
                          onClick={() => setActiveLead(openThread)}
                          className="ml-1 text-blue-400 hover:underline"
                        >
                          Send a template instead
                        </button>
                      )}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {emails.map((e) => (
            <button
              key={e.id}
              onClick={() => openMessage(e)}
              className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-card2"
            >
              <span
                className={clsx(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  e.direction === 'inbound' && !e.is_read ? 'bg-blue-500' : 'bg-transparent'
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={clsx('truncate text-sm', e.is_read ? 'text-muted2' : 'font-semibold text-fg')}>
                    {e.direction === 'inbound' ? e.from_email || 'Unknown sender' : e.to_email}
                  </span>
                  {e.lead_name && (
                    <span className="shrink-0 rounded-md bg-blue-500/15 px-1.5 text-[11px] text-blue-300">
                      #{e.lead_number} {e.lead_name}
                    </span>
                  )}
                  {e.status === 'failed' && (
                    <span className="shrink-0 text-[11px] text-red-400">failed</span>
                  )}
                </span>
                <span className="block truncate text-sm text-fg">{e.subject}</span>
                <span className="block truncate text-xs text-muted2">{e.body.slice(0, 120)}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-muted">
                {when(e.received_at || e.created_at)}
              </span>
            </button>
          ))}
          {emails.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {loading ? 'Loading…' : box === 'sent' ? 'Nothing sent yet.' : 'Nothing here — press Refresh to check the mailbox.'}
            </p>
          )}
        </div>
      )}

      {openEmail && (
        <EmailReader
          email={openEmail}
          onClose={() => setOpenEmail(null)}
          onOpenLead={(id) => {
            setOpenEmail(null)
            setActiveLead(id)
          }}
          onReplied={() => {
            setOpenEmail(null)
            load()
          }}
        />
      )}

      {composing && (
        <Composer
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false)
            setBox('sent')
          }}
        />
      )}

      {activeLead && <LeadSlideOver leadId={activeLead} onClose={() => setActiveLead(null)} />}
    </div>
  )
}

function EmailReader({
  email,
  onClose,
  onOpenLead,
  onReplied,
}: {
  email: EmailRow
  onClose: () => void
  onOpenLead: (leadId: string) => void
  onReplied: () => void
}) {
  const [replying, setReplying] = useState(false)

  if (replying) {
    return (
      <Composer
        onClose={() => setReplying(false)}
        onSent={onReplied}
        initialTo={email.direction === 'inbound' ? email.from_email || '' : email.to_email}
        // "Re: Re: Re:" is what happens when a reply subject is built blindly,
        // so an existing Re: prefix is left alone.
        initialSubject={email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`}
        leadId={email.lead_id}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-fg">{email.subject}</h2>
            <p className="mt-1 text-xs text-muted2">
              {email.direction === 'inbound' ? `From ${email.from_email}` : `To ${email.to_email}`} ·{' '}
              {when(email.received_at || email.created_at)}
              {email.sent_by_name ? ` · sent by ${email.sent_by_name}` : ''}
            </p>
            {email.lead_id && (
              <button
                onClick={() => onOpenLead(email.lead_id!)}
                className="mt-1 text-xs text-blue-400 hover:underline"
              >
                Open lead #{email.lead_number} — {email.lead_name}
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-muted2 hover:text-fg">
            <X size={20} />
          </button>
        </div>

        <p className="whitespace-pre-wrap text-sm text-fg">{email.body}</p>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg">
            Close
          </button>
          <button
            onClick={() => setReplying(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  )
}

function Composer({
  onClose,
  onSent,
  initialTo = '',
  initialSubject = '',
  leadId = null,
}: {
  onClose: () => void
  onSent: () => void
  initialTo?: string
  initialSubject?: string
  leadId?: string | null
}) {
  const [to, setTo] = useState(initialTo)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setError('Fill in the recipient, subject and message.')
      return
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/inbox/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body, leadId }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(b.error || 'Could not send.')
        return
      }
      onSent()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">{initialSubject ? 'Reply' : 'New email'}</h2>
          <button onClick={onClose} className="text-muted2 hover:text-fg">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">To</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="parent@example.com"
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Message</label>
            <textarea
              value={body}
              rows={10}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-border bg-card2 px-3 py-2 text-sm text-fg outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted2 hover:text-fg">
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Send size={15} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
