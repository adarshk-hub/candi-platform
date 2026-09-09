// path: app/api/lead-automation/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'

const MODES = ['manual', 'rules', 'round_robin']
const MATCH_TYPES = ['source', 'campaign', 'grade', 'location', 'any']

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
    const rules = await query(
      `SELECT r.id, r.counsellor_id, r.match_type, r.match_value, r.sort_order, r.is_active,
              u.full_name AS counsellor_name
       FROM lead_assignment_rules r
       LEFT JOIN users u ON u.id = r.counsellor_id
       WHERE r.client_id = $1
       ORDER BY r.sort_order ASC, r.created_at ASC`,
      [clientId]
    )
    return NextResponse.json({
      mode: client?.lead_assignment_mode || 'manual',
      waWelcomeConfirm: client?.wa_welcome_confirm !== false,
      rules,
    })
  } catch (err: any) {
    if (err?.code === '42703' || err?.code === '42P01') {
      return NextResponse.json({ migrationNeeded: true, mode: 'manual', waWelcomeConfirm: false, rules: [] })
    }
    console.error('[lead-automation] read failed:', err)
    return NextResponse.json({ error: 'Could not load these settings.' }, { status: 500 })
  }
}

// Rules are replaced wholesale rather than patched one at a time. The panel
// is a short ordered list that people reorder and prune as a unit, and
// sending the whole list keeps the saved order exactly as it appears on
// screen — no drift between a client-side array and a server-side
// sort_order.
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

    if (Array.isArray(body.rules)) {
      const rules = body.rules.filter(
        (r: any) => r && typeof r.counsellor_id === 'string' && MATCH_TYPES.includes(r.match_type)
      )

      // Validated before anything is deleted — a rule pointing at somebody
      // else's counsellor would otherwise wipe the existing list and then
      // refuse to write the replacement.
      const ids = Array.from(new Set(rules.map((r: any) => r.counsellor_id)))
      if (ids.length > 0) {
        const valid = await query<{ id: string }>(
          `SELECT id FROM users WHERE id = ANY($1) AND client_id = $2 AND role = 'client_counsellor'`,
          [ids, clientId]
        )
        if (valid.length !== ids.length) {
          return NextResponse.json({ error: 'A rule points at someone who is not a counsellor here.' }, { status: 400 })
        }
      }

      await query('DELETE FROM lead_assignment_rules WHERE client_id = $1', [clientId])
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i]
        await query(
          `INSERT INTO lead_assignment_rules (client_id, counsellor_id, match_type, match_value, sort_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [clientId, r.counsellor_id, r.match_type, r.match_type === 'any' ? null : r.match_value || null, i, r.is_active !== false]
        )
      }
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
