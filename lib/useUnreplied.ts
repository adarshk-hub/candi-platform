// path: lib/useUnreplied.ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { NOTIFICATIONS_CHANGED } from './useNotifications'

export interface UnrepliedFeed {
  // Inbound messages still waiting on a reply.
  total: number
  // How many conversations those messages are spread across.
  threads: number
  byLead: Record<string, number>
}

const EMPTY: UnrepliedFeed = { total: 0, threads: 0, byLead: {} }

// Counts messages nobody has answered yet — unlike the notification bell,
// which counts messages nobody has looked at. Opening a thread does not
// change this number; replying does. Polls on its own and also refreshes
// whenever anything in the app announces a change, so a reply sent from a
// lead updates the sidebar without a page reload.
export function useUnreplied({ poll = true }: { poll?: boolean } = {}) {
  const [feed, setFeed] = useState<UnrepliedFeed>(EMPTY)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/unreplied')
      if (!res.ok) return
      const data = await res.json()
      setFeed({ total: data.total || 0, threads: data.threads || 0, byLead: data.byLead || {} })
    } catch {
      // Leave the last known counts rather than flashing zero.
    }
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    window.addEventListener(NOTIFICATIONS_CHANGED, onChange)
    // Refresh on returning to the tab, so a badge is never stale just
    // because the page has been open in the background.
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const timer = poll ? setInterval(refresh, 30000) : null
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChange)
      window.removeEventListener('focus', onFocus)
      if (timer) clearInterval(timer)
    }
  }, [refresh, poll])

  return { ...feed, refresh }
}
