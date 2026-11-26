// path: app/api/leads/[id]/booking-notify/route.ts
// Local Octo only — the "Ask before sending" step right after a call is booked.
//   GET  ?eventId= — channels set to "Ask before sending", with their text
//   POST { eventId, channels[] } — send those
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { isLocalOcto } from '@/lib/localOcto'
import {
  NOTIFY_CHANNELS,
  getBookingNotifyConfig,
  loadBooking,
  previewChannel,
  sendBookingNotifications,
  type NotifyChannel,
} from '@/lib/bookingNotify'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const clientId = access.lead.client_id
  const eventId = req.nextUrl.searchParams.get('eventId') || ''
  if (!isLocalOcto(clientId) || !eventId) return NextResponse.json({ channels: [] })

  const booking = await loadBooking(clientId, eventId)
  if (!booking || booking.lead.id !== params.id || booking.event_type !== 'call_booked') {
    return NextResponse.json({ channels: [] })
  }
  const cfg = (await getBookingNotifyConfig(clientId)).on_booking || {}
  const channels = []
  for (const ch of NOTIFY_CHANNELS) {
    const c = cfg[ch]
    if (c?.mode !== 'manual') continue
    if (ch === 'email' && !booking.lead.email) continue
    channels.push({ channel: ch, preview: await previewChannel(clientId, booking, c, ch) })
  }
  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const clientId = access.lead.client_id
  if (!isLocalOcto(clientId)) return NextResponse.json({ error: 'Not set up for this institute.' }, { status: 400 })

  const b = await req.json().catch(() => ({}))
  const eventId = String(b?.eventId || '')
  const channels: NotifyChannel[] = Array.isArray(b?.channels)
    ? b.channels.filter((c: any) => (NOTIFY_CHANNELS as string[]).includes(c))
    : []
  const booking = eventId ? await loadBooking(clientId, eventId) : null
  if (!booking || booking.lead.id !== params.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (channels.length === 0) return NextResponse.json({ ok: true, results: {} })

  const results = await sendBookingNotifications({
    clientId,
    eventId,
    kind: 'on_booking',
    trigger: 'manual',
    channels,
    sentBy: session?.id || null,
  })
  const failed = Object.entries(results).filter(([, r]) => !r.ok)
  if (failed.length) {
    return NextResponse.json(
      { error: failed.map(([ch, r]) => `${ch}: ${r.error}`).join(' · '), results },
      { status: 400 }
    )
  }
  return NextResponse.json({ ok: true, results })
}
