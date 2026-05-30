/**
 * EPS wire-protocol — V5 production + V4 sandbox round-trip tests.
 *
 * Pins the contract for each direction (request body builders, response
 * parsers, verify-request dispatch shape) so a future drift in either
 * protocol shows up as a test failure before it shows up as an HTTP 404 or
 * "OrderId missing" against a live gateway.
 */

import { describe, expect, it } from 'vitest'

import {
  V4_SANDBOX_PROTOCOL,
  V5_PRODUCTION_PROTOCOL,
  type BuildInitBodyArgs,
  type BuildVerifyRequestArgs,
} from './eps-wire-protocol.js'

const baseInitArgs: BuildInitBodyArgs = {
  merchantId: 'm-1',
  storeId: 's-1',
  merchantTransactionId: 'TXN-AAA-0000000001',
  totalAmountBdt: '1027.56',
  successUrl: 'https://example.test/success',
  failUrl: 'https://example.test/fail',
  cancelUrl: 'https://example.test/cancel',
}

const baseVerifyArgs: BuildVerifyRequestArgs = {
  merchantId: 'm-1',
  storeId: 's-1',
  merchantTransactionId: 'TXN-AAA-0000000001',
  token: 'jwt-token',
  xHash: 'XHASH=',
  path: '/api/v1/Verify',
}

describe('V5_PRODUCTION_PROTOCOL — request shape (§11.4)', () => {
  it('buildInitBody emits camelCase + transactionTypeId:1 + NO CustomerOrderId/customer fields', () => {
    const body = V5_PRODUCTION_PROTOCOL.buildInitBody({
      ...baseInitArgs,
      customerOrderId: 'should-be-ignored',
    })
    expect(body).toEqual({
      merchantId: 'm-1',
      storeId: 's-1',
      merchantTransactionId: 'TXN-AAA-0000000001',
      totalAmount: '1027.56',
      transactionTypeId: 1,
      successUrl: 'https://example.test/success',
      failUrl: 'https://example.test/fail',
      cancelUrl: 'https://example.test/cancel',
    })
    expect(Object.keys(body)).not.toContain('CustomerOrderId')
    expect(Object.keys(body)).not.toContain('customerName')
    expect(Object.keys(body)).not.toContain('productName')
  })

  it('buildVerifyRequest emits POST + body (NOT GET + queryParams)', () => {
    const req = V5_PRODUCTION_PROTOCOL.buildVerifyRequest(baseVerifyArgs)
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/api/v1/Verify')
    expect(req.body).toEqual({
      merchantId: 'm-1',
      storeId: 's-1',
      merchantTransactionId: 'TXN-AAA-0000000001',
    })
    expect(req.queryParams).toBeUndefined()
    expect(req.headers).toEqual({
      Authorization: 'Bearer jwt-token',
      'x-hash': 'XHASH=',
    })
  })
})

describe('V5_PRODUCTION_PROTOCOL — response parsing', () => {
  it('accepts a top-level RedirectURL as success', () => {
    const r = V5_PRODUCTION_PROTOCOL.parseInitResponse({ RedirectURL: 'https://eps/pay' })
    expect(r.kind).toBe('success')
    if (r.kind === 'success') expect(r.redirectUrl).toBe('https://eps/pay')
  })
  it('accepts camelCase redirectUrl alias', () => {
    const r = V5_PRODUCTION_PROTOCOL.parseInitResponse({ redirectUrl: 'https://eps/pay' })
    expect(r.kind).toBe('success')
  })
  it('returns eps-error with Code/Message when redirect URL absent', () => {
    const r = V5_PRODUCTION_PROTOCOL.parseInitResponse({ Code: 'X', Message: 'no url' })
    expect(r.kind).toBe('eps-error')
    if (r.kind === 'eps-error') {
      expect(r.errorCode).toBe('X')
      expect(r.errorMessage).toBe('no url')
    }
  })
  it('rejects non-object Init responses as schema-fail', () => {
    expect(V5_PRODUCTION_PROTOCOL.parseInitResponse('plain text').kind).toBe('schema-fail')
    expect(V5_PRODUCTION_PROTOCOL.parseInitResponse(null).kind).toBe('schema-fail')
  })

  it('parseVerifyResponse accepts any object (permissive passthrough)', () => {
    const r = V5_PRODUCTION_PROTOCOL.parseVerifyResponse({ Status: 'SUCCESS' })
    expect(r.kind).toBe('success')
    if (r.kind === 'success') expect(r.totalAmountBdt).toBeNull()
  })
})

