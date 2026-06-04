/**
 * Derive a friendly display name from an email's local-part, for passwordless
 * signup where we don't ask for a name up front (the user edits it later in
 * settings). `moshiur.rahman@x` → "Moshiur Rahman", `jane_doe@x` → "Jane Doe".
 * Falls back to "New User" when the local-part yields nothing usable.
 */
export function deriveDisplayName(email: string): string {
  const local = email.split('@')[0] ?? ''
  const name = local
    .split(/[._-]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim()
  return name.length > 0 ? name : 'New User'
}
