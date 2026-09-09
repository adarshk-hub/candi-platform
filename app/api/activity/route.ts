// path: app/api/activity/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { fetchActivityOverview, ACTIVITY_BUCKETS, ActivityBucket } from '@/lib/activityQuery'

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const requested = (sp.get('bucket') || 'not_called') as ActivityBucket
  const bucket: ActivityBucket = ACTIVITY_BUCKETS.includes(requested) ? requested : 'not_called'

  try {
    const data = await fetchActivityOverview(session, {
      bucket,
      counsellorId: sp.get('counsellorId')?.trim() || '',
      search: sp.get('search')?.trim() || '',
      page: Math.max(1, Number(sp.get('page') || '1')),
    })
    return NextResponse.json(data)
  } catch (err: any) {
    // 42703 undefined_column — this institute's database predates
    // scripts/activity-migration.sql. Saying so plainly is far more useful
    // than a generic 500, because the fix is a single SQL file away.
    if (err?.code === '42703') {
      return NextResponse.json(
        {
          migrationNeeded: true,
          error:
            'This database is missing the call-tracking and cold-reason columns. Run scripts/activity-migration.sql against it, then reload this page.',
        },
        { status: 200 }
      )
    }
    console.error('[activity] failed:', err)
    return NextResponse.json({ error: 'Could not load activity data.' }, { status: 500 })
  }
}
