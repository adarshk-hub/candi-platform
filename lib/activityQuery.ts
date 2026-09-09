// path: lib/activityQuery.ts
import { query } from '@/lib/db'
import { SessionUser, AGENCY_ROLES } from '@/lib/auth'
import { leadDateRangeSql } from '@/lib/leadDateRange'

export type ActivityBucket =
  | 'not_called'
  | 'new_today_not_called'
  | 'not_called_today'
  | 'unassigned'
  | 'cold'
  | 'cold_no_reason'
  | 'all'

export const ACTIVITY_BUCKETS: ActivityBucket[] = [
  'not_called',
  'new_today_not_called',
  'not_called_today',
  'unassigned',
  'cold',
  'cold_no_reason',
  'all',
]

const PAGE_SIZE = 100

export interface ActivityLeadRow {
  id: string
  lead_number: number
  client_id: string
  full_name: string
  whatsapp_number: string
  grade: string | null
  source: string
  pipeline_stage: string
  lead_score: number
  created_at: string
  assigned_counsellor_id: string | null
  counsellor_name: string | null
  first_called_at: string | null
  last_called_at: string | null
  call_attempt_count: number
  cold_reason: string | null
  cold_reason_note: string | null
}

export interface ActivitySummary {
  total: number
  newToday: number
  notCalled: number
  newTodayNotCalled: number
  notCalledToday: number
  unassigned: number
  cold: number
  coldNoReason: number
}

export interface CounsellorLoadRow {
  id: string | null
  full_name: string
  assigned: number
  notCalled: number
  notCalledToday: number
}

export interface ActivityOverview {
  summary: ActivitySummary
  coldReasons: { reason: string; count: number }[]
  counsellorLoad: CounsellorLoadRow[]
  leads: ActivityLeadRow[]
  total: number
  page: number
  pageSize: number
  bucket: ActivityBucket
  canAssign: boolean
}

// A lead sitting in a stage the institute has marked cold — either by
// status_group or by being the dedicated cold lane. Both are checked because
// an institute can configure either one (see pipeline_stages in schema.sql).
const COLD_SQL = `EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
    AND (ps.status_group = 'cold' OR ps.is_cold_lane)
)`

// Enrolled/won leads are deliberately left out of every "not called" number.
// A lead who has already paid doesn't belong on a chase list, and counting
// them makes the figure look permanently broken.
const WON_SQL = `EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
    AND ps.status_group = 'won'
)`

// Dates are compared in the institute's own timezone, not the server's.
// "Not called today" has to mean today where the counsellors actually are —
// on a UTC server an 8am IST call would otherwise land on the previous day
// for the first two and a half hours of every morning.
//
// The ::timestamptz cast makes this work whether the column is still a naive
// TIMESTAMP (original schema) or has been converted to TIMESTAMPTZ by
// scripts/fix-timezones.sql.
function localDate(expr: string, tzIdx: number): string {
  return `((${expr})::timestamptz AT TIME ZONE $${tzIdx})::date`
}

interface Ctx {
  where: string[]
  params: any[]
  tzIdx: number
}

async function resolveTimezone(): Promise<string> {
  try {
    const rows = await query<{ timezone: string | null }>('SELECT timezone FROM clients LIMIT 1')
    return rows[0]?.timezone || 'Asia/Kolkata'
  } catch {
    return 'Asia/Kolkata'
  }
}

// Same visibility rules as the leads list: a counsellor only ever sees their
// own leads, a client user only their institute's, and the global lead date
// window applies on top of both.
async function buildCtx(session: SessionUser, counsellorId: string): Promise<Ctx> {
  const params: any[] = []
  const where: string[] = []

  if (session.role === 'client_admin' || session.role === 'client_staff') {
    params.push(session.clientId)
    where.push(`l.client_id = $${params.length}`)
  } else if (session.role === 'client_counsellor') {
    params.push(session.id)
    where.push(`l.assigned_counsellor_id = $${params.length}`)
  }

  if (counsellorId === 'unassigned') {
    where.push('l.assigned_counsellor_id IS NULL')
  } else if (counsellorId) {
    params.push(counsellorId)
    where.push(`l.assigned_counsellor_id = $${params.length}`)
  }

  where.push(leadDateRangeSql('l'))

  const tz = await resolveTimezone()
  params.push(tz)

  return { where, params, tzIdx: params.length }
}

function bucketSql(bucket: ActivityBucket, tzIdx: number): string | null {
  const createdToday = `${localDate('l.created_at', tzIdx)} = ${localDate('now()', tzIdx)}`
  const calledToday = `l.last_called_at IS NOT NULL AND ${localDate('l.last_called_at', tzIdx)} = ${localDate('now()', tzIdx)}`

  switch (bucket) {
    case 'not_called':
      return `l.first_called_at IS NULL AND NOT ${WON_SQL}`
    case 'new_today_not_called':
      return `l.first_called_at IS NULL AND ${createdToday}`
    case 'not_called_today':
      return `NOT (${calledToday}) AND NOT ${WON_SQL}`
    case 'unassigned':
      return 'l.assigned_counsellor_id IS NULL'
    case 'cold':
      return COLD_SQL
    case 'cold_no_reason':
      return `${COLD_SQL} AND COALESCE(l.cold_reason, '') = ''`
    case 'all':
    default:
      return null
  }
}

export interface ActivityParams {
  bucket: ActivityBucket
  counsellorId: string
  search: string
  page: number
}

