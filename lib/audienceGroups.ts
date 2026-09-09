// path: lib/audienceGroups.ts
import { query } from '@/lib/db'
import { leadDateRangeSql } from '@/lib/leadDateRange'
import { BroadcastFilters, normalizeFilters } from '@/lib/leadAudience'

export interface AudienceGroup {
  id: string
  name: string
  description: string | null
  kind: 'filters' | 'manual' | 'source'
  origin: string
  filters: BroadcastFilters | null
  count: number
  created_at: string | null
  created_by_name: string | null
  // Source groups are computed, not stored, so they can't be renamed or
  // deleted. The UI uses this rather than inferring it from kind.
  editable: boolean
}

// Groups that exist because the data exists — one per lead source, counted
// live. Nobody creates or maintains these, which is what "audiences are
// saved automatically" comes down to in practice: the moment leads start
// arriving from a new source, that audience is there to broadcast to.
//
// Deriving them beats storing them: a stored copy would need a job to keep
// its count fresh and would quietly rot when a source is renamed.
export async function sourceGroups(clientId: string): Promise<AudienceGroup[]> {
  const rows = await query<{ source: string; count: number; latest: string }>(
    `SELECT l.source, COUNT(*)::int AS count, MAX(l.created_at) AS latest
     FROM leads l
     WHERE l.client_id = $1 AND ${leadDateRangeSql('l')}
       AND l.source IS NOT NULL AND l.source <> ''
     GROUP BY l.source
     ORDER BY count DESC`,
    [clientId]
  )

  return rows.map((r) => ({
    // Prefixed so a computed group's id can never collide with a real
    // audience_groups UUID, and so the API can tell them apart on the way
    // back in without a second lookup.
    id: `source:${r.source}`,
    name: labelForSource(r.source),
    description: 'Everyone who came in through this source. Updates on its own.',
    kind: 'source' as const,
    origin: 'auto',
    filters: { ...normalizeFilters({}), sourceKeys: [r.source] },
    count: Number(r.count),
    created_at: r.latest,
    created_by_name: null,
    editable: false,
  }))
}

const SOURCE_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google',
  website_contact_form: 'Website form',
  direct_walkin: 'Walk-ins',
  influencer_referral: 'Referrals',
  manual: 'Added by hand',
  other: 'Other',
}

function labelForSource(source: string): string {
  return SOURCE_LABEL[source] || source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Saved groups, with their sizes worked out in the same pass. A manual group
// counts its members; a filter group has to be evaluated, which is done
// per-group rather than in one query because each carries a different WHERE.
export async function savedGroups(clientId: string): Promise<AudienceGroup[]> {
  const rows = await query<{
    id: string
    name: string
    description: string | null
    kind: 'filters' | 'manual'
    origin: string
    filters: any
    created_at: string
    created_by_name: string | null
    member_count: number
  }>(
    `SELECT g.id, g.name, g.description, g.kind, g.origin, g.filters, g.created_at,
            u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM audience_group_members m WHERE m.group_id = g.id)::int AS member_count
     FROM audience_groups g
     LEFT JOIN users u ON u.id = g.created_by
     WHERE g.client_id = $1
     ORDER BY g.created_at DESC`,
    [clientId]
  )

  const out: AudienceGroup[] = []
  for (const r of rows) {
    let count = Number(r.member_count)
    if (r.kind === 'filters') {
      // Re-evaluated on every read rather than cached, so "Hot leads from
      // Instagram" means what it says today, not what it meant when it was
      // saved.
      const { previewAudience } = await import('@/lib/leadAudience')
      const preview = await previewAudience(clientId, normalizeFilters(r.filters), undefined, 0)
      count = preview.count
    }
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      origin: r.origin,
      filters: r.kind === 'filters' ? normalizeFilters(r.filters) : null,
      count,
      created_at: r.created_at,
      created_by_name: r.created_by_name,
      editable: true,
    })
  }
  return out
}

// Turns whatever the caller selected into filters the audience query can
// use. A computed source group has no database row, so it's translated back
// into the filter it represents.
export async function resolveGroupFilters(
  clientId: string,
  groupId: string
): Promise<BroadcastFilters | null> {
  if (groupId.startsWith('source:')) {
    return { ...normalizeFilters({}), sourceKeys: [groupId.slice('source:'.length)] }
  }

  const [row] = await query<{ kind: string; filters: any }>(
    'SELECT kind, filters FROM audience_groups WHERE id = $1 AND client_id = $2',
    [groupId, clientId]
  )
  if (!row) return null

  if (row.kind === 'manual') return { ...normalizeFilters({}), groupId }
  return normalizeFilters(row.filters)
}
