// path: app/api/leads/[id]/welcome/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { handleWriteError } from '@/lib/apiError'
import { startSequence } from '@/lib/waSequenceEngine'

// Answers the "send the welcome message?" prompt shown on top of a lead
// whose automatic WhatsApp send is being held (see lib/welcomeMessage.ts).
//
// POST { send: true }  — start the nurture sequence now
// POST { send: false } — never send it for this lead, clear the prompt
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const send = body.send !== false

  try {
    if (!send) {
      await query(`UPDATE leads SET welcome_message_status = 'skipped' WHERE id = $1`, [params.id])
      await query(
        `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
         VALUES ($1, 'system', 'Welcome Message Skipped', $2, $3)`,
        [params.id, 'Declined at the confirmation prompt — no automatic WhatsApp was sent.', session!.id]
      )
      return NextResponse.json({ status: 'skipped' })
    }

    const result = await startSequence(params.id)
    // Marked 'sent' even when startSequence declines because a sequence is
    // already running: the prompt has been answered either way, and leaving
    // it as 'pending' would mean it reappears forever on a lead that is
    // already being messaged.
    await query(`UPDATE leads SET welcome_message_status = 'sent' WHERE id = $1`, [params.id])
    await query(
      `INSERT INTO activity_log (lead_id, activity_type, title, description, actor_id)
       VALUES ($1, 'system', 'Welcome Message Sent', $2, $3)`,
      [
        params.id,
        result.ok ? 'Confirmed at the prompt — WhatsApp welcome sequence started.' : `Confirmed at the prompt, but the sequence did not start: ${result.error}`,
        session!.id,
      ]
    )

    return NextResponse.json({ status: 'sent', ok: result.ok, error: result.error || null })
  } catch (err: any) {
    if (err?.code === '42703') {
      return NextResponse.json(
        { error: 'Run scripts/phase2-migration.sql against this database first.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}
