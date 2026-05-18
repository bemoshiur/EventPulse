'use client'

/**
 * TenantTypeGate — Sprint 2 Day 15 Item 11.
 *
 * Client-side complement to the server's `requireTenantType` middleware.
 * Reads the current tenant via `useTenantType`; if `type` is null,
 * renders `AccountTypeModal` over the layout. Once the modal's submit
 * succeeds, refetches the tenant and unmounts the modal.
 *
 * Defence-in-depth posture: the server-side gate is the actual
 * correctness boundary (every tenant route except `me` and
 * `account-type` returns 409 `TENANT_TYPE_REQUIRED` until the type is
 * set). This component is the UX layer — it prevents users from seeing
 * the empty/loading state of gated pages and gives them the one action
 * that unblocks the rest of the portal.
 *
 * Loading state: while `useTenantType` is in flight, render the modal's
 * loading skeleton rather than flashing the gated content. After the
 * first read settles, branch on the resolved type.
 */

import { useCallback } from 'react'

import { AccountTypeModal } from './account-type-modal'
import { useTenantType, type TenantType } from '@/hooks/use-tenant-type'

interface TenantTypeGateProps {
  children: React.ReactNode
}

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface AccountTypeResponse {
  data: { tenant: { type: TenantType } }
}

interface AccountTypeError {
  error: { code: string; message: string }
}

export function TenantTypeGate({ children }: TenantTypeGateProps) {
  const { type, isLoading, refetch } = useTenantType()

  const handleSubmit = useCallback(
    async (chosen: TenantType) => {
      const res = await fetch(`${apiBase()}/api/v1/tenant/account-type`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: chosen }),
      })

      if (!res.ok) {
        let message = `Could not save your choice (HTTP ${res.status}). Please try again.`
        try {
          const body = (await res.json()) as AccountTypeError
          if (body.error?.code === 'TENANT_TYPE_ALREADY_SET') {
            message = 'Account type is already set. Contact support to change it.'
          } else if (body.error?.message) {
            message = body.error.message
          }
        } catch {
          // Body not JSON — keep the status-based message.
        }
        throw new Error(message)
      }

      // Parse the response so a 200/201 with malformed body still
      // surfaces as an error (forces the modal's retry path rather
      // than silently unmounting on a half-success).
      const body = (await res.json()) as AccountTypeResponse
      if (body.data?.tenant?.type !== chosen) {
        throw new Error('Server confirmed a different type than requested. Please retry.')
      }

      await refetch()
    },
    [refetch],
  )

  // Render the modal over the layout so the gradient mesh background
  // remains visible. Children stay mounted but pointer-events-none
  // visually behind the backdrop blur — preserves layout stability
  // when the modal dismisses (no remount flash).
  if (isLoading || !type) {
    return (
      <>
        <div className="pointer-events-none opacity-50" aria-hidden>
          {children}
        </div>
        <AccountTypeModal isLoading={isLoading} onSubmit={handleSubmit} />
      </>
    )
  }

  return <>{children}</>
}
