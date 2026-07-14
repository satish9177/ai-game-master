import { describe, expect, it } from 'vitest'
import type { Belief, Observation } from './contracts'
import type { CanonicalClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'
import { canonicalKeyOf } from './canonicalProposition'
import { claimPolarityOf, mintReportResolution, reportProvenanceRootOf } from './reportResolutionRules'
import { buildReportIndexEntry } from './reportResolutionContracts'
import type { ReportIndex, ReportResolution } from './reportResolutionContracts'

/**
 * Minting-rule unit tests (research vault ADR-0012 D4/D6/D7/D10, spec
 * §5). Exercises each of `mintReportResolution`'s six conditions directly
 * and independently (F1-F9, F14-F16), `claimPolarityOf`'s identity-vs-
 * polarity split (§5.1 condition 4), and `reportProvenanceRootOf`'s
 * earliest-match semantics (D7). There is no `reportPredicate` input
 * anywhere in this file (D9): the report's predicate is read exclusively
 * from a hand-registered `ReportIndex` entry, resolved by `reportRef` --
 * every test that needs a specific predicate builds its own `ReportIndex`
 * via `buildReportIndexEntry`, never a raw string a caller could diverge
 * from the report actually being resolved.
 */

const HOLDER = 'NPC_C'
const SOURCE = 'NPC_B'

function belief(id: string): Belief {
  return {
    schemaVersion: 1,
    id,
    holder: HOLDER,
    proposition: `${SOURCE} asserted something`,
    confidence: 'high',
    sourceType: 'inference',
    sourceRef: 'x',
    supporting: [],
    contradicting: [],
    lastUpdated: 't0',
  }
}

function observation(id: string, observer: string): Observation {
  return {
    schemaVersion: 1,
    id,
    observer,
    truthRef: 'TE_x',
    channels: ['sight'],
    perceived: {},
    missing: [],
    fidelity: 'full',
    time: 't1',
  }
}

function claimFor(predicate: string): CanonicalClaim {
  return {
    predicate,
    fixedRoles: {},
    contestedRole: 'state',
    contestedValue: 'true',
    polarity: 'asserts',
    validity: { kind: 'instant', at: { night: 1, tick: 0 } },
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

const REPORT_BELIEF = belief('Bel_report1')
const RESOLVING_OBSERVATION = observation('O_resolve1', HOLDER)
const THIRD_PARTY_BELIEF = belief('Bel_other_belief')
const FOREIGN_OBSERVATION = observation('O_foreign1', 'NPC_D')

const universe: ReadableRecord[] = [
  { kind: 'belief', record: REPORT_BELIEF },
  { kind: 'observation', record: RESOLVING_OBSERVATION },
  { kind: 'belief', record: THIRD_PARTY_BELIEF },
  { kind: 'observation', record: FOREIGN_OBSERVATION },
]

const CLAIM_PREDICATE = 'well-fouled'
const CLAIM = claimFor(CLAIM_PREDICATE)
const CLAIM_KEY = canonicalKeyOf(CLAIM)

/** The default ReportIndex: REPORT_BELIEF is registered under CLAIM (predicate 'well-fouled', topic 'village-events'). */
const defaultReportIndex: ReportIndex = new Map([[REPORT_BELIEF.id, buildReportIndexEntry(REPORT_BELIEF.id, SOURCE, CLAIM)]])

/** Builds a one-entry ReportIndex naming REPORT_BELIEF under an arbitrary predicate -- the only way these tests can vary the report's "trusted" predicate, mirroring how the live store itself would only ever read it from a committed index entry, never from caller input. */
function indexWith(predicate: string): ReportIndex {
  return new Map([[REPORT_BELIEF.id, buildReportIndexEntry(REPORT_BELIEF.id, SOURCE, claimFor(predicate))]])
}

function baseInput(overrides: Partial<Parameters<typeof mintReportResolution>[0]> = {}): Parameters<typeof mintReportResolution>[0] {
  return {
    resolutionId: 'RR_test1',
    holderId: HOLDER,
    sourceId: SOURCE,
    topicId: 'village-events',
    reportRef: REPORT_BELIEF.id,
    reportClaimKey: CLAIM_KEY,
    reportCommitSeq: 1,
    resolutionRef: RESOLVING_OBSERVATION.id,
    resolutionCommitSeq: 2,
    resolutionClaimKey: CLAIM_KEY,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: { night: 1, tick: 0 },
    universe,
    reportIndex: defaultReportIndex,
    reportProvenanceRoot: REPORT_BELIEF.id,
    existingResolutions: [],
    ...overrides,
  }
}

describe('mintReportResolution -- the six conditions (§5.1)', () => {
  it('P10/P18 -- mints a well-formed ReportResolution when every condition holds', () => {
    const outcome = mintReportResolution(baseInput())
    expect(outcome.verdict).toBe('mint')
    if (outcome.verdict === 'mint') {
      expect(outcome.resolution.outcome).toBe('confirmed')
      expect(outcome.resolution.resolutionRef).toBe(RESOLVING_OBSERVATION.id)
      expect(outcome.resolution.reportRef).toBe(REPORT_BELIEF.id)
    }
  })

  it('F1 -- condition 1 rejects when reportRef is not a committed record', () => {
    const outcome = mintReportResolution(baseInput({ reportRef: 'Bel_nonexistent' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'report-not-committed' })
  })

  it('F2 -- condition 3 rejects when resolutionCommitSeq is earlier than reportCommitSeq, regardless of validTime', () => {
    const outcome = mintReportResolution(baseInput({ reportCommitSeq: 10, resolutionCommitSeq: 5, validTime: { night: 99, tick: 0 } }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-after-report' })
  })

  it('F3 -- an earlier validTime with a later commitSeq is still accepted (commit-sequence governs, not valid time)', () => {
    const outcome = mintReportResolution(baseInput({ reportCommitSeq: 10, resolutionCommitSeq: 11, validTime: { night: 0, tick: 0 } }))
    expect(outcome.verdict).toBe('mint')
  })

  it('F4 -- mere pre-existing agreement with no fresh resolving event (an equal commitSeq) rejects identically to F2', () => {
    const outcome = mintReportResolution(baseInput({ reportCommitSeq: 5, resolutionCommitSeq: 5 }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-after-report' })
  })

  it('F5 -- condition 4 rejects a claim-key mismatch as a no-op, never resolving the wrong report', () => {
    const outcome = mintReportResolution(baseInput({ resolutionClaimKey: 'a-different-key::{}' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'claim-key-mismatch' })
  })

  it('F6 -- self-licensing: resolutionRef naming the source\'s own further testimony (kind: belief) is mechanically rejected, not structurally unconstructible', () => {
    const outcome = mintReportResolution(baseInput({ resolutionRef: REPORT_BELIEF.id }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('F7 -- third-party testimony (a different Belief, kind: belief) is mechanically rejected identically to F6', () => {
    const outcome = mintReportResolution(baseInput({ resolutionRef: THIRD_PARTY_BELIEF.id }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('condition 5 also rejects an Observation that exists but belongs to a different holder', () => {
    const outcome = mintReportResolution(baseInput({ resolutionRef: FOREIGN_OBSERVATION.id }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('F8 -- an id naming no committed record at all (standing in for a hidden TruthEvent) is mechanically rejected', () => {
    const outcome = mintReportResolution(baseInput({ resolutionRef: 'TE_hidden_truth_event' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('F16 -- condition 6 rejects a second resolution attempt against an already-consumed provenance root', () => {
    const existing: ReportResolution = {
      schemaVersion: 1,
      resolutionId: 'RR_already',
      holderId: HOLDER,
      sourceId: SOURCE,
      topicId: 'village-events',
      reportRef: REPORT_BELIEF.id,
      reportClaimKey: CLAIM_KEY,
      reportProvenanceRoot: REPORT_BELIEF.id,
      resolutionRef: 'O_earlier',
      outcome: 'confirmed',
      resolutionCause: 'ordinary',
      ruleId: 'resolve_report_from_observation',
      ruleVersion: 'srt_v0',
      validTime: { night: 0, tick: 0 },
      commitSeq: 1,
    }
    const outcome = mintReportResolution(baseInput({ existingResolutions: [existing] }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'provenance-already-consumed' })
  })

  it('a distinct claim from the same source is a distinct dedup key and independently contributes (P23)', () => {
    const existing: ReportResolution = {
      schemaVersion: 1,
      resolutionId: 'RR_other_claim',
      holderId: HOLDER,
      sourceId: SOURCE,
      topicId: 'village-events',
      reportRef: 'Bel_report_other',
      reportClaimKey: 'a-different-key::{}',
      reportProvenanceRoot: 'Bel_report_other',
      resolutionRef: 'O_earlier',
      outcome: 'confirmed',
      resolutionCause: 'ordinary',
      ruleId: 'resolve_report_from_observation',
      ruleVersion: 'srt_v0',
      validTime: { night: 0, tick: 0 },
      commitSeq: 1,
    }
    const outcome = mintReportResolution(baseInput({ existingResolutions: [existing] }))
    expect(outcome.verdict).toBe('mint')
  })
})

describe('mintReportResolution -- topic consistency (D9, condition 2, F14/F15)', () => {
  it('F14 -- an unmapped predicate is rejected as unknown-predicate-topic-mapping, regardless of the topicId supplied', () => {
    const outcome = mintReportResolution(baseInput({ reportIndex: indexWith('unmapped-predicate-x') }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'unknown-predicate-topic-mapping' })
  })

  it('F14 twin -- an unmapped predicate is rejected even when the supplied topicId happens to be a real topic', () => {
    const outcome = mintReportResolution(baseInput({ reportIndex: indexWith('unmapped-predicate-x'), topicId: 'monster-knowledge' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'unknown-predicate-topic-mapping' })
  })

  it('F15 -- a known predicate paired with the wrong topicId is rejected as topic-mismatch', () => {
    // CLAIM_PREDICATE ('well-fouled') maps to 'village-events'; supplying
    // 'monster-knowledge' here is the deliberate mismatch.
    const outcome = mintReportResolution(baseInput({ topicId: 'monster-knowledge' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'topic-mismatch' })
  })

  it('reportPredicate-authority gap closure: symmetric to F15, a monster-knowledge report is rejected as topic-mismatch when resolved under village-events -- the predicate is always read from reportRef\'s own registered entry, never anything a caller could supply independently of it', () => {
    const monsterIndex: ReportIndex = new Map([[REPORT_BELIEF.id, buildReportIndexEntry(REPORT_BELIEF.id, SOURCE, claimFor('troll-weak-to-fire'))]])
    const outcome = mintReportResolution(baseInput({ reportIndex: monsterIndex, topicId: 'village-events' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'topic-mismatch' })
  })

  it('report lookup runs before topic derivation -- an uncommitted reportRef is rejected as report-not-committed, never topic-mismatch, even when topicId is also wrong (a report must be resolved before its trusted predicate can be read)', () => {
    const outcome = mintReportResolution(baseInput({ topicId: 'monster-knowledge', reportRef: 'Bel_nonexistent' }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'report-not-committed' })
  })

  it('a report committed in universe but absent from reportIndex is rejected as report-not-committed -- an unregistered report has no trusted predicate to read', () => {
    const unregistered = belief('Bel_unregistered')
    const scanUniverse: ReadableRecord[] = [...universe, { kind: 'belief', record: unregistered }]
    const outcome = mintReportResolution(baseInput({ reportRef: unregistered.id, universe: scanUniverse }))
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'report-not-committed' })
  })

  it('a correctly matched topicId/predicate pair is unaffected by condition 2, and the minted record\'s topicId is the derived one', () => {
    const outcome = mintReportResolution(baseInput())
    expect(outcome.verdict).toBe('mint')
    if (outcome.verdict === 'mint') {
      expect(outcome.resolution.topicId).toBe('village-events')
    }
  })
})

describe('claimPolarityOf (§5.1 condition 4, §3.0) -- identity vs. polarity', () => {
  function claim(contestedValue: 'true' | 'false', predicate = 'gate-mechanism-broken'): CanonicalClaim {
    return {
      predicate,
      fixedRoles: {},
      contestedRole: 'state',
      contestedValue,
      polarity: 'asserts',
      validity: { kind: 'instant', at: { night: 1, tick: 0 } },
      canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
    }
  }

  it('identical contested values on the same key -- confirms', () => {
    expect(claimPolarityOf(claim('true'), claim('true'))).toBe('confirms')
  })

  it('opposite contested values on the same key -- refutes', () => {
    expect(claimPolarityOf(claim('true'), claim('false'))).toBe('refutes')
  })

  it('same key alone is never treated as confirmation without inspecting contestedValue -- different predicates key-mismatch', () => {
    expect(claimPolarityOf(claim('true', 'gate-mechanism-broken'), claim('true', 'well-fouled'))).toBe('mismatch')
  })
})

describe('reportProvenanceRootOf (D7, §5.0) -- earliest-match filter, not a chain-walk', () => {
  it('a repeated assertion of the identical claim by the identical source resolves to the same, earliest root', () => {
    const firstReport = belief('Bel_gate_assert1')
    const secondReport = belief('Bel_gate_assert2')
    const scanUniverse: ReadableRecord[] = [{ kind: 'belief', record: firstReport }, { kind: 'belief', record: secondReport }]
    const claim = claimFor('gate-mechanism-broken')
    const key = canonicalKeyOf(claim)
    const reportIndex: ReportIndex = new Map([
      [firstReport.id, buildReportIndexEntry(firstReport.id, SOURCE, claim)],
      [secondReport.id, buildReportIndexEntry(secondReport.id, SOURCE, claim)],
    ])
    const timing = new Map([
      [firstReport.id, { validFrom: { night: 1, tick: 0 }, mintSeq: 3 }],
      [secondReport.id, { validFrom: { night: 2, tick: 0 }, mintSeq: 9 }],
    ])
    expect(reportProvenanceRootOf(scanUniverse, reportIndex, timing, SOURCE, key)).toBe(firstReport.id)
  })

  it('a distinct claim from the same source gets its own, independent root', () => {
    const gateReport = belief('Bel_gate1')
    const wellReport = belief('Bel_well1')
    const scanUniverse: ReadableRecord[] = [{ kind: 'belief', record: gateReport }, { kind: 'belief', record: wellReport }]
    const gateClaim = claimFor('gate-mechanism-broken')
    const wellClaim = claimFor('well-fouled')
    const reportIndex: ReportIndex = new Map([
      [gateReport.id, buildReportIndexEntry(gateReport.id, SOURCE, gateClaim)],
      [wellReport.id, buildReportIndexEntry(wellReport.id, SOURCE, wellClaim)],
    ])
    const timing = new Map([
      [gateReport.id, { validFrom: { night: 1, tick: 0 }, mintSeq: 1 }],
      [wellReport.id, { validFrom: { night: 1, tick: 1 }, mintSeq: 2 }],
    ])
    expect(reportProvenanceRootOf(scanUniverse, reportIndex, timing, SOURCE, canonicalKeyOf(wellClaim))).toBe(wellReport.id)
  })
})
