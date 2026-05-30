/**
 * EPS wire-protocol abstraction — the per-config bridge between
 * `initialiseOrderHttp` / `verifyOrderHttp` and the EPS gateway's actual
 * request/response shapes. Two implementations:
 *
 *   - `V5_PRODUCTION_PROTOCOL` — the V5 production shape per CLAUDE.md §11.4.
 *     Used by the env path (`cfg()`); preserves byte-identical behavior for
 *     the running services. NOT yet empirically confirmed against EPS
 *     production — closeout note flagged for Phase 1.6.
 *   - `V4_SANDBOX_PROTOCOL` — the V4 sandbox shape per the EPS V4 Sandbox
 *     Merchant API Integration Guide + Postman collection. Used ONLY by
 *     `sandbox-config.ts` (the truth-gate harness path). Empirically
 *     confirmed at Phase 1.4 against `sandboxpgapi.eps.com.bd`.
 *
 * The two protocols are physically separate frozen objects. Cross-
 * contamination tests pin that nothing in the env path can ever produce a
 * V4-shaped body / response and vice versa. EpsConfig carries
 * `wireProtocol` exactly as it carries `paths` (config-with-defaults).
 *
 * Shape divergences captured here:
 *   1. V4 InitializeEPS REQUEST body shape: adds `CustomerOrderId`
 *      (PascalCase) + 9 customer fields + `productName` + `TransactionTypeId`
 *      (PascalCase), in mixed casing per the V4 Postman collection. V5 uses
 *      `transactionTypeId` (camelCase) + no customer fields.
 *   2. V4 InitializeEPS RESPONSE shape: PascalCase top-level with nullable
 *      `RedirectURL` / `TransactionId` on error; numeric `ErrorCode`. V5
 *      uses RedirectURL/redirectUrl + string Code/Message.
 *   3. V4 Verify request: GET with `merchantTransactionId` query param +
 *      x-hash + Bearer; no body. V5 uses POST with body.
 *   4. V4 Verify response: PascalCase top-level with `TotalAmount` as a BDT
 *      DECIMAL STRING ("1027.56"), not paisa, not number. The truth-gate
 *      comparator derives observed EPS fee by parsing this and subtracting
 *      the §14.2 subtotal.
 *
 * Hash mechanism (`signEpsField(merchantTransactionId, hashKey)`) is the
 * same in both protocols per §11.4. If V4 sandbox empirically rejects this
 * hash, that is a fifth divergence and a STOP-ASK.
 */

import { z } from 'zod'

import { normaliseStatus, type EpsStatus } from './normalise-status.js'

// ─── shared types ────────────────────────────────────────────────────────

/**
 * Args the wrapper passes to `buildInitBody`. The wrapper is responsible
 * for resolving these from the input + config + deps before invoking the
 * protocol; the protocol then composes them into the exact wire-shape.
 */
export interface BuildInitBodyArgs {
  merchantId: string
  storeId: string
  merchantTransactionId: string
  /** Already formatted BDT-decimal string (e.g. "1027.56"). */
  totalAmountBdt: string
  successUrl: string
  failUrl: string
  cancelUrl: string
  /**
   * Sandbox-only V4: a merchant-side order reference distinct from
   * `merchantTransactionId`. The wrapper passes whatever the caller
   * supplies; V5 ignores it.
   */
  customerOrderId?: string
}

/** Args for `buildVerifyRequest`. */
export interface BuildVerifyRequestArgs {
  merchantId: string
  storeId: string
  merchantTransactionId: string
  /** Bearer access token. */
  token: string
  /** Already-computed x-hash header value. */
  xHash: string
  /** Path from `config.paths.verify`. */
  path: string
}

/**
 * Discriminated outcome of parsing an Init response. The wrapper turns each
 * kind into a structured log + throw or a success return.
 */
export type InitParseResult =
  | { kind: 'success'; redirectUrl: string; transactionId: string | null; raw: unknown }
  | {
      kind: 'eps-error'
      errorCode: number | string | null
      errorMessage: string | null
      raw: unknown
    }
  | { kind: 'schema-fail'; issues: z.ZodIssue[]; raw: unknown }

/**
 * Discriminated outcome of parsing a Verify response.
 *
 * `totalAmountBdt` is what EPS captured from the buyer (BDT decimal string).
 * `storeAmountBdt` is what EPS will settle to the merchant (BDT decimal
 * string) — the V4 Verify envelope publishes this as the load-bearing field
 * for the truth-gate derivation: `eps_fee = TotalAmount − StoreAmount` is
 * mode-agnostic (no Mode-B/D blind spots). V5 production omits StoreAmount,
 * so V5 returns `null` for it.
 */
export type VerifyParseResult =
  | {
      kind: 'success'
      status: EpsStatus
      totalAmountBdt: string | null
      storeAmountBdt: string | null
      raw: unknown
    }
  | { kind: 'schema-fail'; issues: z.ZodIssue[]; raw: unknown }

