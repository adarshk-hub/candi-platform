// path: lib/nurtureSequenceSteps.ts

// The days the nurture sequence fires on, and therefore how many rows the
// "Assign Templates to Sequence Steps" panel shows.
//
// Kept separate from NURTURE_TEMPLATE_DEFINITIONS on purpose. That file is
// the set of ready-written template bodies submitted to Meta as the
// "Default 5" — a fixed, curated set. This is the shape of the *schedule*,
// which an institute may want longer than the templates supplied. Merging
// the two would mean adding a schedule slot required inventing template
// copy to go with it, and submitting copy nobody asked for to Meta.
//
// Days 14 and 21 have no default template: they exist as empty slots for an
// institute's own approved templates, which is why the panel shows "Select
// a template…" against them until one is chosen.
export interface SequenceStepDef {
  day: number
  label: string
}

export const SEQUENCE_STEPS: SequenceStepDef[] = [
  { day: 0, label: 'Welcome' },
  { day: 2, label: 'Story' },
  { day: 4, label: 'Fee justification' },
  { day: 7, label: 'Urgency' },
  { day: 10, label: 'Visit nudge' },
  { day: 14, label: 'Follow-up' },
  { day: 21, label: 'Last touch' },
]
