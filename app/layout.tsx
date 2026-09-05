import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import NotificationBell from '@/components/NotificationBell'
import { ThemeProvider } from '@/components/ThemeProvider'
import { StagesProvider } from '@/lib/StagesContext'
import { getServerSession } from '@/lib/serverAuth'
import { query } from '@/lib/db'

export const metadata: Metadata = {
  title: 'Candi Connect',
  description: 'Lead-to-admission CRM for education marketing',
}

// Applies the saved theme class before first paint (falling back to the
// user's OS preference for a first-ever visit), so there's no flash of the
// wrong theme while React hydrates.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('cc-theme');
    var theme = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = getServerSession()

  // Agency roles (agency_admin/agency_staff) aren't scoped to a single
  // client, so there's no one institute's preference to apply — default
  // to showing the tabs for them. A client-scoped user gets their own
  // institute's Settings > Customize > Display Preferences choice.
  let showLeadStatusTabs = true
  let institutionName: string | null = null
  if (session?.clientId) {
    const rows = await query<{ show_lead_status_tabs: boolean; name: string }>(
      'SELECT show_lead_status_tabs, name FROM clients WHERE id = $1',
      [session.clientId]
    )
    if (rows[0]) {
      showLeadStatusTabs = rows[0].show_lead_status_tabs
      institutionName = rows[0].name
    }
  } else if (session) {
    const rows = await query<{ show_lead_status_tabs: boolean; name: string }>(
      'SELECT show_lead_status_tabs, name FROM clients'
    )
    if (rows.length === 1) {
      showLeadStatusTabs = rows[0].show_lead_status_tabs
      institutionName = rows[0].name
    }
  }
  
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <ThemeProvider>
          {session ? (
            <StagesProvider>
              <div className="flex">
                <Sidebar user={session} showLeadStatusTabs={showLeadStatusTabs} institutionName={institutionName} />
                <main className="min-h-screen flex-1 overflow-x-hidden">
                  {/* Thin top bar carrying app-wide controls. Sticky so the
                      bell stays reachable while a long leads list scrolls,
                      matching the sidebar's own sticky behaviour. */}
                  <div className="sticky top-0 z-30 flex justify-end border-b border-border bg-bg/80 px-8 py-2.5 backdrop-blur">
                    <NotificationBell />
                  </div>
                  <div className="px-8 py-8">{children}</div>
                </main>
              </div>
            </StagesProvider>
          ) : (
            <main className="flex min-h-screen items-center justify-center px-4">{children}</main>
          )}
        </ThemeProvider>
      </body>
    </html>
  )
}
