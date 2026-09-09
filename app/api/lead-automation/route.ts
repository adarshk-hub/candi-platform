// path: app/api/lead-automation/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'

// Two modes only: either a person picks who takes each lead, or the system
// spreads them automatically. The rule-based routing that briefly lived here
// was removed — it added a whole editor to configure something an institute
// this size handles by simply looking at the lead.
const MODES = ['manual', 'round_robin']

// One route for the whole "what happens automatically when a lead arrives"
// panel: who it gets assigned to, and whether the WhatsApp welcome goes out
// on its own or waits to be confirmed. They're edited together on one
// screen, so splitting them across two endpoints would only mean two
// round trips and two ways for the screen to end up half-saved.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  const clientId = req.nextUrl.searchParams.get('clientId') || session?.clientId || ''
  if (!clientId || !canCustomize(session, clientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [client] = await query<{ lead_assignment_mode: string; wa_welcome_confirm: boolean }>(
      'SELECT lead_assignment_mode, wa_welcome_confirm FROM clients WHERE id = $1',
      [clientId]
    )
    return NextResponse.json({
      mode: client?.lead_assignment_mode || 'manual',
      waWelcomeConfirm: client?.wa_welcome_confirm !== false,
    })
  } catch (err: any) {
    if (err?.code === '42703' || err?.code === '42P01') {
      return NextResponse.json({ migrationNeeded: true, mode: 'manual', waWelcomeConfirm: false })
    }
    console.error('[lead-automation] read failed:', err)
    return NextResponse.json({ error: 'Could not load these settings.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const session = getSession(req)
  const body = await req.json().catch(() => ({}))
  const clientId = body.clientId || session?.clientId || ''
  if (!clientId || !canCustomize(session, clientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (body.mode !== undefined && !MODES.includes(body.mode)) {
    return NextResponse.json({ error: `mode must be one of: ${MODES.join(', ')}` }, { status: 400 })
  }

  try {
    if (body.mode !== undefined) {
      await query('UPDATE clients SET lead_assignment_mode = $1 WHERE id = $2', [body.mode, clientId])
    }
    if (body.waWelcomeConfirm !== undefined) {
      await query('UPDATE clients SET wa_welcome_confirm = $1 WHERE id = $2', [!!body.waWelcomeConfirm, clientId])
    }

    await logSettingsActivity(clientId, session, 'Lead Assignment', 'Updated automatic assignment settings')
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.code === '42703' || err?.code === '42P01') {
      return NextResponse.json(
        { error: 'Run scripts/phase2-migration.sql against this database first.' },
        { status: 409 }
      )
    }
    return handleWriteError(err)
  }
}
