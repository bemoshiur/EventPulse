import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('api smoke', () => {
  it('GET /health returns ok envelope', async () => {
    const app = createApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { status: string; service: string; timestamp: string }
    }
    expect(body.data.status).toBe('ok')
    expect(body.data.service).toBe('@eventpulse/api')
    expect(body.data.timestamp).toBeTruthy()
  })
})
