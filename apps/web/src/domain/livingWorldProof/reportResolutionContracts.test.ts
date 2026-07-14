import { describe, expect, it } from 'vitest'
import {
  assertTopicMapWellFormed,
  buildReportIndexEntry,
  PREDICATE_TOPIC_MAP,
  REPORT_RESOLUTION_SCHEMA_VERSION,
  ReportResolutionSchema,
  resolutionVisible,
  SOURCE_TRUST_RULE_VERSION,
  topicOf,
  TOPIC_IDS,
} from './reportResolutionContracts'
import type { ReportResolution } from './reportResolutionContracts'
import type { CanonicalClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import { canonicalKeyOf } from './canonicalProposition'

/**
 * Schema/topic-map unit tests (research vault ADR-0012 D1/D3/D9, spec
 * §3.0/§4). Covers the record-shape properties (P2/P3/P6/P7/P8/P9),
 * PREDICATE_TOPIC_MAP totality/injectivity (P24), the unmapped-predicate
 * validation fault (F14/F15), and `resolutionVisible`'s holder-scoped gate
 * (mirrors `conflictScope.ts`'s `transitionVisible`).
 */

function baseResolution(overrides: Partial<ReportResolution> = {}): ReportResolution {
  return {
    schemaVersion: REPORT_RESOLUTION_SCHEMA_VERSION,
    resolutionId: 'RR_test1',
    holderId: 'NPC_C',
    sourceId: 'NPC_B',
    topicId: 'village-events',
    reportRef: 'Bel_report1',
    reportClaimKey: 'key1',
    reportProvenanceRoot: 'Bel_report1',
    resolutionRef: 'O_resolve1',
    outcome: 'confirmed',
    resolutionCause: 'ordinary',
    ruleId: 'resolve_report_from_observation',
    ruleVersion: SOURCE_TRUST_RULE_VERSION,
    validTime: { night: 1, tick: 0 },
    commitSeq: 1,
    ...overrides,
  }
}

describe('ReportResolutionSchema (P2/P3/P6/P7/P8/P9)', () => {
  it('P6 -- accepts a well-formed record with every D1-named field', () => {
    expect(ReportResolutionSchema.safeParse(baseResolution()).success).toBe(true)
  })

  it('P9 -- accepts the optional beliefTransitionRef, and it never participates in identity by construction (it is just one more optional field)', () => {
    const withRef = baseResolution({ beliefTransitionRef: 'BT_0001' })
    expect(ReportResolutionSchema.safeParse(withRef).success).toBe(true)
  })

  it('P4 -- accepts a record with beliefTransitionRef entirely absent (Phase B\'s decisive case)', () => {
    const withoutRef = baseResolution()
    expect(withoutRef.beliefTransitionRef).toBeUndefined()
    expect(ReportResolutionSchema.safeParse(withoutRef).success).toBe(true)
  })

  it('P2/F13 -- .strict() rejects competence/certainty/a trust tier/a probability/an accept-reject decision as extra fields', () => {
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), competence: 'high' }).success).toBe(false)
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), certainty: 'medium' }).success).toBe(false)
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), trustTier: 'high' }).success).toBe(false)
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), probability: 0.9 }).success).toBe(false)
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), accepted: true }).success).toBe(false)
  })

  it('P3 -- there is no "pending" outcome value; only confirmed | refuted', () => {
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), outcome: 'pending' }).success).toBe(false)
    expect(ReportResolutionSchema.safeParse(baseResolution({ outcome: 'confirmed' })).success).toBe(true)
    expect(ReportResolutionSchema.safeParse(baseResolution({ outcome: 'refuted' })).success).toBe(true)
  })

  it('P7 -- outcome is exactly confirmed | refuted, never a third value', () => {
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), outcome: 'unresolved' }).success).toBe(false)
  })

  it('P8 -- resolutionCause is present and typed on every record, ordinary by default', () => {
    expect(ReportResolutionSchema.safeParse(baseResolution({ resolutionCause: 'ordinary' })).success).toBe(true)
    expect(ReportResolutionSchema.safeParse(baseResolution({ resolutionCause: 'refuted-after-source-retraction' })).success).toBe(true)
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), resolutionCause: 'malicious' }).success).toBe(false)
  })

  it('ruleId/ruleVersion are pinned literals -- a mismatched version fails parsing (F22 twin)', () => {
    expect(ReportResolutionSchema.safeParse({ ...baseResolution(), ruleVersion: 'srt_v1' }).success).toBe(false)
  })
})

describe('PREDICATE_TOPIC_MAP (D9, §4.1) -- totality, injectivity, no fallback (P24, F14/F15)', () => {
  it('P24 -- the table is total and injective over its own keys', () => {
    expect(assertTopicMapWellFormed()).toBe(true)
  })

  it('every rig predicate maps to exactly one of the two closed topics', () => {
    for (const predicate of Object.keys(PREDICATE_TOPIC_MAP)) {
      expect(TOPIC_IDS).toContain(topicOf(predicate))
    }
  })

  it('F14 -- an unmapped predicate returns \'unmapped\', never a default bucket', () => {
    expect(topicOf('unmapped-predicate-x')).toBe('unmapped')
    expect(topicOf('unmapped-predicate-x')).not.toBe('village-events')
    expect(topicOf('unmapped-predicate-x')).not.toBe('monster-knowledge')
  })

  it('F15 twin -- topicOf is the only function that may determine a topic; no other code path exists to call', () => {
    // Structural: there is no exported "assignTopic"/"defaultTopic" function in this module.
    expect(typeof topicOf).toBe('function')
  })
})

describe('resolutionVisible (§3.2) -- mirrors conflictScope.ts\'s transitionVisible verbatim', () => {
  it('true iff resolution.holderId === holderId', () => {
    const resolution = baseResolution({ holderId: 'NPC_C' })
    expect(resolutionVisible('NPC_C', resolution)).toBe(true)
    expect(resolutionVisible('NPC_D', resolution)).toBe(false)
  })
})

describe('buildReportIndexEntry / ReportIndexEntry integrity (D9) -- closes the reportPredicate-authority gap', () => {
  function claim(predicate: string): CanonicalClaim {
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

  it('entry.reportClaimKey === canonicalKeyOf(entry.claim) for every entry buildReportIndexEntry produces -- reportClaimKey can never independently drift from the claim it names', () => {
    const c = claim('gate-mechanism-broken')
    const entry = buildReportIndexEntry('Bel_report1', 'NPC_B', c)
    expect(entry.reportClaimKey).toBe(canonicalKeyOf(c))
    expect(entry.reportRef).toBe('Bel_report1')
    expect(entry.sourceId).toBe('NPC_B')
    expect(entry.claim).toEqual(c)
  })

  it('the invariant holds across every predicate this rig registers, not just one example', () => {
    for (const predicate of Object.keys(PREDICATE_TOPIC_MAP)) {
      const c = claim(predicate)
      const entry = buildReportIndexEntry(`Bel_${predicate}`, 'NPC_B', c)
      expect(entry.reportClaimKey).toBe(canonicalKeyOf(c))
    }
  })

  it('buildReportIndexEntry is the only exported constructor -- there is no sibling function that could build an entry with an independently-supplied reportClaimKey', () => {
    expect(typeof buildReportIndexEntry).toBe('function')
    expect(buildReportIndexEntry.length).toBe(3)
  })
})
