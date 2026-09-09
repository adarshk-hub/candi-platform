// path: app/api/team-day/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'

function canView(role: string): boolean {
  return AGENCY_ROLES.includes(role as any) || role === 'client_admin'
}

// The management view of My Day: every counsellor's work for one day, both
// the automatic trail and the notes they wrote themselves.
//
// A day is small enough to return whole — a busy team produces a few hundred
// activity rows — so this sends everything once and lets the page filter by
// person on the client. Paginating or re-querying per counsellor would mean
// a round trip every time somebody is clicked, for data already in hand.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canView(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  try {
    const counsellors = await query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM users
       WHERE role = 'client_counsellor' AND COALESCE(is_active, true)
       ORDER BY full_name`
    )
    const ids = counsellors.map((c) => c.id)

    if (ids.length === 0) {
      return NextResponse.json({ date, counsellors: [], activity: [], notes: [], totals: emptyTotals() })
    }

    const activity = await query(
      `SELECT a.id, a.actor_id, a.title, a.description, a.created_at,
              a.lead_id, l.full_name AS lead_name, l.lead_number
       FROM activity_log a
       LEFT JOIN leads l ON l.id = a.lead_id
       WHERE a.actor_id = ANY($1)
         AND a.created_at >= $2::date
         AND a.created_at < $2::date + INTERVAL '1 day'
       ORDER BY a.created_at DESC`,
      [ids, date]
    )

    // Notes are read, never written, from here. They belong to the person who
    // made them — a manager reading someone's day shouldn't be able to tick
    // off their tasks, so there is no PATCH on this route at all.
    const notes = await query(
      `SELECT n.id, n.user_id, n.title, n.details, n.is_done, n.created_at,
              n.lead_id, l.full_name AS lead_name, l.lead_number
       FROM day_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.user_id = ANY($1) AND n.entry_date = $2::date
       ORDER BY n.is_done ASC, n.created_at ASC`,
      [ids, date]
    )

    // Per-person counts derived from the same rows the page displays, so the
    // table and the timeline underneath it can never disagree.
    const rows = counsellors.map((c) => {
      const mine = activity.filter((a: any) => a.actor_id === c.id)
      const myNotes = notes.filter((n: any) => n.user_id === c.id)
      return {
        id: c.id,
        name: c.full_name,
        stageMoves: mine.filter((a: any) => a.title === 'Stage Updated').length,
        calls: mine.filter((a: any) => a.title === 'Call Logged').length,
        emails: mine.filter((a: any) => a.title === 'Email Sent').length,
        leadsTouched: new Set(mine.map((a: any) => a.lead_id).filter(Boolean)).size,
        notes: myNotes.length,
        notesDone: myNotes.filter((n: any) => n.is_done).length,
        actions: mine.length,
      }
    })

    const totals = rows.reduce(
      (acc, r) => ({
        stageMoves: acc.stageMoves + r.stageMoves,
        calls: acc.calls + r.calls,
        emails: acc.emails + r.emails,
        notes: acc.notes + r.notes,
        notesDone: acc.notesDone + r.notesDone,
        // Summed per person rather than de-duplicated across the team: two
        // counsellors working the same lead is two people's effort, and this
        // number is about effort, not reach.
        leadsTouched: acc.leadsTouched + r.leadsTouched,
        active: acc.active + (r.actions > 0 || r.notes > 0 ? 1 : 0),
      }),
      { ...emptyTotals(), active: 0 }
    )

    return NextResponse.json({ date, counsellors: rows, activity, notes, totals })
  } catch (err: any) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return NextResponse.json({
        migrationNeeded: true,
        date,
        counsellors: [],
        activity: [],
        notes: [],
        totals: { ...emptyTotals(), active: 0 },
        error: 'Run scripts/phase3-migration.sql against this database first.',
      })
    }
    console.error('[team-day] failed:', err)
    return NextResponse.json({ error: "Could not load the team's day." }, { status: 500 })
  }
}

function emptyTotals() {
  return { stageMoves: 0, calls: 0, emails: 0, notes: 0, notesDone: 0, leadsTouched: 0 }
}
