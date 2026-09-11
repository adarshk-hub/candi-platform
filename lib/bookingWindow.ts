// path: lib/bookingWindow.ts

// Rules shared by call and visit bookings, so the two can't drift apart.

// SQL that flips any still-scheduled booking whose day has passed to
// cancelled. Run on read rather than by a cron: a booking nobody resolved is
// only interesting when somebody looks at the lead, and a scheduled job is
// one more thing to deploy, monitor and get wrong.
//
// Whole days, not exact times — a 9am slot dealt with at 6pm the same day is
// perfectly normal, and cancelling it at 9:01 would be wrong.
export const AUTO_CANCEL_PAST_SQL = `
  UPDATE events
  SET status = 'cancelled'
  WHERE lead_id = $1
    AND event_type = $2
    AND status = 'scheduled'
    AND event_date < CURRENT_DATE
`

// Whether a booking can be marked done, missed or cancelled yet.
//
// Only from its scheduled moment onwards. Marking a call "done" on Monday
// for a slot on Friday is either a mistake or a lie, and both corrupt the
// call figures on Activity and Team Day.
export function canResolveBooking(eventDate: string, eventTime: string | null): boolean {
  const now = new Date()
  const [y, m, d] = eventDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return false

  // Built from parts rather than parsed from the string: new Date('2026-09-17')
  // is treated as UTC midnight, which in IST is 5:30am on the same day — close
  // enough to look right and wrong often enough to matter.
  const [hh, mm] = (eventTime || '00:00').split(':').map(Number)
  const scheduled = new Date(y, m - 1, d, hh || 0, mm || 0)

  return now >= scheduled
}
