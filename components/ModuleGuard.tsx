// path: components/ModuleGuard.tsx
'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Role } from '@/lib/auth'
import { canAccessPage, firstAllowedHref, pageKeyForPath } from '@/lib/moduleAccess'

// Hiding a link in the sidebar isn't access control — somebody who
// bookmarked /broadcasts, or typed it, would still land on it. This sits in
// the root layout and redirects on any route the current login isn't
// allowed.
//
// It runs on the client because several of these pages are client
// components ('use client' at the top of app/follow-ups, app/calendar,
// app/broadcasts), so there's no single server render point that sees both
// the pathname and the user. The APIs behind those pages already scope
// their data to the caller — a counsellor only ever receives their own
// leads — so this layer is about keeping people out of screens that aren't
// theirs to use, not about hiding data the API would otherwise hand over.
export default function ModuleGuard({
  role,
  allowedPages,
}: {
  role: Role
  allowedPages: string[] | null
}) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const key = pageKeyForPath(pathname)
    // Routes not in the module list (settings, login, the root redirect)
    // are governed by their own role checks and left alone here.
    if (!key) return
    if (canAccessPage(role, allowedPages, key)) return
    router.replace(firstAllowedHref(role, allowedPages))
  }, [pathname, role, allowedPages, router])

  return null
}
