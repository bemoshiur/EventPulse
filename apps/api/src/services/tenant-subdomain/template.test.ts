import { describe, expect, it } from 'vitest'

import {
  buildProvisionCommands,
  buildTeardownCommands,
  InvalidTenantSlugError,
  renderTenantVhost,
} from './template.js'

describe('tenant vhost template', () => {
  it('renders a complete Nginx vhost for a valid slug + apex', () => {
    const out = renderTenantVhost({
      slug: 'acme',
      apexDomain: 'staging.eventpulse.com.bd',
    })
    expect(out).toContain('server_name acme.staging.eventpulse.com.bd;')
    expect(out).toContain(
      'ssl_certificate     /etc/letsencrypt/live/staging.eventpulse.com.bd/fullchain.pem;',
    )
    expect(out).toContain('include /etc/nginx/snippets/ep-security-headers.conf;')
    expect(out).toContain('proxy_pass http://127.0.0.1:3000;')
    expect(out).toContain('proxy_set_header X-Tenant-Slug acme;')
    expect(out).toContain('location = /nginx-health')
  })

  it('honours explicit certLineagePath override', () => {
    const out = renderTenantVhost({
      slug: 'acme',
      apexDomain: 'eventpulse.com.bd',
      certLineagePath: '/custom/cert/path',
    })
    expect(out).toContain('ssl_certificate     /custom/cert/path/fullchain.pem;')
  })

  it('rejects invalid slugs to prevent shell injection', () => {
    const bad = [
      '', // empty
      'a', // too short (min 3)
      'AB', // uppercase
      'foo bar', // space
      'foo;rm -rf', // semicolon
      'foo$(whoami)', // shell exec
      '../etc/passwd', // path traversal
      '-foo', // starts with hyphen
      'foo-', // ends with hyphen
      'a'.repeat(31), // too long
    ]
    for (const slug of bad) {
      expect(() => renderTenantVhost({ slug, apexDomain: 'staging.eventpulse.com.bd' })).toThrow(
        InvalidTenantSlugError,
      )
    }
  })

  it('accepts edge-valid slugs (3 chars, max len, hyphens in middle)', () => {
    expect(() =>
      renderTenantVhost({ slug: 'abc', apexDomain: 'staging.eventpulse.com.bd' }),
    ).not.toThrow()
    expect(() =>
      renderTenantVhost({ slug: 'a'.repeat(30), apexDomain: 'staging.eventpulse.com.bd' }),
    ).not.toThrow()
    expect(() =>
      renderTenantVhost({ slug: 'foo-bar-baz', apexDomain: 'staging.eventpulse.com.bd' }),
    ).not.toThrow()
  })
})

describe('buildProvisionCommands', () => {
  it('produces 5 commands (idempotency check + write + symlink + validate + reload)', () => {
    const vhost = renderTenantVhost({
      slug: 'acme',
      apexDomain: 'staging.eventpulse.com.bd',
    })
    const cmds = buildProvisionCommands({ slug: 'acme', vhostContent: vhost })
    expect(cmds).toHaveLength(5)
    expect(cmds[0]).toMatch(/PROVISION_NO_OP_ALREADY_EXISTS/)
    expect(cmds[1]).toMatch(/base64 -d/)
    expect(cmds[1]).toMatch(/\/etc\/nginx\/sites-available\/acme\.conf/)
    expect(cmds[2]).toMatch(/ln -sf/)
    expect(cmds[3]).toMatch(/PROVISION_FAILED_NGINX_T/)
    expect(cmds[4]).toMatch(/systemctl reload nginx.*PROVISION_OK/)
  })

  it('base64-encodes the vhost content (avoids shell escape issues)', () => {
    const vhost = 'server { server_name acme.example.com; }\n# special: \'"$()'
    const cmds = buildProvisionCommands({ slug: 'acme', vhostContent: vhost })
    const expected = Buffer.from(vhost, 'utf-8').toString('base64')
    expect(cmds[1]).toContain(expected)
  })

  it('rejects invalid slugs (defense in depth)', () => {
    expect(() =>
      buildProvisionCommands({ slug: 'foo; rm -rf /', vhostContent: 'ignored' }),
    ).toThrow(InvalidTenantSlugError)
  })
})

describe('buildTeardownCommands', () => {
  it('produces 2 commands (rm + nginx reload)', () => {
    const cmds = buildTeardownCommands({ slug: 'acme' })
    expect(cmds).toHaveLength(2)
    expect(cmds[0]).toMatch(
      /rm -f \/etc\/nginx\/sites-enabled\/acme\.conf \/etc\/nginx\/sites-available\/acme\.conf/,
    )
    expect(cmds[1]).toMatch(/TEARDOWN_OK/)
  })

  it('rejects invalid slugs', () => {
    expect(() => buildTeardownCommands({ slug: '../evil' })).toThrow(InvalidTenantSlugError)
  })
})
