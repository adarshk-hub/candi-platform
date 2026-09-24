// path: app/api/templates/counsellor-alert/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { canCustomize } from '@/lib/customizeAccess'
import { decrypt } from '@/lib/waEncryption'
import { submitAndRecordTemplate } from '@/lib/metaWhatsapp'
import { COUNSELLOR_ALERT_TEMPLATES } from '@/lib/counsellorAlerts'
import { handleWriteError } from '@/lib/apiError'

// Counsellor alerts go to staff, who have usually never messaged the school
// number — so WhatsApp's 24-hour rule blocks plain text and only an
// approved template gets through. This submits that one template, so
// turning the alerts on doesn't mean hand-writing it.
async function statusFor(clientId: string) {
  const templates = []
  for (const def of COUNSELLOR_ALERT_TEMPLATES) {
    const [row] = await query<{ status: string; rejection_reason: string | null }>(
      `SELECT status, rejection_reason FROM wa_templates
       WHERE client_id = $1 AND name ILIKE $2 ORDER BY submitted_at DESC LIMIT 1`,
      [clientId, `%${def.name}%`]
    )
    templates.push({
      name: def.name,
      purpose: def.name === 'counsellor_new_lead' ? 'New lead' : 'Call or visit booked',
      body: def.body,
      status: row?.status || 'none',
      rejectionReason: row?.rejection_reason || null,
    })
  }
  // Both have to be approved before every alert can be delivered.
  const status = templates.every((t) => t.status === 'approved')
    ? 'approved'
    : templates.some((t) => t.status === 'rejected')
      ? 'rejected'
      : templates.some((t) => t.status === 'pending')
        ? 'pending'
        : 'none'
  return { status, templates }
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  const clientId = req.nextUrl.searchParams.get('clientId') || ''
  if (!canCustomize(session, clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await statusFor(clientId))
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  const { clientId } = await req.json().catch(() => ({ clientId: '' }))
  if (!canCustomize(session, clientId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [config] = await query<{ waba_id: string; access_token: string }>(
    'SELECT waba_id, access_token FROM wa_configs WHERE client_id = $1',
    [clientId]
  )
  if (!config?.waba_id || !config?.access_token) {
    return NextResponse.json({ error: 'Connect WhatsApp for this institute first.' }, { status: 400 })
  }

  try {
    const token = decrypt(config.access_token)
    const results = []
    for (const def of COUNSELLOR_ALERT_TEMPLATES) {
      results.push(
        await submitAndRecordTemplate({
          clientId,
          wabaId: config.waba_id,
          accessToken: token,
          name: def.name,
          category: def.category,
          body: def.body,
        })
      )
    }
    return NextResponse.json({ results, ...(await statusFor(clientId)) })
  } catch (err) {
    return handleWriteError(err)
  }
}
