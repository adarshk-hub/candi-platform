// path: components/whatsapp/variableFields.ts
// A template's placeholders are approved by Meta as slots with no meaning
// attached — Meta has no idea that {{1}} (or {{customer}}) is "the parent's
// name". What each slot stands for is therefore a per-template decision the
// admin makes once, here, instead of being hardcoded ("variable 1 is always
// the parent's name") or re-typed by a counsellor on every single send.
export type TemplateVariableSource =
  | 'full_name'
  | 'child_name'
  | 'phone'
  | 'grade'
  | 'location'
  | 'source'
  | 'counsellor_name'
  | 'institute_name'
  | 'custom'

export interface TemplateVariableMapping {
  source: TemplateVariableSource
  // Only used when source === 'custom': the fixed text to send, and also the
  // fallback value when a lead has nothing stored for the chosen field.
  value?: string
}

// Meta offers exactly two placeholder styles per template and they cannot be
// mixed: numbered ({{1}}, {{2}}) or named ({{customer}}). This is the same
// "Type of variable — Name / Number" choice WhatsApp Manager asks for, and
// it has to travel with the submission as parameter_format.
export type VariableFormat = 'NUMBER' | 'NAME'

export const VARIABLE_SOURCE_LABELS: Record<TemplateVariableSource, string> = {
  full_name: "Parent's name",
  child_name: "Child's name",
  phone: 'Phone number',
  grade: 'Grade',
  location: 'Location',
  source: 'Lead source',
  counsellor_name: "Counsellor's name",
  institute_name: 'Institute name',
  custom: 'Fixed text (same for everyone)',
}

export const VARIABLE_SOURCES = Object.keys(VARIABLE_SOURCE_LABELS) as TemplateVariableSource[]

// Meta reviews a template against example values rather than live customer
// data, so every variable needs a sample. These stand in whenever the admin
// mapped a slot to a lead field, which has no single fixed value.
export const VARIABLE_SAMPLE_VALUES: Record<TemplateVariableSource, string> = {
  full_name: 'Ramesh Kumar',
  child_name: 'Aarav',
  phone: '9876543210',
  grade: 'Grade 5',
  location: 'Bengaluru',
  source: 'Instagram',
  counsellor_name: 'Sneha',
  institute_name: 'Our school',
  custom: 'Sample text',
}

// A sensible variable name to suggest for each field, used when the template
// is written in Meta's named style.
export const VARIABLE_SUGGESTED_NAMES: Record<TemplateVariableSource, string> = {
  full_name: 'customer_name',
  child_name: 'child_name',
  phone: 'phone',
  grade: 'grade',
  location: 'location',
  source: 'source',
  counsellor_name: 'counsellor',
  institute_name: 'school_name',
  custom: 'custom_text',
}

// Meta's rule for a named variable: lower-case letters, digits and
// underscores only.
export function sanitizeVariableName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
}

// Pulls the placeholders out of a body in order of first appearance,
// de-duplicated — "{{1}} … {{2}} … {{1}}" is two variables, not three. The
// token is whatever sits inside the braces: "1" when numbered, "customer"
// when named.
export function extractVariableTokens(bodyText: string): string[] {
  const seen: string[] = []
  for (const match of (bodyText || '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const token = match[1]
    if (!seen.includes(token)) seen.push(token)
  }
  // A numbered template reads in numeric order regardless of where each
  // placeholder happens to sit in the sentence.
  if (seen.length > 0 && seen.every((t) => /^\d+$/.test(t))) {
    return seen.sort((a, b) => Number(a) - Number(b))
  }
  return seen
}

export function isNamedToken(token: string): boolean {
  return !/^\d+$/.test(token)
}

// Which style a body is written in. An empty body counts as numbered, the
// default for a new template.
export function detectVariableFormat(bodyText: string): VariableFormat {
  return extractVariableTokens(bodyText).some(isNamedToken) ? 'NAME' : 'NUMBER'
}

// Accepts whatever shape came back from JSONB and normalises it into a
// token-keyed map, so a hand-edited or half-saved row can't crash a send.
export function normalizeVariableMap(raw: any): Record<string, TemplateVariableMapping> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, TemplateVariableMapping> = {}
  for (const [key, entry] of Object.entries(raw as Record<string, any>)) {
    const source = entry?.source
    if (!VARIABLE_SOURCES.includes(source)) continue
    out[String(key)] = { source, value: typeof entry?.value === 'string' ? entry.value : undefined }
  }
  return out
}

// Fills the placeholders in a body with the given values, for previews and
// for the copy of the message written into the chat thread.
export function renderBody(bodyText: string, values: string[], tokens?: string[]): string {
  const slots = tokens && tokens.length > 0 ? tokens : extractVariableTokens(bodyText)
  let out = bodyText
  slots.forEach((token, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'), values[i] ?? '')
  })
  return out
}

// The example values Meta reviews the template against, in slot order.
export function sampleValues(tokens: string[], map: Record<string, TemplateVariableMapping>): string[] {
  return tokens.map((token) => {
    const mapping = map[token]
    if (!mapping) return 'Sample'
    const own = (mapping.value || '').trim()
    if (mapping.source === 'custom') return own || VARIABLE_SAMPLE_VALUES.custom
    return own || VARIABLE_SAMPLE_VALUES[mapping.source]
  })
}

// Builds the body parameters for a send. Named templates need the variable
// name on every parameter; numbered ones must not carry one.
export function buildBodyParameters(tokens: string[], values: string[]): any[] {
  return tokens.map((token, i) =>
    isNamedToken(token)
      ? { type: 'text', parameter_name: token, text: values[i] ?? '' }
      : { type: 'text', text: values[i] ?? '' }
  )
}
