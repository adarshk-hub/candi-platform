// path: app/api/reports/counsellor-performance/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { leadDateRangeSql } from '@/lib/leadDateRange'

// Management reporting, so it's gated on role here as well as in the
// sidebar — a counsellor with the URL still gets a 403.
function canView(role: string): boolean {
  return AGENCY_ROLES.includes(role as any) || role === 'client_admin'
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canView(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') || ''
  const to = sp.get('to') || ''

  // The date filter applies to when the work happened (the stage move, the
  // call), not to when the lead was created — a lead captured in March that
  // a counsellor converted in June is June's work.
  const actParams: any[] = []
  let actWindow = ''
  if (from) {
    actParams.push(from)
    actWindow += ` AND a.created_at >= $${actParams.length}::date`
  }
  if (to) {
    actParams.push(to)
    actWindow += ` AND a.created_at < $${actParams.length}::date + INTERVAL '1 day'`
  }

  try {
    // Stage movements are counted from the activity trail rather than from
    // the leads table, because a lead only ever shows its *current* stage —
    // the counsellor who walked it from New to Visit Booked before someone
    // else closed it would otherwise show no work at all.
    const moves = await query<{
      actor_id: string | null
      full_name: string | null
      stage_moves: number
      forward_moves: number
      cold_moves: number
      won_moves: number
    }>(
      `SELECT a.actor_id,
              u.full_name,
              COUNT(*)::int AS stage_moves,
              COUNT(*) FILTER (WHERE a.description NOT ILIKE '%cold%')::int AS forward_moves,
              COUNT(*) FILTER (WHERE a.description ILIKE '%cold reason%')::int AS cold_moves,
              COUNT(*) FILTER (WHERE a.title = 'Stage Updated' AND a.description ILIKE '%enrol%')::int AS won_moves
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.title = 'Stage Updated' AND a.actor_id IS NOT NULL ${actWindow}
       GROUP BY a.actor_id, u.full_name`,
      actParams
    )

    const calls = await query<{ actor_id: string | null; calls: number }>(
      `SELECT a.actor_id, COUNT(*)::int AS calls
       FROM activity_log a
       WHERE a.title = 'Call Logged' AND a.actor_id IS NOT NULL ${actWindow}
       GROUP BY a.actor_id`,
      actParams
    )

    // Current book of business per counsellor — assigned, enrolled, cold —
    // which is the other half of the picture: movement without outcomes, or
    // outcomes without movement, both mean something different.
    const book = await query<{
      id: string
      full_name: string
      assigned: number
      enrolled: number
      cold: number
      never_called: number
    }>(
      `SELECT u.id,
              u.full_name,
              COUNT(l.id)::int AS assigned,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM pipeline_stages ps
                WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage AND ps.status_group = 'won'
              ))::int AS enrolled,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM pipeline_stages ps
                WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
                  AND (ps.status_group = 'cold' OR ps.is_cold_lane)
              ))::int AS cold,
              COUNT(*) FILTER (WHERE l.first_called_at IS NULL)::int AS never_called
       FROM users u
       LEFT JOIN leads l ON l.assigned_counsellor_id = u.id AND ${leadDateRangeSql('l')}
       WHERE u.role = 'client_counsellor'
       GROUP BY u.id, u.full_name
       ORDER BY u.full_name`,
      []
    )

    const movesById = new Map(moves.map((m) => [m.actor_id, m]))
    const callsById = new Map(calls.map((c) => [c.actor_id, Number(c.calls)]))

    const rows = book.map((b) => {
      const m = movesById.get(b.id)
      const stageMoves = Number(m?.stage_moves ?? 0)
      return {
        id: b.id,
        name: b.full_name,
        assigned: Number(b.assigned),
        enrolled: Number(b.enrolled),
        cold: Number(b.cold),
        neverCalled: Number(b.never_called),
        calls: callsById.get(b.id) ?? 0,
        stageMoves,
        coldMoves: Number(m?.cold_moves ?? 0),
        conversionPct: b.assigned > 0 ? (Number(b.enrolled) / Number(b.assigned)) * 100 : null,
      }
    })

    // Sorted by movement, since the question this page exists to answer is
    // who is actually pushing leads through the pipeline.
    rows.sort((a, b) => b.stageMoves - a.stageMoves)

    return NextResponse.json({ rows, from, to })
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        rows: [],
        error: 'Run scripts/activity-migration.sql and scripts/phase2-migration.sql against this database first.',
      })
    }
    console.error('[counsellor-performance] failed:', err)
    return NextResponse.json({ error: 'Could not build the report.' }, { status: 500 })
  }
}
