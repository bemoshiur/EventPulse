import { GradientMesh } from '@/components/ui/gradient-mesh'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <GradientMesh variant="calm" />
      <div className="mx-auto flex min-h-screen items-center justify-center px-4 py-12">
        {children}
      </div>
    </main>
  )
}
