import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { QuestCandidate } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  ATTENTION_EXPOSURE_POLICY_VERSION,
  ATTENTION_LEDGER_POLICY_VERSION,
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
} from './attentionCandidatePolicy'
import { ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION } from './attentionDirectEvidenceAssertion'
import { ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION } from './attentionNarrativePatternResourcePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import { orderAttentionCandidates } from './attentionCandidateOrdering'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import {
  ATTENTION_LEDGER_FEATURE_KEYS,
  ATTENTION_LEDGER_RECORD_KEYS,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_RECORD_KEYS,
  appendAttentionLedgerRecord,
  attentionLedgerFeatures,
  evaluateAttentionPatternPresentationPolicy,
  createAttentionLedger,
} from './attentionLedger'
import type { AttentionLedger, AttentionLedgerAppendInput, AttentionLedgerOutcome } from './attentionLedger'

/**
 * A4 — the replay-local, non-authoritative Attention Ledger (surface C).
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D17 non-authoritative and one-way, D15 cooldown keyed on committed
 *    coordinates rather than wall clock, D2 surface C);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§24 L1-L3 ledger closure, §25 L5-L6 no online policy adaptation, §26 T6 a
 *    rendering failure is not non-engagement, §27 lifecycle preservation);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 immutable replay-local append sequence, no table or migration; §9 A4
 *    slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * The static half of the ledger's closure — that no Stage A module imports it, so
 * detection and A-prime construction provably cannot read it — is asserted in
 * `attentionLedgerStaticClosure.test.ts`, which is where the whole-tree evidence
 * lives. What is proven here is the record contract itself.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

function orderedCandidates(candidates: readonly QuestCandidate[]): readonly AttentionCandidate[] {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, access.openingCoordinateViews, Object.freeze([]))
  if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit these views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')
  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') throw new Error('expected the A3 total order to be total')
  return ordered.orderedCandidates
}

function openCandidate(id: string, provenanceId: string, openedAtLsn: number): QuestCandidate {
  return createProofQuestCandidate({
    id,
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn,
    openingProvenance: { visibility: 'public', provenanceId },
    legallyVisibleParties: ['player'],
    legallyVisiblePublicStakes: 'restore-public-trust',
  })
}

const FIRST = openCandidate('quest-a-open', 'consequence-public-31', 31)
const SECOND = openCandidate('quest-b-open', 'consequence-public-32', 32)

function emptyLedger(): AttentionLedger {
  const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (created.kind !== 'ok') throw new Error('expected an empty ledger')
  return created.ledger
}

/** Render one candidate through the real A4 presentation path. */
function renderedIdentity(attentionCandidate: AttentionCandidate): string {
  const built = buildAttentionRevealPackage(attentionCandidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (built.kind !== 'ok') throw new Error('expected a package')
  const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (rendered.kind !== 'ok') throw new Error('expected rendered output')
  return rendered.outputIdentity
}

function appendInput(
  attentionCandidate: AttentionCandidate,
  outcome: AttentionLedgerOutcome,
): AttentionLedgerAppendInput {
  const carriesOutput = outcome === 'presentation-ready' || outcome === 'presentation-fallback'
  return {
    attentionCandidate,
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
    templateVersion: ATTENTION_TEMPLATE_VERSION,
    outcome,
    ...(carriesOutput ? { renderedOutputIdentity: renderedIdentity(attentionCandidate) } : {}),
  }
}

function appendOrThrow(
  ledger: AttentionLedger,
  attentionCandidate: AttentionCandidate,
  outcome: AttentionLedgerOutcome,
): AttentionLedger {
  const result = appendAttentionLedgerRecord(ledger, appendInput(attentionCandidate, outcome))
  if (result.kind !== 'ok') throw new Error('expected an append, got refusal: ' + result.reason)
  return result.ledger
}

describe('A4 — the ledger is created under an explicit, supported policy version', () => {
  it('creates an empty, frozen sequence', () => {
    const ledger = emptyLedger()

    expect(ledger.ledgerPolicyVersion).toBe(ATTENTION_LEDGER_POLICY_VERSION)
    expect(ledger.records).toEqual([])
    expect(Object.isFrozen(ledger)).toBe(true)
    expect(Object.isFrozen(ledger.records)).toBe(true)
  })

  it('refuses a missing or unsupported ledger policy version rather than defaulting one', () => {
    expect(createAttentionLedger({ ledgerPolicyVersion: '  ' }))
      .toEqual({ kind: 'refused', reason: 'missing-ledger-policy-version' })
    expect(createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v2' }))
      .toEqual({ kind: 'refused', reason: 'unsupported-ledger-policy-version' })
  })
})

describe('B5 — pattern presentation policy', () => {
  const pattern: AttentionCandidate = Object.freeze({
    sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'pattern-source', candidateId: 'pattern-candidate',
    eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
    canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
    rankingSnapshotLsn: 0, legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
    canonicalBindingTuple: Object.freeze([]), canonicalSupportingRecordIdentityTuple: Object.freeze([]), lastProgressLsn: 0,
  })

  function appendPattern(
    ledger: AttentionLedger,
    lsn: number,
    outcome: AttentionLedgerOutcome,
    candidateId = pattern.candidateId,
  ): AttentionLedger {
    const result = appendAttentionLedgerRecord(ledger, {
      attentionCandidate: { ...pattern, candidateId, sourceId: `${candidateId}-source`, rankingSnapshotLsn: lsn },
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      outcome,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      presentationLsn: lsn,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      ...((outcome === 'presentation-ready' || outcome === 'presentation-fallback') ? { renderedOutputIdentity: `output-${lsn}` } : {}),
    })
    if (result.kind !== 'ok') throw new Error('expected pattern append: ' + result.reason)
    return result.ledger
  }

  it('applies density, cooldown, failure, and retirement boundaries from committed LSNs', () => {
    let ledger = emptyLedger()
    for (const lsn of [1, 2, 3, 4]) ledger = appendPattern(ledger, lsn, 'presentation-ready', `other-${lsn}`)
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 16 }))
      .toMatchObject({ eligible: false, reason: 'density-window-full', successfulPresentationsInWindow: 4 })

    ledger = appendPattern(emptyLedger(), 10, 'presentation-ready')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 13 }).reason)
      .toBe('successful-cooldown')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 14 }).reason)
      .toBe('eligible')

    ledger = appendPattern(emptyLedger(), 10, 'revalidation-failed')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 11 }).reason)
      .toBe('revalidation-failure-cooldown')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 12 }).reason)
      .toBe('eligible')
    ledger = appendPattern(ledger, 12, 'revalidation-failed')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 14 }).reason)
      .toBe('retired-revalidation-failure')
    expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 8, satisfiedCompletionLsn: 0 }).reason)
      .toBe('retired-satisfied-age')
  })

  it('uses a disjoint pattern record identity and leaves the quest-only feature projection unchanged', () => {
    const ledger = appendPattern(emptyLedger(), 10, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected a pattern record')
    if (record.sourceKind !== 'narrative_pattern_instance') throw new Error('expected a pattern presentation record')

    expect(record.sourceKind).toBe('narrative_pattern_instance')
    expect(record.patternPresentationLedgerPolicyVersion)
      .toBe(ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION)
    expect(record.recordId.startsWith(ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION + ':')).toBe(true)
    expect('ledgerPolicyVersion' in record).toBe(false)
    expect(Object.isFrozen(record)).toBe(true)
    expect(attentionLedgerFeatures(ledger, pattern.candidateId)).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 0,
      lastPresentedRankingSnapshotLsn: null,
    })
  })

  it('B5 -- carries exactly the closed pattern-branch key set (RN019 SS9.7), no quest-only key, and reverse-order-stable canonical bytes', () => {
    // Independently pinned from RN019 SS9.7's field table, not derived from
    // the implementation export, from Object.keys of a built record, or from
    // any other implementation constant.
    const PATTERN_PRESENTATION_LEDGER_RECORD_KEYS_EXPECTED = [
      // common
      'sourceKind', 'sourceId', 'candidateId', 'sequence', 'recordId', 'rankingSnapshotLsn', 'outcome',
      'canonicalizationVersion', 'accessorContractVersion', 'templateChannelPolicyVersion', 'exposurePolicyVersion',
      'templateVersion',
      // narrative_pattern_instance branch only
      'patternPresentationLedgerPolicyVersion', 'presentationLsn', 'resourcePolicyVersion',
    ]
    expect(PATTERN_PRESENTATION_LEDGER_RECORD_KEYS_EXPECTED).toHaveLength(15)
    expect([...ATTENTION_PATTERN_PRESENTATION_LEDGER_RECORD_KEYS].sort())
      .toEqual([...PATTERN_PRESENTATION_LEDGER_RECORD_KEYS_EXPECTED].sort())

    const ledger = appendPattern(emptyLedger(), 10, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected a pattern record')
    if (record.sourceKind !== 'narrative_pattern_instance') throw new Error('expected a pattern presentation record')

    // Exactly the fifteen pattern-branch keys plus the one optional key this
    // append carries -- no extra, no omission, and no quest-only key.
    expect(Object.keys(record).sort())
      .toEqual([...PATTERN_PRESENTATION_LEDGER_RECORD_KEYS_EXPECTED, 'renderedOutputIdentity'].sort())
    expect('ledgerPolicyVersion' in record).toBe(false)
    expect(record.sourceKind).toBe('narrative_pattern_instance')
    expect(record.patternPresentationLedgerPolicyVersion).toBe(ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION)
    expect(record.presentationLsn).toBe(10)
    expect(record.resourcePolicyVersion).toBe(ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION)

    // Reversing the append-input's property-construction order does not
    // change canonical key/byte identity: canonical serialization sorts keys,
    // so two structurally identical inputs built in opposite property order
    // must mint the identical recordId and identical canonical bytes.
    const candidateForRecord = { ...pattern, candidateId: 'reverse-order-candidate', sourceId: 'reverse-order-source', rankingSnapshotLsn: 10 }
    const forwardInput: AttentionLedgerAppendInput = {
      attentionCandidate: candidateForRecord,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      outcome: 'presentation-ready',
      renderedOutputIdentity: 'reverse-order-output',
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      presentationLsn: 10,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    }
    const reversedInput: AttentionLedgerAppendInput = {
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      presentationLsn: 10,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      renderedOutputIdentity: 'reverse-order-output',
      outcome: 'presentation-ready',
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      attentionCandidate: candidateForRecord,
    }
    const forward = appendAttentionLedgerRecord(emptyLedger(), forwardInput)
    const reversed = appendAttentionLedgerRecord(emptyLedger(), reversedInput)
    if (forward.kind !== 'ok' || reversed.kind !== 'ok') throw new Error('expected both appends to succeed')
    expect(forward.record.recordId).toBe(reversed.record.recordId)
    expect(canonicalSerialize(forward.record)).toBe(canonicalSerialize(reversed.record))
  })

  it('refuses missing, unsupported, and mixed branch-specific record fields before hashing', () => {
    const patternInput: AttentionLedgerAppendInput = {
      attentionCandidate: { ...pattern, rankingSnapshotLsn: 10 },
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      outcome: 'presentation-ready',
      renderedOutputIdentity: 'pattern-output',
      presentationLsn: 10,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    }
    expect(appendAttentionLedgerRecord(emptyLedger(), patternInput))
      .toEqual({ kind: 'refused', reason: 'missing-pattern-presentation-ledger-policy-version' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...patternInput,
      patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v9',
    })).toEqual({ kind: 'refused', reason: 'unsupported-pattern-presentation-ledger-policy-version' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...patternInput,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION,
    } as AttentionLedgerAppendInput)).toEqual({ kind: 'refused', reason: 'mixed-ledger-record-branch' })

    const [quest] = orderedCandidates([FIRST])
    if (quest === undefined) throw new Error('expected quest candidate')
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...appendInput(quest, 'presentation-ready'),
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      presentationLsn: 10,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    })).toEqual({ kind: 'refused', reason: 'mixed-ledger-record-branch' })
  })

  describe('B5 -- density window: 0/4/5 successes, inclusive -15/-16 boundary, reverse order', () => {
    it('zero prior successes is eligible with a zero window count', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 5 }))
        .toMatchObject({ eligible: true, successfulPresentationsInWindow: 0 })
    })

    it('one through four successes in the window all remain eligible at the fourth', () => {
      let ledger = emptyLedger()
      for (const lsn of [1, 2, 3]) ledger = appendPattern(ledger, lsn, 'presentation-ready', `other-${lsn}`)
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 10 }))
        .toMatchObject({ eligible: true, successfulPresentationsInWindow: 3 })
    })

    it('the oldest success is exactly on the inclusive 16-LSN boundary and still counts', () => {
      const ledger = appendPattern(emptyLedger(), 0, 'presentation-ready', 'other-boundary')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 15 }))
        .toMatchObject({ successfulPresentationsInWindow: 1 })
    })

    it('the oldest success one LSN outside the window (currentLsn - 16) does not count', () => {
      const ledger = appendPattern(emptyLedger(), 0, 'presentation-ready', 'other-outside')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 16 }))
        .toMatchObject({ successfulPresentationsInWindow: 0 })
    })

    it('reverse ledger append order produces the identical window count', () => {
      let forward = emptyLedger()
      for (const lsn of [1, 2, 3, 4]) forward = appendPattern(forward, lsn, 'presentation-ready', `f-${lsn}`)
      let reversed = emptyLedger()
      for (const lsn of [4, 3, 2, 1]) reversed = appendPattern(reversed, lsn, 'presentation-ready', `f-${lsn}`)
      const forwardDecision = evaluateAttentionPatternPresentationPolicy({ ledger: forward, candidateId: pattern.candidateId, evaluationLsn: 16 })
      const reversedDecision = evaluateAttentionPatternPresentationPolicy({ ledger: reversed, candidateId: pattern.candidateId, evaluationLsn: 16 })
      expect(forwardDecision).toEqual(reversedDecision)
    })

    it('density counts pattern successes globally, never scoped to one candidate id', () => {
      const ledger = appendPattern(emptyLedger(), 5, 'presentation-ready', 'entirely-unrelated-candidate')
      // A different candidate's own history is empty, but the global window
      // still reflects the unrelated candidate's success (RN019 SS8.2: density
      // is ledger-wide, not per-candidate).
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 6 }))
        .toMatchObject({ successfulPresentationsInWindow: 1 })
    })

    it('non-success outcomes (revalidation-failed, presentation-failed, non-engagement) never count toward density', () => {
      let ledger = emptyLedger()
      ledger = appendPattern(ledger, 1, 'revalidation-failed', 'a')
      ledger = appendPattern(ledger, 2, 'presentation-failed', 'b')
      ledger = appendPattern(ledger, 3, 'non-engagement', 'c')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 4 }))
        .toMatchObject({ successfulPresentationsInWindow: 0 })
    })
  })

  describe('B5 -- successful exposure: 0/2/3 attempts, post-append retirement, independence', () => {
    it('zero successful exposures is eligible', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 0 }))
        .toMatchObject({ eligible: true, successfulExposureCount: 0 })
    })

    it('the first success is recorded and the candidate remains eligible for its second attempt after cooldown', () => {
      const ledger = appendPattern(emptyLedger(), 0, 'presentation-ready')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 4 }))
        .toMatchObject({ eligible: true, successfulExposureCount: 1 })
    })

    it('the second successful exposure retires the exact candidate id immediately after append', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'presentation-ready')
      ledger = appendPattern(ledger, 4, 'presentation-ready')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 20 }))
        .toMatchObject({ eligible: false, reason: 'retired-exposure', successfulExposureCount: 2 })
    })

    it('a third attempt after the second success remains permanently ineligible', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'presentation-ready')
      ledger = appendPattern(ledger, 4, 'presentation-ready')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 1000 }).reason)
        .toBe('retired-exposure')
    })

    it('an unrelated candidate id is independent of another candidate exhausting its exposures', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'presentation-ready', 'candidate-a')
      ledger = appendPattern(ledger, 4, 'presentation-ready', 'candidate-a')
      ledger = appendPattern(ledger, 8, 'presentation-ready', 'candidate-b')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: 'candidate-b', evaluationLsn: 20 }))
        .toMatchObject({ eligible: true, successfulExposureCount: 1 })
    })

    it('reverse ledger append order produces the identical exposure decision', () => {
      let forward = appendPattern(emptyLedger(), 0, 'presentation-ready')
      forward = appendPattern(forward, 4, 'presentation-ready')
      // Same two successes, appended in reverse LSN order onto separate ledgers.
      let reversed = appendPattern(emptyLedger(), 4, 'presentation-ready')
      reversed = appendPattern(reversed, 0, 'presentation-ready')
      const forwardDecision = evaluateAttentionPatternPresentationPolicy({ ledger: forward, candidateId: pattern.candidateId, evaluationLsn: 20 })
      const reversedDecision = evaluateAttentionPatternPresentationPolicy({ ledger: reversed, candidateId: pattern.candidateId, evaluationLsn: 20 })
      expect(forwardDecision).toEqual(reversedDecision)
    })
  })

  describe('B5 -- revalidation-failure cooldown and retirement: 0/2/3 attempts, success resets the count', () => {
    it('zero consecutive failures is eligible', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 0 }))
        .toMatchObject({ eligible: true, consecutiveRevalidationFailureCount: 0 })
    })

    it('a successful presentation between two failures resets the consecutive-failure count', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'revalidation-failed')
      ledger = appendPattern(ledger, 4, 'presentation-ready')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 8 }))
        .toMatchObject({ consecutiveRevalidationFailureCount: 0 })
      // A single subsequent failure is only the first again, not the second
      // consecutive one, so the candidate is not yet retired.
      ledger = appendPattern(ledger, 12, 'revalidation-failed')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 14 }).reason)
        .not.toBe('retired-revalidation-failure')
    })

    it('a third attempt after the second consecutive failure remains permanently ineligible', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'revalidation-failed')
      ledger = appendPattern(ledger, 2, 'revalidation-failed')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: pattern.candidateId, evaluationLsn: 1000 }).reason)
        .toBe('retired-revalidation-failure')
    })

    it('an unrelated candidate id is independent of another candidate retiring on consecutive failures', () => {
      let ledger = appendPattern(emptyLedger(), 0, 'revalidation-failed', 'candidate-a')
      ledger = appendPattern(ledger, 2, 'revalidation-failed', 'candidate-a')
      ledger = appendPattern(ledger, 4, 'revalidation-failed', 'candidate-b')
      // candidate-b has only its own single failure at LSN 4; evaluated one
      // LSN inside its own 2-LSN failure cooldown, not retired by candidate-a's
      // unrelated second consecutive failure.
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: 'candidate-b', evaluationLsn: 5 }).reason)
        .toBe('revalidation-failure-cooldown')
      expect(evaluateAttentionPatternPresentationPolicy({ ledger, candidateId: 'candidate-b', evaluationLsn: 5 }).reason)
        .not.toBe('retired-revalidation-failure')
    })

    it('reverse ledger append order produces the identical retirement decision', () => {
      let forward = appendPattern(emptyLedger(), 0, 'revalidation-failed')
      forward = appendPattern(forward, 2, 'revalidation-failed')
      let reversed = appendPattern(emptyLedger(), 2, 'revalidation-failed')
      reversed = appendPattern(reversed, 0, 'revalidation-failed')
      const forwardDecision = evaluateAttentionPatternPresentationPolicy({ ledger: forward, candidateId: pattern.candidateId, evaluationLsn: 1000 })
      const reversedDecision = evaluateAttentionPatternPresentationPolicy({ ledger: reversed, candidateId: pattern.candidateId, evaluationLsn: 1000 })
      expect(forwardDecision).toEqual(reversedDecision)
    })
  })

  describe('B5 -- satisfied-pattern age retirement: 7/8/9, active/stalled unaffected', () => {
    it('one LSN before the 8-LSN boundary is not yet retired', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 7, satisfiedCompletionLsn: 0 }).reason)
        .not.toBe('retired-satisfied-age')
    })

    it('exactly at the 8-LSN boundary the candidate is retired', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 8, satisfiedCompletionLsn: 0 }).reason)
        .toBe('retired-satisfied-age')
    })

    it('one LSN past the boundary remains retired', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 9, satisfiedCompletionLsn: 0 }).reason)
        .toBe('retired-satisfied-age')
    })

    it('an active/stalled candidate with no satisfiedCompletionLsn is never subject to age retirement', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 1000 }).reason)
        .not.toBe('retired-satisfied-age')
    })

    it('an unrelated candidate id is independent of another candidate satisfied-age retiring', () => {
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: 'unrelated-candidate', evaluationLsn: 1000 }).reason)
        .not.toBe('retired-satisfied-age')
    })
  })

  describe('B5 -- malformed/hidden ledger evidence cannot alter a policy decision', () => {
    it('a duplicate record id anywhere in the ledger is treated as malformed history', () => {
      const clean = appendPattern(emptyLedger(), 0, 'presentation-ready')
      const [record] = clean.records
      if (record === undefined) throw new Error('expected one record')
      // Force a structurally impossible duplicate-identity ledger a legitimate
      // append path could never produce.
      const malformed: AttentionLedger = Object.freeze({
        ledgerPolicyVersion: clean.ledgerPolicyVersion,
        records: Object.freeze([record, record]),
      })
      expect(evaluateAttentionPatternPresentationPolicy({ ledger: malformed, candidateId: pattern.candidateId, evaluationLsn: 10 }).reason)
        .toBe('malformed-ledger-history')
    })

    it('an unrelated candidate hidden record cannot shift this candidate\'s own decision beyond the documented global density effect', () => {
      const withoutHidden = evaluateAttentionPatternPresentationPolicy({ ledger: emptyLedger(), candidateId: pattern.candidateId, evaluationLsn: 5 })
      const hiddenLedger = appendPattern(emptyLedger(), 3, 'presentation-ready', 'hidden-elsewhere')
      const withHidden = evaluateAttentionPatternPresentationPolicy({ ledger: hiddenLedger, candidateId: pattern.candidateId, evaluationLsn: 5 })
      // The hidden candidate's own exposure/cooldown/retirement state is
      // completely untouched; only the shared global density count moves,
      // exactly as RN019 SS8.2 specifies for the mixed-family density window.
      expect(withHidden.successfulExposureCount).toBe(withoutHidden.successfulExposureCount)
      expect(withHidden.consecutiveRevalidationFailureCount).toBe(withoutHidden.consecutiveRevalidationFailureCount)
    })
  })
})

