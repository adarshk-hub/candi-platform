import Link from 'next/link'
import { getClientDashboardMetrics } from '@/lib/clientDashboardMetrics'
import { getCapiSummary } from '@/lib/capiSummary'
import { formatLakh, formatDateTime } from '@/lib/format'
import { Card, SectionLabel, Row, Pill } from '@/components/ui'
import GenerateReportButton from './GenerateReportButton'
import BackfillMetaLeadsButton from './BackfillMetaLeadsButton'
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
}: {
  clientId: string
  clientName: string
  from?: string
  to?: string
}) {
  const metrics = await getClientDashboardMetrics(clientId, from, to)
  const capi = await getCapiSummary(clientId, from, to)

  const presets = [
    { label: '7d', ...presetRange(7) },
    { label: '30d', ...presetRange(30) },
    { label: '90d', ...presetRange(90) },
  ]

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
              href={`/dashboard?from=${p.from}&to=${p.to}`}
              className="rounded-md border border-border bg-card2 px-3 py-1.5 text-sm text-fg hover:border-blue-500"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Agency-only in practice — the API route itself enforces this via
          AGENCY_ROLES, so a client_admin clicking it just sees "Forbidden"
          rather than the button being hidden client-side. */}
      <BackfillMetaLeadsButton clientId={clientId} />

      <form className="flex items-end gap-3 rounded-card border border-border bg-card p-4 text-sm">
        <span className="font-medium text-fg">Custom range</span>
        <div>
          <label className="mb-1 block text-xs text-muted">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-fg outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-border bg-card2 px-3 py-2 text-fg outline-none focus:border-blue-500"
          />
        </div>
        <button type="submit" className="rounded-md bg-zinc-700 px-4 py-2 font-medium text-white hover:bg-zinc-600">
          Submit
        </button>
      </form>

      <PipelineDashboard metrics={metrics} />

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
