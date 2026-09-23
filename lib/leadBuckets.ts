// path: lib/leadBuckets.ts
// One definition of what Lead / Visit / Enrolled / Cold mean, so the leads
// list, the exports and the dashboard all count the same thing. Previously
// the sidebar tabs read pipeline_stages.status_group while the dashboard
// counted booking events and enrollment rows, which is why the two never
// agreed.
//
//   Lead     — new, responded, visit booked (and anything else not below)
//   Visit    — visit done, offer made
//   Enrolled — payment in
//   Cold     — cold
//
// Stages are per-institute rows, not a fixed list, so a stage is placed by
// what it is rather than by an exact key: the stage's own status_group and
// cold-lane flag first, then its key/label.
export type LeadBucket = 'lead' | 'visit' | 'enrolled' | 'cold'

export const LEAD_BUCKETS: LeadBucket[] = ['lead', 'visit', 'enrolled', 'cold']

export const LEAD_BUCKET_LABELS: Record<LeadBucket, string> = {
  lead: 'Lead',
  visit: 'Visit',
  enrolled: 'Enrolled',
  cold: 'Cold',
}

// Old sidebar links and saved bookmarks still say warm/hot.
export function normalizeBucket(tab: string | null | undefined): LeadBucket | null {
  switch ((tab || '').toLowerCase()) {
    case 'lead':
    case 'warm':
      return 'lead'
    case 'visit':
    case 'hot':
      return 'visit'
    case 'enrolled':
      return 'enrolled'
    case 'cold':
      return 'cold'
    default:
      return null
  }
}

// The Status each stage carries in Settings > Lead Stages IS this mapping —
// an admin who marks "Visit Scheduled" as Visit has already said where it
// belongs, so that setting decides the bucket and nothing here second-
// guesses it (warm = Lead, hot = Visit, won = Enrolled, cold = Cold).
//
// The lead's own stage text is only a fallback, for a lead sitting on a
// stage key that no longer exists in pipeline_stages — renamed, deleted or
// from before the stages were customised. An earlier version required a
// matching stage row, so those leads matched no bucket and vanished from
// every count.
function stageField(field: string, leadAlias: string, fallback: string): string {
  return `COALESCE((
    SELECT ps.${field} FROM pipeline_stages ps
    WHERE ps.client_id = ${leadAlias}.client_id AND ps.key = ${leadAlias}.pipeline_stage
    LIMIT 1
  ), ${fallback})`
}

// Every lead lands in exactly one bucket, so the four counts always add up
// to the total. An unknown or blank stage counts as a Lead.
function bucketExpr(leadAlias: string): string {
  const stage = `COALESCE(${leadAlias}.pipeline_stage, '')`
  const statusGroup = stageField('status_group', leadAlias, "''")
  const coldLane = stageField('is_cold_lane', leadAlias, 'false')

  // Fallback rules, used only when the stage has no status_group of its own.
  const looksCold = `(${stage} ILIKE '%cold%' OR ${stage} ILIKE '%lost%')`
  const looksEnrolled = `(${stage} ILIKE '%payment%' OR ${stage} ILIKE '%enrol%' OR ${stage} ILIKE '%paid%' OR ${stage} ILIKE '%won%')`
  const looksVisit = `(${stage} ILIKE '%visit%' OR ${stage} ILIKE '%done%' OR ${stage} ILIKE '%offer%')`

  return `(CASE
    WHEN ${coldLane} OR ${statusGroup} = 'cold' THEN 'cold'
    WHEN ${statusGroup} = 'won' THEN 'enrolled'
    WHEN ${statusGroup} = 'hot' THEN 'visit'
    WHEN ${statusGroup} = 'warm' THEN 'lead'
    WHEN ${looksCold} THEN 'cold'
    WHEN ${looksEnrolled} THEN 'enrolled'
    WHEN ${looksVisit} THEN 'visit'
    ELSE 'lead'
  END)`
}

// WHERE fragment: this lead's current stage is in the given bucket.
export function leadBucketSql(bucket: LeadBucket, leadAlias = 'l'): string {
  return `${bucketExpr(leadAlias)} = '${bucket}'`
}

// WHERE fragment for a funnel step: the lead is in this bucket *or* has
// moved past it. A parent who has paid has obviously visited, so counting
// only the current stage would make the dashboard's Visited number fall
// every time someone enrolled.
export function leadReachedSql(bucket: LeadBucket, leadAlias = 'l'): string {
  if (bucket === 'visit') {
    return `(${leadBucketSql('visit', leadAlias)} OR ${leadBucketSql('enrolled', leadAlias)})`
  }
  return leadBucketSql(bucket, leadAlias)
}
