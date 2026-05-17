/**
 * Hand-rolled SQL migration runner.
 *
 * Reads every `*.sql` file in `src/db/migrations/` in lexical order,
 * applies it inside a single transaction per file, and records the
 * filename in `_eventpulse_schema_migrations` so subsequent runs skip
 * already-applied migrations.
 *
 * Why hand-rolled instead of `drizzle-kit migrate`:
 *  - Drizzle's generator emits only table DDL; we also have RLS policies,
 *    triggers, role grants — easier to keep them in the same file as the
 *    table they're for and apply them in one ordered stream.
 *  - We retain full control over migration naming, file format, and
 *    ordering — which the playbook §23.3 calls out as load-bearing.
 *
 * Usage: `pnpm --filter @eventpulse/api db:migrate`. Requires DATABASE_URL.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, 'migrations')

interface MigrationFile {
  filename: string
  fullPath: string
}

function listMigrations(): MigrationFile[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return files.map((f) => ({ filename: f, fullPath: resolve(migrationsDir, f) }))
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _eventpulse_schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function alreadyApplied(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    'SELECT filename FROM _eventpulse_schema_migrations',
  )
  return new Set(result.rows.map((r) => r.filename))
}

async function run(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 })
  const client = await pool.connect()

  try {
    await ensureMigrationsTable(client)
    const applied = await alreadyApplied(client)
    const all = listMigrations()

    let appliedCount = 0
    for (const migration of all) {
      if (applied.has(migration.filename)) {
        // eslint-disable-next-line no-console
        console.log(`✓ skip   ${migration.filename}`)
        continue
      }
      const sqlText = readFileSync(migration.fullPath, 'utf8')
      // eslint-disable-next-line no-console
      console.log(`→ apply  ${migration.filename}`)
      await client.query('BEGIN')
      try {
        await client.query(sqlText)
        await client.query('INSERT INTO _eventpulse_schema_migrations (filename) VALUES ($1)', [
          migration.filename,
        ])
        await client.query('COMMIT')
        appliedCount++
        // eslint-disable-next-line no-console
        console.log(`✓ done   ${migration.filename}`)
      } catch (err) {
        await client.query('ROLLBACK')
        // eslint-disable-next-line no-console
        console.error(`✗ failed ${migration.filename}`)
        throw err
      }
    }

    // eslint-disable-next-line no-console
    console.log(`migrations complete: ${appliedCount} applied, ${applied.size} already in place`)
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
