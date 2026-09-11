// path: app/activity/page.tsx
import { redirect } from 'next/navigation'

// This page has been merged away. The redirect stays rather than the route
// being deleted, because people bookmark these and a 404 reads as "the
// feature is gone" rather than "it moved".
export default function MovedPage() {
  redirect('/follow-ups')
}
