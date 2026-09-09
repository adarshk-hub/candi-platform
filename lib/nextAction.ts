// path: lib/nextAction.ts
import { query } from '@/lib/db'
import { leadDateRangeSql } from '@/lib/leadDateRange'

export interface NextActionRow {
  id: string
  lead_number: number
  full_name: string
  whatsapp_number: string
  pipeline_stage: string
  client_id: string
  assigned_counsellor_id: string | null
  counsellor_name: string | null
  next_action: string | null
  next_action_at: string | null
  next_action_set_at: string | null
  assigned_at: string | null
  hours_since_assigned: number | null
}

export interface NextActionBuckets {
  overdue: NextActionRow[]
  unplanned: NextActionRow[]
  dueToday: NextActionRow[]
}

// How long a counsellor has to decide what happens next after a lead lands
// with them. A day is deliberate: leads arriving at 6pm shouldn't be counted
// against anyone by 9am, and anything longer stops being a working rule.
const PLANNING_GRACE_HOURS = 24

// When the lead was handed to its current counsellor. Read from the activity
// trail rather than a column, because assignment is already logged in three
// places (manual create, bulk assign, auto-assign) and a fourth write would
// be one more thing to keep in step. Falls back to when the lead was created,
// which is right for a lead that arrived already assigned.
const ASSIGNED_AT_SQL = `COALESCE(
  (SELECT MAX(a.created_at) FROM activity_log a
    WHERE a.lead_id = l.id AND a.title = 'Counsellor Assigned'),
  l.created_at
)`

const SELECT_COLS = `l.id, l.lead_number, l.full_name, l.whatsapp_number, l.pipeline_stage,
  l.client_id, l.assigned_counsellor_id, l.next_action, l.next_action_at, l.next_action_set_at,
  u.full_name AS counsellor_name,
  ${ASSIGNED_AT_SQL} AS assigned_at,
  EXTRACT(EPOCH FROM (now() - ${ASSIGNED_AT_SQL})) / 3600 AS hours_since_assigned`

// Leads in a won or lost stage are excluded everywhere below. Chasing a
// parent who has already enrolled — or already said no — isn't work anyone
// should be flagged for not doing.
const OPEN_ONLY = `NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
    AND ps.status_group IN ('won', 'lost')
)`

// Everything a counsellor is behind on, split into the two failures that
// mean different things:
//
//   overdue   — a plan existed, the date passed, nothing was recorded
//   unplanned — the lead has been theirs for over a day with no plan at all
//
// Kept apart because the fix differs. Overdue means "do the thing or move
// the date". Unplanned means "decide what you're going to do".
export async function fetchNextActionBuckets(counsellorId?: string): Promise<NextActionBuckets> {
  const params: any[] = []
  let scope = ''
  if (counsellorId) {
    params.push(counsellorId)
    scope = ` AND l.assigned_counsellor_id = $${params.length}`
  }

  const base = `FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_counsellor_id
    WHERE l.assigned_counsellor_id IS NOT NULL
      AND ${leadDateRangeSql('l')}
      AND ${OPEN_ONLY}${scope}`

  const overdue = await query<NextActionRow>(
    `SELECT ${SELECT_COLS} ${base}
       AND l.next_action_at IS NOT NULL
       AND l.next_action_done_at IS NULL
       AND l.next_action_at < now()
     ORDER BY l.next_action_at ASC`,
    params
  )

  const unplanned = await query<NextActionRow>(
    `SELECT ${SELECT_COLS} ${base}
       AND l.next_action_at IS NULL
       AND ${ASSIGNED_AT_SQL} < now() - INTERVAL '${PLANNING_GRACE_HOURS} hours'
     ORDER BY assigned_at ASC`,
    params
  )

  // Not a failure — shown alongside so the day reads as a worklist rather
  // than only a list of things gone wrong.
  const dueToday = await query<NextActionRow>(
    `SELECT ${SELECT_COLS} ${base}
       AND l.next_action_at IS NOT NULL
       AND l.next_action_done_at IS NULL
       AND l.next_action_at >= now()
       AND l.next_action_at::date <= now()::date
     ORDER BY l.next_action_at ASC`,
    params
  )

  return { overdue, unplanned, dueToday }
}

export type NextActionState = 'overdue' | 'unplanned' | 'due_today' | 'upcoming' | 'done'

