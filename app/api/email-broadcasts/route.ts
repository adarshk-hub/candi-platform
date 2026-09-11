// path: app/api/email-broadcasts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession, AGENCY_ROLES } from '@/lib/auth'
import { handleWriteError } from '@/lib/apiError'
import { createBroadcast, listBroadcasts, BroadcastFilters } from '@/lib/emailBroadcast'
import { normalizeFilters } from '@/lib/leadAudience'

function resolveClientId(session: ReturnType<typeof getSession>, requestedClientId?: string | null): string | null {
  if (!session) return null
  if (AGENCY_ROLES.includes(session.role)) return requestedClientId || null
  if (session.role === 'client_admin') return session.clientId
  return null // counsellors can view but not create broadcasts
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedClientId = req.nextUrl.searchParams.get('clientId')
  const clientId = AGENCY_ROLES.includes(session.role) ? requestedClientId : session.clientId
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })

  const rows = await listBroadcasts(clientId)
  return NextResponse.json(rows)
}

// Creates an email broadcast and snapshots its audience into
// email_broadcast_recipients (status 'pending'). Sends happen later, in
// batches, via app/api/cron/email-broadcast-send.
export async function POST(req: NextRequest) {
  const session = getSession(req)
  const body = await req.json().catch(() => null)
  const clientId = resolveClientId(session, body?.clientId)
  if (!clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const name = String(body?.name || '').trim()
  const subject = String(body?.subject || '').trim()
  const emailBody = String(body?.body || '').trim()

  if (!name || !subject || !emailBody) {
    return NextResponse.json({ error: 'Broadcast name, subject, and body are required' }, { status: 400 })
  }

  // Normalised in one shared place (lib/leadAudience.ts) rather than
  // rebuilt here. Each route used to spell this out itself, which is how a
  // new filter ends up working in the preview and silently doing nothing at
  // send time — the source and audience-group filters are exactly that
  // shape of addition.
  const filters: BroadcastFilters = normalizeFilters(body?.filters)

  try {
    const { broadcastId, totalRecipients } = await createBroadcast({
      clientId,
      name,
      subject,
      body: emailBody,
      presetKey: String(body?.presetKey || 'announcement'),
      ctaLabel: body?.ctaLabel || null,
      ctaUrl: body?.ctaUrl || null,
      filters,
      explicitLeadIds: Array.isArray(body?.explicitLeadIds) ? body.explicitLeadIds : null,
      createdBy: session!.id,
    })

    if (totalRecipients === 0) {
      await query(`UPDATE email_broadcasts SET status = 'completed', completed_at = now() WHERE id = $1`, [broadcastId])
    }

    return NextResponse.json({ broadcastId, totalRecipients })
  } catch (err: any) {
    return handleWriteError(err)
  }
}
