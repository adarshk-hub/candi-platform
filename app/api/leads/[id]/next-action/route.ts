// path: app/api/leads/[id]/next-action/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { handleWriteError } from '@/lib/apiError'

// Sets, replaces, or completes the one thing a counsellor has committed to
// doing next on this lead.
//
// PUT  { action, dueAt }  — plan it
// POST { note }           — mark the current plan done
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '').trim()
  const dueAt = String(body.dueAt || '').trim()

  if (!action) return NextResponse.json({ error: 'Say what the next action is.' }, { status: 400 })
  if (!dueAt) return NextResponse.json({ error: 'Pick a date for the next action.' }, { status: 400 })

  // A next action is somebody's commitment, so there has to be a somebody.
  // Without this an unassigned lead could carry a plan that appears on no
  // counsellor's list and shows up in nobody's overdue count — worse than
  // having no plan at all, because it looks handled.
  const [lead] = await query<{ assigned_counsellor_id: string | null }>(
    'SELECT assigned_counsellor_id FROM leads WHERE id = $1',
    [params.id]
  )
  if (!lead?.assigned_counsellor_id) {
    return NextResponse.json(
      { error: 'Assign a counsellor to this lead before planning a next action.', needsCounsellor: true },
      { status: 400 }
    )
  }

  try {
    // done_at is cleared alongside: planning a new action on a lead whose
    // last one was completed has to reopen it, or the lead would show as
    // permanently handled and drop out of every overdue report.
    const rows = await query(
      `UPDATE leads
       SET next_action = $1,
           next_action_at = $2::timestamptz,
           next_action_set_by = $3,
           next_action_set_at = now(),
           next_action_done_at = NULL
       WHERE id = $4
       RETURNING id, next_action, next_action_at, next_action_set_at, next_action_done_at`,
      [action, dueAt, session!.id, params.id]
    )

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Next Action Set', $2, $3)`,
      [params.id, `"${action}" planned for ${new Date(dueAt).toLocaleString('en-IN')}.`, session!.id]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json(
        { error: 'Run scripts/phase4-migration.sql against this database first.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}

// Clears the planned action without completing it — the plan was wrong, or
// circumstances changed. Distinct from POST (done), because "cancelled" and
// "completed" mean opposite things to anyone reading the history later.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const [existing] = await query<{ next_action: string | null }>(
      'SELECT next_action FROM leads WHERE id = $1',
      [params.id]
    )

    const rows = await query(
      `UPDATE leads
       SET next_action = NULL, next_action_at = NULL, next_action_set_by = NULL,
           next_action_set_at = NULL, next_action_done_at = NULL
       WHERE id = $1
       RETURNING id, next_action, next_action_at, next_action_done_at`,
      [params.id]
    )

    if (existing?.next_action) {
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Next Action Cancelled', $2, $3)`,
        [params.id, `"${existing.next_action}" cancelled.`, session!.id]
      )
    }

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const note = String(body.note || '').trim()

  try {
    const [existing] = await query<{ next_action: string | null }>(
      'SELECT next_action FROM leads WHERE id = $1',
      [params.id]
    )
    if (!existing?.next_action) {
      return NextResponse.json({ error: 'There is no next action to complete.' }, { status: 400 })
    }

    // The completed action is written to activity_log rather than kept on the
    // lead, so what happened survives the next plan overwriting these columns.
    const rows = await query(
      `UPDATE leads SET next_action_done_at = now() WHERE id = $1
       RETURNING id, next_action, next_action_at, next_action_done_at`,
      [params.id]
    )

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Next Action Done', $2, $3)`,
      [params.id, `"${existing.next_action}" completed.${note ? ` ${note}` : ''}`, session!.id]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    return handleWriteError(err)
  }
}
