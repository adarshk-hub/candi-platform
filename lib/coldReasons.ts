// path: lib/coldReasons.ts

// Cold reasons are a per-institute editable list stored in
// client_option_items under this key (same mechanism as Lead Source and
// Services), so a school can rename or replace them from Settings >
// Customize without a code change.
export const COLD_REASON_LIST_KEY = 'cold_reason'

// Used only when an institute hasn't got its own list yet — a fresh client
// database, or one where the seed in scripts/activity-migration.sql hasn't
// run. Without this the reason prompt would appear with an empty dropdown
// and block the stage change entirely, which is worse than a generic list.
export const DEFAULT_COLD_REASONS: string[] = [
  'Budget too high',
  'Chose another institute',
  'Not responding / unreachable',
  'Wrong or invalid number',
  'Location too far',
  'Admission postponed',
  'No longer interested',
  'Duplicate or test enquiry',
  'Other',
]
