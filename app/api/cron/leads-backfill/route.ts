import { NextRequest, NextResponse } from 'next/server'
import { backfillMetaLeadsForAllClients } from '@/lib/metaLeadAdsBackfill'

// Looping over every client, each pulling every lead form's full history,
// can take a while as the client count grows — give it real headroom
// rather than the platform's short default (same reasoning as
// /api/spend/backfill). Vercel Hobby caps this at 60s regardless.
export const maxDuration = 60

// Meant to be hit periodically by an external scheduler (cron-job.org,
// etc.) — same pattern and same shared secret as /api/cron/ad-spend-sync.
// Loops over every client with a Meta Page ID configured (from the central
// registry), so cron-job.org only ever needs to call this one URL —
// there's no need to configure a separate cron job per institute.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = await backfillMetaLeadsForAllClients()
  return NextResponse.json({ ok: true, clients: results.length, results })
}
