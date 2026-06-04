
/**
 * Auth pages are rendered per-request (never statically cached). Without this,
 * Next prerenders the login shells with `s-maxage=1y`, so a browser/CDN can pin
 * a STALE login page for up to a year — referencing JS chunks a later deploy
 * purged, which surfaces to the user as a broken form / "Network error" on
 * submit (reported Day 47). Login traffic is tiny, so per-request rendering is
 * free and keeps the form always in lock-step with the deployed bundle.
 */
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mkt-hero text-mkt-ink relative min-h-screen font-[family-name:var(--font-bangla)]">
      <div className="mx-auto flex min-h-screen items-center justify-center px-4 py-12">
        {children}
      </div>
    </main>
  )
}
