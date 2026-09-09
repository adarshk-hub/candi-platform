// path: app/api/my-day/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'

function canViewOthers(role: string): boolean {
  return AGENCY_ROLES.includes(role as any) || role === 'client_admin'
}

// One day's work for one person: what the CRM recorded automatically, and
// what they wrote down themselves.
//
// The automatic half is read from activity_log rather than copied into a
// separate table. Duplicating it would mean two records of the same event
// that can disagree — and activity_log already stamps every stage move, call
// and email with who did it and when.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const date = sp.get('date') || new Date().toISOString().slice(0, 10)
  const requestedUser = sp.get('userId')?.trim() || ''
  // A counsellor can only ever look at their own day. Managers can pick
  // somebody, which is what makes this useful in a one-to-one.
  const userId = requestedUser && canViewOthers(session.role) ? requestedUser : session.id

  try {
    const activity = await query(
      `SELECT a.id, a.title, a.description, a.action_type, a.created_at,
              a.lead_id, l.full_name AS lead_name, l.lead_number
       FROM activity_log a
       LEFT JOIN leads l ON l.id = a.lead_id
       WHERE a.actor_id = $1
         AND a.created_at >= $2::date
         AND a.created_at < $2::date + INTERVAL '1 day'
       ORDER BY a.created_at DESC`,
      [userId, date]
    )

    const notes = await query(
      `SELECT n.id, n.title, n.details, n.is_done, n.created_at, n.lead_id,
              l.full_name AS lead_name, l.lead_number
       FROM day_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.user_id = $1 AND n.entry_date = $2::date
       ORDER BY n.is_done ASC, n.created_at ASC`,
      [userId, date]
    )

    // Counted from the same rows the timeline shows, so the headline numbers
    // and the list underneath can never tell different stories.
    const summary = {
      stageMoves: activity.filter((a: any) => a.title === 'Stage Updated').length,
      calls: activity.filter((a: any) => a.title === 'Call Logged').length,
      emails: activity.filter((a: any) => a.title === 'Email Sent').length,
      notes: notes.length,
      notesDone: notes.filter((n: any) => n.is_done).length,
      leadsTouched: new Set(activity.map((a: any) => a.lead_id).filter(Boolean)).size,
    }

    let people: any[] = []
    if (canViewOthers(session.role)) {
      people = await query(
        `SELECT id, full_name FROM users
         WHERE role IN ('client_counsellor', 'client_admin', 'client_staff')
         ORDER BY full_name`
      )
    }

    return NextResponse.json({ date, userId, activity, notes, summary, people, canViewOthers: canViewOthers(session.role) })
  } catch (err: any) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        date,
        userId,
        activity: [],
        notes: [],
        summary: { stageMoves: 0, calls: 0, emails: 0, notes: 0, notesDone: 0, leadsTouched: 0 },
        people: [],
        canViewOthers: canViewOthers(session.role),
        error: 'Run scripts/phase3-migration.sql against this database first.',
      })
    }
    console.error('[my-day] failed:', err)
    return NextResponse.json({ error: 'Could not load your day.' }, { status: 500 })
  }
}

// Notes are always written against the logged-in user, never against somebody
// else — a manager viewing a counsellor's day is reading it, not adding to it.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

  const date = body.date || new Date().toISOString().slice(0, 10)

  try {
    const rows = await query(
      `INSERT INTO day_notes (client_id, user_id, entry_date, lead_id, title, details)
       VALUES ($1,$2,$3::date,$4,$5,$6) RETURNING *`,
      [session.clientId, session.id, date, body.leadId || null, title, body.details || null]
    )
    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err?.code === '42P01') {
      return NextResponse.json(
        { error: 'Run scripts/phase3-migration.sql against this database first.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}
