// path: app/api/sms/broadcast/route.ts
// Local Octo only: sends one fixed MSG91 template to the leads picked in the
// SMS broadcast screen. Counsellors can't send broadcasts (same as WhatsApp).
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { isLocalOcto } from '@/lib/localOcto'
import { sendLocalOctoSmsBroadcast, LOCAL_OCTO_SMS_TEMPLATES } from '@/lib/msg91Sms'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  const isAgency = AGENCY_ROLES.includes(session.role)
  if (!isAgency && session.role !== 'client_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clientId = isAgency ? body?.clientId : session.clientId
  if (!clientId || !isLocalOcto(clientId)) {
    return NextResponse.json({ error: 'SMS is not set up for this institute.' }, { status: 400 })
  }

  const stage = String(body?.stage || '')
  if (!LOCAL_OCTO_SMS_TEMPLATES[stage]) return NextResponse.json({ error: 'Choose a template.' }, { status: 400 })

  const leadIds: string[] = Array.isArray(body?.leadIds) ? body.leadIds.filter((x: any) => typeof x === 'string') : []
  if (leadIds.length === 0) return NextResponse.json({ error: 'Select at least one lead.' }, { status: 400 })
  if (leadIds.length > 500) return NextResponse.json({ error: 'At most 500 leads per broadcast.' }, { status: 400 })

  const leads = await query('SELECT * FROM leads WHERE client_id = $1 AND id = ANY($2::uuid[])', [clientId, leadIds])

  const result = await sendLocalOctoSmsBroadcast({
    clientId,
    stage,
    leads,
    sentBy: session.id,
    broadcastName: typeof body?.name === 'string' ? body.name.trim().slice(0, 100) || null : null,
  })
  return NextResponse.json(result)
}
