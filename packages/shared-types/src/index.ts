/**
 * Shared zod schemas + inferred types used by both apps/web and apps/api.
 * Per §3.2: if a type is used by both frontend and backend, it lives here.
 *
 * Populated as routes and domain entities land. First inhabitant is the
 * Bangladesh division enum (Sprint 2 Day 16 Item 12 — shared by KYC
 * address forms, future tenant profile forms, future event venue forms).
 */

export {
  BD_DIVISIONS,
  BD_DIVISION_LABELS_BN,
  BD_DIVISION_LABELS_EN,
  type BdDivision,
} from './bd.js'
