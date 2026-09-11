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
// A lead sitting in a stage the institute has marked cold — by status_group
// or by being the dedicated cold lane, since an institute can configure
// either. Defined here rather than imported from lib/activityQuery so this
// file has no dependency on the page it absorbed.
const COLD_SQL = `EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
    AND (ps.status_group = 'cold' OR ps.is_cold_lane)
)`

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

// Three live states, matching the three figures on the Next Actions page:
//
//   upcoming  — planned, its time hasn't come yet
//   overdue   — planned, the time passed, nothing recorded
//   unplanned — a counsellor owns this lead and hasn't planned anything
//
// The 24-hour grace period that used to sit between "new" and "unplanned" is
// gone. It meant the same lead could read as unplanned on one screen and
// fine on another depending on the hour, and the distinction was never
// something anyone acted on differently.
export type NextActionState = 'overdue' | 'unplanned' | 'upcoming' | 'done'

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
  // Which states to list. Leaving this unset lists only leads that have a
  // plan, because a lead with nothing planned is not a row of work — it's a
  // gap, and putting it in the table means every new lead arrives as a line
  // item nobody created. The count still includes them; clicking that figure
  // is how you go and look.
  states?: NextActionState[]
  // One of the lead-condition buckets above. Applied on top of everything
  // else rather than instead of it.
  bucket?: LeadBucket
}

export interface NextActionCounts {
  upcoming: number
  overdue: number
  unplanned: number
  // Absorbed from the old Activity page. These describe the lead rather than
  // its plan — "nobody has ever rung this person" is the same complaint as
  // "nobody has planned anything", so they belong on one worklist instead of
  // two pages that each show half the neglect.
  neverCalled: number
  notCalledToday: number
  unassigned: number
  coldNoReason: number
}

// Buckets that filter by the lead's own condition rather than by its next
// action. Kept as a separate axis from `states` because they answer a
// different question and can legitimately overlap — a lead can be overdue
// *and* never called.
export type LeadBucket = 'never_called' | 'not_called_today' | 'unassigned' | 'cold_no_reason'


// Counted over everything in scope, independent of what the table is
// currently listing — otherwise hiding unplanned leads from the list would
// zero the figure that exists to tell you about them.
const BUCKET_SQL: Record<LeadBucket, string> = {
  never_called: 'l.first_called_at IS NULL',
  not_called_today: `(l.last_called_at IS NULL OR l.last_called_at::date < now()::date)`,
  unassigned: 'l.assigned_counsellor_id IS NULL',
  cold_no_reason: `${COLD_SQL} AND COALESCE(l.cold_reason, '') = ''`,
}

export async function fetchNextActionCounts(counsellorId?: string): Promise<NextActionCounts> {
  const values: any[] = []
  // Unassigned leads have to be inside this scope, or the "unassigned" count
  // would always be zero — which is exactly the figure it exists to show.
  const where: string[] = [leadDateRangeSql('l'), OPEN_ONLY]

  if (counsellorId) {
    values.push(counsellorId)
    where.push(`l.assigned_counsellor_id = $${values.length}`)
  }

  const [row] = await query<Record<string, number>>(
    `SELECT
       COUNT(*) FILTER (
         WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL AND l.next_action_at >= now()
       )::int AS upcoming,
       COUNT(*) FILTER (
         WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL AND l.next_action_at < now()
       )::int AS overdue,
       COUNT(*) FILTER (
         WHERE l.next_action_at IS NULL AND l.assigned_counsellor_id IS NOT NULL
       )::int AS unplanned,
       COUNT(*) FILTER (WHERE l.first_called_at IS NULL)::int AS never_called,
       COUNT(*) FILTER (
         WHERE l.last_called_at IS NULL OR l.last_called_at::date < now()::date
       )::int AS not_called_today,
       COUNT(*) FILTER (WHERE l.assigned_counsellor_id IS NULL)::int AS unassigned,
       COUNT(*) FILTER (WHERE ${COLD_SQL} AND COALESCE(l.cold_reason, '') = '')::int AS cold_no_reason
     FROM leads l
     WHERE ${where.join(' AND ')}`,
    values
  )

  return {
    upcoming: Number(row?.upcoming ?? 0),
    overdue: Number(row?.overdue ?? 0),
    unplanned: Number(row?.unplanned ?? 0),
    neverCalled: Number(row?.never_called ?? 0),
    notCalledToday: Number(row?.not_called_today ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    coldNoReason: Number(row?.cold_no_reason ?? 0),
  }
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
  const where: string[] = [leadDateRangeSql('l'), OPEN_ONLY]
  // Normally only assigned leads are work; the unassigned bucket is the one
  // case where the point is precisely that nobody owns them.
  if (params.bucket !== 'unassigned') where.push('l.assigned_counsellor_id IS NOT NULL')

  if (params.counsellorId) {
    values.push(params.counsellorId)
    where.push(`l.assigned_counsellor_id = $${values.length}`)
  }

  // Leads with no plan at all have no date to filter on, so a date range
  // would silently drop them — and they're the ones most worth seeing. They
  // are kept in regardless of the range, and sorted to the top.
  const unplannedSql = `l.next_action_at IS NULL`

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

  // Default: only leads that actually have a plan. Unplanned leads are
  // reachable by asking for them explicitly.
  const states = params.states && params.states.length > 0 ? params.states : ['upcoming', 'overdue', 'done']
  if (!states.includes('unplanned')) where.push('l.next_action_at IS NOT NULL')
  if (states.length === 1 && states[0] === 'unplanned') where.push('l.next_action_at IS NULL')

  // A lead bucket overrides the plan-state filter: asking for "never called"
  // means every lead nobody has rung, whether or not somebody has since
  // planned something.
  if (params.bucket) {
    const idx = where.findIndex((w) => w === 'l.next_action_at IS NOT NULL' || w === 'l.next_action_at IS NULL')
    if (idx >= 0) where.splice(idx, 1)
    where.push(BUCKET_SQL[params.bucket])
  }

  return query<NextActionListRow>(
    `SELECT ${SELECT_COLS}, l.next_action_done_at,
            CASE
              WHEN l.next_action_done_at IS NOT NULL THEN 'done'
              WHEN l.next_action_at IS NULL THEN 'unplanned'
              WHEN l.next_action_at < now() THEN 'overdue'
              ELSE 'upcoming'
            END AS state
     FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_counsellor_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE
         WHEN l.next_action_done_at IS NOT NULL THEN 3
         WHEN l.next_action_at IS NULL THEN 0
         WHEN l.next_action_at < now() THEN 1
         ELSE 2
       END,
       l.next_action_at ASC NULLS FIRST`,
    values
  )
}

// Per-counsellor counts for the admin view.
export async function fetchNextActionSummary(): Promise<
  {
    id: string
    full_name: string
    overdue: number
    unplanned: number
    upcoming: number
  }[]
> {
  return query(
    `SELECT u.id, u.full_name,
            COUNT(*) FILTER (
              WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL AND l.next_action_at < now()
            )::int AS overdue,
            COUNT(*) FILTER (WHERE l.next_action_at IS NULL)::int AS unplanned,
            COUNT(*) FILTER (
              WHERE l.next_action_at IS NOT NULL AND l.next_action_done_at IS NULL
                AND l.next_action_at >= now()
            )::int AS "upcoming"
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
