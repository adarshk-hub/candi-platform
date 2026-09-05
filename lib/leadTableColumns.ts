// path: lib/leadTableColumns.ts
// The catalogue of columns the leads table can show, and which are on by
// default. Shared by the settings picker and the table itself so the two
// can't drift — adding a column here makes it appear in both.

export type LeadColumnKey =
  | 'id'
  | 'lead'
  | 'child_name'
  | 'phone'
  | 'email'
  | 'grade'
  | 'stage'
  | 'source'
  | 'campaign'
  | 'score'
  | 'created'
  | 'counsellor'

export interface LeadColumnDef {
  key: LeadColumnKey
  label: string
  // Default pixel width, used when the user hasn't dragged this column.
  width: number
  // A row with no name and no way to open it isn't a leads table, so the
  // picker refuses to let this one be switched off.
  required?: boolean
  hint?: string
}

export const LEAD_COLUMNS: LeadColumnDef[] = [
  { key: 'id', label: 'ID', width: 110, hint: 'Lead number and created date' },
  { key: 'lead', label: 'Lead', width: 240, required: true, hint: "Parent's name" },
  { key: 'child_name', label: 'Child', width: 160, hint: "Child's name as its own column" },
  { key: 'phone', label: 'Phone', width: 170 },
  { key: 'email', label: 'Email', width: 220 },
  { key: 'grade', label: 'Grade', width: 130 },
  { key: 'stage', label: 'Stage', width: 200 },
  { key: 'source', label: 'Source', width: 150 },
  { key: 'campaign', label: 'Campaign', width: 200, hint: 'Ad campaign the lead came from' },
  { key: 'score', label: 'Score', width: 110, hint: 'Lead score out of 10' },
  { key: 'created', label: 'Created', width: 150, hint: 'Full created date and time' },
  { key: 'counsellor', label: 'Counsellor', width: 170 },
]

// Exactly the columns the table showed before this setting existed, so an
// install that never opens the picker sees no change at all.
export const DEFAULT_LEAD_COLUMNS: LeadColumnKey[] = [
  'id',
  'lead',
  'phone',
  'grade',
  'stage',
  'source',
  'counsellor',
]

const VALID_KEYS = new Set(LEAD_COLUMNS.map((c) => c.key))

// Normalises whatever is stored (or posted) into a usable, ordered list.
// Order always comes from LEAD_COLUMNS rather than from the stored array:
// the picker is a set of checkboxes, not a sort, so a saved order would be
// an accident of click sequence rather than an intention.
export function resolveLeadColumns(stored: unknown): LeadColumnKey[] {
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_LEAD_COLUMNS

  const chosen = new Set(stored.filter((k): k is LeadColumnKey => VALID_KEYS.has(k as LeadColumnKey)))

  // Required columns are re-added even if a stale payload omitted them,
  // so the table can never render without a name to click.
  for (const col of LEAD_COLUMNS) {
    if (col.required) chosen.add(col.key)
  }

  const ordered = LEAD_COLUMNS.filter((c) => chosen.has(c.key)).map((c) => c.key)
  return ordered.length > 0 ? ordered : DEFAULT_LEAD_COLUMNS
}
