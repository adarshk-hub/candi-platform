// Fixed internal rates for the WCC wallet — deliberately NOT tied to
// Meta's live per-conversation/per-message pricing. Edit the numbers
// below whenever you want to change what a message "costs" in credits;
// nothing else in the wallet code needs to change.
//
// Categories map 1:1 to Meta's template categories (MARKETING / UTILITY /
// AUTHENTICATION, lowercased) plus one extra bucket, "session", for
// free-form text replies sent inside an open 24hr customer-service window
// (lib/metaWhatsapp.ts -> sendTextMessage). Media (image/video/document)
// sent as part of a template's HEADER component is billed at the same
// rate as that template's category — there's no separate "media" rate
// since it's still one template send, just with a richer header.
export type WaMessageCategory = 'marketing' | 'utility' | 'authentication' | 'session'

// NOTE: utility/authentication are priced to three decimal places. The
// wallet balance and ledger columns must therefore hold at least 4 decimal
// digits — see scripts/wa-wallet-rate-precision.sql. If those columns are
// still numeric(_,2), every ₹0.145 send silently rounds to ₹0.15 or ₹0.14
// and the balance drifts away from what this table says.
export const WA_CREDIT_RATES: Record<WaMessageCategory, number> = {
  marketing: 1.09,
  utility: 0.145,
  authentication: 0.145,
  // Free — Meta itself doesn't charge for a free-form reply sent inside a
  // window the *user* opened (a "service" conversation on Meta's side),
  // so there's no real cost here to pass through. Only template sends
  // (marketing/utility/authentication) that proactively open or restart
  // a conversation are billed by Meta and carry a rate above.
  session: 0,
}

export const DEFAULT_MESSAGE_CATEGORY: WaMessageCategory = 'utility'

export function getRateForCategory(category: string | null | undefined): number {
  const key = (category || '').toLowerCase() as WaMessageCategory
  return WA_CREDIT_RATES[key] ?? WA_CREDIT_RATES[DEFAULT_MESSAGE_CATEGORY]
}

// True for any category that costs nothing to send, so callers can skip
// the balance arithmetic entirely instead of writing a ₹0.00 no-op.
export function isFreeCategory(category: string | null | undefined): boolean {
  return getRateForCategory(category) <= 0
}

// What each category is called in the UI. "session" is an internal name —
// clients see Meta's term for the same thing, "Service", which is what
// a free-form reply inside the 24hr window actually is on Meta's side.
export const WA_CATEGORY_LABELS: Record<WaMessageCategory, string> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
  session: 'Service',
}

// Display order for the per-template-message pricing card in the wallet UI.
export const WA_PRICING_ORDER: WaMessageCategory[] = [
  'marketing',
  'utility',
  'authentication',
  'session',
]

// Renders a rate the way the pricing card shows it: "Free" for ₹0, two
// decimals normally (₹1.09), and three when the third one carries value
// (₹0.145) so a sub-paisa rate isn't misrepresented as ₹0.15 or ₹0.14.
export function formatRate(rate: number): string {
  if (rate <= 0) return 'Free'
  const trimmed = rate
    .toFixed(3)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '')
  const decimals = trimmed.includes('.') ? trimmed.split('.')[1].length : 0
  return `₹${decimals < 2 ? rate.toFixed(2) : trimmed}`
}

// The cut withheld on every Razorpay recharge before crediting WCC, e.g.
// a client paying ₹1500 with a 6.67% cut gets ₹1400 credited to their
// wallet balance (the remaining ₹100 is the platform's margin). Adjust
// this single constant to change the cut across all recharges.
export const RECHARGE_CUT_PERCENTAGE = 0.0667

// Preset "quick recharge" amounts shown as buttons in the wallet UI,
// starting low so a client can top up in small amounts if their balance
// (or their previous recharge) has run out.
export const RECHARGE_PRESETS = [100, 500, 1000, 5000] as const

export const MIN_RECHARGE_AMOUNT = 100
