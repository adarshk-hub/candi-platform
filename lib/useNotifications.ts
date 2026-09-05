'use client'

import { useCallback, useEffect, useState } from 'react'

export interface NotificationItem {
  id: string
  type: 'new_lead' | 'wa_message'
  leadId: string
  leadNumber: number
  leadName: string
  body: string | null
  createdAt: string
}

export interface NotificationFeed {
  items: NotificationItem[]
  unreadByLead: Record<string, number>
  total: number
}

const EMPTY: NotificationFeed = { items: [], unreadByLead: {}, total: 0 }

// Broadcast whenever read state changes anywhere in the app, so the bell
// and the leads list stay in step without threading state through a
// provider. Opening a lead clears its badge and its bell entries at the
// same moment, which is the behaviour that makes the two feel like one
// thing rather than two counters that drift apart.
export const NOTIFICATIONS_CHANGED = 'cc-notifications-changed'

export function announceNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}

// Marks one lead's notifications read and tells every listener to refresh.
// Safe to call repeatedly — the server upserts, so re-opening an already
// read lead is a no-op.
export async function markLeadRead(leadId: string): Promise<void> {
  try {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    })
  } catch {
    // Non-critical: the badge just stays until the next successful call.
  }
  announceNotificationsChanged()
}

export function useNotifications({ poll = false }: { poll?: boolean } = {}) {
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setFeed({
        items: data.items || [],
        unreadByLead: data.unreadByLead || {},
        total: data.total || 0,
      })
    } catch {
      // Leave the last known feed in place rather than blanking the bell
      // on a single failed poll.
    }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh)
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refresh)
  }, [refresh])

  useEffect(() => {
    if (!poll) return
    // 30s is frequent enough that a counsellor sees a reply while the
    // parent is still typing, without every open tab hammering the DB.
    const timer = setInterval(refresh, 30000)
    // A tab left open in the background stops mattering; refresh the
    // moment it's looked at again so the count is never stale on return.
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [poll, refresh])

  return { ...feed, refresh }
}
