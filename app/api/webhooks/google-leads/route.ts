// path: app/api/webhooks/google-leads/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { centralQuery } from '@/lib/db'
import { findOrCreateLead, findOrCreateCampaign } from '@/lib/leadIntake'
import { findGradeValue, findChildNameValue } from '@/lib/metaLeadAds'
import { startWelcomeOrAsk } from '@/lib/welcomeMessage'

// Google Ads lead form webhook. Google POSTs each lead as JSON, with the
// key set on the lead form as `google_key`. That key is per school
// (clients.google_leads_key) and only accepted while the school has Google
// leads switched on (clients.google_leads_enabled) — so a school receives
// Google leads only after it has been activated in Agency Settings.
//
// Google's rules (developers.google.com/google-ads/webhook): reply 200 with
// an empty JSON body on success; 4xx is not retried; 5xx is retried. The
// same lead can arrive more than once, so lead_id is the duplicate key.

interface GoogleColumn {
  column_id?: string
  column_name?: string
  string_value?: string
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const key = typeof body.google_key === 'string' ? body.google_key.trim() : ''
  if (!key) {
    return NextResponse.json({ error: 'Missing google_key' }, { status: 401 })
  }

  // No session on a webhook — which school this is comes from the key, via
  // the central registry (same reasoning as the other webhooks).
  const client = (
    await centralQuery<{ id: string }>(
      'SELECT id FROM clients WHERE google_leads_key = $1 AND google_leads_enabled = true',
      [key]
    )
  )[0]
  if (!client) {
    return NextResponse.json({ error: 'Invalid key, or Google leads are not enabled for this school' }, { status: 403 })
  }

  // Answers by column_id (FULL_NAME, PHONE_NUMBER, ...). Custom questions are
  // also indexed by their question text, lowercased with underscores, so the
  // same loose grade / child-name matching used for Meta forms works here.
  const byId: Record<string, string> = {}
  const byText: Record<string, string> = {}
  for (const col of (Array.isArray(body.user_column_data) ? body.user_column_data : []) as GoogleColumn[]) {
    const value = (col?.string_value || '').trim()
    if (!value) continue
    if (col.column_id) byId[col.column_id.toUpperCase()] = value
    const label = (col.column_name || col.column_id || '').trim().toLowerCase().replace(/\s+/g, '_')
    if (label) byText[label] = value
  }

  const fullName =
    byId.FULL_NAME || [byId.FIRST_NAME, byId.LAST_NAME].filter(Boolean).join(' ') || 'Unknown'
  const phone = byId.PHONE_NUMBER || ''
  if (!phone) {
    console.log(`[google-leads] lead ${body.lead_id} for client ${client.id} has no phone number — skipped`)
    return NextResponse.json({ error: 'Lead has no phone number' }, { status: 400 })
  }

  const isTest = body.is_test === true
  const leadId = body.lead_id ? String(body.lead_id) : null

  try {
    let campaignId: string | null = null
    if (body.campaign_id) {
      campaignId = await findOrCreateCampaign({
        clientId: client.id,
        platform: 'google',
        platformCampaignId: String(body.campaign_id),
        platformAdsetId: body.adgroup_id ? String(body.adgroup_id) : null,
        platformAdId: body.creative_id ? String(body.creative_id) : null,
        adSetLabel: body.adgroup_id ? `Ad group ${body.adgroup_id}` : null,
      })
    }

    const { lead, created } = await findOrCreateLead({
      clientId: client.id,
      // Google's "Send test data" leads are kept so the connection can be
      // checked in the CRM, but marked so they are easy to spot and delete.
      fullName: isTest ? `[TEST] ${fullName}` : fullName,
      whatsappNumber: phone,
      email: byId.EMAIL || null,
      grade: findGradeValue(byText),
      childName: findChildNameValue(byText),
      source: 'google',
      entryType: 'google_form',
      campaignId,
      externalRef: leadId ? `google:${leadId}` : null,
      // google_key is deliberately not stored.
      rawPayload: {
        leadId,
        formId: body.form_id ?? null,
        campaignId: body.campaign_id ?? null,
        adgroupId: body.adgroup_id ?? null,
        creativeId: body.creative_id ?? null,
        gclId: body.gcl_id ?? null,
        isTest,
        submitTime: body.lead_submit_time ?? null,
        answers: byText,
      },
    })

    // Same as the website form: only a brand-new lead gets the WhatsApp
    // welcome. No Meta Conversions API event — this lead did not come from
    // Meta. Test leads get no welcome message either.
    if (created && !isTest && lead?.id) {
      waitUntil(
        startWelcomeOrAsk(client.id, lead.id).catch((err) =>
          console.error(`[google-leads] welcome handling threw for lead ${lead.id}`, err)
        )
      )
    }

    return NextResponse.json({})
  } catch (err: any) {
    // A 5xx makes Google retry later, so a temporary database problem
    // does not lose the lead.
    console.error(`[google-leads] failed for lead ${leadId} (client ${client.id}):`, err?.message || err)
    return NextResponse.json({ error: 'Temporary error, please retry' }, { status: 500 })
  }
}
