// path: app/api/clients/[id]/email-config/route.ts
// Local Octo only: the email each stage sends (subject + body) and how
// (Automatic / Ask before sending / Off). See lib/stageEmail.ts.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canEditSection } from '@/lib/settingsSections'
import { handleWriteError } from '@/lib/apiError'
import { logSettingsActivity } from '@/lib/settingsActivityLog'
import { isLocalOcto } from '@/lib/localOcto'
import type { EmailMode, StageEmailConfig } from '@/lib/stageEmail'

const MODES: EmailMode[] = ['auto', 'manual', 'off']

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Read by the stage-change prompt too, so any user of this institute may read.
  const sameClient = session.clientId === params.id || ['agency_admin', 'agency_staff'].includes(session.role)
  if (!sameClient) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ enabled: false, config: {} })

  let config: StageEmailConfig = {}
  try {
    const [row] = await query<{ email_stage_config: StageEmailConfig | null }>(
      'SELECT email_stage_config FROM clients WHERE id = $1',
      [params.id]
    )
    config = row?.email_stage_config || {}
  } catch {
    // column not added yet
  }
  return NextResponse.json({ enabled: true, config })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  if (!canEditSection(session, params.id, 'stage_email')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isLocalOcto(params.id)) return NextResponse.json({ error: 'Stage emails are not set up for this institute.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const input = body?.config
  if (typeof input !== 'object' || input === null) return NextResponse.json({ error: 'config must be an object' }, { status: 400 })

  const config: StageEmailConfig = {}
  for (const [stage, raw] of Object.entries<any>(input)) {
    if (!/^[a-z0-9_]{1,64}$/.test(stage)) continue
    const subject = String(raw?.subject || '').slice(0, 300)
    const text = String(raw?.body || '').slice(0, 20000)
    const mode: EmailMode = MODES.includes(raw?.mode) ? raw.mode : 'off'
    if (!subject.trim() && !text.trim() && mode === 'off') continue
    config[stage] = { mode, subject, body: text }
  }

  try {
    const [row] = await query<{ email_stage_config: StageEmailConfig }>(
      'UPDATE clients SET email_stage_config = $1 WHERE id = $2 RETURNING email_stage_config',
      [JSON.stringify(config), params.id]
    )
    await logSettingsActivity(params.id, session, 'Stage Emails', 'Updated stage emails')
    return NextResponse.json({ enabled: true, config: row?.email_stage_config || config })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
