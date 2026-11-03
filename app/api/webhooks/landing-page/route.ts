// path: app/api/webhooks/landing-page/route.ts
//Re

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { centralQuery } from '@/lib/db'
import { findOrCreateLead, findOrCreateCampaign } from '@/lib/leadIntake'
import { fireCapiEventForLead } from '@/lib/capiTriggers'
import { startWelcomeOrAsk } from '@/lib/welcomeMessage'

// Generic intake for any client website/landing-page form. Auth is a bearer
// token equal to the client's clients.api_key (see Settings page for the
// per-client URL + key to paste into their form's submit handler).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing Authorization: Bearer <api_key>' }, { status: 401 })
  }

  // Same reasoning as the meta-leads webhook: there's no session here to
  // infer a client from — figuring out which institute this belongs to is
  // exactly what this lookup does, so it has to go to the central registry
  // directly rather than the ambient per-session query().
  const client = (await centralQuery('SELECT id FROM clients WHERE api_key = $1', [apiKey]))[0]
  if (!client) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.name || !body.phone) {
    return NextResponse.json({ error: 'name and phone are required' }, { status: 400 })
  }

  // A form may say where its leads come from (e.g. Queens' site sends
  // "google"). Only these known values are accepted; anything else, or no
  // value at all, keeps the default — so forms that don't send it are
  // unchanged.
  const ALLOWED_SOURCES = ['website_contact_form', 'google']
  const source = ALLOWED_SOURCES.includes(body.source) ? body.source : 'website_contact_form'

  // Google Ads campaign the visitor clicked, when the site passes it on
  // (Queens' plugin reads it from the ad's ?cid={campaignid} URL suffix).
  // Linking the lead to that campaign is what makes it count under Google
  // on the dashboard instead of Organic. Digits only — anything else is
  // ignored, and forms that don't send it are unchanged.
  let campaignId: string | null = null
  const googleCampaignId = String(body.googleCampaignId ?? '').trim()
  if (source === 'google' && /^\d{1,20}$/.test(googleCampaignId)) {
    try {
      campaignId = await findOrCreateCampaign({
        clientId: client.id,
        platform: 'google',
        platformCampaignId: googleCampaignId,
      })
    } catch (err: any) {
      // Never lose the lead over this — it is saved without a campaign.
      console.error(`[landing-page webhook] could not link Google campaign ${googleCampaignId}:`, err?.message || err)
    }
  }

  const { lead, created, duplicate } = await findOrCreateLead({
    clientId: client.id,
    fullName: body.name,
    whatsappNumber: body.phone,
    email: body.email || null,
    grade: body.grade || null,
    // Where a form asks for the student's name separately.
    childName: body.childName || body.studentName || null,
    serviceInterestedIn: body.serviceInterestedIn || body.program || null,
    source,
    entryType: 'landing_page',
    campaignId,
    rawPayload: body,
    // Have the website's form JS read these off the page (fbclid from the
    // URL query string, fbp/fbc from the _fbp/_fbc cookies the Meta Pixel
    // already sets) and include them in the POST body — they're what lets
    // a "Qualified"/"Enrolled" event sent days later via Conversions API
    // still be attributed back to the original ad click.
    fbclid: body.fbclid || null,
    fbc: body.fbc || null,
    fbp: body.fbp || null,
  })

  // Only the first touch fires the Lead event and the WhatsApp welcome
  // sequence — a duplicate submit from a number that's already a lead is
  // a re-engagement, not a new conversion, and shouldn't restart Day 0.
  // Both wrapped in waitUntil(): Vercel can freeze this function the
  // instant the response below is sent, so an un-awaited promise on its
  // own isn't reliable — waitUntil keeps it alive to actually finish,
  // without making the webhook response wait on it.
  if (created) {
    waitUntil(
      fireCapiEventForLead({
        lead,
        trigger: 'lead_created',
        eventIdSeed: `lead:${lead.id}`,
        clientIpAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        clientUserAgent: req.headers.get('user-agent'),
      })
    )
    // Held for confirmation instead of sent outright when the institute
    // has that switched on — see lib/welcomeMessage.ts.
    waitUntil(
      startWelcomeOrAsk(client.id, lead.id).catch((err) =>
        console.error(`[landing-page webhook] welcome handling threw for lead ${lead.id}`, err)
      )
    )
  }

  return NextResponse.json({ ok: true, leadId: lead.id, created, duplicate })
}
