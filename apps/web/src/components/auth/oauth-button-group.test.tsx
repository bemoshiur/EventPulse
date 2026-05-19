/**
 * Tests for OAuthButtonGroup — Sprint 2 Day 20 OAuth bug fix.
 *
 * The Day 11 → Day 20 silent failure: buttons pointed at
 * `/api/auth/{provider}/start` (web vhost relative) which 404'd against
 * the Next.js server. The real route lives at
 * `/api/v1/auth/oauth/{provider}/start` on the API vhost.
 *
 * These tests pin the URL shape so a regression resurrects with a loud
 * failure instead of a silent UX dead-end.
 */

import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthButtonGroup } from './oauth-button-group'

describe('OAuthButtonGroup', () => {
  const ORIGINAL_API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL']

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env['NEXT_PUBLIC_API_BASE_URL']
    } else {
      process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_API_BASE
    }
  })

  it('renders both provider buttons', () => {
    render(<OAuthButtonGroup />)
    expect(screen.getByTestId('oauth-google-button')).toBeInTheDocument()
    expect(screen.getByTestId('oauth-apple-button')).toBeInTheDocument()
  })

  it('button hrefs hit the API vhost path, not the web vhost', async () => {
    // Re-import the module under a fresh env so the module-eval `startUrl()`
    // function reads the value we set here, not the build-time default.
    process.env['NEXT_PUBLIC_API_BASE_URL'] = 'https://api.staging.eventpulse.com.bd'
    vi.resetModules()
    const { OAuthButtonGroup: Fresh } = await import('./oauth-button-group')
    render(<Fresh />)

    const google = screen.getByTestId('oauth-google-button')
    const apple = screen.getByTestId('oauth-apple-button')
    expect(google.getAttribute('href')).toBe(
      'https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start',
    )
    expect(apple.getAttribute('href')).toBe(
      'https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/apple/start',
    )
  })

  it('button hrefs MUST start with the v1 oauth path (regression guard)', () => {
    render(<OAuthButtonGroup />)
    const google = screen.getByTestId('oauth-google-button').getAttribute('href') ?? ''
    const apple = screen.getByTestId('oauth-apple-button').getAttribute('href') ?? ''
    expect(google).toMatch(/\/api\/v1\/auth\/oauth\/google\/start$/)
    expect(apple).toMatch(/\/api\/v1\/auth\/oauth\/apple\/start$/)
    // Defence against the original bug: web-vhost relative paths must NEVER
    // be the href shape.
    expect(google).not.toMatch(/^\/api\/auth\/google/)
    expect(apple).not.toMatch(/^\/api\/auth\/apple/)
  })

  it('strips trailing slash from NEXT_PUBLIC_API_BASE_URL', async () => {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = 'https://api.staging.eventpulse.com.bd/'
    vi.resetModules()
    const { OAuthButtonGroup: Fresh } = await import('./oauth-button-group')
    render(<Fresh />)
    const google = screen.getByTestId('oauth-google-button').getAttribute('href') ?? ''
    expect(google).not.toMatch(/\.bd\/\/api/)
    expect(google).toBe('https://api.staging.eventpulse.com.bd/api/v1/auth/oauth/google/start')
  })

  it('is axe-clean', async () => {
    const { container } = render(<OAuthButtonGroup />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
