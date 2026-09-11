// path: app/api/leads/[id]/visits/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { handleWriteError } from '@/lib/apiError'
import { AUTO_CANCEL_PAST_SQL } from '@/lib/bookingWindow'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Same rule as booked calls: a visit still marked scheduled after its day
  // has gone is closed off rather than left offering actions forever.
  await query(AUTO_CANCEL_PAST_SQL, [params.id, 'session_booked']).catch(() => {})

  const rows = await query(
    `SELECT * FROM events WHERE lead_id = $1 AND event_type = 'session_booked'
     ORDER BY event_date DESC, created_at DESC`,
    [params.id]
  )
  return NextResponse.json(rows)
}

// Books a campus visit — "Visit date + time slot booking inside CRM".
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { eventDate, eventTime, meetingLink } = await req.json().catch(() => ({}))
  if (!eventDate) return NextResponse.json({ error: 'Pick a date for the visit.' }, { status: 400 })
  // Required, matching calls: a visit with no time can't be reminded about
  // and never becomes resolvable.
  if (!eventTime) return NextResponse.json({ error: 'Pick a time for the visit.' }, { status: 400 })

  try {
    const rows = await query(
      `INSERT INTO events (lead_id, event_type, event_date, event_time, meeting_link, status)
       VALUES ($1, 'session_booked', $2, $3, $4, 'scheduled')
       RETURNING *`,
      [params.id, eventDate, eventTime, meetingLink || null]
    )

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Visit Scheduled', $2, $3)`,
      [params.id, `Campus visit booked for ${eventDate} at ${eventTime}.`, session!.id]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

// Resolves or reschedules a booked visit.
//
// Mirrors PATCH /api/leads/[id]/calls exactly — same body shape, same status
// values — so one component can drive both kinds of booking rather than each
// needing its own handling.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { eventId, status, eventDate, eventTime } = await req.json().catch(() => ({}))
  if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })

  try {
    // Rescheduling moves the existing booking rather than cancelling and
    // creating another: the lead keeps one visit with a history, instead of
    // a pile of cancelled rows around the one that counts.
    if (eventDate) {
      if (!eventTime) return NextResponse.json({ error: 'Pick a time for the visit.' }, { status: 400 })
      const rows = await query(
        `UPDATE events SET event_date = $1, event_time = $2, status = 'scheduled'
         WHERE id = $3 AND lead_id = $4 AND event_type = 'session_booked' RETURNING *`,
        [eventDate, eventTime, eventId, params.id]
      )
      if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Visit Rescheduled', $2, $3)`,
        [params.id, `Campus visit moved to ${eventDate} at ${eventTime}.`, session!.id]
      )
      return NextResponse.json(rows[0])
    }

    const allowed = ['completed', 'no_show', 'cancelled']
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }

    const rows = await query(
      `UPDATE events SET status = $1 WHERE id = $2 AND lead_id = $3 AND event_type = 'session_booked' RETURNING *`,
      [status, eventId, params.id]
    )
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Visit Updated', $2, $3)`,
      [params.id, `Campus visit marked ${status.replace('_', ' ')}.`, session!.id]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}