/**
 * Wire-shape spec for the Verify request. V4 GET vs V5 POST is the load-
 * bearing divergence; the wrapper dispatches via `axios.request()` so the
 * same retry logic handles both methods.
 */
export interface VerifyRequestSpec {
  method: 'GET' | 'POST'
  path: string
  body?: Record<string, unknown>
  queryParams?: Record<string, string>
  headers: Record<string, string>
}

/**
 * The full per-protocol surface. Identified by `name` for diagnostic logs.
 */
export interface EpsWireProtocol {
  readonly name: 'v5-production' | 'v4-sandbox'
  buildInitBody(args: BuildInitBodyArgs): Record<string, unknown>
  parseInitResponse(data: unknown): InitParseResult
  buildVerifyRequest(args: BuildVerifyRequestArgs): VerifyRequestSpec
  parseVerifyResponse(data: unknown): VerifyParseResult
}

// ─── V5 production protocol ──────────────────────────────────────────────

const V5InitResponseSchema = z
  .object({
    RedirectURL: z.string().min(1).optional(),
    redirectUrl: z.string().min(1).optional(),
    Code: z.string().optional(),
    Message: z.string().optional(),
  })
  .passthrough()

const V5VerifyResponseSchema = z.object({}).passthrough()

/**
 * V5 production protocol. Byte-identical to the wrapper's pre-refactor
 * inline logic — running services see no change.
 */
export const V5_PRODUCTION_PROTOCOL: EpsWireProtocol = Object.freeze({
  name: 'v5-production' as const,
  buildInitBody(args: BuildInitBodyArgs): Record<string, unknown> {
    return {
      merchantId: args.merchantId,
      storeId: args.storeId,
      merchantTransactionId: args.merchantTransactionId,
      totalAmount: args.totalAmountBdt,
      transactionTypeId: 1, // 1=Web per §11.4
      successUrl: args.successUrl,
      failUrl: args.failUrl,
      cancelUrl: args.cancelUrl,
    }
  },
  parseInitResponse(data: unknown): InitParseResult {
    const parsed = V5InitResponseSchema.safeParse(data)
    if (!parsed.success) {
      return { kind: 'schema-fail', issues: parsed.error.issues, raw: data }
    }
    const url = parsed.data.RedirectURL ?? parsed.data.redirectUrl
    if (!url) {
      return {
        kind: 'eps-error',
        errorCode: parsed.data.Code ?? null,
        errorMessage: parsed.data.Message ?? null,
        raw: data,
      }
    }
    return { kind: 'success', redirectUrl: url, transactionId: null, raw: data }
  },
  buildVerifyRequest(args: BuildVerifyRequestArgs): VerifyRequestSpec {
    return {
      method: 'POST',
      path: args.path,
      body: {
        merchantId: args.merchantId,
        storeId: args.storeId,
        merchantTransactionId: args.merchantTransactionId,
      },
      headers: {
        Authorization: `Bearer ${args.token}`,
        'x-hash': args.xHash,
      },
    }
  },
  parseVerifyResponse(data: unknown): VerifyParseResult {
    const parsed = V5VerifyResponseSchema.safeParse(data)
    if (!parsed.success) {
      return { kind: 'schema-fail', issues: parsed.error.issues, raw: data }
    }
    return {
      kind: 'success',
      status: normaliseStatus(parsed.data),
      totalAmountBdt: null,
      storeAmountBdt: null,
      raw: data,
    }
  },
})

// ─── V4 sandbox protocol ─────────────────────────────────────────────────

/**
 * Placeholder customer values for the V4 sandbox truth-gate. The buyer is
 * the operator completing the sandbox hosted-checkout; these fields just
 * need to satisfy EPS's mandatory-field validation. They are never persisted
 * and never flow to a real buyer.
 */
const V4_SANDBOX_CUSTOMER_PLACEHOLDERS = Object.freeze({
  customerName: 'Truth Gate Buyer',
  customerEmail: 'truthgate@eventpulse.com.bd',
  customerAddress: '17 Bashundhara Avenue',
  customerCity: 'Dhaka',
  customerState: 'Dhaka',
  customerPostcode: '1212',
  customerCountry: 'BD',
  customerPhone: '+8801712000000',
  productName: 'Truth-gate sandbox test ticket',
})

/**
 * V4 InitializeEPS response — one envelope for both success and error.
 *
 * Empirically observed shape (Phase 1.4c step 1):
 *   - success: TransactionId=<guid>, RedirectURL=<url>, ErrorMessage="",
 *     ErrorCode=null|0, FinancialEntityList=null
 *   - error:   TransactionId=null,   RedirectURL=null,  ErrorMessage="<msg>",
 *     ErrorCode=<number>, FinancialEntityList=null
 */
