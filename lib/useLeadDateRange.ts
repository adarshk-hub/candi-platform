// path: lib/useLeadDateRange.ts
'use client'

import { useEffect, useState } from 'react'

export interface LeadDateRange {
  from: string | null
  to: string | null
}

const NO_RANGE: LeadDateRange = { from: null, to: null }

// Supplies the global window to client components so their date inputs can
// set min/max. This is a convenience for the person using the page, not a
// security boundary — the server applies the window to every lead query
// regardless of what a date input allows, so a modified request still
// can't surface a hidden lead.
export function useLeadDateRange(): LeadDateRange {
  const [range, setRange] = useState<LeadDateRange>(NO_RANGE)

  useEffect(() => {
    let cancelled = false
    fetch('/api/lead-date-range')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setRange({ from: data.from || null, to: data.to || null })
      })
      .catch(() => {
        // No range applied to the inputs; the server still enforces it.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return range
}