describe('A4 — records are immutable, append-only, and deterministically identified', () => {
  it('returns a new ledger and leaves the previous one byte-identical', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const before = emptyLedger()
    const beforeBytes = canonicalSerialize(before)

    const after = appendOrThrow(before, first, 'presentation-ready')

    expect(canonicalSerialize(before)).toBe(beforeBytes)
    expect(before.records).toHaveLength(0)
    expect(after.records).toHaveLength(1)
    expect(after).not.toBe(before)
  })

  it('freezes every record, so an appended outcome cannot be edited afterwards', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(emptyLedger(), first, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected one record')

    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      (record as unknown as Record<string, unknown>).outcome = 'non-engagement'
    }).toThrow(TypeError)
  })

  it('carries the closed record field set, its version coordinates, and both ids', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(emptyLedger(), first, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected one record')
    if (record.sourceKind !== 'quest_candidate') throw new Error('expected a quest ledger record')

    expect(Object.keys(record).sort()).toEqual([...ATTENTION_LEDGER_RECORD_KEYS, 'renderedOutputIdentity'].sort())
    expect(record.ledgerPolicyVersion).toBe(ATTENTION_LEDGER_POLICY_VERSION)
    expect(record.exposurePolicyVersion).toBe(ATTENTION_EXPOSURE_POLICY_VERSION)
    expect(record.templateChannelPolicyVersion).toBe(ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION)
    expect(record.templateVersion).toBe(ATTENTION_TEMPLATE_VERSION)
    expect(record.accessorContractVersion).toBe(ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION)
    expect(record.canonicalizationVersion).toBe(first.canonicalizationVersion)
    expect(record.rankingSnapshotLsn).toBe(A1_RANKING_SNAPSHOT_LSN)
    expect(record.sourceKind).toBe('quest_candidate')
    expect(record.sourceId).toBe('quest-a-open')
    expect(record.candidateId).toBe(first.candidateId)
    expect(record.sequence).toBe(0)
    expect(record.recordId.startsWith(ATTENTION_LEDGER_POLICY_VERSION + ':')).toBe(true)
  })

  it('appends in the A3 total order it is given, with strictly increasing sequence', () => {
    const ordered = orderedCandidates([SECOND, FIRST])
    let ledger = emptyLedger()
    for (const attentionCandidate of ordered) {
      ledger = appendOrThrow(ledger, attentionCandidate, 'presentation-ready')
    }

    expect(ordered.map((attentionCandidate) => attentionCandidate.sourceId)).toEqual(['quest-a-open', 'quest-b-open'])
    expect(ledger.records.map((record) => record.sourceId)).toEqual(['quest-a-open', 'quest-b-open'])
    expect(ledger.records.map((record) => record.sequence)).toEqual([0, 1])
  })

  it('gives byte-identical records across repeated cold runs of the same inputs', () => {
    const runs = [0, 1].map(() => {
      const ordered = orderedCandidates([FIRST, SECOND])
      let ledger = emptyLedger()
      for (const attentionCandidate of ordered) {
        ledger = appendOrThrow(ledger, attentionCandidate, 'presentation-ready')
      }
      return canonicalSerialize(ledger)
    })

    expect(runs[1]).toBe(runs[0])
  })

  it('distinguishes a repeated presentation of the same candidate by its position', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), first, 'presentation-ready'), first, 'presentation-ready')
    const [one, two] = ledger.records

    expect(one?.candidateId).toBe(two?.candidateId)
    expect(one?.recordId).not.toBe(two?.recordId)
    expect(ledger.records.map((record) => record.sequence)).toEqual([0, 1])
  })
})

