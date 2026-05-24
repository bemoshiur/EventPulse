/**
 * Truth-gate harness — orchestration logic tested with synthetic
 * observation providers. The harness itself doesn't make EPS calls;
 * these tests verify the comparator/report logic that wraps a
 * future-real provider at execution time.
 */

import { describe, expect, it } from 'vitest'

import { formatReport, noopObservationProvider, runTruthGate } from './harness.js'
import { TRUTH_GATE_SCENARIOS, type TruthGateScenario } from './scenarios.js'

/**
 * Synthetic provider returning a fixed paisa value regardless of
 * scenario. Useful for asserting harness logic against a single
 * known observation per mode.
 */
function fixedProvider(observedEpsFeePaisa: bigint) {
  return async () => ({ observedEpsFeePaisa, rawResponse: { mocked: true } })
}

/**
 * Synthetic provider returning the calculator's prediction verbatim
 * — `allMatch=true` case.
 */
function matchingProvider() {
  return async (scenario: TruthGateScenario) => ({
    observedEpsFeePaisa: scenario.calculatorPrediction.epsFeePaisa,
    rawResponse: { mocked: true },
  })
}

describe('runTruthGate', () => {
  it('reports allMatch=true when every observation equals the calculator prediction', async () => {
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, matchingProvider())
    expect(report.allMatch).toBe(true)
    expect(report.shifts).toEqual([])
    expect(report.verdicts).toHaveLength(4)
    for (const v of report.verdicts) {
      expect(v.verdict).toBe('match')
      expect(v.deltaPaisa).toBe(0n)
    }
  })

  it('reports allMatch=false + isolates shifts when an observation diverges', async () => {
    // Inject a 6-paisa shift on Mode C only — the canonical "Decision
    // N might fire" outcome. Other modes match.
    const provider = async (scenario: TruthGateScenario) => ({
      observedEpsFeePaisa:
        scenario.modeId === 'C'
          ? scenario.calculatorPrediction.epsFeePaisa + 6n
          : scenario.calculatorPrediction.epsFeePaisa,
      rawResponse: { mocked: true },
    })
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
    expect(report.allMatch).toBe(false)
    expect(report.shifts).toHaveLength(1)
    expect(report.shifts[0]!.modeId).toBe('C')
    expect(report.shifts[0]!.deltaPaisa).toBe(6n)
    expect(report.shifts[0]!.verdict).toBe('shift')
  })

  it('detects shifts in any direction (under-predict OR over-predict)', async () => {
    const provider = async (scenario: TruthGateScenario) => ({
      observedEpsFeePaisa:
        scenario.modeId === 'A'
          ? scenario.calculatorPrediction.epsFeePaisa - 5n
          : scenario.calculatorPrediction.epsFeePaisa,
      rawResponse: { mocked: true },
    })
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
    expect(report.shifts).toHaveLength(1)
    expect(report.shifts[0]!.modeId).toBe('A')
    expect(report.shifts[0]!.deltaPaisa).toBe(-5n)
  })

  it('processes scenarios in order A → B → C → D', async () => {
    const order: string[] = []
    const provider = async (scenario: TruthGateScenario) => {
      order.push(scenario.modeId)
      return { observedEpsFeePaisa: scenario.calculatorPrediction.epsFeePaisa, rawResponse: {} }
    }
    await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
    expect(order).toEqual(['A', 'B', 'C', 'D'])
  })

  it('embeds the Decision N rule restatement in every report', async () => {
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, matchingProvider())
    expect(report.ruleOnShift).toContain('Decision N')
    expect(report.ruleOnShift).toContain('CALCULATOR BUG')
    expect(report.ruleOnShift).toContain('NOT the sandbox observation')
  })

  it('uses a fixed provider when the same observation needs to apply to all', async () => {
    // Edge case: a fixed-paisa provider doesn't model real EPS but is
    // useful for hypothesis-testing ("what if EPS always charged 2500?")
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, fixedProvider(2500n))
    // Modes B + C predict 2500 → match. Modes A + D predict 2506 → shift.
    const matches = report.verdicts.filter((v) => v.verdict === 'match').map((v) => v.modeId)
    const shifts = report.verdicts.filter((v) => v.verdict === 'shift').map((v) => v.modeId)
    expect(matches).toEqual(['B', 'C'])
    expect(shifts).toEqual(['A', 'D'])
  })
})

describe('noopObservationProvider', () => {
  it('throws with prerequisites listed when invoked', async () => {
    await expect(noopObservationProvider(TRUTH_GATE_SCENARIOS[0]!)).rejects.toThrow(
      /sandbox creds|STAGING_PAYMENT_BLOCK|withholding|wrapper Part 2/i,
    )
  })
})

describe('formatReport', () => {
  it('renders a per-mode summary line for each of the 4 modes', async () => {
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, matchingProvider())
    const rendered = formatReport(report)
    for (const id of ['A', 'B', 'C', 'D'] as const) {
      expect(rendered).toMatch(new RegExp(`Mode ${id}`))
    }
    expect(rendered).toMatch(/ALL MATCH/)
  })

  it('surfaces shift count + Decision N rule when shifts present', async () => {
    const provider = async (scenario: TruthGateScenario) => ({
      observedEpsFeePaisa:
        scenario.modeId === 'C'
          ? scenario.calculatorPrediction.epsFeePaisa + 6n
          : scenario.calculatorPrediction.epsFeePaisa,
      rawResponse: {},
    })
    const report = await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
    const rendered = formatReport(report)
    expect(rendered).toContain('1 shift(s)')
    expect(rendered).toContain('Decision N')
    expect(rendered).toContain('Mode C')
    expect(rendered).toContain('+6p')
  })
})
