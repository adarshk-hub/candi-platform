// path: app/api/clients/[id]/whatsapp-sequence-templates/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { handleWriteError } from '@/lib/apiError'

// Lets a client admin see and change which approved Meta template fires on
// each nurture-sequence day (Day 0/2/4/7/10), instead of it being locked to
// whatever seed-defaults auto-generated. GET returns the current mapping;
// POST reassigns one day. The nurture engine (lib/waSequenceEngine.ts)
// reads wa_sequence_templates directly, so a change here takes effect on
// the next send for that day with no other wiring needed.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // stage_key is selected defensively: a database that hasn't had
  // scripts/phase5-migration.sql applied yet would otherwise 500 on a
  // settings page that worked fine the day before.
  const rows = await query(
    `SELECT day_number, template_name, language_code, stage_key
     FROM wa_sequence_templates WHERE client_id = $1 ORDER BY day_number`,
    [params.id]
  ).catch(async (err: any) => {
    if (err?.code !== '42703') throw err
    return query(
      'SELECT day_number, template_name, language_code FROM wa_sequence_templates WHERE client_id = $1 ORDER BY day_number',
      [params.id]
    )
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canCustomize(session, params.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const dayNumber = Number(body.dayNumber)
  const templateName = String(body.templateName || '').trim()
  const languageCode = String(body.languageCode || 'en')
  // Empty string from an unset dropdown means "every stage", stored as NULL
  // rather than as '' so the engine's IS NULL check is the only test needed.
  const stageKey = String(body.stageKey || '').trim() || null

  if (!Number.isInteger(dayNumber) || !templateName) {
    return NextResponse.json({ error: 'dayNumber and templateName are required' }, { status: 400 })
  }

  // Only allow assigning templates Meta has actually approved for this
  // client — prevents pointing a sequence day at something still pending
  // or rejected, which would just fail every send.
  const approved = (
    await query(
      `SELECT 1 FROM wa_templates WHERE client_id = $1 AND name = $2 AND status = 'approved'`,
      [params.id, templateName]
    )
  )[0]
  if (!approved) {
    return NextResponse.json({ error: 'That template is not approved for this client yet' }, { status: 400 })
  }

  try {
    try {
      await query(
        `INSERT INTO wa_sequence_templates (client_id, day_number, template_name, language_code, stage_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (client_id, day_number)
         DO UPDATE SET template_name = $3, language_code = $4, stage_key = $5`,
        [params.id, dayNumber, templateName, languageCode, stageKey]
      )
    } catch (err: any) {
      if (err?.code !== '42703') throw err
      // Pre-migration database — save the template assignment anyway rather
      // than refusing the whole action over a column that only narrows it.
      await query(
        `INSERT INTO wa_sequence_templates (client_id, day_number, template_name, language_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, day_number) DO UPDATE SET template_name = $3, language_code = $4`,
        [params.id, dayNumber, templateName, languageCode]
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
