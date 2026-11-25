// path: app/api/leads/[id]/stage-email/route.ts
// Local Octo only.
//   GET  — the stage emails filled in for this lead (?stage= for just one),
//          plus the emails already sent to the lead
//   POST — send one. { stage, direct, subject?, body? }
//          direct=true  → from the lead's Email tab (subject/body as edited)
//          direct=false → the "Ask before sending" stage prompt
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { isLocalOcto } from '@/lib/localOcto'
import { getStageEmailConfig, stageEmailVars, sendLocalOctoStageEmail } from '@/lib/stageEmail'
import { renderStageEmail } from '@/lib/stageEmailRender'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const lead = access.lead
  if (!isLocalOcto(lead.client_id)) return NextResponse.json({ enabled: false, templates: [], messages: [] })

  const only = req.nextUrl.searchParams.get('stage')
  const config = await getStageEmailConfig(lead.client_id)
  const vars = await stageEmailVars(lead.client_id, lead)
  const labels: Record<string, string> = {}
  try {
    const stages = await query<{ key: string; label: string }>('SELECT key, label FROM pipeline_stages WHERE client_id = $1', [
      lead.client_id,
    ])
    for (const s of stages) labels[s.key] = s.label
  } catch {}

  const templates = Object.entries(config)
    .filter(([stage, e]) => (!only || stage === only) && e.subject?.trim() && e.body?.trim())
    .map(([stage, e]) => ({
      stage,
      label: labels[stage] || stage,
      mode: e.mode,
      subject: renderStageEmail(e.subject, vars),
      body: renderStageEmail(e.body, vars),
    }))

  let messages: any[] = []
  if (!only) {
    messages = await query(
      `SELECT em.id, em.template_key, em.subject, em.body, em.to_email, em.status, em.error, em.created_at,
              u.full_name AS sent_by_name
       FROM email_messages em LEFT JOIN users u ON u.id = em.sent_by
       WHERE em.lead_id = $1 ORDER BY em.created_at DESC LIMIT 200`,
      [params.id]
    ).catch(() => [])
  }
  return NextResponse.json({ enabled: true, hasEmail: !!lead.email, templates, messages })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const lead = access.lead
  if (!isLocalOcto(lead.client_id)) return NextResponse.json({ error: 'Stage emails are not set up for this institute.' }, { status: 400 })

  const b = await req.json().catch(() => ({}))
  if (!b?.stage || typeof b.stage !== 'string') return NextResponse.json({ error: 'stage is required' }, { status: 400 })
  const subject = typeof b.subject === 'string' && b.subject.trim() ? b.subject : undefined
  const body = typeof b.body === 'string' && b.body.trim() ? b.body : undefined

  const result = await sendLocalOctoStageEmail({
    clientId: lead.client_id,
    lead,
    stage: b.stage,
    trigger: b.direct ? 'direct' : 'manual',
    sentBy: session?.id || null,
    subject,
    body,
  })
  if (!result.ok) return NextResponse.json({ error: result.error || 'Email was not sent.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
