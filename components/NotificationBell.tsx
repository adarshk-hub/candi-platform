// path: components/NotificationBell.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, MessageCircle, UserPlus } from 'lucide-react'
import { clsx } from 'clsx'
import { elapsedLabel } from '@/lib/format'
import {
  announceNotificationsChanged,
  markLeadRead,
  useNotifications,
  type NotificationItem,
} from '@/lib/useNotifications'

function Row({
  item,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem
  onOpen: (leadId: string) => void
  onDismiss: (leadId: string) => void
}) {
  const isMessage = item.type === 'wa_message'
  const Icon = isMessage ? MessageCircle : UserPlus

  return (
    <div className="group flex w-full items-start gap-2 rounded-md px-1 hover:bg-card2">
      <button onClick={() => onOpen(item.leadId)} className="flex flex-1 items-start gap-3 px-2 py-2.5 text-left">
        <span
          className={clsx(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            isMessage ? 'bg-green-500/15 text-green-500' : 'bg-blue-500/15 text-blue-500'
          )}
        >
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg">
            {isMessage ? 'New WhatsApp message' : 'New lead'}
            <span className="ml-1.5 font-mono text-xs text-green-500">#{item.leadNumber}</span>
          </span>
          <span className="block truncate text-xs font-medium text-blue-400">{item.leadName}</span>
          {item.body && <span className="block truncate text-xs text-muted2">{item.body}</span>}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted">{elapsedLabel(item.createdAt)}</span>
      </button>

      {/* Dismissing is its own deliberate action, separate from opening the
          lead. Opening used to clear the notification by itself, which meant
          a glance at a lead silently emptied the bell — there was no way to
          look at something and still keep it on the list. */}
      <button
        onClick={() => onDismiss(item.leadId)}
        title="Dismiss this notification"
        className="mt-2.5 shrink-0 rounded-md p-1.5 text-muted opacity-0 transition-opacity hover:bg-card hover:text-green-400 group-hover:opacity-100"
      >
        <Check size={14} />
      </button>
    </div>
  )
}

export default function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { items, total } = useNotifications({ poll: true })

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Jumps to the lead but leaves the notification alone. Someone checking
  // who a lead is, then coming back to work through the rest of the list,
  // shouldn't lose their place.
  function openLead(leadId: string) {
    setOpen(false)
    router.push(`/leads?highlight=${leadId}`)
  }

  function dismiss(leadId: string) {
    markLeadRead(leadId)
  }

  async function clearAll() {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
    announceNotificationsChanged()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label={total > 0 ? `Notifications (${total} unread)` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted2 hover:text-fg"
      >
        <Bell size={17} />
        {total > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-card border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            {total > 0 && (
              <button onClick={clearAll} className="text-xs text-muted2 hover:text-fg">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto p-1">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">You're all caught up.</p>
            ) : (
              items.map((item) => <Row key={item.id} item={item} onOpen={openLead} onDismiss={dismiss} />)
            )}
          </div>

          {items.length > 0 && (
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted">
              Notifications stay until you dismiss them with the tick.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
