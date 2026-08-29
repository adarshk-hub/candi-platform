import { query } from '@/lib/db'
import { SessionUser } from '@/lib/auth'

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
}

export interface LeadsPageParams {
  page: number
  search: string
  tab: string
  stage: string[]
  source: string[]
  grade: string[]
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
  const { page, search, tab, stage: stageFilter, source: sourceFilter, grade: gradeFilter } = params

  const where: string[] = []
  const sqlParams: any[] = []

  if (session.role === 'client_admin') {
    sqlParams.push(session.clientId)
    where.push(`l.client_id = $${sqlParams.length}`)
  } else if (session.role === 'client_counsellor') {
    sqlParams.push(session.id)
    where.push(`l.assigned_counsellor_id = $${sqlParams.length}`)
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
  if (gradeFilter.length > 0) {
    sqlParams.push(gradeFilter)
    where.push(`l.grade = ANY($${sqlParams.length})`)
  }

  if (tab === 'enrolled') {
    where.push(
      `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'won')`
    )
  } else if (tab === 'hot') {
    where.push(
      `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'hot')`
    )
  } else if (tab === 'warm') {
    where.push(
      `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'warm')`
    )
  } else if (tab === 'cold') {
    where.push(
      `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'cold')`
    )
  }

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
            l.source, l.lead_score, l.created_at, l.assigned_counsellor_id,
            u.full_name AS counsellor_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    sqlParams
  )

  return { leads, total: Number(count), page, pageSize: PAGE_SIZE }
}
