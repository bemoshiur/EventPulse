/**
 * User CRUD helpers used by the auth flows. Kept thin on purpose; full
 * profile management lands in Sprint 2.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../db/client.js'
import { users } from '../db/schema/index.js'

export interface UserRecord {
  id: string
  email: string
  fullName: string
  passwordHash: string | null
  emailVerifiedAt: Date | null
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    return rows[0] ?? null
  })
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    return rows[0] ?? null
  })
}

export interface CreateUserInput {
  email: string
  fullName: string
  passwordHash?: string | null
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  return withSuperAdmin(async (db) => {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash ?? null,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
    return row!
  })
}

export async function markEmailVerified(userId: string): Promise<void> {
  await withSuperAdmin(async (db) => {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId))
  })
}
