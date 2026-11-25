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

// Starting email for each Local Octo stage. Used until that stage's email is
// saved in Settings > Stage Emails — they show there prefilled and can be
// edited; once saved, the saved version is used instead.
export const LOCAL_OCTO_DEFAULT_EMAILS: Record<string, { subject: string; body: string }> = {
  new_lead: {
    subject: "Thanks for your interest in Local Octo, {{name}}",
    body: "Hi {{name}},\n\nThank you for your interest in Local Octo for {{company}}.\n\nWe help local businesses get more calls from Google Maps with higher rankings and more 5-star reviews. Our team will call you shortly to understand your business and how we can help.\n\nIf you have any questions before then, just reply to this email.\n\nRegards,\nTeam {{school}}",
  },
  qualified: {
    subject: "Next steps for {{company}}",
    body: "Hi {{name}},\n\nThanks for getting back to us about Google Maps ranking and review management for {{company}}.\n\nOur team will call you shortly to understand your goals and show you how we can bring you more calls from Google Maps. If there's a time that suits you best, just reply to this email.\n\nRegards,\nTeam {{school}}",
  },
  wa_sent: {
    subject: "Your call with Local Octo is confirmed – {{date}} at {{time}}",
    body: "Hi {{name}},\n\nYour call with Local Octo is confirmed for {{date}} at {{time}}.\n\nOur expert will call you on this number to walk you through how we can improve {{company}}'s Google Maps ranking and reviews. Please keep 15–20 minutes free.\n\nNeed a different time? Just reply to this email.\n\nRegards,\nTeam {{school}}",
  },
  visit_done: {
    subject: "Thank you for your time today, {{name}}",
    body: "Hi {{name}},\n\nThank you for speaking with us today about {{company}}.\n\nAs discussed, you can see our plan and what's included here: https://localocto.com\n\nIf you have any questions or would like to get started, just reply to this email.\n\nRegards,\nTeam {{school}}",
  },
  offer_made: {
    subject: "Your Local Octo plan for {{company}}",
    body: "Hi {{name}},\n\nAs discussed, your Local Octo Done For You plan for {{company}} is ready.\n\nIt covers your Google Maps ranking, review growth and the ongoing work to bring you more calls each month. You can see the plan details here: https://localocto.com\n\nReply to this email when you're ready to go ahead, or if you'd like to talk anything through.\n\nRegards,\nTeam {{school}}",
  },
  accepted: {
    subject: "Welcome to Local Octo – let's get started",
    body: "Hi {{name}},\n\nThank you for choosing Local Octo for {{company}}!\n\nOur team will share the payment details with you shortly. As soon as it's done, we'll begin work on your Google Maps profile.\n\nIf you have any questions, just reply to this email.\n\nRegards,\nTeam {{school}}",
  },
  enrolled: {
    subject: "Payment received – thank you, {{name}}",
    body: "Hi {{name}},\n\nWe've received your payment for {{company}}. Thank you!\n\nOur team will start work shortly and keep you updated on your Google Maps ranking, reviews and calls.\n\nWelcome aboard – reply to this email any time you need us.\n\nRegards,\nTeam {{school}}",
  },
  cold: {
    subject: "Still looking for more calls from Google Maps?",
    body: "Hi {{name}},\n\nWe spoke a while ago about getting {{company}} more calls from Google Maps.\n\nIf it's still on your mind, Local Octo can help you rank higher and collect more 5-star reviews. Just reply to this email and we'll pick up where we left off.\n\nRegards,\nTeam {{school}}",
  },
}
