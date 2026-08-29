//Re

import crypto from 'crypto'
import { fetchPageAccessToken } from './metaPages'

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0'

export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET
  // No secret configured yet (pre-launch/dev) — accept everything so the
  // endpoint is testable before real Meta credentials exist.
  if (!appSecret) return true
  if (!signatureHeader) return false

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export interface MetaLeadFields {
  fullName: string
  whatsappNumber: string
  email: string | null
  grade: string | null
  // Meta Lead Ads forms can run on either placement — same form, same
  // campaign, but each individual submission came from whichever app the
  // person was actually using. Previously hardcoded to 'facebook' for
  // every lead regardless of where it really came from.
  source: 'facebook' | 'instagram'
}

// Meta's Graph API returns 'fb' or 'ig' for a lead's platform field.
// Falls back to 'facebook' for anything unrecognized (a future placement
// value Meta adds, or the field being absent) rather than leaving it
// undefined — better to default to the more common case than crash.
export function mapPlatform(raw: string | undefined | null): 'facebook' | 'instagram' {
  return raw === 'ig' ? 'instagram' : 'facebook'
}

// Meta auto-generates each question's internal field `name` from its label
// text, so a custom "Grade" question can come back as something like
// "which_grade_is_your_child_in" rather than the literal word "grade" —
// matching only the exact keys "grade"/"class" misses that. This checks
// every field for one whose key contains "grade" or "class" anywhere,
// case-insensitively, so it catches the real question name whatever Meta
// generated it as. Shared between the live webhook (fetchLeadFields below)
// and the historical backfill (lib/metaLeadAdsBackfill.ts) — they were
// drifting into two different (and differently buggy) implementations of
// what should be the exact same lookup.
export function findGradeValue(fields: Record<string, string>): string | null {
  const gradeKey = Object.keys(fields).find((k) => /grade|class/i.test(k))
  return gradeKey ? fields[gradeKey] || null : null
}

// Fetches the actual submitted field values for a leadgen_id from the Graph
// API. Meta's webhook payload only tells you a lead *exists* (its ID); the
// field data (name/phone/email) requires this separate authenticated call.
// Requires the Page's own Page Access Token, not a raw System User token —
// see fetchPageAccessToken's comment in metaPages.ts; this exchanges it via
// pageId before the actual lead-field lookup, same fix as the historical
// backfill needed. Until META_PAGE_ACCESS_TOKEN is set, returns stub data so
// the rest of the pipeline (dedup, campaign auto-tag, lead creation) is
// fully exercisable.
export async function fetchLeadFields(leadgenId: string, pageId: string): Promise<MetaLeadFields> {
  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    console.log(`[meta:stub] would fetch field_data for leadgen_id ${leadgenId} from Graph API`)
    return {
      fullName: `Meta Lead ${leadgenId.slice(-6)}`,
      whatsappNumber: '9000000000',
      email: null,
      grade: null,
      source: 'facebook',
    }
  }

  const token = await fetchPageAccessToken(pageId)
  // Explicitly requesting `platform` — without listing fields, the default
  // set Graph API returns for a leadgen object doesn't reliably include it,
  // which is why every lead was silently defaulting to 'facebook' before
  // regardless of whether it actually came from Instagram.
  const res = await fetch(`${GRAPH_API_URL}/${leadgenId}?fields=field_data,platform&access_token=${token}`)
  if (!res.ok) {
    throw new Error(`Graph API returned ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  const fields: Record<string, string> = {}
  for (const f of data.field_data || []) {
    fields[f.name] = f.values?.[0] || ''
  }

  const grade = findGradeValue(fields)

  // TEMP DIAGNOSTIC — remove once grade capture is confirmed working end
  // to end. If this fires, it means Meta didn't send back any field whose
  // name contains "grade" or "class" for this lead — either the form has
  // no grade/class question at all, or its question is worded in a way
  // that doesn't match either substring (e.g. "standard", "year group").
  // The full field name list here is what to check against.
  if (!grade) {
    console.log(`[meta-leads] no grade-like field for leadgen_id ${leadgenId}. Fields received: ${Object.keys(fields).join(', ') || '(none)'}`)
  }

  return {
    fullName: fields.full_name || fields.first_name || 'Unknown',
    whatsappNumber: fields.phone_number || '',
    email: fields.email || null,
    grade,
    source: mapPlatform(data.platform),
  }
}
