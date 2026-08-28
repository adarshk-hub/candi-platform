import * as XLSX from 'xlsx'
import { SOURCE_LABEL } from './types'

export type ExportFormat = 'xlsx' | 'csv'

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

// One row shape shared by the leads list query and the export endpoint —
// keeps the spreadsheet's column set decoupled from the DB's internal
// column names so a future schema change doesn't silently rename an export
// header a school might already depend on for their own records.
export interface ExportableLead {
  lead_number: number
  full_name: string
  child_name: string | null
  whatsapp_number: string
  second_phone: string | null
  email: string | null
  grade: string | null
  source: string
  stage_label: string
  counsellor_name: string | null
  created_at: string
}

const EXPORT_HEADERS = [
  'Lead ID',
  'Parent Name',
  'Child Name',
  'Phone Number',
  'Second Phone',
  'Email',
  'Grade',
  'Source',
  'Stage',
  'Counsellor',
  'Created At',
] as const

function toExportRow(l: ExportableLead): Record<(typeof EXPORT_HEADERS)[number], string | number> {
  return {
    'Lead ID': l.lead_number,
    'Parent Name': l.full_name || '',
    'Child Name': l.child_name || '',
    'Phone Number': l.whatsapp_number || '',
    'Second Phone': l.second_phone || '',
    Email: l.email || '',
    Grade: l.grade || '',
    Source: SOURCE_LABEL[l.source] || l.source || '',
    Stage: l.stage_label || '',
    Counsellor: l.counsellor_name || '',
    'Created At': l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : '',
  }
}

// Builds the actual file bytes for a leads export. xlsx and csv share the
// same underlying worksheet so the two formats can never drift in which
// columns they include.
export function buildLeadsExportFile(
  leads: ExportableLead[],
  format: ExportFormat
): { buffer: Buffer; contentType: string; extension: string } {
  const rows = leads.map(toExportRow)
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS as unknown as string[] })

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(worksheet)
    // Prefix a UTF-8 BOM so Excel (Windows) doesn't mangle names with
    // non-ASCII characters when the CSV is double-clicked open.
    return { buffer: Buffer.from('\uFEFF' + csv, 'utf-8'), contentType: 'text/csv;charset=utf-8', extension: 'csv' }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return {
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  }
}

// ---------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------

export interface ParsedImportRow {
  fullName: string
  childName: string | null
  whatsappNumber: string
  secondPhone: string | null
  email: string | null
  grade: string | null
  location: string | null
  source: string | null
  stageText: string | null
  serviceInterestedIn: string | null
  occupation: string | null
  companyName: string | null
  keyConcern: string | null
  rowNumber: number // 1-based, matching the spreadsheet row (header = row 1)
}

// Normalizes a spreadsheet header cell down to a bare a-z0-9 key so
// "Parent Name", "parent_name", "Parent  Name " and "PARENT NAME" all match
// the same alias — schools export their own data in all sorts of casings.
function normalizeHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// Every accepted spelling for each field, pre-normalized. The first alias
// list to match a given column header wins.
const FIELD_ALIASES: Record<keyof Omit<ParsedImportRow, 'rowNumber'>, string[]> = {
  fullName: ['parentname', 'fullname', 'name', 'leadname', 'parent', 'contactname'],
  childName: ['childname', 'studentname', 'kidname', 'childsname', 'studentsname'],
  whatsappNumber: [
    'phoneno',
    'phonenumber',
    'phone',
    'whatsappnumber',
    'whatsapp',
    'contactnumber',
    'mobileno',
    'mobilenumber',
    'mobile',
  ],
  secondPhone: ['secondphone', 'alternatephone', 'altphone', 'phone2', 'secondnumber', 'alternatenumber'],
  email: ['email', 'emailaddress', 'emailid'],
  grade: ['grade', 'class', 'gradeclass', 'childclass', 'childsclass'],
  location: ['location', 'city', 'address'],
  source: ['source', 'leadsource'],
  stageText: ['stage', 'pipelinestage', 'status', 'leadstage'],
  serviceInterestedIn: ['serviceinterestedin', 'service', 'course', 'program', 'programme'],
  occupation: ['occupation', 'profession'],
  companyName: ['companyname', 'company', 'employer'],
  keyConcern: ['keyconcern', 'notes', 'remarks', 'comment', 'comments'],
}

function cell(raw: Record<string, any>, headerMap: Record<string, string>, field: keyof typeof FIELD_ALIASES): string {
  for (const alias of FIELD_ALIASES[field]) {
    const originalHeader = headerMap[alias]
    if (originalHeader === undefined) continue
    const value = raw[originalHeader]
    if (value === undefined || value === null) continue
    const str = String(value).trim()
    if (str) return str
  }
  return ''
}

// Reads an uploaded .xlsx/.xls/.csv file into normalized row objects, ready
// for validation + insert. Uses the first sheet only — bulk lead imports
// are expected to be a single flat list, not a multi-tab workbook.
export function parseLeadsImportFile(buffer: Buffer): ParsedImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false })

  return raw.map((row, idx) => {
    const headerMap: Record<string, string> = {}
    for (const header of Object.keys(row)) {
      headerMap[normalizeHeader(header)] = header
    }

    return {
      fullName: cell(row, headerMap, 'fullName'),
      childName: cell(row, headerMap, 'childName') || null,
      whatsappNumber: cell(row, headerMap, 'whatsappNumber'),
      secondPhone: cell(row, headerMap, 'secondPhone') || null,
      email: cell(row, headerMap, 'email') || null,
      grade: cell(row, headerMap, 'grade') || null,
      location: cell(row, headerMap, 'location') || null,
      source: cell(row, headerMap, 'source') || null,
      stageText: cell(row, headerMap, 'stageText') || null,
      serviceInterestedIn: cell(row, headerMap, 'serviceInterestedIn') || null,
      occupation: cell(row, headerMap, 'occupation') || null,
      companyName: cell(row, headerMap, 'companyName') || null,
      keyConcern: cell(row, headerMap, 'keyConcern') || null,
      rowNumber: idx + 2, // +1 for 0-index, +1 for the header row
    }
  })
}

export const IMPORT_MISSING_REQUIRED_MESSAGE =
  'Parent name and phone number are both required — this row was skipped because one or both were missing.'
