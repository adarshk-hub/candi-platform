import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { assertLeadAccess } from '@/lib/leadAccess'
import { extractVariableTokens, hasVariableMapColumn, renderBody, resolveTemplateVariables, variableMapFromRow } from '@/lib/templateVariables'

// Lead-scoped (assertLeadAccess), not the settings-only canCustomize check
// GET /api/templates/[clientId] uses — a counsellor who can open this lead's
// WhatsApp tab needs to be able to pick a template to restart a closed
// 24hr window, even if they can't manage templates in Settings.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await assertLeadAccess(getSession(req), params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const hasColumn = await hasVariableMapColumn()
  const rows = await query<{ id: string; name: string; category: string | null; language: string; components: any; variable_map: any }>(
    `SELECT id, name, category, language, components, ${hasColumn ? 'variable_map' : 'NULL AS variable_map'}
     FROM wa_templates WHERE client_id = $1 AND status = 'approved' ORDER BY name ASC`,
    [access.lead.client_id]
  )

  const templates = await Promise.all(
    rows.map(async (row) => {
      const components = Array.isArray(row.components) ? row.components : []
      const bodyComponent = components.find((c: any) => String(c.type || '').toUpperCase() === 'BODY')
      const bodyText: string = bodyComponent?.text || ''
      const tokens = extractVariableTokens(bodyText)
      const map = variableMapFromRow(row)
      // When the admin has already said what every {{n}} stands for, the
      // counsellor is shown the finished message rather than a row of boxes
      // to retype — variableCount 0 means "nothing left to fill in".
      const fullyMapped = tokens.length > 0 && tokens.every((t) => map[t])
      const resolved = fullyMapped ? await resolveTemplateVariables(access.lead.client_id, row.name, params.id) : null

      return {
        id: row.id,
        name: row.name,
        category: row.category,
        language: row.language,
        bodyPreview: resolved ? renderBody(bodyText, resolved.values, resolved.tokens) : bodyText,
        variableCount: resolved ? 0 : tokens.length,
      }
    })
  )

  return NextResponse.json(templates)
}
