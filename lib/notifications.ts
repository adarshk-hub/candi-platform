import { query, queryAsClient } from './db'
import { SessionUser } from './auth'

export type NotificationType = 'new_lead' | 'wa_message'

export interface NotificationItem {
  id: string
  type: NotificationType
  leadId: string
  leadNumber: number
  leadName: string
  body: string | null
  createdAt: string
}

export interface NotificationFeed {
  items: NotificationItem[]
  // lead_id -> count of unread inbound WhatsApp messages, used for the
  // per-row badge on the leads list. Covers every unread lead, not just
  // the ones inside the capped `items` list above.
  unreadByLead: Record<string, number>
  total: number
}

const FEED_LIMIT = 30

// Writes one notification. Deliberately swallows its own errors: this is
// called from inside webhook handlers and lead intake, where the actual
// work (recording the message, creating the lead) has already succeeded.
// A failed bell notification must never turn a successful webhook delivery
// into a 500 that Meta then retries.
export async function createNotification(params: {
  clientId: string
  leadId: string
  type: NotificationType
  body?: string | null
}): Promise<void> {
  try {
    await queryAsClient(
      params.clientId,
      `INSERT INTO notifications (client_id, lead_id, type, body)
       VALUES ($1, $2, $3, $4)`,
      [params.clientId, params.leadId, params.type, (params.body || '').slice(0, 300) || null]
    )
  } catch (err) {
    console.error('[notifications] could not record notification:', err)
  }
}

// Restricts the feed to the leads this user is allowed to see, matching
// the same rules lib/leadsQuery.ts applies to the leads list itself — a
// counsellor must not learn about leads that aren't theirs just because
// the notification bell forgot to scope its query.
function scopeClause(session: SessionUser, params: any[]): string {
  if (session.role === 'client_admin' || session.role === 'client_staff') {
    params.push(session.clientId)
    return `AND l.client_id = $${params.length}`
  }
  if (session.role === 'client_counsellor') {
    params.push(session.id)
    return `AND l.assigned_counsellor_id = $${params.length}`
  }
  // Agency roles see everything in the database they're connected to.
  return ''
}

export async function getNotificationFeed(session: SessionUser): Promise<NotificationFeed> {
  const itemParams: any[] = [session.id]
  const itemScope = scopeClause(session, itemParams)

  const rows = await query<{
    id: string
    type: NotificationType
    lead_id: string
    lead_number: number
    full_name: string
    body: string | null
    created_at: string
  }>(
    `SELECT n.id, n.type, n.lead_id, n.body, n.created_at,
            l.lead_number, l.full_name
     FROM notifications n
     JOIN leads l ON l.id = n.lead_id
     LEFT JOIN notification_reads r
       ON r.notification_id = n.id AND r.user_id = $1
     WHERE r.notification_id IS NULL
     ${itemScope}
     ORDER BY n.created_at DESC
     LIMIT ${FEED_LIMIT}`,
    itemParams
  )

  // Counted separately from the capped list so a lead sitting on page 3
  // with 4 unread messages still shows "4" on its row, even when its
  // notifications fell outside the newest 30 shown in the dropdown.
  const countParams: any[] = [session.id]
  const countScope = scopeClause(session, countParams)

  const counts = await query<{ lead_id: string; count: string }>(
    `SELECT n.lead_id, COUNT(*) AS count
     FROM notifications n
     JOIN leads l ON l.id = n.lead_id
     LEFT JOIN notification_reads r
       ON r.notification_id = n.id AND r.user_id = $1
     WHERE r.notification_id IS NULL
       AND n.type = 'wa_message'
     ${countScope}
     GROUP BY n.lead_id`,
    countParams
  )

  const totalParams: any[] = [session.id]
  const totalScope = scopeClause(session, totalParams)

  const totalRow = (
    await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM notifications n
       JOIN leads l ON l.id = n.lead_id
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.user_id = $1
       WHERE r.notification_id IS NULL
       ${totalScope}`,
      totalParams
    )
  )[0]

  const unreadByLead: Record<string, number> = {}
  for (const c of counts) unreadByLead[c.lead_id] = Number(c.count)

  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      leadId: r.lead_id,
      leadNumber: r.lead_number,
      leadName: r.full_name,
      body: r.body,
      createdAt: r.created_at,
    })),
    unreadByLead,
    total: Number(totalRow?.count || 0),
  }
}

// Marks every notification for one lead as read for this user — called
// when they open that lead. This is the single action that clears the
// badge on the lead row and removes its entries from the bell at the same
// time, so the two can never disagree.
export async function markLeadNotificationsRead(session: SessionUser, leadId: string): Promise<void> {
  const params: any[] = [session.id, leadId]
  const scope = scopeClause(session, params)

  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1
     FROM notifications n
     JOIN leads l ON l.id = n.lead_id
     WHERE n.lead_id = $2
     ${scope}
     ON CONFLICT (notification_id, user_id) DO NOTHING`,
    params
  )
}

export async function markAllNotificationsRead(session: SessionUser): Promise<void> {
  const params: any[] = [session.id]
  const scope = scopeClause(session, params)

  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1
     FROM notifications n
     JOIN leads l ON l.id = n.lead_id
     WHERE true
     ${scope}
     ON CONFLICT (notification_id, user_id) DO NOTHING`,
    params
  )
}
