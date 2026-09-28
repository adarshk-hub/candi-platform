// path: app/api/leads/filter-options/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { leadDateRangeSql } from '@/lib/leadDateRange'

// Powers the leads list's Filter panel (Stage / Source / Grade). Stage
// comes from this institute's own pipeline_stages config; Source and Grade
// are read directly off the leads table since source can include values
// that predate/aren't in the customizable option list, and grade is plain
// free text with no dedicated options table at all.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const where: string[] = []
  const params: any[] = []
  if (session.role === 'client_counsellor') {
    // Counsellors see every lead at their institute, so the filter options
    // must cover the institute too — scoping these to their own leads left
    // the Counsellor list showing only themselves.
    params.push(session.clientId)
    where.push(`l.client_id = $${params.length}`)
  }
  // The Source and Grade dropdowns must only offer values that exist on
  // visible leads — otherwise the filter panel advertises a source whose
  // every lead is outside the global window, and picking it returns
  // nothing. Both queries below are aliased to `l` for this clause.
  where.push(leadDateRangeSql('l'))
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [stages, sources, grades, counsellors] = await Promise.all([
    query<{ key: string; label: string }>(
      `SELECT key, label FROM pipeline_stages WHERE client_id = $1 AND is_active = true ORDER BY sort_order ASC`,
      [session.clientId]
    ).catch(() => []),
    query<{ source: string }>(
      `SELECT DISTINCT l.source FROM leads l ${whereSql} ORDER BY l.source ASC`,
      params
    ),
    query<{ grade: string }>(
      `SELECT DISTINCT l.grade FROM leads l ${whereSql} AND l.grade IS NOT NULL AND l.grade <> '' ORDER BY l.grade ASC`,
      params
    ),
    // Only counsellors who actually hold leads here, so the panel never
    // offers a name that returns nothing.
    query<{ id: string; full_name: string }>(
      `SELECT DISTINCT u.id, u.full_name
       FROM leads l JOIN users u ON u.id = l.assigned_counsellor_id
       ${whereSql}
       ORDER BY u.full_name ASC`,
      params
    ).catch(() => []),
  ])

  return NextResponse.json({
    stages,
    sources: sources.map((s) => s.source).filter(Boolean),
    grades: grades.map((g) => g.grade).filter(Boolean),
    counsellors: counsellors.map((c) => ({ id: c.id, name: c.full_name || 'Unnamed' })),
  })
}
