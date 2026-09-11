// path: app/api/leads/[id]/calls/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { handleWriteError } from '@/lib/apiError'
import { AUTO_CANCEL_PAST_SQL } from '@/lib/bookingWindow'

// Scheduled calls, stored in the same `events` table as campus visits under
// a different event_type.
//
// A booked call and a booked visit are the same shape of thing — a date, a
// time, a status that resolves to done or no-show — so giving calls their
// own table would mean duplicating the reminder and status handling that
// already exists for visits.
//
// Note this is distinct from POST /api/leads/[id]/call, which records a call
// that has *already happened*. Booking is a plan; logging is a fact. Keeping
// them apart is what lets "never called" stay honest — scheduling a call for
// Friday doesn't make it a call that was made.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Anything still "scheduled" from a day that has passed is closed off
  // first, so the list never offers Call done on a slot from last week.
  await query(AUTO_CANCEL_PAST_SQL, [params.id, 'call_booked']).catch(() => {})

  const rows = await query(
    `SELECT * FROM events WHERE lead_id = $1 AND event_type = 'call_booked' ORDER BY event_date DESC, created_at DESC`,
    [params.id]
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { eventDate, eventTime, notes } = await req.json().catch(() => ({}))
  // Both required. A booking with no time can't be reminded about, can't be
  // ordered against anything else in the day, and gives no moment at which
  // it becomes resolvable — it isn't a booking, it's a wish.
  if (!eventDate) return NextResponse.json({ error: 'Pick a date for the call.' }, { status: 400 })
  if (!eventTime) return NextResponse.json({ error: 'Pick a time for the call.' }, { status: 400 })

  try {
    const rows = await query(
      `INSERT INTO events (lead_id, event_type, event_date, event_time, notes, status)
       VALUES ($1, 'call_booked', $2, $3, $4, 'scheduled')
       RETURNING *`,
      [params.id, eventDate, eventTime || null, notes || null]
    )

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Call Booked', $2, $3)`,
      [
        params.id,
        `Call booked for ${eventDate}${eventTime ? ` at ${eventTime}` : ''}.${notes ? ` ${notes}` : ''}`,
        session!.id,
      ]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

// Resolves a booked call — done, missed, or cancelled.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { eventId, status, eventDate, eventTime } = await req.json().catch(() => ({}))
  if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })

  try {
    // Rescheduling moves the existing booking rather than cancelling and
    // creating another, so the lead keeps one call with a history instead of
    // a pile of cancelled rows around the one that counts.
    if (eventDate) {
      if (!eventTime) return NextResponse.json({ error: 'Pick a time for the call.' }, { status: 400 })
      const moved = await query(
        `UPDATE events SET event_date = $1, event_time = $2, status = 'scheduled'
         WHERE id = $3 AND lead_id = $4 AND event_type = 'call_booked' RETURNING *`,
        [eventDate, eventTime, eventId, params.id]
      )
      if (!moved[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Call Rescheduled', $2, $3)`,
        [params.id, `Call moved to ${eventDate} at ${eventTime}.`, session!.id]
      )
      return NextResponse.json(moved[0])
    }

    const allowed = ['completed', 'no_show', 'cancelled']
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }

    const rows = await query(
      `UPDATE events SET status = $1 WHERE id = $2 AND lead_id = $3 AND event_type = 'call_booked' RETURNING *`,
      [status, eventId, params.id]
    )
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // A call marked completed also counts as a call made — otherwise a
    // counsellor who books and completes calls all week still shows as
    // "never called" on the Activity page.
    if (status === 'completed') {
      await query(
        `UPDATE leads
         SET first_called_at = COALESCE(first_called_at, now()),
             last_called_at = now(),
             call_attempt_count = COALESCE(call_attempt_count, 0) + 1
         WHERE id = $1`,
        [params.id]
      ).catch(() => {})
    }

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, action_type, description, actor_id)
       VALUES ($1, 'manual', $2, 'Call', $3, $4)`,
      [
        params.id,
        status === 'completed' ? 'Call Logged' : 'Call Updated',
        status === 'completed' ? 'Booked call completed.' : `Booked call marked ${status.replace('_', ' ')}.`,
        session!.id,
      ]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}
