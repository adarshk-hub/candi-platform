// path: app/api/clients/[id]/booking-notify-config/route.ts
// Local Octo only: booking notification templates and modes (Settings >
// Booking Reminders). See lib/bookingNotify.ts.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canEditSection } from '@/lib/settingsSections'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'
import { isLocalOcto } from '@/lib/localOcto'
import {
  NOTIFY_KINDS,
  NOTIFY_CHANNELS,
  type BookingNotifyConfig,
  type NotifyChannelConfig,
  type NotifyMode,
} from '@/lib/bookingNotify'
import { extractVariableTokens } from '@/components/whatsapp/variableFields'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sameClient = session.clientId === params.id || ['agency_admin', 'agency_staff'].includes(session.role)
  if (!sameClient) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ enabled: false })

  let config: BookingNotifyConfig = {}
  try {
    const [row] = await query<{ booking_notify_config: BookingNotifyConfig | null }>(
      'SELECT booking_notify_config FROM clients WHERE id = $1',
      [params.id]
    )
    config = row?.booking_notify_config || {}
  } catch {
    // column not added yet
  }

  // Approved WhatsApp templates to pick from, with how many variables each has.
  const rows = await query<{ name: string; components: any }>(
    `SELECT name, components FROM wa_templates WHERE client_id = $1 AND status = 'approved' ORDER BY name`,
    [params.id]
  ).catch(() => [])
  const waTemplates = rows.map((t) => {
    const comps = Array.isArray(t.components) ? t.components : []
    const body = comps.find((c: any) => String(c.type || '').toUpperCase() === 'BODY')?.text || ''
    return { name: t.name, body, variables: extractVariableTokens(body).length }
  })

  return NextResponse.json({ enabled: true, config, waTemplates })
}

const MODES: NotifyMode[] = ['auto', 'manual', 'off']
const str = (v: any, max: number) => String(v ?? '').slice(0, max)

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canEditSection(session, params.id, 'booking_notify')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ error: 'Not set up for this institute.' }, { status: 400 })

  const input = (await req.json().catch(() => ({})))?.config
  if (typeof input !== 'object' || input === null) return NextResponse.json({ error: 'config must be an object' }, { status: 400 })

  const config: BookingNotifyConfig = {}
  for (const kind of NOTIFY_KINDS) {
    const k = input[kind] || {}
    config[kind] = {}
    for (const ch of NOTIFY_CHANNELS) {
      const c = k[ch] || {}
      let mode: NotifyMode = MODES.includes(c.mode) ? c.mode : 'off'
      // Reminders fire on a timer with nobody there to confirm.
      if (kind !== 'on_booking' && mode === 'manual') mode = 'auto'
      const out: NotifyChannelConfig = { mode }
      if (ch === 'whatsapp') {
        out.template = str(c.template, 200)
        out.params = Array.isArray(c.params) ? c.params.slice(0, 20).map((p: any) => str(p, 40)) : []
      } else if (ch === 'sms') {
        out.name = str(c.name, 100)
        out.templateId = str(c.templateId, 100)
        out.text = str(c.text, 1000)
      } else {
        out.subject = str(c.subject, 300)
        out.body = str(c.body, 20000)
      }
      config[kind]![ch] = out
    }
  }

  try {
    const [row] = await query<{ booking_notify_config: BookingNotifyConfig }>(
      'UPDATE clients SET booking_notify_config = $1 WHERE id = $2 RETURNING booking_notify_config',
      [JSON.stringify(config), params.id]
    )
    await logSettingsActivity(params.id, session, 'Booking Reminders', 'Updated booking reminders')
    return NextResponse.json({ enabled: true, config: row?.booking_notify_config || config })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