describe('A4 — appends refuse rather than approximate', () => {
  const [base] = orderedCandidates([FIRST])
  if (base === undefined) throw new Error('expected a candidate')

  const refusals: [string, AttentionLedgerAppendInput, string][] = [
    [
      'an unsupported exposure policy version',
      { ...appendInput(base, 'presentation-ready'), exposurePolicyVersion: 'attention-exposure-policy-v2' },
      'unsupported-exposure-policy-version',
    ],
    [
      'a blank exposure policy version',
      { ...appendInput(base, 'presentation-ready'), exposurePolicyVersion: '' },
      'missing-exposure-policy-version',
    ],
    [
      'an unsupported template/channel policy version',
      { ...appendInput(base, 'presentation-ready'), templateChannelPolicyVersion: 'attention-template-channel-policy-v2' },
      'unsupported-template-channel-policy-version',
    ],
    [
      'a blank template/channel policy version',
      { ...appendInput(base, 'presentation-ready'), templateChannelPolicyVersion: ' ' },
      'missing-template-channel-policy-version',
    ],
    [
      'an unsupported template version',
      { ...appendInput(base, 'presentation-ready'), templateVersion: 'attention-extradiegetic-template-v2' },
      'unsupported-template-version',
    ],
    [
      'a later canonicalization version on the candidate',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, canonicalizationVersion: 'attention-candidate-canonicalization-v2' },
      },
      'unsupported-canonicalization-version',
    ],
    [
      'a blank accessor-contract version on the candidate',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, accessorContractVersion: '' },
      },
      'missing-accessor-contract-version',
    ],
    [
      'a ranking coordinate past the safe-integer ceiling',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, rankingSnapshotLsn: Number.MAX_SAFE_INTEGER + 2 },
      },
      'ranking-snapshot-lsn-out-of-range',
    ],
    [
      'a blank source id',
      { ...appendInput(base, 'presentation-ready'), attentionCandidate: { ...base, sourceId: '  ' } },
      'missing-source-id',
    ],
    [
      'a blank candidate id',
      { ...appendInput(base, 'presentation-ready'), attentionCandidate: { ...base, candidateId: '' } },
      'missing-candidate-id',
    ],
    [
      'an outcome outside the closed set',
      { ...appendInput(base, 'presentation-ready'), outcome: 'presented-somehow' as unknown as AttentionLedgerOutcome },
      'unsupported-outcome',
    ],
  ]

  it.each(refusals)('refuses %s', (_label, input, reason) => {
    expect(appendAttentionLedgerRecord(emptyLedger(), input)).toEqual({ kind: 'refused', reason })
  })

  it('refuses a ledger value carrying an unsupported policy version', () => {
    const forged = { ledgerPolicyVersion: 'attention-ledger-policy-v2', records: [] } as unknown as AttentionLedger

    expect(appendAttentionLedgerRecord(forged, appendInput(base, 'presentation-ready')))
      .toEqual({ kind: 'refused', reason: 'unsupported-ledger-policy-version' })
  })

  it('refuses a rendered outcome with no output identity, and an unrendered one that claims output', () => {
    const rendered = appendInput(base, 'presentation-ready')
    const withoutIdentity = { ...rendered }
    delete (withoutIdentity as { renderedOutputIdentity?: string }).renderedOutputIdentity

    expect(appendAttentionLedgerRecord(emptyLedger(), withoutIdentity))
      .toEqual({ kind: 'refused', reason: 'missing-rendered-output-identity' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...appendInput(base, 'non-engagement'),
      renderedOutputIdentity: 'forged-output-identity',
    })).toEqual({ kind: 'refused', reason: 'unexpected-rendered-output-identity' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...appendInput(base, 'presentation-failed'),
      renderedOutputIdentity: 'forged-output-identity',
    })).toEqual({ kind: 'refused', reason: 'unexpected-rendered-output-identity' })
  })

  it('leaves the ledger untouched when it refuses', () => {
    const ledger = appendOrThrow(emptyLedger(), base, 'presentation-ready')
    const before = canonicalSerialize(ledger)

    expect(appendAttentionLedgerRecord(ledger, { ...appendInput(base, 'presentation-ready'), templateVersion: 'x' }).kind)
      .toBe('refused')
    expect(canonicalSerialize(ledger)).toBe(before)
  })
})

