// path: lib/googleAdsSpend.ts
import crypto from 'crypto'
import { CampaignSpend } from './metaAdsSpend'

// v17 has been shut down by Google; v26 is current (Nov 2026). Can still be
// overridden with the GOOGLE_ADS_API_VERSION env var when Google moves on.
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v26'
const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface ServiceAccountKey {
  client_email: string
  private_key: string
}

// GOOGLE_ADS_SERVICE_ACCOUNT_JSON holds the service account's JSON key file,
// pasted as-is or base64-encoded (both are accepted, since some dashboards
// mangle multi-line values).
function readServiceAccountKey(): ServiceAccountKey | null {
  const raw = (process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON || '').trim()
  if (!raw) return null
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const key = JSON.parse(text)
    if (!key.client_email || !key.private_key) throw new Error('missing client_email or private_key')
    return { client_email: key.client_email, private_key: key.private_key }
  } catch (err: any) {
    throw new Error(`GOOGLE_ADS_SERVICE_ACCOUNT_JSON is not a valid service account key: ${err?.message || err}`)
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// Reused across calls in the same warm instance — a token is valid for an
// hour, and the sync may run once per school.
let cachedToken: { value: string; expiresAt: number } | null = null

// Service account sign-in (OAuth 2.0 JWT bearer grant): no person, password
// or passkey involved. The service account's email is added as a user in the
// Google Ads manager account, which is what gives it access.
async function getServiceAccountToken(key: ServiceAccountKey): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({ iss: key.client_email, scope: ADWORDS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  )
  const signature = base64url(crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key))

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  })
  if (!res.ok) {
    throw new Error(`Google service account token request failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 }
  return data.access_token
}

// Original sign-in method (a person's refresh token), kept as a fallback so
// an existing refresh-token setup keeps working unchanged.
async function getRefreshTokenAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.access_token
}

// Service account if configured, otherwise refresh token, otherwise null
// (not set up yet — the sync then skips Google without failing).
async function getAccessToken(): Promise<string | null> {
  const key = readServiceAccountKey()
  if (key) return getServiceAccountToken(key)
  return getRefreshTokenAccessToken()
}

// Pulls per-campaign spend for one customer account over a date range from
// the Google Ads API (GAQL search against the `campaign` resource).
//
// Since Sept 2026 Google no longer uses developer tokens: access is granted
// to the Google Cloud project instead (Explorer access is enough here). The
// developer-token header is therefore only sent if GOOGLE_ADS_DEVELOPER_TOKEN
// is still set, and is not required. GOOGLE_ADS_LOGIN_CUSTOMER_ID is the
// manager account the school's account is linked under (digits only).
export async function fetchGoogleCampaignSpend(params: {
  customerId: string // digits only, no dashes
  since: string // YYYY-MM-DD
  until: string // YYYY-MM-DD
}): Promise<CampaignSpend[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  const accessToken = await getAccessToken()

  if (!accessToken) {
    console.log(
      `[google-ads:stub] would fetch campaign spend for customer ${params.customerId} from ${params.since} to ${params.until} — no Google Ads credentials configured`
    )
    return []
  }

  const query = `
    SELECT campaign.id, campaign.name, metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${params.since}' AND '${params.until}'
  `.trim()

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${params.customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(developerToken ? { 'developer-token': developerToken } : {}),
        ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
      },
      body: JSON.stringify({ query }),
    }
  )
  if (!res.ok) {
    throw new Error(`Google Ads API returned ${res.status}: ${await res.text()}`)
  }
  const batches = await res.json()

  const results: CampaignSpend[] = []
  for (const batch of Array.isArray(batches) ? batches : [batches]) {
    for (const row of batch.results || []) {
      results.push({
        platformCampaignId: String(row.campaign.id),
        campaignName: row.campaign.name,
        spend: Number(row.metrics.costMicros || 0) / 1_000_000,
      })
    }
  }
  return results
}
