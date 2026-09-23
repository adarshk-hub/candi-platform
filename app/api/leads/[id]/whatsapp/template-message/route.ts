import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { sendTemplateMessage } from '@/lib/metaWhatsapp'
import { pauseSequenceForLead } from '@/lib/waSequenceEngine'
import { handleWriteError } from '@/lib/apiError'
import { bodyComponentFor, extractVariableTokens, renderBody, resolveTemplateVariables } from '@/lib/templateVariables'

// Companion to POST /api/leads/[id]/whatsapp/messages — that route sends
// free-form text (window must be open); this one sends an approved
// template, the only message type Meta allows outside the window, so a
// counsellor can restart a conversation that's gone quiet for 24h+.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req)
  const access = await assertLeadAccess(session, params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const lead = access.lead

  const { templateId, variables } = await req.json()
  if (!templateId) {
    return NextResponse.json({ error: 'templateId required' }, { status: 400 })
  }

  const template = (
    await query<{ name: string; language: string; components: any }>(
      `SELECT name, language, components FROM wa_templates WHERE id = $1 AND client_id = $2 AND status = 'approved'`,
      [templateId, lead.client_id]
    )
  )[0]
  if (!template) {
    return NextResponse.json({ error: 'Template not found or not approved' }, { status: 404 })
  }

  const components = Array.isArray(template.components) ? template.components : []
  const bodyComponent = components.find((c: any) => String(c.type || '').toUpperCase() === 'BODY')
  const bodyText: string = bodyComponent?.text || ''
  const tokens = extractVariableTokens(bodyText)
  const variableCount = tokens.length

  // If the admin has mapped this template's variables to lead fields, those
  // win — the values are filled from this lead's own record rather than
  // being retyped (or mistyped) on every send.
  const mapped = await resolveTemplateVariables(lead.client_id, template.name, params.id)
  const values: string[] = mapped
    ? mapped.values
    : Array.isArray(variables)
    ? variables.map((v) => String(v ?? '').trim())
    : []
  if (values.length !== variableCount || values.some((v) => !v)) {
    return NextResponse.json(
      { error: `This template needs ${variableCount} variable(s), all filled in.` },
      { status: 400 }
    )
  }

  // Render a human-readable copy of the sent template for the thread, same
  // as a delivered template would read, so the chat log stays legible.
  const renderedBody = renderBody(bodyText, values, tokens)

  try {
    let row = (
      await query(
        `INSERT INTO whatsapp_messages (lead_id, direction, message_type, body, template_name, status, sent_by)
         VALUES ($1, 'outbound', 'template', $2, $3, 'queued', $4)
         RETURNING *`,
        [params.id, renderedBody, template.name, session!.id]
      )
    )[0]

    const result = await sendTemplateMessage({
      clientId: lead.client_id,
      to: lead.whatsapp_number,
      templateName: template.name,
      languageCode: template.language || 'en',
      // Named templates ({{customer}}) need the variable name on each
      // parameter; numbered ones must not carry one.
      components: bodyComponentFor(tokens, values) || [],
    })

    const updated = (
      await query(
        `UPDATE whatsapp_messages SET status = $1, wamid = $2, external_message_id = $2 WHERE id = $3 RETURNING *`,
        [result.ok ? 'sent' : 'failed', result.wamid || null, row.id]
      )
    )[0]

    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: updated }, { status: 502 })
    }

    await pauseSequenceForLead(params.id)

    return NextResponse.json(updated)
  } catch (err: any) {
    return handleWriteError(err)
  }
}
