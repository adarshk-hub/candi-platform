// path: lib/leadDateRange.ts
import { query } from './db'

export interface LeadDateRange {
  from: string | null
  to: string | null
}

// The single clause that enforces the global window, appended to the WHERE
// of every query that reads leads.
//
// It takes NO bind parameters on purpose. Each call site builds its own
// positional $1/$2/... list in its own order, so a helper that needed to
// push parameters would have to be threaded through nine different query
// builders and would renumber them differently in each. Reading the bounds
// from the clients row inline sidesteps that entirely: the fragment is a
// constant string that can be dropped into any WHERE without disturbing
// anything around it.
//
// The subquery is a primary-key lookup against a table holding one row per
// institute (each institute has its own database — see lib/db.ts), so this
// is cheap; idx_leads_client_created_at carries the actual filtering work.
//
// NULL on either bound means "no limit on that side", which is why a fresh
// install with no range configured hides nothing.
export function leadDateRangeSql(alias = 'l'): string {
  return `(
    ${alias}.created_at >= COALESCE(
      (SELECT cdr.lead_range_from FROM clients cdr WHERE cdr.id = ${alias}.client_id)::timestamp,
      '-infinity'::timestamp
    )
    AND ${alias}.created_at < COALESCE(
      (SELECT cdr.lead_range_to FROM clients cdr WHERE cdr.id = ${alias}.client_id)::timestamp + INTERVAL '1 day',
      'infinity'::timestamp
    )
  )`
}

export async function getLeadDateRange(clientId: string): Promise<LeadDateRange> {
  try {
    const row = (
      await query<{ lead_range_from: string | null; lead_range_to: string | null }>(
        'SELECT lead_range_from, lead_range_to FROM clients WHERE id = $1',
        [clientId]
      )
    )[0]
    return {
      from: row?.lead_range_from ? toIsoDate(row.lead_range_from) : null,
      to: row?.lead_range_to ? toIsoDate(row.lead_range_to) : null,
    }
  } catch (err) {
    // Migration not run yet — behave as "no range set" rather than
    // breaking every page that asks.
    console.error('[leadDateRange] could not read range:', err)
    return { from: null, to: null }
  }
}

// pg returns DATE columns as JS Date objects. Formatting from the local
// date parts (not toISOString) matters here: toISOString converts to UTC
// first, which rolls a midnight-IST date back to the previous day.
function toIsoDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

// Pulls a requested date range back inside the global window, so a
// dashboard preset or a hand-typed URL can never show leads the window is
// meant to hide. Returns the dates a page should actually query with.
export function clampToRange(
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  range: LeadDateRange
): { from: string | undefined; to: string | undefined } {
  let from = requestedFrom
  let to = requestedTo

  if (range.from && (!from || from < range.from)) from = range.from
  if (range.to && (!to || to > range.to)) to = range.to

  return { from, to }
}

export async function setLeadDateRange(clientId: string, range: LeadDateRange): Promise<void> {
  await query('UPDATE clients SET lead_range_from = $2, lead_range_to = $3 WHERE id = $1', [
    clientId,
    range.from || null,
    range.to || null,
  ])
}
