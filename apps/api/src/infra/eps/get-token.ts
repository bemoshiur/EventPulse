/**
 * EPS GetToken — real HTTP wire-up. Part 2 of the in-house wrapper.
 *
 * Per CLAUDE.md §11 + §11.4:
 *   - POST `/api/v1/GetToken` to the active mode's base URL
 *     (`pgapi.eps.com.bd` production / `sandboxpgapi.eps.com.bd`
 *     sandbox — single word, no hyphen; see core.ts BASE_URLS)
 *   - Body: `{ userName, password }`
 *   - Header: `x-hash: <HMAC-SHA512 Base64 of userName, keyed by hashKey>`
 *     (per §11.4 hash mechanism table — GetToken hashes `userName`;
 *     wire format is Base64 not hex per Day-36 truth-gate pre-flight)
 *   - Response (defensively schema'd): a JWT-bearing payload. Field
 *     names observed in the rejected community SDK + corroborated
 *     against §11.4's "JWT from GetToken expired" guidance: `Token`
 *     (the JWT string), `ExpiresIn` (seconds; optional — EPS docs
 *     show ~15 min in practice).
 *
 * **No PII in logs (§1.3 R5):** `userName` is a credential and is
 * NEVER logged. `password` is never logged. The hashed `x-hash`
 * value is non-reversible but still not logged. Structured-log
 * fields are limited to `requestId`, `mode`, `endpoint`, and
 * `httpStatus`/`durationMs` for observability.
 *
 * **Wire-shape uncertainty surfaces here:** the exact field name
 * for the JWT in the response body is not pinned by §11; the
 * SDK source uses `Token`. Day 27+ truth-gate execution will
 * empirically validate; if EPS responds with a different field
 * name, this file + its zod schema are the single edit point.
 * Marked `// [truth-gate-verify]` at the relevant lines.
 */

import { type AxiosError } from 'axios'
import { z } from 'zod'

import { logger } from '../../lib/logger.js'
import { cfg, type EpsCallDeps, http } from './core.js'
import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { signEpsField } from './hash.js'

/**
 * EPS GetToken response shape — defensively typed. `passthrough()`
 * because EPS may add fields without notice (a forward-compatible
 * stance per "money never lies" + "money never depends on un-pinned
 * external schema" — we validate what we consume; we ignore what
 * we don't).
 *
 * [truth-gate-verify] field name `Token` is from the rejected SDK
 * source. If EPS responds with `accessToken` / `jwt` / etc., update
 * here + add an alias in `pickTokenFromResponse()` below.
 */
const GetTokenResponseSchema = z
  .object({
    Token: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    AccessToken: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    ExpiresIn: z.number().int().positive().optional(),
    expiresIn: z.number().int().positive().optional(),
  })
  .passthrough()

type GetTokenResponse = z.infer<typeof GetTokenResponseSchema>

/**
 * Defensive token field extraction. The response shape may vary;
 * we collapse common aliases to a single value. Throwing
 * `EpsResponseError` if none present means we fail loud rather
 * than caching an empty string + having every downstream call
 * fail with a different error.
 */
function pickTokenFromResponse(body: GetTokenResponse): string {
  const token = body.Token ?? body.token ?? body.AccessToken ?? body.accessToken
  if (!token) {
    throw new EpsResponseError('EPS GetToken response missing token field', {
      epsCode: typeof body['Code'] === 'string' ? (body['Code'] as string) : null,
      epsMessage: typeof body['Message'] === 'string' ? (body['Message'] as string) : null,
    })
  }
  return token
}

/**
 * Default access-token TTL when EPS doesn't include `ExpiresIn` in
 * the response. 14 min = 1-min safety margin vs §11.4's ~15-min JWT
 * lifetime. If EPS DOES include `ExpiresIn`, we shave 60s off it
 * for the same safety margin.
 */
const DEFAULT_ACCESS_TOKEN_TTL_SEC = 14 * 60
const SAFETY_MARGIN_SEC = 60

