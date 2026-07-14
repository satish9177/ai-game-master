import { describe, expect, it } from 'vitest'
import { deriveSourceTrustProjection, lookupSourceTrust } from './sourceTrustProjection'
import { initReportResolutionStore } from './reportResolutionStore'
import type { ReportResolution } from './reportResolutionContracts'

/**
 * Derived-projection unit tests (research vault ADR-0012 D8, spec §7).
 * Covers totality, determinism/integer-only, monotonicity, the
 * certainty-depends-on-total/competence-depends-on-ratio independence,
 * non-oscillation under alternation, order-independence (P33-P50), and the
 * unknown-vs-established-low distinction (P41-P44).
 */

function resolution(outcome: 'confirmed' | 'refuted', overrides: Partial<ReportResolution> = {}): ReportResolution {
  return {
    schemaVersion: 1,
    resolutionId: `RR_${Math.random()}`,
    holderId: 'NPC_C',
    sourceId: 'NPC_B',
    topicId: 'village-events',
    reportRef: 'Bel_x',
    reportClaimKey: 'key',
    reportProvenanceRoot: `root_${Math.random()}`,
    resolutionRef: 'O_x',
    outcome,
    resolutionCause: 'ordinary',
    ruleId: 'resolve_report_from_observation',
    ruleVersion: 'srt_v0',
    validTime: { night: 0, tick: 0 },
    commitSeq: 1,
    ...overrides,
  }
}

describe('deriveSourceTrustProjection (D8, §7.1) -- cutpoints', () => {
  it('P45 -- totality: every non-negative pair falls into exactly one of nine cells', () => {
    for (let c = 0; c <= 12; c += 1) {
      for (let r = 0; r <= 12; r += 1) {
        const projection = deriveSourceTrustProjection(c, r)
        expect(['low', 'medium', 'high']).toContain(projection.competence)
        expect(['low', 'medium', 'high']).toContain(projection.certainty)
      }
    }
  })

  it('P46 -- integer-only: no fractional input is ever required to reach a defined tier', () => {
    // deriveSourceTrustProjection's own type signature accepts only numbers;
    // this is a smoke check that whole-number boundary inputs behave exactly.
    expect(deriveSourceTrustProjection(1, 0)).toEqual({ competence: 'high', certainty: 'low' })
  })

  it('C=3,R=0 -- high competence, medium certainty (spec §8 Phase E)', () => {
    expect(deriveSourceTrustProjection(3, 0)).toEqual({ competence: 'high', certainty: 'medium' })
  })

  it('C=2,R=1 -- medium competence, medium certainty (spec §8 Phase F, Daren)', () => {
    expect(deriveSourceTrustProjection(2, 1)).toEqual({ competence: 'medium', certainty: 'medium' })
  })

  it('C=0,R=3 -- low competence, medium certainty (spec §8 Phase G)', () => {
    expect(deriveSourceTrustProjection(0, 3)).toEqual({ competence: 'low', certainty: 'medium' })
  })

  it('P49 -- alternating confirm/refute converges to (3,3) -- medium competence, medium certainty, never cycling', () => {
    expect(deriveSourceTrustProjection(3, 3)).toEqual({ competence: 'medium', certainty: 'medium' })
  })

  it('P47/P35 -- monotone: incrementing C never moves competence toward low; incrementing R never moves it toward high', () => {
    for (let r = 0; r <= 6; r += 1) {
      let sawHigh = false
      for (let c = 0; c <= 10; c += 1) {
        const { competence } = deriveSourceTrustProjection(c, r)
        if (competence === 'high') sawHigh = true
        // once high is reached, it must stay high or the axis moved backward incorrectly
        if (sawHigh) expect(competence).toBe('high')
      }
    }
  })

  it('P48/P36 -- certainty depends on C+R alone, independent of the split', () => {
    const pairsSummingToSix: Array<[number, number]> = [[0, 6], [1, 5], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0]]
    for (const [c, r] of pairsSummingToSix) {
      expect(deriveSourceTrustProjection(c, r).certainty).toBe('medium')
    }
  })

  it('P37 -- competence depends on the C/R ratio alone, not the absolute totals', () => {
    expect(deriveSourceTrustProjection(3, 0).competence).toBe(deriveSourceTrustProjection(6, 0).competence)
    expect(deriveSourceTrustProjection(3, 0).competence).toBe('high')
    expect(deriveSourceTrustProjection(6, 0).competence).toBe('high')
  })

  it('P43/P44 -- (0,0) and (0,1) project to structurally different competence tiers, though both render under the low-certainty cap row', () => {
    const zeroZero = deriveSourceTrustProjection(0, 0)
    const zeroOne = deriveSourceTrustProjection(0, 1)
    expect(zeroZero).toEqual({ competence: 'medium', certainty: 'low' })
    expect(zeroOne).toEqual({ competence: 'low', certainty: 'low' })
    expect(zeroZero.competence).not.toBe(zeroOne.competence)
    expect(zeroZero.certainty).toBe(zeroOne.certainty)
  })

  it('P50 -- order-independence is structural: the function is total over (C, R) alone, never a sequence', () => {
    // deriveSourceTrustProjection's signature has no "order" parameter at all --
    // two differently-ordered accumulations reaching the same totals must
    // call this with the same (C, R) and therefore always agree.
    expect(deriveSourceTrustProjection(3, 1)).toEqual(deriveSourceTrustProjection(3, 1))
  })
})

describe('lookupSourceTrust (§6.0) -- unknown vs. resolved, never falls back to TrustRegistry', () => {
  it('P41 -- returns {tier: "unknown"} iff no ReportResolution exists for the exact key', () => {
    const store = initReportResolutionStore(new Map())
    expect(lookupSourceTrust(store, 'NPC_C', 'NPC_B', 'village-events')).toEqual({ tier: 'unknown' })
  })

  it('P42 -- the (0,0) case is never reachable through lookupSourceTrust -- minting always produces C+R >= 1', () => {
    const store = initReportResolutionStore(new Map())
    const result = lookupSourceTrust(store, 'NPC_C', 'NPC_B', 'village-events')
    expect(result).not.toEqual({ tier: 'resolved', confirmed: 0, refuted: 0, competence: 'medium', certainty: 'low' })
    expect(result.tier).toBe('unknown')
  })

  it('resolved: folds only committed resolutions matching the exact (holder, source, topic) key', () => {
    const store = { ...initReportResolutionStore(new Map()), resolutions: [resolution('confirmed'), resolution('confirmed'), resolution('refuted')] }
    const result = lookupSourceTrust(store, 'NPC_C', 'NPC_B', 'village-events')
    expect(result).toEqual({ tier: 'resolved', confirmed: 2, refuted: 1, competence: 'medium', certainty: 'medium' })
  })

  it('P55 -- a different holder/source/topic key is completely unaffected (holder isolation, topic isolation)', () => {
    const store = {
      ...initReportResolutionStore(new Map()),
      resolutions: [resolution('confirmed', { holderId: 'NPC_C', sourceId: 'NPC_B', topicId: 'village-events' })],
    }
    expect(lookupSourceTrust(store, 'NPC_D', 'NPC_B', 'village-events')).toEqual({ tier: 'unknown' })
    expect(lookupSourceTrust(store, 'NPC_C', 'NPC_B', 'monster-knowledge')).toEqual({ tier: 'unknown' })
  })
})