export interface NextActionListRow extends NextActionRow {
  next_action_done_at: string | null
  state: NextActionState
}

export interface NextActionListParams {
  counsellorId?: string
  from?: string
  to?: string
  search?: string
  // 'open' hides completed actions — the default, since this is a worklist.
  status?: 'open' | 'all' | 'done'
}

// One flat, filterable list for the Next Actions page, as opposed to the
// three fixed buckets the day pages show. Same rules underneath, so a lead
// can't be overdue on one screen and fine on the other.
//
// The state is computed in SQL rather than in the page, because "overdue"
// has to mean the same thing here as it does in the buckets above, and two
// implementations of that comparison would eventually disagree.
export async function fetchNextActionList(params: NextActionListParams): Promise<NextActionListRow[]> {
  const values: any[] = []
  const where: string[] = [`l.assigned_counsellor_id IS NOT NULL`, leadDateRangeSql('l'), OPEN_ONLY]

  if (params.counsellorId) {
    values.push(params.counsellorId)
    where.push(`l.assigned_counsellor_id = $${values.length}`)
  }

  // Leads with no plan at all have no date to filter on, so a date range
  // would silently drop them — and they're the ones most worth seeing. They
  // are kept in regardless of the range, and sorted to the top.
  const unplannedSql = `(l.next_action_at IS NULL AND ${ASSIGNED_AT_SQL} < now() - INTERVAL '${PLANNING_GRACE_HOURS} hours')`

  const dateWhere: string[] = []
  if (params.from) {
    values.push(params.from)
    dateWhere.push(`l.next_action_at >= $${values.length}::date`)
  }
  if (params.to) {
    values.push(params.to)
    dateWhere.push(`l.next_action_at < $${values.length}::date + INTERVAL '1 day'`)
  }
  if (dateWhere.length > 0) {
    where.push(`(${unplannedSql} OR (${dateWhere.join(' AND ')}))`)
  }

  if (params.search) {
    values.push(`%${params.search}%`)
    const i = values.length
    where.push(`(l.full_name ILIKE $${i} OR l.whatsapp_number ILIKE $${i} OR l.next_action ILIKE $${i})`)
  }

  if (params.status === 'done') {
    where.push('l.next_action_done_at IS NOT NULL')
  } else if (params.status !== 'all') {
    where.push(`(l.next_action_done_at IS NULL OR ${unplannedSql})`)
  }

  return query<NextActionListRow>(
    `SELECT ${SELECT_COLS}, l.next_action_done_at,
            CASE
              WHEN l.next_action_done_at IS NOT NULL THEN 'done'
              WHEN l.next_action_at IS NULL THEN 'unplanned'
              WHEN l.next_action_at < now() THEN 'overdue'
              WHEN l.next_action_at::date = now()::date THEN 'due_today'
              ELSE 'upcoming'
            END AS state
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE
         WHEN l.next_action_done_at IS NOT NULL THEN 4
         WHEN l.next_action_at IS NULL THEN 0
         WHEN l.next_action_at < now() THEN 1
         WHEN l.next_action_at::date = now()::date THEN 2
         ELSE 3
       END,
       l.next_action_at ASC NULLS FIRST`,
    values
  )
}

// Per-counsellor counts for the admin view.
export async function fetchNextActionSummary(): Promise<
  { id: string; full_name: string; overdue: number; unplanned: number; dueToday: number }[]
> {
  return query(
    `SELECT u.id, u.full_name,
            COUNT(*) FILTER (
              WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL AND l.next_action_at < now()
            )::int AS overdue,
            COUNT(*) FILTER (
              WHERE l.next_action_at IS NULL AND ${ASSIGNED_AT_SQL} < now() - INTERVAL '${PLANNING_GRACE_HOURS} hours'
            )::int AS unplanned,
            COUNT(*) FILTER (
              WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL
                AND l.next_action_at >= now() AND l.next_action_at::date <= now()::date
            )::int AS "dueToday"
     FROM users u
     LEFT JOIN leads l
       ON l.assigned_counsellor_id = u.id
      AND ${leadDateRangeSql('l')}
      AND ${OPEN_ONLY}
     WHERE u.role = 'client_counsellor' AND COALESCE(u.is_active, true)
     GROUP BY u.id, u.full_name
     ORDER BY overdue DESC, unplanned DESC, u.full_name`
  )
}
