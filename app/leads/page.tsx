import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverAuth'
import { fetchLeadsPage } from '@/lib/leadsQuery'
import LeadsPageClient from '@/components/lead/LeadsPageClient'

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || '' : v || ''
}

// This is what actually fixes the "0 leads, then a flash, then real leads"
// problem: fetchLeadsPage() runs right here, server-side, as part of
// rendering the page — not as a separate fetch() the browser has to make
// after the (empty) page has already loaded. The tab/page filters read
// from the URL match exactly what LeadsPageClient derives from
// useSearchParams() on the client, so the data handed down here is exactly
// what the client would have asked for anyway. Search and the Stage/
// Source/Grade filter panel are client-only state (never in the URL), so
// they always start empty — meaning this always matches the client's own
// initial (unfiltered) state.
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const session = getServerSession()
  if (!session) redirect('/login')

  const initial = await fetchLeadsPage(session, {
    page: Math.max(1, Number(first(searchParams.page) || '1')),
    search: '',
    tab: first(searchParams.tab),
    stage: [],
    source: [],
    grade: [],
  })

  return <LeadsPageClient initial={initial} />
}
