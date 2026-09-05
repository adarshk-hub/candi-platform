import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getNotificationFeed } from '@/lib/notifications'

// Polled by the bell in the top bar (and read once by the leads list for
// its per-row badges). Returns only what's unread for the calling user.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const feed = await getNotificationFeed(session)
    return NextResponse.json(feed)
  } catch (err) {
    // The bell is ambient UI — if the notifications tables haven't been
    // migrated yet, degrade to "nothing unread" rather than throwing a
    // red error into every page of the app.
    console.error('[notifications] feed query failed:', err)
    return NextResponse.json({ items: [], unreadByLead: {}, total: 0 })
  }
}
