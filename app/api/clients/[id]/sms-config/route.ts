// path: app/api/clients/[id]/sms-config/route.ts
// Local Octo only: which MSG91 SMS each stage sends, and how (Automatic /
// Ask before sending / Off). The templates themselves are fixed in
// lib/msg91Sms.ts — DLT-approved outside the CRM.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canEditSection } from '@/lib/settingsSections'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'
import { isLocalOcto } from '@/lib/localOcto'
import { LOCAL_OCTO_SMS_TEMPLATES, SmsMode } from '@/lib/msg91Sms'

const MODES: SmsMode[] = ['auto', 'manual', 'off']

function templateList() {
  return Object.entries(LOCAL_OCTO_SMS_TEMPLATES).map(([stage, t]) => ({ stage, name: t.name, text: t.text }))
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Read by the stage-change prompt too, so any user of this institute may read.
  const sameClient = session.clientId === params.id || ['agency_admin', 'agency_staff'].includes(session.role)
  if (!sameClient) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ enabled: false, modes: {}, templates: [] })

  let modes: Record<string, SmsMode> = {}
  try {
    const [row] = await query<{ sms_stage_modes: Record<string, SmsMode> | null }>(
      'SELECT sms_stage_modes FROM clients WHERE id = $1',
      [params.id]
    )
    modes = row?.sms_stage_modes || {}
  } catch {
    // column not added yet
  }
  return NextResponse.json({ enabled: true, modes, templates: templateList() })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canEditSection(session, params.id, 'sms')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ error: 'SMS is not set up for this institute.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const input = body?.modes
  if (typeof input !== 'object' || input === null) {
    return NextResponse.json({ error: 'modes must be an object' }, { status: 400 })
  }

  // Only known stages and known modes are kept.
  const modes: Record<string, SmsMode> = {}
  for (const stage of Object.keys(LOCAL_OCTO_SMS_TEMPLATES)) {
    const m = input[stage]
    modes[stage] = MODES.includes(m) ? m : 'off'
  }

  try {
    const [row] = await query<{ sms_stage_modes: Record<string, SmsMode> }>(
      'UPDATE clients SET sms_stage_modes = $1 WHERE id = $2 RETURNING sms_stage_modes',
      [JSON.stringify(modes), params.id]
    )
    await logSettingsActivity(params.id, session, 'SMS', 'Updated SMS stage settings')
    return NextResponse.json({ enabled: true, modes: row?.sms_stage_modes || modes, templates: templateList() })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