export async function fetchActivityOverview(
  session: SessionUser,
  params: ActivityParams
): Promise<ActivityOverview> {
  const { bucket, counsellorId, search, page } = params
  const ctx = await buildCtx(session, counsellorId)
  const { tzIdx } = ctx

  const baseWhere = `WHERE ${ctx.where.join(' AND ')}`

  const createdToday = `${localDate('l.created_at', tzIdx)} = ${localDate('now()', tzIdx)}`
  const calledToday = `l.last_called_at IS NOT NULL AND ${localDate('l.last_called_at', tzIdx)} = ${localDate('now()', tzIdx)}`

  // Every headline number in one pass. COUNT(*) FILTER means Postgres reads
  // the rows once instead of eight separate times — this page is opened
  // constantly through the day, so it's worth the single round trip.
  const [summaryRow] = await query<Record<string, number>>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE ${createdToday})::int AS new_today,
       COUNT(*) FILTER (WHERE l.first_called_at IS NULL AND NOT ${WON_SQL})::int AS not_called,
       COUNT(*) FILTER (WHERE l.first_called_at IS NULL AND ${createdToday})::int AS new_today_not_called,
       COUNT(*) FILTER (WHERE NOT (${calledToday}) AND NOT ${WON_SQL})::int AS not_called_today,
       COUNT(*) FILTER (WHERE l.assigned_counsellor_id IS NULL)::int AS unassigned,
       COUNT(*) FILTER (WHERE ${COLD_SQL})::int AS cold,
       COUNT(*) FILTER (WHERE ${COLD_SQL} AND COALESCE(l.cold_reason, '') = '')::int AS cold_no_reason
     FROM leads l
     ${baseWhere}`,
    ctx.params
  )

  const coldReasonRows = await query<{ reason: string; count: number }>(
    `SELECT COALESCE(NULLIF(l.cold_reason, ''), 'No reason recorded') AS reason, COUNT(*)::int AS count
     FROM leads l
     ${baseWhere} AND ${COLD_SQL}
     GROUP BY 1
     ORDER BY count DESC, reason ASC`,
    ctx.params
  )

  // Includes an "Unassigned" pseudo-row via the LEFT JOIN so the workload
  // table shows the backlog nobody owns next to everyone's real load —
  // that unowned pile is the whole point of looking at this table.
  const counsellorRows = await query<{
    id: string | null
    full_name: string | null
    assigned: number
    not_called: number
    not_called_today: number
  }>(
    `SELECT u.id,
            u.full_name,
            COUNT(*)::int AS assigned,
            COUNT(*) FILTER (WHERE l.first_called_at IS NULL AND NOT ${WON_SQL})::int AS not_called,
            COUNT(*) FILTER (WHERE NOT (${calledToday}) AND NOT ${WON_SQL})::int AS not_called_today
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     ${baseWhere}
     GROUP BY u.id, u.full_name
     ORDER BY assigned DESC`,
    ctx.params
  )

  // The list below reuses the same scope, then narrows to the selected
  // bucket and search term.
  const listWhere = [...ctx.where]
  const listParams = [...ctx.params]

  const bucketClause = bucketSql(bucket, tzIdx)
  if (bucketClause) listWhere.push(bucketClause)

  if (search) {
    listParams.push(`%${search}%`)
    const i = listParams.length
    listWhere.push(`(l.full_name ILIKE $${i} OR l.child_name ILIKE $${i} OR l.whatsapp_number ILIKE $${i})`)
  }

  const listWhereSql = `WHERE ${listWhere.join(' AND ')}`

  const [countRow] = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM leads l ${listWhereSql}`,
    listParams
  )
  const total = countRow?.count ?? 0

  const safePage = Math.max(1, page)
  const offset = (safePage - 1) * PAGE_SIZE

  // Oldest first, deliberately: this is a worklist, and the lead that has
  // been waiting longest is the one that should be called next.
  const leads = await query<ActivityLeadRow>(
    `SELECT l.id, l.lead_number, l.client_id, l.full_name, l.whatsapp_number, l.grade, l.source,
            l.pipeline_stage, l.lead_score, l.created_at, l.assigned_counsellor_id,
            l.first_called_at, l.last_called_at, l.call_attempt_count,
            l.cold_reason, l.cold_reason_note,
            u.full_name AS counsellor_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     ${listWhereSql}
     ORDER BY l.created_at ASC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    listParams
  )

  return {
    summary: {
      total: Number(summaryRow?.total ?? 0),
      newToday: Number(summaryRow?.new_today ?? 0),
      notCalled: Number(summaryRow?.not_called ?? 0),
      newTodayNotCalled: Number(summaryRow?.new_today_not_called ?? 0),
      notCalledToday: Number(summaryRow?.not_called_today ?? 0),
      unassigned: Number(summaryRow?.unassigned ?? 0),
      cold: Number(summaryRow?.cold ?? 0),
      coldNoReason: Number(summaryRow?.cold_no_reason ?? 0),
    },
    coldReasons: coldReasonRows.map((r) => ({ reason: r.reason, count: Number(r.count) })),
    counsellorLoad: counsellorRows.map((r) => ({
      id: r.id,
      full_name: r.full_name || 'Unassigned',
      assigned: Number(r.assigned),
      notCalled: Number(r.not_called),
      notCalledToday: Number(r.not_called_today),
    })),
    leads,
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    bucket,
    canAssign: AGENCY_ROLES.includes(session.role) || session.role === 'client_admin',
  }
}