const V4InitResponseSchema = z
  .object({
    TransactionId: z.string().nullable(),
    RedirectURL: z.string().nullable(),
    ErrorMessage: z.string(),
    // V4 returns numeric ErrorCode on error (e.g. 400); null/0 on success.
    ErrorCode: z.union([z.number(), z.null()]),
    // Shape unknown when populated; usually null in our observed traffic.
    FinancialEntityList: z.unknown().nullable(),
  })
  .passthrough()

/**
 * V4 CheckMerchantTransactionStatus response — the buyer-facing transaction
 * snapshot.
 *
 *   - `TotalAmount` — BDT-decimal amount EPS charged the buyer (e.g.
 *     "1027.56"). Always present on a Success status.
 *   - `StoreAmount` — BDT-decimal amount EPS will settle to the merchant
 *     after deducting its own gateway fee (e.g. "1010.09" on a 1027.56 bKash
 *     capture → 17.47 BDT EPS fee, i.e. 1.747% MFS rate). The truth-gate
 *     uses (TotalAmount − StoreAmount) to derive the observed eps_fee
 *     mode-agnostically.
 *   - `ErrorCode` + `ErrorMessage` — both observed as `null` on success
 *     against the EPS V4 sandbox (the Postman/guide sample showed empty
 *     strings; sandbox reality is null). Accept both.
 *
 * `.passthrough()` keeps Customer-/Shipment-/Value-/Product-/PaymentId
 * fields that EPS echoes back without forcing the schema to enumerate them.
 */
const V4VerifyResponseSchema = z
  .object({
    MerchantTransactionId: z.string(),
    Status: z.string(),
    TotalAmount: z.string(),
    StoreAmount: z.string(),
    TransactionDate: z.string().optional(),
    TransactionType: z.string().optional(),
    FinancialEntity: z.string().nullable().optional(),
    // V4 Verify ErrorCode/ErrorMessage are null on success against the
    // sandbox (the Postman/guide samples showed empty strings; reality is
    // null). Accept string, number, or null for both.
    ErrorCode: z.union([z.string(), z.number(), z.null()]).optional(),
    ErrorMessage: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough()

/**
 * V4 sandbox protocol. Used ONLY by the truth-gate harness path
 * (`sandbox-config.ts`). The body field-by-field matches the EPS V4 Postman
 * collection casing exactly (mostly camelCase with PascalCase
 * `CustomerOrderId` + `TransactionTypeId`).
 */
export const V4_SANDBOX_PROTOCOL: EpsWireProtocol = Object.freeze({
  name: 'v4-sandbox' as const,
  buildInitBody(args: BuildInitBodyArgs): Record<string, unknown> {
    // CustomerOrderId is a SEPARATE field from merchantTransactionId per the
    // V4 guide. The harness supplies it; if the caller omits we derive a
    // distinct value rather than reusing the mtid (V4 has rejected reuse in
    // some envs per the guide).
    const orderRef = args.customerOrderId ?? `ORDER-${args.merchantTransactionId}`
    return {
      merchantId: args.merchantId,
      storeId: args.storeId,
      CustomerOrderId: orderRef,
      merchantTransactionId: args.merchantTransactionId,
      TransactionTypeId: 1, // 1=Web per V4 guide page 2 (NOT 10 — old samples)
      totalAmount: args.totalAmountBdt,
      successUrl: args.successUrl,
      failUrl: args.failUrl,
      cancelUrl: args.cancelUrl,
      ...V4_SANDBOX_CUSTOMER_PLACEHOLDERS,
    }
  },
  parseInitResponse(data: unknown): InitParseResult {
    const parsed = V4InitResponseSchema.safeParse(data)
    if (!parsed.success) {
      return { kind: 'schema-fail', issues: parsed.error.issues, raw: data }
    }
    const d = parsed.data
    if (d.RedirectURL && d.TransactionId) {
      return {
        kind: 'success',
        redirectUrl: d.RedirectURL,
        transactionId: d.TransactionId,
        raw: data,
      }
    }
    return {
      kind: 'eps-error',
      errorCode: d.ErrorCode,
      errorMessage: d.ErrorMessage,
      raw: data,
    }
  },
  buildVerifyRequest(args: BuildVerifyRequestArgs): VerifyRequestSpec {
    // V4 Verify: GET with query param, no body, x-hash + Bearer headers.
    return {
      method: 'GET',
      path: args.path,
      queryParams: { merchantTransactionId: args.merchantTransactionId },
      headers: {
        Authorization: `Bearer ${args.token}`,
        'x-hash': args.xHash,
      },
    }
  },
  parseVerifyResponse(data: unknown): VerifyParseResult {
    const parsed = V4VerifyResponseSchema.safeParse(data)
    if (!parsed.success) {
      return { kind: 'schema-fail', issues: parsed.error.issues, raw: data }
    }
    return {
      kind: 'success',
      status: normaliseStatus(parsed.data),
      totalAmountBdt: parsed.data.TotalAmount,
      storeAmountBdt: parsed.data.StoreAmount,
      raw: data,
    }
  },
})
