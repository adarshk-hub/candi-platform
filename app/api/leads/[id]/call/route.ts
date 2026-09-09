// path: app/api/leads/[id]/call/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { handleWriteError } from '@/lib/apiError'

const OUTCOMES = ['connected', 'no_answer', 'busy', 'wrong_number', 'switched_off', 'call_back_later'] as const
type Outcome = (typeof OUTCOMES)[number]

const OUTCOME_LABEL: Record<Outcome, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  wrong_number: 'Wrong number',
  switched_off: 'Switched off',
  call_back_later: 'Call back later',
}

// Records a call attempt as structured data rather than only as a free-text
// note. This is what makes "how many leads have never been called" and "how
// many haven't been called today" answerable at all — a typed activity_log
// entry can't be counted reliably, since the wording is up to whoever typed
// it.
//
// first_called_at is written with COALESCE so it keeps the timestamp of the
// genuine first attempt no matter how many follow-up calls are logged later.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const outcome: Outcome | null = OUTCOMES.includes(body.outcome) ? body.outcome : null
  const notes: string = typeof body.notes === 'string' ? body.notes.trim() : ''

  try {
    const rows = await query(
      `UPDATE leads
       SET first_called_at    = COALESCE(first_called_at, now()),
           last_called_at     = now(),
           call_attempt_count = COALESCE(call_attempt_count, 0) + 1
       WHERE id = $1
       RETURNING id, first_called_at, last_called_at, call_attempt_count`,
      [params.id]
    )

    const description = [
      outcome ? `Outcome: ${OUTCOME_LABEL[outcome]}.` : 'Call attempt logged.',
      notes || null,
    ]
      .filter(Boolean)
      .join(' ')

    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, action_type, description, actor_id)
       VALUES ($1, 'manual', 'Call Logged', 'Call', $2, $3)`,
      [params.id, description, session!.id]
    )

    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json(
        { error: 'Call tracking columns are missing. Run scripts/activity-migration.sql against this database.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}
