// path: lib/templateVariables.ts
import { query } from '@/lib/db'
import {
  TemplateVariableMapping,
  buildBodyParameters,
  extractVariableTokens,
  normalizeVariableMap,
} from '@/lib/templateVariableFields'

// Field definitions and the pure helpers live in templateVariableFields so
// that client components can import them without pulling the database
// driver into the browser bundle; they are re-exported here for callers
// that want everything from one place.
export * from '@/lib/templateVariableFields'

// Every client has its own database (see getClientPool in lib/db), so
// scripts/wa-template-variable-map.sql has to be applied once per client
// database, and a column present for one client can be missing for the
// next. Rather than leave that to be remembered, the column is checked
// against whichever database the current request is using and created on
// demand if absent. The cache is keyed by database name for the same
// reason — a single boolean would leak one client's answer to another.
const variableMapColumnCache = new Map<string, boolean>()

async function columnState(): Promise<{ db: string; present: boolean }> {
  const row = (
    await query<{ db: string; present: boolean }>(
      `SELECT current_database() AS db,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'wa_templates' AND column_name = 'variable_map'
              ) AS present`
    )
  )[0]
  return { db: row?.db || 'unknown', present: !!row?.present }
}

export async function hasVariableMapColumn(): Promise<boolean> {
  try {
    const { db, present } = await columnState()
    // Only a positive answer is cached: a column never disappears, but a
    // missing one can be added at any moment by ensureVariableMapColumn.
    if (present) variableMapColumnCache.set(db, true)
    return present
  } catch {
    return false
  }
}

// Adds the column to this client's database if it isn't there yet. Safe to
// call repeatedly: ADD COLUMN IF NOT EXISTS is a no-op once it exists.
export async function ensureVariableMapColumn(): Promise<boolean> {
  try {
    const { db, present } = await columnState()
    if (variableMapColumnCache.get(db)) return true
    if (present) {
      variableMapColumnCache.set(db, true)
      return true
    }
    await query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS variable_map JSONB`)
    variableMapColumnCache.set(db, true)
    return true
  } catch (err) {
    console.error('[templateVariables] could not add wa_templates.variable_map:', err)
    return false
  }
}

interface LeadForVariables {
  full_name?: string | null
  child_name?: string | null
  whatsapp_number?: string | null
  grade?: string | null
  location?: string | null
  counsellor_name?: string | null
  institute_name?: string | null
}

// Meta rejects a send outright (#132000) when a body parameter is an empty
// string, so every mapping falls back to something.
function valueFor(mapping: TemplateVariableMapping, lead: LeadForVariables): string {
  const fallback = (mapping.value || '').trim()
  switch (mapping.source) {
    case 'custom':
      return fallback
    case 'full_name':
      return (lead.full_name || '').trim() || fallback
    case 'child_name':
      // A child's name is often blank early on, so the parent's name is a
      // safer stand-in than sending an empty parameter.
      return (lead.child_name || '').trim() || (lead.full_name || '').trim() || fallback
    case 'phone':
      return (lead.whatsapp_number || '').trim() || fallback
    case 'grade':
      return (lead.grade || '').trim() || fallback
    case 'location':
      return (lead.location || '').trim() || fallback
    case 'counsellor_name':
      return (lead.counsellor_name || '').trim() || fallback
    case 'institute_name':
      return (lead.institute_name || '').trim() || fallback
    default:
      return fallback
  }
}

// Everything a mapping can refer to, fetched in one go.
export async function loadLeadForVariables(leadId: string): Promise<LeadForVariables | null> {
  const row = (
    await query<LeadForVariables>(
      `SELECT l.full_name, l.child_name, l.whatsapp_number, l.grade, l.location,
              u.full_name AS counsellor_name, c.name AS institute_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_counsellor_id
       LEFT JOIN clients c ON c.id = l.client_id
       WHERE l.id = $1`,
      [leadId]
    )
  )[0]
  return row || null
}

// Reads the stored map for one template. Returns null when the admin never
// set one up, so callers can fall back to their old behaviour rather than
// silently sending blanks.
export async function getTemplateVariableMap(
  clientId: string,
  templateName: string
): Promise<{ map: Record<string, TemplateVariableMapping>; tokens: string[] } | null> {
  const hasColumn = await hasVariableMapColumn()
  const row = (
    await query<{ components: any; variable_map: any }>(
      `SELECT components, ${hasColumn ? 'variable_map' : 'NULL AS variable_map'} FROM wa_templates
       WHERE client_id = $1 AND name = $2 ORDER BY submitted_at DESC LIMIT 1`,
      [clientId, templateName]
    )
  )[0]
  if (!row) return null

  const components = Array.isArray(row.components) ? row.components : []
  const bodyText: string = components.find((c: any) => String(c?.type).toUpperCase() === 'BODY')?.text || ''
  const tokens = extractVariableTokens(bodyText)
  const map = normalizeVariableMap(row.variable_map)
  if (tokens.length === 0) return { map: {}, tokens }
  // A partly-mapped template is treated as unmapped — a half-filled body
  // would be rejected by Meta anyway.
  if (tokens.some((t) => !map[t])) return null
  return { map, tokens }
}

// Resolves a template's variables for one lead. null means "this template
// has no usable map" — the caller should fall back to asking, or to its own
// default.
export async function resolveTemplateVariables(
  clientId: string,
  templateName: string,
  leadId: string
): Promise<{ tokens: string[]; values: string[] } | null> {
  const mapped = await getTemplateVariableMap(clientId, templateName)
  if (!mapped) return null
  if (mapped.tokens.length === 0) return { tokens: [], values: [] }

  const lead = await loadLeadForVariables(leadId)
  if (!lead) return null
  return { tokens: mapped.tokens, values: mapped.tokens.map((t) => valueFor(mapped.map[t], lead)) }
}

// The components array for a send, or undefined for a template whose body
// has no variables at all.
export function bodyComponentFor(tokens: string[], values: string[]): any[] | undefined {
  if (tokens.length === 0) return undefined
  return [{ type: 'body', parameters: buildBodyParameters(tokens, values) }]
}