describe('A4 — the ledger exposes only the declared exposure and cooldown inputs', () => {
  const [base] = orderedCandidates([FIRST])
  if (base === undefined) throw new Error('expected a candidate')

  it('projects exactly the pinned feature keys and nothing else', () => {
    const features = attentionLedgerFeatures(emptyLedger(), base.candidateId)

    expect(Object.keys(features).sort()).toEqual([...ATTENTION_LEDGER_FEATURE_KEYS])
    expect(ATTENTION_LEDGER_FEATURE_KEYS).toEqual([
      'exposureCount',
      'lastPresentedRankingSnapshotLsn',
      'nonEngagementCount',
      'repetitionCount',
    ])
    expect(features).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 0,
      lastPresentedRankingSnapshotLsn: null,
    })
  })

  it('counts exposures and repetitions, and keys cooldown on a committed coordinate', () => {
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), base, 'presentation-ready'), base, 'presentation-fallback')

    expect(attentionLedgerFeatures(ledger, base.candidateId)).toEqual({
      exposureCount: 2,
      repetitionCount: 1,
      nonEngagementCount: 0,
      // A committed ranking coordinate, never a wall-clock instant (D15).
      lastPresentedRankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })
  })

  it('keeps a rendering failure distinct from player non-engagement', () => {
    const failed = appendOrThrow(emptyLedger(), base, 'presentation-failed')
    const ignored = appendOrThrow(emptyLedger(), base, 'non-engagement')

    // A failure is neither an exposure nor a non-engagement (replay spec T6).
    expect(attentionLedgerFeatures(failed, base.candidateId)).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 0,
      lastPresentedRankingSnapshotLsn: null,
    })
    expect(attentionLedgerFeatures(ignored, base.candidateId)).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 1,
      lastPresentedRankingSnapshotLsn: null,
    })
  })

  it('scopes features to one candidate identity', () => {
    const ordered = orderedCandidates([FIRST, SECOND])
    const [first, second] = ordered
    if (first === undefined || second === undefined) throw new Error('expected two candidates')
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), first, 'presentation-ready'), second, 'non-engagement')

    expect(attentionLedgerFeatures(ledger, first.candidateId).exposureCount).toBe(1)
    expect(attentionLedgerFeatures(ledger, second.candidateId).exposureCount).toBe(0)
    expect(attentionLedgerFeatures(ledger, second.candidateId).nonEngagementCount).toBe(1)
  })

  it('does not force completion, substitute an actor, or resolve anything on non-engagement', () => {
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidates: [FIRST],
    })
    const snapshotBefore = canonicalSerialize(snapshot)
    const [only] = orderedCandidates([FIRST])
    if (only === undefined) throw new Error('expected a candidate')
    const candidateBefore = canonicalSerialize(only)

    appendOrThrow(appendOrThrow(emptyLedger(), only, 'non-engagement'), only, 'presentation-failed')

    // Nothing about the engine-owned record moved: same bytes, same lifecycle.
    expect(canonicalSerialize(snapshot)).toBe(snapshotBefore)
    expect(canonicalSerialize(only)).toBe(candidateBefore)
    expect(snapshot.candidates.map((candidate) => candidate.status)).toEqual(['open'])
  })
})
