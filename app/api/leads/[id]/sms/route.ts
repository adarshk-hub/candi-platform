// path: app/api/leads/[id]/sms/route.ts
// Local Octo only: sends a stage's MSG91 SMS after someone clicks Send in
// the "Ask before sending" prompt. Variables are filled from the lead.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { isLocalOcto } from '@/lib/localOcto'
import { sendLocalOctoStageSms } from '@/lib/msg91Sms'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const lead = access.lead

  if (!isLocalOcto(lead.client_id)) {
    return NextResponse.json({ error: 'SMS is not set up for this institute.' }, { status: 400 })
  }

  const { stage } = await req.json().catch(() => ({}))
  if (!stage || typeof stage !== 'string') return NextResponse.json({ error: 'stage is required' }, { status: 400 })

  const result = await sendLocalOctoStageSms({ clientId: lead.client_id, lead, stage, trigger: 'manual' })
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'SMS was not sent.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
