// path: lib/localOcto.ts
// Local Octo (the institute with this client ID, originally "Candid Schools")
// is a business, not a school, so a few labels read differently for it only.
// Every other institute gets exactly the labels it had before.
export const LOCAL_OCTO_CLIENT_ID = '0a9d4675-8179-4d87-a879-decce8d00b86'

// Stage a manually added Local Octo lead starts in (no WhatsApp sent).
export const LOCAL_OCTO_MANUAL_STAGE = 'manual_lead'

export function isLocalOcto(clientId: string | null | undefined): boolean {
  return clientId === LOCAL_OCTO_CLIENT_ID
}

// Lead field labels: full_name and child_name.
export function leadNameLabels(clientId: string | null | undefined) {
  return isLocalOcto(clientId)
    ? { parent: 'Full Name', child: 'Company Name' }
    : { parent: null, child: null } // null = keep the screen's own default
}

// Dashboard pipeline words: Visit -> Meet, Enrolled -> Purchased.
export interface PipelineTerms {
  Visit: string
  visit: string
  visited: string
  Enrolled: string
  enrolled: string
  enrollment: string
}

export const DEFAULT_PIPELINE_TERMS: PipelineTerms = {
  Visit: 'Visit',
  visit: 'visit',
  visited: 'visited',
  Enrolled: 'Enrolled',
  enrolled: 'enrolled',
  enrollment: 'enrollment',
}

const LOCAL_OCTO_PIPELINE_TERMS: PipelineTerms = {
  Visit: 'Meet',
  visit: 'meet',
  visited: 'met',
  Enrolled: 'Purchased',
  enrolled: 'purchased',
  enrollment: 'purchase',
}

export function pipelineTerms(clientId: string | null | undefined): PipelineTerms {
  return isLocalOcto(clientId) ? LOCAL_OCTO_PIPELINE_TERMS : DEFAULT_PIPELINE_TERMS
}

// Conversions API: the Meta events offered in the stage-mapping dropdown.
// Local Octo gets Meta's full standard event list; every other institute
// keeps the default list in lib/types.ts.
export const LOCAL_OCTO_CAPI_EVENTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Lead', label: 'Lead' },
  { value: 'Contact', label: 'Contact' },
  { value: 'Schedule', label: 'Schedule (meeting booked)' },
  { value: 'SubmitApplication', label: 'Submit Application' },
  { value: 'CompleteRegistration', label: 'Complete Registration' },
  { value: 'StartTrial', label: 'Start Trial' },
  { value: 'Subscribe', label: 'Subscribe' },
  { value: 'InitiateCheckout', label: 'Initiate Checkout' },
  { value: 'AddPaymentInfo', label: 'Add Payment Info' },
  { value: 'Purchase', label: 'Purchase' },
  { value: 'ViewContent', label: 'View Content' },
  { value: 'FindLocation', label: 'Find Location' },
  { value: 'Search', label: 'Search' },
  { value: 'Donate', label: 'Donate' },
  { value: 'CustomizeProduct', label: 'Customize Product' },
  { value: 'AddToCart', label: 'Add To Cart' },
  { value: 'AddToWishlist', label: 'Add To Wishlist' },
]
