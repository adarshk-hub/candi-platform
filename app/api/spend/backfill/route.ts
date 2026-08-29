import { NextRequest, NextResponse } from 'next/server'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { backfillMetaAdSpend } from '@/lib/adSpendSync'

// Backfilling many weeks across many campaigns means more Meta API pages to
// walk through than a single-week sync — give it real headroom rather than
// the platform's short default. (Vercel Hobby plan caps this at 60s; Pro/
// Enterprise allow higher if this ever isn't enough for a very large
// account.)
export const maxDuration = 60

// One-off (or occasionally re-run) catch-up for historical spend that the
// regular weekly sync never covers — see the comment on backfillMetaAdSpend
// for why that gap exists. Callable two ways: a logged-in agency session
// (the /spend page's "Backfill" button), or a shared secret (same
// x-cron-secret pattern as /api/cron/ad-spend-sync), for an external
// scheduler to trigger it without a login.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  const cronSecret = process.env.CRON_SECRET
  const providedSecret = req.headers.get('x-cron-secret')
  const isCronAuthed = !!cronSecret && providedSecret === cronSecret
  const isSessionAuthed = !!session && AGENCY_ROLES.includes(session.role)

  if (!isCronAuthed && !isSessionAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const weeksBack = Math.min(Math.max(Number(body.weeks) || 12, 1), 104) // cap at 2 years to bound one request

  try {
    const results = await backfillMetaAdSpend(weeksBack)
    return NextResponse.json({ ok: true, weeksRequested: weeksBack, results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Backfill failed' }, { status: 502 })
  }
}
