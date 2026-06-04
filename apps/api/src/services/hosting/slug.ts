/**
 * Derive a valid base slug for a personal tenant from an email/name seed.
 * The result always satisfies the handle contract (§2.3): lowercase, 3-30
 * chars, `^[a-z0-9][a-z0-9-]*[a-z0-9]$`. Uniqueness (suffixing) is the caller's
 * job — this only produces a clean base.
 */
export function derivePersonalSlug(seed: string): string {
  let base = (seed.split('@')[0] ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '') // drop non-ASCII
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alnum → single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 30)
    .replace(/-+$/g, '') // re-trim after the slice

  // Too short (or empty) → pad to a valid, ≥3-char slug.
  if (base.length < 3) {
    base = `${base ? `${base}-` : ''}events`.slice(0, 30).replace(/^-+|-+$/g, '')
  }
  return base.length >= 3 ? base : 'host'
}
