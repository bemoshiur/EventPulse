import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/drizzle-generated',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://eventpulse:eventpulse@localhost:5432/eventpulse_local',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
} satisfies Config
