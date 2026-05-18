import { GlassCard } from '@/components/ui/glass-card'

/**
 * Placeholder tenant dashboard. Item 11 needs SOMETHING behind the
 * Account-Type modal so the layout has children to render. Real
 * dashboard surface lands across Days 16+ (KYC wizard, event CRUD,
 * attendee list, etc.).
 */
export default function TenantDashboardPage() {
  return (
    <GlassCard className="p-8">
      <h1 className="font-display text-ep-ink text-3xl font-medium">Welcome to Event Pulse</h1>
      <p className="text-ep-graphite mt-3">
        Your dashboard will land here as Days 16+ ship the event CRUD, KYC wizard, and attendee
        surfaces. For now this page exists so the Account-Type modal has something to render in
        front of.
      </p>
    </GlassCard>
  )
}