describe('V4_SANDBOX_PROTOCOL — request shape (EPS V4 Postman + guide)', () => {
  it('buildInitBody emits the V4 mandatory-field shape with CustomerOrderId distinct from mtid', () => {
    const body = V4_SANDBOX_PROTOCOL.buildInitBody({
      ...baseInitArgs,
      customerOrderId: 'ORDER-XYZ-001',
    })
    expect(body).toMatchObject({
      merchantId: 'm-1',
      storeId: 's-1',
      CustomerOrderId: 'ORDER-XYZ-001',
      merchantTransactionId: 'TXN-AAA-0000000001',
      TransactionTypeId: 1,
      totalAmount: '1027.56',
      successUrl: 'https://example.test/success',
      failUrl: 'https://example.test/fail',
      cancelUrl: 'https://example.test/cancel',
      customerName: 'Truth Gate Buyer',
      customerEmail: 'truthgate@eventpulse.com.bd',
      customerCountry: 'BD',
      productName: 'Truth-gate sandbox test ticket',
    })
    // CustomerOrderId is PascalCase per the V4 guide — NOT customerOrderId.
    expect(body['CustomerOrderId']).toBeDefined()
    expect(body['customerOrderId']).toBeUndefined()
    // TransactionTypeId is PascalCase per the V4 guide page 2.
    expect(body['TransactionTypeId']).toBe(1)
    expect(body['transactionTypeId']).toBeUndefined()
    // All 17 V4 mandatory fields present (merchantId..productName).
    const mandatory = [
      'merchantId',
      'storeId',
      'CustomerOrderId',
      'merchantTransactionId',
      'TransactionTypeId',
      'totalAmount',
      'successUrl',
      'failUrl',
      'cancelUrl',
      'customerName',
      'customerEmail',
      'customerAddress',
      'customerCity',
      'customerState',
      'customerPostcode',
      'customerCountry',
      'customerPhone',
      'productName',
    ]
    for (const k of mandatory) expect(Object.keys(body)).toContain(k)
  })

  it('buildInitBody derives a distinct CustomerOrderId when caller omits it (NEVER reuses the mtid)', () => {
    const body = V4_SANDBOX_PROTOCOL.buildInitBody({ ...baseInitArgs })
    expect(body['CustomerOrderId']).toBe('ORDER-TXN-AAA-0000000001')
    expect(body['CustomerOrderId']).not.toBe(body['merchantTransactionId'])
  })

  it('buildVerifyRequest emits GET + queryParams (NOT POST + body)', () => {
    const req = V4_SANDBOX_PROTOCOL.buildVerifyRequest(baseVerifyArgs)
    expect(req.method).toBe('GET')
    expect(req.queryParams).toEqual({ merchantTransactionId: 'TXN-AAA-0000000001' })
    expect(req.body).toBeUndefined()
    expect(req.headers).toEqual({
      Authorization: 'Bearer jwt-token',
      'x-hash': 'XHASH=',
    })
  })
})

