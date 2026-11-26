// path: app/api/cron/booking-reminders/route.ts
// Sends Local Octo's "1 hour before" and "10 minutes before" call reminders
// (lib/bookingNotify.ts). Call it every 5 minutes from a scheduler, with the
// CRON_SECRET in an `x-cron-secret` header (or `Authorization: Bearer …`).
import { NextRequest, NextResponse } from 'next/server'
import { sendDueBookingReminders } from '@/lib/bookingNotify'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret || req.headers.get('authorization') === `Bearer ${secret}`
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await sendDueBookingReminders()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = run
export const POST = run
