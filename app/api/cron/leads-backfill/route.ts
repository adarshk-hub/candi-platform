// path: app/api/cron/leads-backfill/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
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

  // Going through every school takes longer than cron-job.org waits for a
  // reply (30s), so every run showed as "Failed (timeout)". Answer straight
  // away and keep working in the background (up to maxDuration); the
  // summary goes to the Vercel logs.
  waitUntil(
    backfillMetaLeadsForAllClients()
      .then((results) => console.log(`[cron/leads-backfill] done for ${results.length} clients`, JSON.stringify(results)))
      .catch((err) => console.error('[cron/leads-backfill] failed', err))
  )
  return NextResponse.json({ ok: true, started: true })
}
