// path: lib/leadsQuery.ts
import { query } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { leadDateRangeSql } from '@/lib/leadDateRange'
import { leadBucketSql, normalizeBucket } from '@/lib/leadBuckets'
import { isLocalOcto } from '@/lib/localOcto'

const DEFAULT_PAGE_SIZE = 250

export interface LeadRow {
  id: string
  lead_number: number
  client_id: string
  full_name: string
  child_name: string | null
  whatsapp_number: string
  grade: string | null
  pipeline_stage: string
  source: string
  lead_score: number
  created_at: string
  assigned_counsellor_id: string | null
  counsellor_name: string | null
  // Optional columns — selected in Settings > Customize > Display
  // Preferences. Always fetched; the table decides whether to show them.
  email: string | null
  campaign_display_name: string | null
  // Local Octo only: how the latest WhatsApp / SMS / email to this lead went
  // (the Messages column). null = nothing sent on that channel yet.
  msg?: LeadMessageStatus
}

export interface LeadMessageStatus {
  // queued | sent | delivered | read | replied | failed
  wa: string | null
  // sent (accepted by MSG91) | failed
  sms: string | null
  // sent | failed
  email: string | null
}

// Latest outbound message per channel for each lead on the page. As the lead
// moves through stages and new messages go out, this always shows the most
// recent one. SMS failures are only kept in the activity log, so the latest
// of "sent" (sms_messages) and "failed" (activity log) wins.
async function attachMessageStatus(leads: LeadRow[]): Promise<void> {
  if (leads.length === 0) return
  try {
    const rows = await query<{ id: string; wa: string | null; sms: string | null; email: string | null }>(
      `SELECT l.id,
              (SELECT w.status FROM whatsapp_messages w
                WHERE w.lead_id = l.id AND w.direction = 'outbound'
                ORDER BY w.created_at DESC LIMIT 1) AS wa,
              (SELECT CASE
                        WHEN s.t IS NULL AND f.t IS NULL THEN NULL
                        WHEN f.t IS NULL OR (s.t IS NOT NULL AND s.t >= f.t) THEN 'sent'
                        ELSE 'failed'
                      END
                 FROM (SELECT max(created_at) AS t FROM sms_messages WHERE lead_id = l.id) s,
                      (SELECT max(created_at) AS t FROM activity_log
                        WHERE lead_id = l.id AND title IN ('SMS Failed', 'SMS Not Sent')) f) AS sms,
              (SELECT e.status FROM email_messages e
                WHERE e.lead_id = l.id ORDER BY e.created_at DESC LIMIT 1) AS email
       FROM leads l
       WHERE l.id = ANY($1::uuid[])`,
      [leads.map((l) => l.id)]
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const l of leads) {
      const r = byId.get(l.id)
      l.msg = { wa: r?.wa || null, sms: r?.sms || null, email: r?.email || null }
    }
  } catch (err) {
    // e.g. sms_messages not created yet — the column just stays empty.
    console.error('[leads] message status lookup failed', err)
  }
}

export interface LeadsPageParams {
  page: number
  search: string
  tab: string
  stage: string[]
  source: string[]
  grade: string[]
  counsellor: string[]
}

export interface LeadsPageResult {
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
}

// The single source of truth for "give me a page of leads" — used both by
// GET /api/leads (for client-side re-fetches: filtering, searching, paging,
// refresh-after-action) and directly by the server-rendered /leads page
// (for the very first paint, so the page never has to render empty and
// then wait on a separate browser round trip just to show what it already
// could have rendered from the start).
export async function fetchLeadsPage(session: SessionUser, params: LeadsPageParams): Promise<LeadsPageResult> {
  const {
    page,
    search,
    tab,
    stage: stageFilter,
    source: sourceFilter,
    grade: gradeFilter,
    counsellor: counsellorFilter = [],
  } = params

  const where: string[] = []
  const sqlParams: any[] = []

  if (session.role === 'client_admin' || session.role === 'client_staff') {
    sqlParams.push(session.clientId)
    where.push(`l.client_id = $${sqlParams.length}`)
  } else if (session.role === 'client_counsellor') {
    // Counsellors see every lead at their own institute, not only the ones
    // assigned to them — they cover for each other and need the whole list.
    sqlParams.push(session.clientId)
    where.push(`l.client_id = $${sqlParams.length}`)
  }

  if (search) {
    sqlParams.push(`%${search}%`)
    const i = sqlParams.length
    where.push(`(l.full_name ILIKE $${i} OR l.child_name ILIKE $${i} OR l.whatsapp_number ILIKE $${i})`)
  }

  if (stageFilter.length > 0) {
    sqlParams.push(stageFilter)
    where.push(`l.pipeline_stage = ANY($${sqlParams.length})`)
  }
  if (sourceFilter.length > 0) {
    sqlParams.push(sourceFilter)
    where.push(`l.source = ANY($${sqlParams.length})`)
  }
  if (counsellorFilter.length > 0) {
    sqlParams.push(counsellorFilter)
    where.push(`l.assigned_counsellor_id = ANY($${sqlParams.length}::uuid[])`)
  }

  if (gradeFilter.length > 0) {
    sqlParams.push(gradeFilter)
    where.push(`l.grade = ANY($${sqlParams.length})`)
  }

  // Lead / Visit / Enrolled / Cold all come from one definition in
  // lib/leadBuckets so this list and the dashboard can't drift apart.
  const bucket = normalizeBucket(tab)
  if (bucket) where.push(leadBucketSql(bucket))

  // Global lead visibility window (Settings > Customize > Lead Date
  // Range). Applied last so it can never be widened by anything above.
  where.push(leadDateRangeSql('l'))
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // One combined round trip for page size + count (see route.ts history —
  // running these as two separate queries at once forces two simultaneous
  // fresh connections instead of one and was actively slower).
  const combinedParams = [...sqlParams, session.clientId]
  const clientIdParamIndex = combinedParams.length

  const [combined] = await query<{ leads_per_page: number | null; count: number }>(
    `SELECT
       (SELECT leads_per_page FROM clients WHERE id = $${clientIdParamIndex}) AS leads_per_page,
       (SELECT COUNT(*)::int FROM leads l ${whereSql}) AS count`,
    combinedParams
  )
  const PAGE_SIZE = combined?.leads_per_page || DEFAULT_PAGE_SIZE
  const count = combined?.count ?? 0

  const offset = (page - 1) * PAGE_SIZE
  const leads = await query<LeadRow>(
    `SELECT l.id, l.lead_number, l.client_id, l.full_name, l.child_name, l.whatsapp_number, l.grade, l.pipeline_stage,
            l.source, l.lead_score, l.created_at, l.assigned_counsellor_id, l.email,
            -- Fetched for the optional Next Action column. Always selected
            -- rather than conditionally, because the column set is a display
            -- preference read on the client — branching the SQL on it would
            -- mean the query shape changes per institute for two small
            -- fields already on the row.
            l.next_action, l.next_action_at, l.next_action_done_at,
            u.full_name AS counsellor_name,
            c.display_name AS campaign_display_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     LEFT JOIN campaigns c ON c.id = l.campaign_id
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    sqlParams
  )

  if (leads.length > 0 && isLocalOcto(leads[0].client_id)) await attachMessageStatus(leads)

  return { leads, total: Number(count), page, pageSize: PAGE_SIZE }
}
