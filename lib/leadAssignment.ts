// path: lib/leadAssignment.ts
import { queryAsClient } from './db'

export type AssignmentMode = 'manual' | 'rules' | 'round_robin'

export interface AssignmentRule {
  id: string
  counsellor_id: string
  match_type: 'source' | 'campaign' | 'grade' | 'location' | 'any'
  match_value: string | null
  sort_order: number
  is_active: boolean
}

// Picks the counsellor a brand-new lead should go to, or null to leave it
// unassigned. Called from every intake path (manual Add Lead, Meta Lead Ads,
// landing page) so a lead is never routed one way through one door and a
// different way through another.
//
// Deliberately never reassigns: this only ever runs for a lead that has just
// been created with nobody on it. A counsellor's existing leads are theirs
// until a human moves them.
export async function resolveAssignee(clientId: string, lead: any): Promise<string | null> {
  let mode: AssignmentMode = 'manual'
  try {
    const rows = await queryAsClient<{ lead_assignment_mode: AssignmentMode }>(
      clientId,
      'SELECT lead_assignment_mode FROM clients WHERE id = $1',
      [clientId]
    )
    mode = rows[0]?.lead_assignment_mode || 'manual'
  } catch {
    // Column missing — scripts/phase2-migration.sql hasn't run here yet.
    // Behaving as 'manual' keeps the pre-existing behaviour exactly.
    return null
  }

  if (mode === 'manual') return null

  const active = await activeCounsellorIds(clientId)
  if (active.length === 0) return null

  if (mode === 'rules') {
    const matched = await matchRule(clientId, lead, active)
    if (matched) return matched
    // A lead that matches no rule still has to go somewhere, or "rules"
    // mode would quietly leave gaps in coverage that nobody notices until
    // the Activity page shows a pile of unassigned leads.
  }

  return leastLoadedCounsellor(clientId, active)
}

async function activeCounsellorIds(clientId: string): Promise<string[]> {
  const rows = await queryAsClient<{ id: string }>(
    clientId,
    `SELECT id FROM users
     WHERE client_id = $1 AND role = 'client_counsellor' AND COALESCE(is_active, true)
     ORDER BY full_name`,
    [clientId]
  )
  return rows.map((r) => r.id)
}

async function matchRule(clientId: string, lead: any, active: string[]): Promise<string | null> {
  let rules: AssignmentRule[] = []
  try {
    rules = await queryAsClient<AssignmentRule>(
      clientId,
      `SELECT id, counsellor_id, match_type, match_value, sort_order, is_active
       FROM lead_assignment_rules
       WHERE client_id = $1 AND is_active
       ORDER BY sort_order ASC, created_at ASC`,
      [clientId]
    )
  } catch {
    return null
  }

  // Campaign is matched on the campaign's display name rather than its id,
  // because that's what the person writing the rule can actually see and
  // type — and Meta hands out a fresh campaign_id every time a campaign is
  // cloned or recreated under the same name.
  let campaignName: string | null = null
  if (lead.campaign_id && rules.some((r) => r.match_type === 'campaign')) {
    const rows = await queryAsClient<{ display_name: string }>(
      clientId,
      'SELECT display_name FROM campaigns WHERE id = $1',
      [lead.campaign_id]
    )
    campaignName = rows[0]?.display_name || null
  }

  const fieldFor: Record<string, string | null> = {
    source: lead.source || null,
    grade: lead.grade || null,
    location: lead.location || null,
    campaign: campaignName,
  }

  for (const rule of rules) {
    // Rules pointing at a removed or deactivated counsellor are skipped
    // rather than honoured — otherwise deactivating someone would silently
    // send new leads into a login nobody is using.
    if (!active.includes(rule.counsellor_id)) continue

    if (rule.match_type === 'any') return rule.counsellor_id

    const value = fieldFor[rule.match_type]
    if (!value || !rule.match_value) continue
    // Loose comparison on purpose: "Facebook" from a dropdown and
    // "facebook" from a webhook payload are the same source.
    if (value.trim().toLowerCase() === rule.match_value.trim().toLowerCase()) {
      return rule.counsellor_id
    }
  }

  return null
}

// "Round robin" implemented as least-loaded rather than strict rotation.
// Strict rotation needs a stored pointer that drifts the moment leads are
// deleted, reassigned by hand, or a counsellor is added mid-week; counting
// open leads self-corrects and produces the fair split people actually mean
// by the phrase.
async function leastLoadedCounsellor(clientId: string, active: string[]): Promise<string | null> {
  const rows = await queryAsClient<{ id: string; open_leads: number }>(
    clientId,
    `SELECT u.id, COUNT(l.id)::int AS open_leads
     FROM users u
     LEFT JOIN leads l
       ON l.assigned_counsellor_id = u.id
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_stages ps
        WHERE ps.client_id = l.client_id AND ps.key = l.pipeline_stage
          AND ps.status_group = 'won'
      )
     WHERE u.id = ANY($1)
     GROUP BY u.id, u.full_name
     ORDER BY open_leads ASC, u.full_name ASC
     LIMIT 1`,
    [active]
  )
  return rows[0]?.id || active[0] || null
}