/**
 * Compute the TTL to cache the returned token under. Defensive
 * against EPS responses that omit `ExpiresIn`, or include it as
 * the alias `expiresIn`.
 *
 * Cap at minimum 60s — a token with a sub-1-min effective TTL is
 * useless to cache, but we don't want to throw on it either.
 */
export function deriveTokenTtl(body: GetTokenResponse): number {
  const reported = body.ExpiresIn ?? body.expiresIn
  if (reported && reported > SAFETY_MARGIN_SEC + 30) {
    return reported - SAFETY_MARGIN_SEC
  }
  return DEFAULT_ACCESS_TOKEN_TTL_SEC
}

/**
 * Execute the real GetToken POST. Returns `{ token, ttlSeconds }`
 * so the caller can write to the appropriate cache adapter with
 * the EPS-reported (or safe-default) lifetime.
 *
 * Errors:
 *   - Network/timeout/TLS → {@link EpsNetworkError}
 *   - Non-2xx status     → {@link EpsResponseError} carrying httpStatus
 *   - Body fails schema  → {@link EpsResponseError} (no httpStatus)
 *   - Missing token      → {@link EpsResponseError}
 *
 * This function is exported separately from `getAccessToken` (which
 * lives in `client.ts` and handles cache plumbing) so the
 * cache-miss code path can be tested in isolation.
 *
 * `deps` is optional: when omitted (every running-service call path),
 * config + client are resolved from env via `cfg()` + `http()`. The
 * truth-gate harness injects a sandbox `{ config, client }` so the same
 * GetToken logic runs against the sandbox host. Resolved INSIDE the body
 * (not as a default param) so the env read only happens when no deps are
 * supplied.
 */
export async function fetchAccessTokenFromEps(
  deps?: Pick<EpsCallDeps, 'config' | 'client'>,
): Promise<{
  token: string
  ttlSeconds: number
}> {
  const { config, client } = deps ?? { config: cfg(), client: http() }
  const requestId = `eps-get-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const xHash = signEpsField(config.username, config.hashKey)

  const startMs = Date.now()
  let response
  try {
    response = await client.post(
      '/api/v1/GetToken',
      // [truth-gate-verify] request body fields: `userName` + `password`
      // are the SDK-source names; §11 confirms the credentials shape
      // implicitly. PascalCase fallback aliases sent simultaneously
      // would risk EPS rejecting the request as "unknown field" — better
      // to follow SDK convention exactly.
      { userName: config.username, password: config.password },
      { headers: { 'x-hash': xHash } },
    )
  } catch (err) {
    const durationMs = Date.now() - startMs
    logger.warn(
      {
        eps: { endpoint: 'GetToken', requestId, mode: config.mode, durationMs },
        err: (err as Error).message,
      },
      'eps.get_token.network_failure',
    )
    // Axios surfaces non-2xx as throws too — distinguish.
    const axiosErr = err as AxiosError
    if (axiosErr.response) {
      // We got a response, but it was a non-2xx (>=400). Treat as
      // response error so the caller can branch on httpStatus.
      throw new EpsResponseError(`EPS GetToken returned HTTP ${axiosErr.response.status}`, {
        httpStatus: axiosErr.response.status,
        epsCode: pickStringField(axiosErr.response.data, 'Code'),
        epsMessage: pickStringField(axiosErr.response.data, 'Message'),
        requestId,
      })
    }
    throw new EpsNetworkError('EPS GetToken network failure', err, requestId)
  }

  const durationMs = Date.now() - startMs
  logger.info(
    {
      eps: {
        endpoint: 'GetToken',
        requestId,
        mode: config.mode,
        httpStatus: response.status,
        durationMs,
      },
    },
    'eps.get_token.ok',
  )

  const parseResult = GetTokenResponseSchema.safeParse(response.data)
  if (!parseResult.success) {
    throw new EpsResponseError('EPS GetToken response failed schema validation', {
      httpStatus: response.status,
      requestId,
    })
  }
  const token = pickTokenFromResponse(parseResult.data)
  const ttlSeconds = deriveTokenTtl(parseResult.data)
  return { token, ttlSeconds }
}

function pickStringField(data: unknown, field: string): string | null {
  if (data == null || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}
