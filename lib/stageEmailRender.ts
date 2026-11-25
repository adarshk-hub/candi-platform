// path: lib/stageEmailRender.ts
// Fills {{variables}} in a stage email's subject/body. Shared by the server
// (sending) and the browser (Settings preview), so it has no imports.

export const STAGE_EMAIL_VARIABLES: { key: string; label: string }[] = [
  { key: 'name', label: 'Full name' },
  { key: 'company', label: 'Company name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'date', label: 'Booked date' },
  { key: 'time', label: 'Booked time' },
  { key: 'school', label: 'Your business name' },
]

// Unknown or empty variables become an empty string rather than staying as
// "{{x}}" in a customer's inbox.
export function renderStageEmail(text: string, vars: Record<string, string | null | undefined>): string {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''))
}