describe('V4_SANDBOX_PROTOCOL — Init response parsing (success vs eps-error envelope)', () => {
  it('classifies the V4 success envelope (TransactionId + RedirectURL non-null) as success', () => {
    const r = V4_SANDBOX_PROTOCOL.parseInitResponse({
      TransactionId: 'guid-001',
      RedirectURL: 'https://pg.eps.com.bd/PG?data=guid-001',
      ErrorMessage: '',
      ErrorCode: null,
      FinancialEntityList: null,
    })
    expect(r.kind).toBe('success')
    if (r.kind === 'success') {
      expect(r.redirectUrl).toBe('https://pg.eps.com.bd/PG?data=guid-001')
      expect(r.transactionId).toBe('guid-001')
    }
  })

  it('classifies the OBSERVED V4 error envelope ("OrderId missing", code 400, both nulls) as eps-error', () => {
    const r = V4_SANDBOX_PROTOCOL.parseInitResponse({
      TransactionId: null,
      RedirectURL: null,
      ErrorMessage: 'OrderId missing',
      ErrorCode: 400,
      FinancialEntityList: null,
    })
    expect(r.kind).toBe('eps-error')
    if (r.kind === 'eps-error') {
      expect(r.errorCode).toBe(400)
      expect(r.errorMessage).toBe('OrderId missing')
    }
  })

  it('classifies an envelope with success-only-TransactionId (missing RedirectURL) as eps-error', () => {
    const r = V4_SANDBOX_PROTOCOL.parseInitResponse({
      TransactionId: 'guid-002',
      RedirectURL: null,
      ErrorMessage: 'something',
      ErrorCode: 500,
      FinancialEntityList: null,
    })
    expect(r.kind).toBe('eps-error')
  })

  it('rejects an envelope missing the V4-required fields as schema-fail', () => {
    const r = V4_SANDBOX_PROTOCOL.parseInitResponse({ random: 'thing' })
    expect(r.kind).toBe('schema-fail')
  })
})

describe('V4_SANDBOX_PROTOCOL — Verify response parsing', () => {
  it('extracts TotalAmount BDT-decimal string on success', () => {
    const r = V4_SANDBOX_PROTOCOL.parseVerifyResponse({
      MerchantTransactionId: 'TXN-AAA',
      Status: 'Success',
      TotalAmount: '1027.56',
      TransactionDate: '2026-05-30',
      TransactionType: 'Purchase',
      FinancialEntity: 'CARD',
      ErrorCode: '',
      ErrorMessage: '',
    })
    expect(r.kind).toBe('success')
    if (r.kind === 'success') {
      expect(r.totalAmountBdt).toBe('1027.56')
    }
  })
  it('rejects a Verify response missing required V4 fields (MerchantTransactionId/Status/TotalAmount)', () => {
    const r = V4_SANDBOX_PROTOCOL.parseVerifyResponse({ Status: 'Success' })
    expect(r.kind).toBe('schema-fail')
  })
})

describe('cross-contamination — V4 and V5 protocols cannot leak', () => {
  it('the two protocols are physically distinct frozen objects', () => {
    expect(V4_SANDBOX_PROTOCOL).not.toBe(V5_PRODUCTION_PROTOCOL)
    expect(Object.isFrozen(V4_SANDBOX_PROTOCOL)).toBe(true)
    expect(Object.isFrozen(V5_PRODUCTION_PROTOCOL)).toBe(true)
  })
  it('protocol identifiers are distinct', () => {
    expect(V4_SANDBOX_PROTOCOL.name).toBe('v4-sandbox')
    expect(V5_PRODUCTION_PROTOCOL.name).toBe('v5-production')
  })
  it('V5 Init body NEVER contains the V4 CustomerOrderId/TransactionTypeId PascalCase fields', () => {
    const body = V5_PRODUCTION_PROTOCOL.buildInitBody({
      ...baseInitArgs,
      customerOrderId: 'should-not-leak',
    })
    expect(Object.keys(body)).not.toContain('CustomerOrderId')
    expect(Object.keys(body)).not.toContain('TransactionTypeId')
  })
  it('V4 Init body NEVER uses the V5 camelCase transactionTypeId', () => {
    const body = V4_SANDBOX_PROTOCOL.buildInitBody(baseInitArgs)
    expect(Object.keys(body)).not.toContain('transactionTypeId')
  })
})
