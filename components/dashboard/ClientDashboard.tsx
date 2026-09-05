// path: components/dashboard/ClientDashboard.tsx
import Link from 'next/link'
import NotificationBell from '@/components/NotificationBell'
import { getClientDashboardMetrics } from '@/lib/clientDashboardMetrics'
import { getCapiSummary } from '@/lib/capiSummary'
import { getExcludedCampaignIds } from '@/lib/dashboardPrefs'
import { clampToRange, getLeadDateRange } from '@/lib/leadDateRange'
import { formatLakh, formatDateTime } from '@/lib/format'
import { Card, SectionLabel, Row, Pill } from '@/components/ui'
import GenerateReportButton from './GenerateReportButton'
import BackfillMetaLeadsButton from './BackfillMetaLeadsButton'
import RepairCampaignNamesButton from './RepairCampaignNamesButton'
import PipelineDashboard from './PipelineDashboard'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function presetRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: isoDate(from), to: isoDate(to) }
}

export default async function ClientDashboard({
  clientId,
  clientName,
  from,
  to,
  // Where "7d/30d/90d" and the Custom range form should navigate back to.
  // This component is shared between two different URLs: /dashboard
  // (client_admin, always their own one institute) and
  // /dashboard/[clientId] (agency roles, viewing a specific institute).
  // Hardcoding "/dashboard" here used to mean an agency user clicking a
  // preset while viewing e.g. Chiguru would get sent to plain /dashboard,
  // which redirects to whichever institute happens to be alphabetically
  // first — silently switching institutes instead of just changing the
  // date range. Defaults to "/dashboard" so nothing breaks for any other
  // caller that doesn't pass this explicitly.
  basePath = '/dashboard',
}: {
  clientId: string
  clientName: string
  from?: string
  to?: string
  basePath?: string
}) {
  // Held inside the global window before anything is queried, so a stale
  // bookmark or a hand-edited ?from= in the URL can't widen the dashboard
  // past what Settings allows.
  const leadRange = await getLeadDateRange(clientId)
  const clamped = clampToRange(from, to, leadRange)
  from = clamped.from
  to = clamped.to

  const metrics = await getClientDashboardMetrics(clientId, from, to)
  const capi = await getCapiSummary(clientId, from, to)
  // Fetched server-side so the dashboard paints with the saved selection
  // already applied — no flash of the unfiltered totals while a client
  // round trip loads the preferences.
  const excludedCampaigns = await getExcludedCampaignIds(clientId)

  // A "90d" preset on a window that only opened 3 weeks ago would
  // otherwise link to a range two months wider than anything visible.
  const presets = [7, 30, 90].map((days) => {
    const raw = presetRange(days)
    const fitted = clampToRange(raw.from, raw.to, leadRange)
    return { label: `${days}d`, from: fitted.from || raw.from, to: fitted.to || raw.to }
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-blue-500 pb-4">
        <div>
          <h1 className="text-3xl font-bold text-fg">{metrics.clientName}</h1>
          <p className="mt-1 text-sm text-muted2">Where your leads come from, and where they turn into admissions.</p>
        </div>
        <div className="flex items-center gap-2">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={`${basePath}?from=${p.from}&to=${p.to}`}
              className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg hover:border-blue-500"
            >
              {p.label}
            </Link>
          ))}
          <NotificationBell />
        </div>
      </div>

      {/* Agency-only in practice — the API route itself enforces this via
          AGENCY_ROLES, so a client_admin clicking it just sees "Forbidden"
          rather than the button being hidden client-side. */}
      <div className="flex flex-wrap gap-3">
        <BackfillMetaLeadsButton clientId={clientId} />
        <RepairCampaignNamesButton clientId={clientId} />
      </div>

      <form action={basePath} className="flex items-end gap-3 rounded-card border border-border bg-card p-4 text-sm">
        <span className="font-medium text-fg">Custom range</span>
        <div>
          <label className="mb-1 block text-xs text-muted">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            min={leadRange.from || undefined}
            max={leadRange.to || undefined}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-fg outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            min={leadRange.from || undefined}
            max={leadRange.to || undefined}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-fg outline-none focus:border-blue-500"
          />
        </div>
        <button type="submit" className="rounded-md bg-zinc-700 px-4 py-2 font-medium text-white hover:bg-zinc-600">
          Submit
        </button>
      </form>

      <PipelineDashboard metrics={metrics} clientId={clientId} initialExcluded={excludedCampaigns} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <SectionLabel>Fees collected</SectionLabel>
          <Row label="Total collected">{formatLakh(metrics.fees.totalCollected)}</Row>
          <Row label="Deposit payments">
            {metrics.fees.depositCount} · {formatLakh(metrics.fees.depositSum)}
          </Row>
          <Row label="Full payments">
            {metrics.fees.fullCount} · {formatLakh(metrics.fees.fullSum)}
          </Row>
          <Row label="Last received">
            {metrics.fees.lastReceivedAt ? formatDateTime(metrics.fees.lastReceivedAt) : '—'}
          </Row>
        </Card>
        <Card>
          <SectionLabel>Conversions API</SectionLabel>
          {!capi.configured ? (
            <>
              <p className="text-sm text-muted2">Not connected yet.</p>
              <Link href="/settings/customize" className="mt-2 inline-block text-sm text-blue-400 hover:underline">
                Connect Meta Pixel →
              </Link>
            </>
          ) : (
            <>
              <Row label="Status">
                <Pill color={capi.enabled ? 'green' : 'gray'}>{capi.enabled ? 'Enabled' : 'Disabled'}</Pill>
              </Row>
              <Row label="Events sent">{capi.sent}</Row>
              <Row label="Failed">{capi.failed}</Row>
              <Row label="Last event">{capi.lastEventAt ? formatDateTime(capi.lastEventAt) : '—'}</Row>
            </>
          )}
        </Card>
        <Card>
          <SectionLabel>Client report</SectionLabel>
          <p className="mb-4 text-sm text-muted2">
            Funnel, cost metrics, and campaign breakdown for {metrics.clientName}, {from || 'all time'} to{' '}
            {to || 'now'}.
          </p>
          <GenerateReportButton clientId={clientId} from={from} to={to} />
        </Card>
      </div>
    </div>
  )
}
