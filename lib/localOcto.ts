// path: lib/localOcto.ts
// Local Octo (the institute with this client ID, originally "Candid Schools")
// is a business, not a school, so a few labels read differently for it only.
// Every other institute gets exactly the labels it had before.
export const LOCAL_OCTO_CLIENT_ID = '0a9d4675-8179-4d87-a879-decce8d00b86'

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
