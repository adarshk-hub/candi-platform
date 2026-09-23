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

// Classification runs off the lead's own pipeline_stage text, with the
// stage row consulted only as an extra signal. An earlier version required
// a matching pipeline_stages row: any lead sitting on a renamed, deleted or
// legacy stage key then matched no bucket at all and silently vanished from
// every count, which is exactly how a dashboard ends up disagreeing with
// the leads list.
function statusGroupExpr(leadAlias: string): string {
  return `COALESCE((
    SELECT ps.status_group FROM pipeline_stages ps
    WHERE ps.client_id = ${leadAlias}.client_id AND ps.key = ${leadAlias}.pipeline_stage
    LIMIT 1
  ), '')`
}

function coldLaneExpr(leadAlias: string): string {
  return `COALESCE((
    SELECT ps.is_cold_lane FROM pipeline_stages ps
    WHERE ps.client_id = ${leadAlias}.client_id AND ps.key = ${leadAlias}.pipeline_stage
    LIMIT 1
  ), false)`
}

// Checked in order: cold wins over everything, then payment, then a
// completed visit. Anything else — new, responded, visit booked, call
// booked, an unknown or blank stage — is a Lead, so every lead lands in
// exactly one bucket and the four counts always add up to the total.
function bucketExpr(leadAlias: string): string {
  const stage = `COALESCE(${leadAlias}.pipeline_stage, '')`
  const isCold = `(${statusGroupExpr(leadAlias)} = 'cold' OR ${coldLaneExpr(leadAlias)} OR ${stage} ILIKE '%cold%' OR ${stage} ILIKE '%lost%')`
  const isEnrolled = `(${statusGroupExpr(leadAlias)} = 'won' OR ${stage} ILIKE '%payment%' OR ${stage} ILIKE '%enrol%' OR ${stage} ILIKE '%paid%' OR ${stage} ILIKE '%won%')`
  const isVisit = `(${stage} ILIKE '%done%' OR ${stage} ILIKE '%offer%' OR ${stage} ILIKE '%visited%')`

  return `(CASE
    WHEN ${isCold} THEN 'cold'
    WHEN ${isEnrolled} THEN 'enrolled'
    WHEN ${isVisit} THEN 'visit'
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
