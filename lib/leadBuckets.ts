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

// The condition a stage row (aliased `ps`) must meet to sit in a bucket.
// Checked in order — a cold stage is cold even if its label mentions a
// visit, and payment counts as enrolled before anything else.
function stageCondition(bucket: LeadBucket): string {
  const isCold = `(ps.status_group = 'cold' OR ps.is_cold_lane OR ps.key ILIKE '%cold%')`
  const isEnrolled = `(ps.status_group = 'won' OR ps.key ILIKE '%payment%' OR ps.key ILIKE '%enrol%')`
  const isVisit = `(ps.key ILIKE '%done%' OR ps.key ILIKE '%offer%')`

  switch (bucket) {
    case 'cold':
      return isCold
    case 'enrolled':
      return `NOT ${isCold} AND ${isEnrolled}`
    case 'visit':
      return `NOT ${isCold} AND NOT ${isEnrolled} AND ${isVisit}`
    case 'lead':
    default:
      return `NOT ${isCold} AND NOT ${isEnrolled} AND NOT ${isVisit}`
  }
}

// WHERE fragment: this lead's current stage is in the given bucket.
export function leadBucketSql(bucket: LeadBucket, leadAlias = 'l'): string {
  return `EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.client_id = ${leadAlias}.client_id
      AND ps.key = ${leadAlias}.pipeline_stage
      AND ${stageCondition(bucket)}
  )`
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
