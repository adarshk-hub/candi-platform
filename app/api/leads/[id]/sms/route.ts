// path: app/api/leads/[id]/sms/route.ts
// Local Octo only.
//   GET  — this lead's sent SMS, plus the templates that can be sent by hand
//   POST — send one template to this lead. { stage, direct }:
//          direct=true  → sent from the lead's SMS tab (any template)
//          direct=false → the "Ask before sending" stage prompt
// Variables are filled from the lead.
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { isLocalOcto } from '@/lib/localOcto'
import { sendLocalOctoStageSms, LOCAL_OCTO_SMS_TEMPLATES } from '@/lib/msg91Sms'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!isLocalOcto(access.lead.client_id)) return NextResponse.json({ enabled: false, messages: [], templates: [] })

  let messages: any[] = []
  try {
    messages = await query(
      `SELECT id, template_name, body, mobile, trigger, broadcast_name, created_at
       FROM sms_messages WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [params.id]
    )
  } catch {
    // table not created yet
  }
  const templates = Object.entries(LOCAL_OCTO_SMS_TEMPLATES).map(([stage, t]) => ({ stage, name: t.name, text: t.text }))
  return NextResponse.json({ enabled: true, messages, templates })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const lead = access.lead

  if (!isLocalOcto(lead.client_id)) {
    return NextResponse.json({ error: 'SMS is not set up for this institute.' }, { status: 400 })
  }

  const { stage, direct } = await req.json().catch(() => ({}))
  if (!stage || typeof stage !== 'string') return NextResponse.json({ error: 'stage is required' }, { status: 400 })

  const result = await sendLocalOctoStageSms({
    clientId: lead.client_id,
    lead,
    stage,
    trigger: direct ? 'direct' : 'manual',
    sentBy: session?.id || null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'SMS was not sent.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
