import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'

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
    params.push(session.id)
    where.push(`assigned_counsellor_id = $${params.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [stages, sources, grades] = await Promise.all([
    query<{ key: string; label: string }>(
      `SELECT key, label FROM pipeline_stages WHERE client_id = $1 AND is_active = true ORDER BY sort_order ASC`,
      [session.clientId]
    ).catch(() => []),
    query<{ source: string }>(
      `SELECT DISTINCT source FROM leads ${whereSql} ORDER BY source ASC`,
      params
    ),
    query<{ grade: string }>(
      `SELECT DISTINCT grade FROM leads ${whereSql ? whereSql + ' AND' : 'WHERE'} grade IS NOT NULL AND grade <> '' ORDER BY grade ASC`,
      params
    ),
  ])

  return NextResponse.json({
    stages,
    sources: sources.map((s) => s.source).filter(Boolean),
    grades: grades.map((g) => g.grade).filter(Boolean),
  })
}
