import { pino } from 'pino'

const isDev = process.env['NODE_ENV'] !== 'production'

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
  // R5 (CLAUDE.md §1.3): never log raw PII. Redact known sensitive fields by default.
  redact: {
    paths: [
      '*.password',
      '*.password_hash',
      '*.mfa_secret',
      '*.buyer_email',
      '*.buyer_phone',
      '*.buyer_nid_last4',
      '*.nid',
      '*.email',
      '*.phone',
      '*.authorization',
      '*.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
})
