// path: app/api/next-actions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { fetchNextActionBuckets, fetchNextActionSummary } from '@/lib/nextAction'

function isManager(role: string): boolean {
  return AGENCY_ROLES.includes(role as any) || role === 'client_admin'
}

// GET                      — the caller's own outstanding next actions
// GET ?scope=all           — everyone's, plus per-counsellor counts (managers)
// GET ?counsellorId=<id>   — one counsellor's (managers)
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const scope = sp.get('scope') || ''
  const requested = sp.get('counsellorId')?.trim() || ''

  // A counsellor only ever sees their own, whatever they ask for.
  const manager = isManager(session.role)
  const counsellorId = manager ? (scope === 'all' ? undefined : requested || undefined) : session.id

  try {
    const buckets = await fetchNextActionBuckets(counsellorId)
    const byCounsellor = manager && scope === 'all' ? await fetchNextActionSummary() : []
    return NextResponse.json({ ...buckets, byCounsellor })
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        overdue: [],
        unplanned: [],
        dueToday: [],
        byCounsellor: [],
        error: 'Run scripts/phase4-migration.sql against this database first.',
      })
    }
    console.error('[next-actions] failed:', err)
    return NextResponse.json({ error: 'Could not load next actions.' }, { status: 500 })
  }
}
