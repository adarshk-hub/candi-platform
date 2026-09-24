// path: app/settings/page.tsx
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Webhook,
  ListOrdered,
  Tags,
  Snowflake,
  FormInput,
  Users,
  Shuffle,
  Mail,
  MessageCircle,
  Radio,
  CalendarRange,
  Rows3,
  History,
} from 'lucide-react'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'
import { AGENCY_ROLES } from '@/lib/auth'
import WebhookCard from '@/components/settings/WebhookCard'
import UsersPanel from '@/components/settings/panels/UsersPanel'
import AdAccountConnector from '@/components/settings/AdAccountConnector'
import PageConnector from '@/components/settings/PageConnector'
import NotificationBell from '@/components/NotificationBell'

// The same section list the Customize page shows in its left nav, so both
// settings pages carry one menu and you can jump straight to a section
// from here instead of going through Customize first.
const CUSTOMIZE_LINKS = [
  { panel: 'stages', label: 'Lead Stages', icon: ListOrdered },
  { panel: 'lead_source', label: 'Lead Source', icon: Tags },
  { panel: 'cold_reason', label: 'Cold Reasons', icon: Snowflake },
  { panel: 'fields', label: 'Lead Form Fields', icon: FormInput },
  { panel: 'counsellors', label: 'Counsellors', icon: Users },
  { panel: 'assignment', label: 'Lead Assignment', icon: Shuffle },
  { panel: 'email', label: 'School Email', icon: Mail },
  { panel: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { panel: 'capi', label: 'Conversions API', icon: Radio },
  { panel: 'lead_range', label: 'Lead Date Range', icon: CalendarRange },
  { panel: 'display', label: 'Display Preferences', icon: Rows3 },
  { panel: 'activity', label: 'Activity', icon: History },
]

function getBaseUrl() {
  const h = headers()
  const host = h.get('host') || 'localhost:3000'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}

export default async function SettingsPage() {
  const session = getServerSession()
  if (!session) redirect('/login')
  // Raw webhook URLs/API keys/access tokens live on this page, and its
  // Users panel can create or edit any role — including other client_admin
  // or agency accounts. Agency roles only from here on. A client_admin's
  // day-to-day institute config (Lead Stages, Counsellors, Logo, etc.)
  // still lives at /settings/customize, so send them there instead of
  // dead-ending them; client_staff/client_counsellor have no settings-
  // adjacent page at all, so they go back to their leads list as before.
  if (session.role === 'client_admin') redirect('/settings/customize')
  if (!AGENCY_ROLES.includes(session.role)) redirect('/leads')

  const baseUrl = getBaseUrl()
  const isAgency = AGENCY_ROLES.includes(session.role)

  type ClientRow = {
    id: string
    name: string
    api_key: string
    meta_page_id: string | null
    meta_whatsapp_phone_number_id: string | null
    meta_ad_account_id: string | null
    google_ads_customer_id: string | null
    meta_pixel_id: string | null
    capi_enabled: boolean
  }

  const CLIENT_COLUMNS =
    'id, name, api_key, meta_page_id, meta_whatsapp_phone_number_id, meta_ad_account_id, google_ads_customer_id, meta_pixel_id, capi_enabled'

  const clients = isAgency
    ? await query<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY name`)
    : session.clientId
      ? await query<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = $1`, [session.clientId])
      : []

  // Only agency roles ever reach this point (client_admin is redirected to
  // /settings/customize above), so this is always true — kept as a named
  // constant rather than inlined so the JSX below still reads clearly.
  const canCustomize = true

  return (
    <div className="flex gap-6">
      <nav className="w-56 shrink-0 space-y-1">
        {/* Current page, shown as the selected item. */}
        <span className="flex w-full items-center gap-2.5 rounded-md border-l-2 border-blue-500 bg-blue-500/10 px-3 py-2 text-left text-sm font-medium text-fg">
          <Webhook size={16} />
          Agency Settings
        </span>
        {CUSTOMIZE_LINKS.map((c) => (
          <Link
            key={c.panel}
            href={`/settings/customize?panel=${c.panel}`}
            className="flex w-full items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2 text-left text-sm text-muted2 transition-colors hover:bg-card2 hover:text-fg"
          >
            <c.icon size={16} />
            {c.label}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-fg">Agency Settings</h1>
          <p className="text-muted2">Account and workspace settings.</p>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
        </div>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
        Lead Capture &amp; Auto-Intake
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted2">
        These endpoints feed leads straight into the CRM the moment someone submits a Meta ad
        form, fills out a landing page, or messages your WhatsApp number for the first time.
        Duplicate phone numbers are automatically merged into the existing lead instead of
        creating a new one.
      </p>

      <div className="space-y-6">
        {clients.map((c) => (
          <div key={c.id} className="rounded-card border border-border bg-card p-5">
            <h3 className="mb-4 font-bold text-fg">{c.name}</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-card border border-border bg-card2 p-5">
                <h3 className="font-semibold text-fg">Meta Lead Ads</h3>
                <p className="mb-4 mt-1 text-sm text-muted2">
                  Paste into your Meta App's Webhooks config (Page subscription, leadgen field).
                </p>
                <div className="mb-4">
                  <p className="mb-1 text-xs text-muted">Webhook URL</p>
                  <code className="block truncate rounded-md border border-border bg-card px-3 py-2 text-xs text-fg">
                    {baseUrl}/api/webhooks/meta-leads
                  </code>
                </div>
                <PageConnector clientId={c.id} currentPageId={c.meta_page_id} />
              </div>
              <WebhookCard
                title="Landing Page Form"
                description="POST { name, phone, email?, grade? } as JSON with this bearer token from your website's form handler."
                rows={[
                  { label: 'Webhook URL', value: `${baseUrl}/api/webhooks/landing-page` },
                  { label: 'API Key (Bearer token)', value: c.api_key },
                ]}
              />
              <WebhookCard
                title="WhatsApp (Meta Cloud API)"
                description="Subscribe this URL to the 'messages' field in your Meta App's WhatsApp product config. Use the same Verify Token as your WEBHOOK_VERIFY_TOKEN env var."
                rows={[
                  { label: 'Webhook URL', value: `${baseUrl}/api/webhooks/meta-whatsapp` },
                  { label: 'Phone Number ID (routing)', value: c.meta_whatsapp_phone_number_id || 'not configured — set via Settings > WhatsApp config' },
                ]}
              />
            </div>
            {isAgency && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-card border border-border bg-card2 p-5">
                  <h3 className="font-semibold text-fg">Ad Spend Sync</h3>
                  <p className="mb-4 mt-1 text-sm text-muted2">
                    Connect the ad account the daily spend sync and reporting should read from.
                  </p>
                  <AdAccountConnector clientId={c.id} currentAdAccountId={c.meta_ad_account_id} />
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="mb-1 text-xs text-muted">Google Ads Customer ID</p>
                    <code className="block truncate rounded-md border border-border bg-card px-3 py-2 text-xs text-fg">
                      {c.google_ads_customer_id || 'not configured — set clients.google_ads_customer_id'}
                    </code>
                  </div>
                </div>
                <WebhookCard
                  title="Meta Conversions API"
                  description="Sends downstream funnel events (qualified, visit, enrolled) from this CRM back to Meta. Configure the pixel and stage mapping under Customize > Conversions API."
                  rows={[
                    { label: 'Status', value: c.capi_enabled ? 'Enabled' : 'Disabled' },
                    { label: 'Meta Pixel / Dataset ID', value: c.meta_pixel_id || 'not configured' },
                  ]}
                />
              </div>
            )}
          </div>
        ))}
        {clients.length === 0 && <p className="text-muted">No institution linked to this account.</p>}
      </div>

      {canCustomize && (
        <div className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Users</h2>
          <UsersPanel
            currentUserId={session.id}
            isAgency={isAgency}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
      )}
      </div>
    </div>
  )
}
