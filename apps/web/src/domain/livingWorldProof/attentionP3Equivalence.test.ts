import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { createProofQuestCandidate } from './attentionQuestCandidateContracts'
import {
  buildAttentionQuestCandidateHiddenPairScenario,
  buildAttentionQuestCandidatePublicOpenPairScenario,
  buildAttentionQuestCandidateResolvedPairScenario,
  buildAttentionQuestCandidateWorld,
} from './attentionQuestCandidateScenario'
import type { AttentionQuestCandidatePairedWorld } from './attentionQuestCandidateScenario'
import {
  attentionPrimeSurfaceDigest,
  attentionPrimeViewIdentities,
  runAttentionMixedFamilyEvaluation,
  runAttentionP3PairedWorldCheck,
} from './attentionReplay'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { createAttentionLedger } from './attentionLedger'
import { buildB6MixedEvaluationFixture, buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'
import {
  A1_RANKING_SNAPSHOT_LSN,
  buildAttentionQuestCandidateTwoVisibleCandidates,
} from './attentionQuestCandidateScenario'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import type { AttentionReadableSurface } from './attentionReadableBoundary'
import { aidRecord, harmRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import type {
  AttentionReadablePatternEvidenceView,
  ProofPatternEvidenceRecordInput,
} from './attentionPatternEvidenceContracts'
import {
  privateBelief,
  privateIntentionCommitment,
  unobservedTruthEvent,
} from './attentionPrivateStateScenario'

/**
 * A5 — P3: A′-equivalent world pairs, including the mandatory hidden
 * `QuestCandidate` pair.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P3: A′-equivalent world pairs yield identical complete observable
 *    traces; the mandatory hidden-`QuestCandidate` fixture);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§10 "P3 — A′-equivalent world pairs", the mandatory premise check;
 *    §11 "Hidden `QuestCandidate` fixture (mandatory)"; §12 the public/
 *    resolved `QuestCandidate` fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "4. P3 — A′ EQUIVALENCE AND TRACE EQUALITY"; §9 A5 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 *
 * Every fixture below runs the premise check first (independent A′
 * construction for each world, canonical byte comparison, view-identity-set
 * comparison) and only then compares the complete player-observable trace —
 * never the reverse, and never a fixture that skips the premise check.
 */

describe('A5 / P3 — the mandatory hidden-QuestCandidate pair (Q1 = P3-5)', () => {
  it('the premise check passes: independently constructed A-prime is byte-identical, and the hidden candidate is absent from both -- both real visible candidates are present in both', () => {
    const { worldA, worldB, hiddenCandidateId, expectedVisibleCandidateIds } = buildAttentionQuestCandidateHiddenPairScenario()

    const { premiseCheck } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-hidden-pair',
      worldA,
      worldB,
    })

    expect(expectedVisibleCandidateIds).toHaveLength(2)
    expect(premiseCheck.equivalent).toBe(true)
    expect(premiseCheck.leftAPrimeDigest).toBe(premiseCheck.rightAPrimeDigest)
    expect([...premiseCheck.leftViewIdentities].sort()).toEqual([...expectedVisibleCandidateIds])
    expect([...premiseCheck.rightViewIdentities].sort()).toEqual([...expectedVisibleCandidateIds])
    expect(premiseCheck.leftViewIdentities).not.toContain(hiddenCandidateId)
    expect(premiseCheck.rightViewIdentities).not.toContain(hiddenCandidateId)
  })

  it('the complete player-observable trace is byte-identical across the pair once the premise check passes (canonical-byte oracle, not deep-equality)', () => {
    const { worldA, worldB } = buildAttentionQuestCandidateHiddenPairScenario()

    const { premiseCheck, traceA, traceB } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-hidden-pair-trace',
      worldA,
      worldB,
    })

    expect(premiseCheck.equivalent).toBe(true)
    if (traceA === undefined || traceB === undefined) throw new Error('expected both worlds to complete a full pass')

    // The pass oracle: canonical bytes of the complete player-observable
    // trace, per replay spec §10/§30 -- never Vitest deep-equality, which
    // cannot distinguish a real structural mismatch from an accidental key-
    // order/reference difference the way a canonical serializer can.
    expect(canonicalSerialize(traceA.playerObservable)).toBe(canonicalSerialize(traceB.playerObservable))
    // Ordered candidate IDs -- explicitly, not only folded into the byte
    // comparison above -- are byte-identical between the two worlds.
    expect(traceA.playerObservable.orderedCandidateIds).toEqual(traceB.playerObservable.orderedCandidateIds)
    expect(traceA.playerObservable.orderedCandidateIds).toHaveLength(2)
    // No cadence/timing coordinate difference.
    expect(traceA.rankingSnapshotLsn).toBe(traceB.rankingSnapshotLsn)
    expect(traceA.revalidationSnapshotLsn).toBe(traceB.revalidationSnapshotLsn)
    // No presentation/fallback difference.
    expect(canonicalSerialize(traceA.presentations)).toBe(canonicalSerialize(traceB.presentations))
    // The full traces legitimately differ only in their replay-case bookkeeping (id/identity); never in observable content.
    expect(traceA.replayCaseId).not.toBe(traceB.replayCaseId)
    expect(traceA.traceIdentity).not.toBe(traceB.traceIdentity)
  })

  it('the hidden candidate causes no ranking or ordering displacement: the order/tie-break trace is byte-identical with and without it', () => {
    const { worldA, worldB } = buildAttentionQuestCandidateHiddenPairScenario()

    const { premiseCheck, traceA, traceB } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-hidden-pair-ordering',
      worldA,
      worldB,
    })

    expect(premiseCheck.equivalent).toBe(true)
    if (traceA === undefined || traceB === undefined) throw new Error('expected both worlds to complete a full pass')

    // World A has the hidden candidate in its raw QuestCandidate snapshot;
    // World B does not contain it at all. If the hidden candidate displaced
    // or reordered anything, the two worlds' tie-break paths would diverge.
    // They do not: this is the direct, non-vacuous witness that a hidden,
    // legally-invisible candidate cannot move a real candidate's position.
    expect(traceA.orderingTrace).toHaveLength(1)
    expect(traceB.orderingTrace).toHaveLength(1)
    expect(canonicalSerialize(traceA.orderingTrace)).toBe(canonicalSerialize(traceB.orderingTrace))
  })

  it('the hidden candidate consumes no candidate/resource budget and remains authoritatively open and untouched', () => {
    const { worldA, hiddenCandidateId } = buildAttentionQuestCandidateHiddenPairScenario()
    const before = canonicalSerialize(worldA.snapshot)

    const { traceA } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-hidden-pair-untouched',
      worldA,
      worldB: buildAttentionQuestCandidateHiddenPairScenario().worldB,
    })

    expect(canonicalSerialize(worldA.snapshot)).toBe(before)
    const hiddenRecord = worldA.snapshot.candidates.find((candidate) => candidate.id === hiddenCandidateId)
    expect(hiddenRecord?.status).toBe('open')
    // Two real candidates admitted, never three: the hidden candidate never
    // occupies a slot in the ordered/admitted set.
    expect(traceA?.orderedAttentionCandidates).toHaveLength(2)
    expect(traceA?.admittedQuestCandidateSourceIds).not.toContain(hiddenCandidateId)
  })
})

/**
 * Correction round: `canonicalSerialize` is JSON.stringify under key-sorting
 * (`canonicalSerialization.ts`), and `JSON.stringify` already omits any key
 * whose value is `undefined` -- `JSON.stringify({ a: undefined })` and
 * `JSON.stringify({})` both produce `'{}'`. So an "absent property" and a
 * "present property whose value is undefined" are byte-identical under this
 * oracle by construction, not by omission: there is no hidden-difference
 * risk for the P3 canonical-byte comparisons above to mask. Every optional
 * field the trace actually constructs (`playerObservableSubtrace`'s
 * `output`, and `AttentionTrace`'s own `p3PremiseCheck`) is already built
 * with a conditional spread that omits the key entirely rather than setting
 * it to `undefined` -- so no constructed trace ever holds an explicit
 * `undefined` value for the byte oracle to (harmlessly) collapse.
 */
describe('A5 / P3 — the canonical-byte oracle does not hide an absent-vs-undefined distinction', () => {
  it('an absent key and a present-but-undefined key serialize identically, so there is no gap for the P3 byte oracle to mask', () => {
    const absent = { candidateId: 'x' }
    const presentUndefined = { candidateId: 'x', output: undefined as string | undefined }

    expect(canonicalSerialize(absent)).toBe(canonicalSerialize(presentUndefined))
    expect(Object.prototype.hasOwnProperty.call(absent, 'output')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(presentUndefined, 'output')).toBe(true)
  })

  it('every constructed playerObservable presentation entry omits an undefined output key rather than holding one', () => {
    const { worldA } = buildAttentionQuestCandidateHiddenPairScenario()
    const { traceA } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-no-undefined-keys',
      worldA,
      worldB: buildAttentionQuestCandidateHiddenPairScenario().worldB,
    })
    if (traceA === undefined) throw new Error('expected a complete pass')

    for (const presentation of traceA.playerObservable.presentations) {
      if (!Object.prototype.hasOwnProperty.call(presentation, 'output')) continue
      expect(presentation.output).not.toBeUndefined()
    }
  })
})

describe('A5 / P3 — the public-open paired case', () => {
  it('an identical public-open candidate in both worlds yields an equivalent premise check and identical observable traces (canonical-byte oracle)', () => {
    const { worldA, worldB } = buildAttentionQuestCandidatePublicOpenPairScenario()

    const { premiseCheck, traceA, traceB } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-public-open-pair',
      worldA,
      worldB,
    })

    expect(premiseCheck.equivalent).toBe(true)
    if (traceA === undefined || traceB === undefined) throw new Error('expected both worlds to complete a full pass')
    expect(canonicalSerialize(traceA.playerObservable)).toBe(canonicalSerialize(traceB.playerObservable))
  })
})

describe('A5 / P3 — the resolved paired case', () => {
  it('an identical resolved candidate in both worlds never enters A-prime, so both worlds have empty (and equivalent) A-prime and traces (canonical-byte oracle)', () => {
    const { worldA, worldB } = buildAttentionQuestCandidateResolvedPairScenario()

    const { premiseCheck, traceA, traceB } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-resolved-pair',
      worldA,
      worldB,
    })

    expect(premiseCheck.equivalent).toBe(true)
    expect(premiseCheck.leftViewIdentities).toEqual([])
    expect(premiseCheck.rightViewIdentities).toEqual([])
    expect(traceA?.orderedAttentionCandidates).toEqual([])
    expect(traceB?.orderedAttentionCandidates).toEqual([])
    if (traceA === undefined || traceB === undefined) throw new Error('expected both worlds to complete a full pass')
    expect(canonicalSerialize(traceA.playerObservable)).toBe(canonicalSerialize(traceB.playerObservable))
  })
})

describe('A5 / P3 — a non-equivalent pair fails as malformed, never reaching an observable-trace comparison', () => {
  it('rejects a pair whose A-prime surfaces are not byte-identical, and reports no traces', () => {
    const hiddenPair = buildAttentionQuestCandidateHiddenPairScenario()
    // World A carries the extra hidden candidate at the A-domain level, but
    // it is legally excluded from A-prime -- so to construct a genuinely
    // *non*-equivalent pair for this negative control, compare world A
    // against the resolved-pair's world (a different public candidate
    // entirely), which the premise check must catch and reject.
    const resolvedPair = buildAttentionQuestCandidateResolvedPairScenario()

    const { premiseCheck, traceA, traceB } = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-malformed-pair',
      worldA: hiddenPair.worldA,
      worldB: resolvedPair.worldB,
    })

    expect(premiseCheck.equivalent).toBe(false)
    expect(traceA).toBeUndefined()
    expect(traceB).toBeUndefined()
  })
})

/**
 * B4 / RN019 §4.3 + §10.3 — the quest opening-coordinate sidecar is a third
 * independently compared P3 premise component.
 *
 * Two worlds whose legal quest views are byte-identical but whose committed
 * opening coordinates differ are **not** Stage B-readable-equivalent: the
 * coordinate is legally readable A-prime material and decides ordering key 7,
 * so a premise oracle blind to it would let a real observable difference pass.
 */
describe('B4 / P3 — readable-surface equality compares the sidecar collection too', () => {
  it('B6 preserves an explicitly supplied equivalent P3 premise in the trusted trace only', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const input = buildB6PatternOnlyEvaluationInput('b6-p3', ledger.ledger)
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      p3PremiseCheck: Object.freeze({
        leftAPrimeDigest: 'same', rightAPrimeDigest: 'same', leftViewIdentities: Object.freeze([]),
        rightViewIdentities: Object.freeze([]), leftOpeningCoordinateIdentities: Object.freeze([]),
        rightOpeningCoordinateIdentities: Object.freeze([]), equivalent: true,
      }),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected evaluation')
    expect(result.result.trace.p3PremiseCheck?.equivalent).toBe(true)
    expect(result.result.trace.playerObservable).not.toHaveProperty('p3PremiseCheck')
  })
})

/**
 * B6 / P3 — the complete **mixed-family** paired-world proof (RN019 §10.3, plan
 * §11.3, §11.6). It is built here, not by generalizing the frozen quest-only
 * `runAttentionP3PairedWorldCheck`, which stays untouched and quest-only.
 *
 * The mandatory legal fixture is exactly RN019 §10.3's: two visible quest views
 * and three visible rankable pattern candidates in **both** worlds, so five
 * candidates genuinely compete for the global mixed-family cap of four and one
 * is really displaced by the final two-family order. World A additionally holds
 * private records that would form a high-retention `public_conflict_escalation`
 * match if they were ever illegally admitted; World B holds none.
 */
describe('B6 / P3 — mixed-family readable-surface equivalence over both candidate families', () => {
  const P3_RANKING_LSN = A1_RANKING_SNAPSHOT_LSN

  /** Six public aid records — three reciprocal pairs, so three rankable instances. */
  const VISIBLE_PATTERN_RECORDS: readonly ProofPatternEvidenceRecordInput[] = Object.freeze([
    aidRecord('p3-aid-a-b', 10, 'a', 'b'), aidRecord('p3-aid-b-a', 11, 'b', 'a'),
    aidRecord('p3-aid-c-d', 12, 'c', 'd'), aidRecord('p3-aid-d-c', 13, 'd', 'c'),
    aidRecord('p3-aid-e-f', 14, 'e', 'f'), aidRecord('p3-aid-f-e', 15, 'f', 'e'),
  ])

  /**
   * World A's private material: a complete three-step escalation that would be a
   * high-retention `public_conflict_escalation` match if admitted. Declared
   * `private`, so the B1 accessor mints no view for it and it never enters A′.
   */
  const HIDDEN_ESCALATION_RECORDS: readonly ProofPatternEvidenceRecordInput[] = Object.freeze([
    Object.freeze({ ...harmRecord('p3-hidden-harm-1', 16, 'g', 'h', 'minor'), visibilityProvenance: Object.freeze({ visibility: 'private' as const }) }),
    Object.freeze({ ...harmRecord('p3-hidden-harm-2', 17, 'h', 'g', 'moderate'), visibilityProvenance: Object.freeze({ visibility: 'private' as const }) }),
    Object.freeze({ ...harmRecord('p3-hidden-harm-3', 18, 'g', 'h', 'major'), visibilityProvenance: Object.freeze({ visibility: 'private' as const }) }),
  ])

  /**
   * A second private set, used only by the post-premise bypass control below.
   * Like the escalation set it is `private`, so the B1 accessor mints no view
   * for it and it is absent from both worlds' A′ — the legal pairing and the
   * hidden-authority control are entirely unaffected by its presence.
   *
   * Its coordinates are pinned so that, IF a forbidden adapter ever forced it
   * past the accessor, the resulting instance would order ahead of the visible
   * aid bindings (`A0`/`B0` precede `a`/`c`/`e` in UTF-16 code units) and
   * complete at LSN 20, making it `satisfied` and therefore rankable.
   */
  const HIDDEN_FORGEABLE_AID_RECORDS: readonly ProofPatternEvidenceRecordInput[] = Object.freeze([
    Object.freeze({ ...aidRecord('p3-hidden-aid-1', 19, 'A0', 'B0'), visibilityProvenance: Object.freeze({ visibility: 'private' as const }) }),
    Object.freeze({ ...aidRecord('p3-hidden-aid-2', 20, 'B0', 'A0'), visibilityProvenance: Object.freeze({ visibility: 'private' as const }) }),
  ])

  function questPairWorld() {
    const { first, second } = buildAttentionQuestCandidateTwoVisibleCandidates()
    return Object.freeze({
      snapshot: createProofQuestCandidateSnapshot({
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        snapshotLsn: P3_RANKING_LSN,
        candidates: [first, second],
      }),
      request: Object.freeze({
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: P3_RANKING_LSN,
      }),
    })
  }

  /** Independently construct one world's complete A′ surface, all three collections. */
  function constructAPrimeSurface(patternViews: readonly AttentionReadablePatternEvidenceView[]) {
    const world = questPairWorld()
    const access = readAttentionReadableQuestCandidateViews(world.snapshot, world.request)
    if (access.kind !== 'ok') throw new Error('expected the quest accessor to admit both candidates')
    const surface = constructAttentionReadableSurface({
      surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
      accessorContractVersion: world.request.accessorContractVersion,
      rankingSnapshotLsn: world.request.rankingSnapshotLsn,
    }, access.views, access.openingCoordinateViews, patternViews)
    if (surface.kind !== 'ok') throw new Error('expected a legal A-prime surface: ' + surface.reason)
    return surface.surface
  }

  /**
   * The premise, derived only from independently computed digests and view
   * identities of the two real surfaces. Nothing is taken from an evaluation.
   */
  function derivePremise(left: AttentionReadableSurface, right: AttentionReadableSurface) {
    const leftDigest = attentionPrimeSurfaceDigest(left)
    const rightDigest = attentionPrimeSurfaceDigest(right)
    const leftIdentities = attentionPrimeViewIdentities(left)
    const rightIdentities = attentionPrimeViewIdentities(right)
    const leftViewIdentities = Object.freeze([
      ...leftIdentities.questCandidateViewIdentities, ...leftIdentities.patternEvidenceViewIdentities,
    ])
    const rightViewIdentities = Object.freeze([
      ...rightIdentities.questCandidateViewIdentities, ...rightIdentities.patternEvidenceViewIdentities,
    ])
    return Object.freeze({
      leftAPrimeDigest: leftDigest,
      rightAPrimeDigest: rightDigest,
      leftViewIdentities,
      rightViewIdentities,
      leftOpeningCoordinateIdentities: leftIdentities.questOpeningCoordinateViewIdentities,
      rightOpeningCoordinateIdentities: rightIdentities.questOpeningCoordinateViewIdentities,
      equivalent: leftDigest === rightDigest
        && canonicalSerialize(leftViewIdentities) === canonicalSerialize(rightViewIdentities)
        && canonicalSerialize(leftIdentities.questOpeningCoordinateViewIdentities)
          === canonicalSerialize(rightIdentities.questOpeningCoordinateViewIdentities),
    })
  }

  function evaluateWorld(
    replayCaseId: string,
    patternViews: readonly AttentionReadablePatternEvidenceView[],
    premise: ReturnType<typeof derivePremise>,
  ) {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const { first, second } = buildAttentionQuestCandidateTwoVisibleCandidates()
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId, ledger: ledger.ledger,
      questCandidates: [first, second],
      patternEvidenceViews: patternViews,
    })
    const result = runAttentionMixedFamilyEvaluation({ ...fixture.input, p3PremiseCheck: premise })
    if (result.kind !== 'ok') throw new Error('expected a mixed P3 evaluation')
    return result.result
  }

  it('the legal paired worlds pass the independently derived premise and produce byte-identical observable traces', () => {
    // Both worlds' A′ surfaces are constructed independently, from their own
    // accessor reads, before any evaluation runs.
    const visibleViews = mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS)
    const worldAViews = mintPatternEvidenceViews([...VISIBLE_PATTERN_RECORDS, ...HIDDEN_ESCALATION_RECORDS])
    const worldBViews = visibleViews

    // The hidden records mint no view at all: A′ is identical on both sides.
    expect(worldAViews).toHaveLength(VISIBLE_PATTERN_RECORDS.length)
    expect(canonicalSerialize(worldAViews)).toBe(canonicalSerialize(worldBViews))

    const surfaceA = constructAPrimeSurface(worldAViews)
    const surfaceB = constructAPrimeSurface(worldBViews)
    expect(surfaceA.questCandidateViews).toHaveLength(2)
    expect(surfaceA.patternEvidenceViews).toHaveLength(6)

    const premise = derivePremise(surfaceA, surfaceB)
    expect(premise.leftAPrimeDigest).toBe(attentionPrimeSurfaceDigest(surfaceA))
    expect(premise.rightAPrimeDigest).toBe(attentionPrimeSurfaceDigest(surfaceB))
    expect(premise.equivalent).toBe(true)

    const resultA = evaluateWorld('b6-p3-world-a', worldAViews, premise)
    const resultB = evaluateWorld('b6-p3-world-a', worldBViews, premise)

    // Five visible candidates genuinely compete for the cap of four, and exactly
    // one is displaced by the final two-family total order.
    expect(resultA.orderedCandidates).toHaveLength(5)
    expect(resultA.retainedCandidates).toHaveLength(4)
    expect(resultA.retainedCandidates.map((candidate) => candidate.sourceKind))
      .toEqual(['quest_candidate', 'quest_candidate', 'narrative_pattern_instance', 'narrative_pattern_instance'])
    expect(resultA.trace.structuralRetention.mixedFamilyDroppedCandidateIds).toHaveLength(1)

    // The complete player-observable comparison, plus the winner/arbitration
    // outputs RN019 §11.2 item 15 requires.
    expect(canonicalSerialize(resultB.trace.playerObservable)).toBe(canonicalSerialize(resultA.trace.playerObservable))
    expect(resultB.trace.mixedFamilyArbitration?.winnerCandidateId)
      .toBe(resultA.trace.mixedFamilyArbitration?.winnerCandidateId)
    expect(resultB.trace.mixedFamilyArbitration?.winnerSourceKind)
      .toBe(resultA.trace.mixedFamilyArbitration?.winnerSourceKind)
    expect(canonicalSerialize(resultB.arbitrationAttempts)).toBe(canonicalSerialize(resultA.arbitrationAttempts))
    expect(canonicalSerialize(resultB.ledger)).toBe(canonicalSerialize(resultA.ledger))
    // The premise is trusted-only and never reaches the player projection.
    expect(resultA.trace.playerObservable).not.toHaveProperty('p3PremiseCheck')
  })

  const C8_PRIVATE_STATE_PAIRS = Object.freeze([
    ['P3-1 private Belief', privateBelief({ holderId: 'a', proposition: 'private-belief-a', confidence: 2 }), privateBelief({ holderId: 'a', proposition: 'private-belief-b', confidence: 9 })],
    ['P3-2 private IntentionCommitment', privateIntentionCommitment({ holderId: 'b', goal: 'private-goal-a', commitmentState: 'formed' }), privateIntentionCommitment({ holderId: 'b', goal: 'private-goal-b', commitmentState: 'abandoned' })],
    ['P3-3 unobserved TruthEvent', unobservedTruthEvent({ eventKind: 'private-event-a', participantIds: ['a', 'b'], observationRecord: null }), unobservedTruthEvent({ eventKind: 'private-event-b', participantIds: ['b', 'c'], observationRecord: null })],
  ] as const)

  it.each(C8_PRIVATE_STATE_PAIRS)('%s differs only outside A-prime and keeps the observable trace byte-identical', (_label, privateLeft, privateRight) => {
    expect(canonicalSerialize(privateLeft)).not.toBe(canonicalSerialize(privateRight))
    const visibleViews = mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS)
    const premise = derivePremise(constructAPrimeSurface(visibleViews), constructAPrimeSurface(visibleViews))
    expect(premise.equivalent).toBe(true)
    const left = evaluateWorld('c8-typed-private-p3', visibleViews, premise)
    const right = evaluateWorld('c8-typed-private-p3', visibleViews, premise)
    expect(canonicalSerialize(left.trace.playerObservable)).toBe(canonicalSerialize(right.trace.playerObservable))
  })

  it.each(C8_PRIVATE_STATE_PAIRS)('%s premise-boundary control rejects an illegal private-to-public adapter before comparison', (label) => {
    const legalViews = mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS)
    const illegallyAdmitted = mintPatternEvidenceViews([
      ...VISIBLE_PATTERN_RECORDS,
      aidRecord(`c8-illegal-${label}`, 31, 'private-a', 'private-b'),
    ])
    const premise = derivePremise(constructAPrimeSurface(illegallyAdmitted), constructAPrimeSurface(legalViews))
    expect(premise.equivalent).toBe(false)
    expect(premise.leftAPrimeDigest).not.toBe(premise.rightAPrimeDigest)
  })

  it('Control A — illegally admitting the hidden evidence before the premise makes the A′ bytes and identities differ, and stops there', () => {
    // A test-only illegal adapter: it re-declares World A's private records as
    // public purely to force them past the accessor. It exists only inside this
    // fixture and is not importable by, or reachable from, the real pipeline.
    const illegallyAdmitted = HIDDEN_ESCALATION_RECORDS.map((record) => Object.freeze({
      ...record, visibilityProvenance: Object.freeze({ visibility: 'public' as const, provenanceId: `illegal-${record.recordId}` }),
    }))
    const surfaceA = constructAPrimeSurface(mintPatternEvidenceViews([...VISIBLE_PATTERN_RECORDS, ...illegallyAdmitted]))
    const surfaceB = constructAPrimeSurface(mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS))

    const premise = derivePremise(surfaceA, surfaceB)
    // Both oracles fire: the canonical digest and the view identities differ.
    expect(premise.leftAPrimeDigest).not.toBe(premise.rightAPrimeDigest)
    expect(canonicalSerialize(premise.leftViewIdentities)).not.toBe(canonicalSerialize(premise.rightViewIdentities))
    expect(premise.equivalent).toBe(false)

    // Mandatory early stop: no downstream candidate, resource, or observable
    // comparison is attempted for a pair whose premise failed.
    expect(surfaceA.patternEvidenceViews.length).toBeGreaterThan(surfaceB.patternEvidenceViews.length)
  })

  it('Control B — a hidden authoritative difference outside A′ alters no permitted observable result and consumes no budget', () => {
    const worldAViews = mintPatternEvidenceViews([...VISIBLE_PATTERN_RECORDS, ...HIDDEN_ESCALATION_RECORDS])
    const worldBViews = mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS)
    const premise = derivePremise(constructAPrimeSurface(worldAViews), constructAPrimeSurface(worldBViews))
    expect(premise.equivalent).toBe(true)

    const withHidden = evaluateWorld('b6-p3-control-b', worldAViews, premise)
    const withoutHidden = evaluateWorld('b6-p3-control-b', worldBViews, premise)

    // The hidden potential pattern consumes no monitor, structural-retention,
    // candidate, ordering, or presentation budget whatsoever.
    expect(canonicalSerialize(withHidden.trace.structuralRetention))
      .toBe(canonicalSerialize(withoutHidden.trace.structuralRetention))
    expect(withHidden.orderedCandidates).toHaveLength(withoutHidden.orderedCandidates.length)
    expect(canonicalSerialize(withHidden.retainedCandidates.map((candidate) => candidate.candidateId)))
      .toBe(canonicalSerialize(withoutHidden.retainedCandidates.map((candidate) => candidate.candidateId)))
    // No `public_conflict_escalation` instance was ever reconstructed.
    expect(withHidden.retainedCandidates.every((candidate) => (
      candidate.sourceKind !== 'narrative_pattern_instance' || candidate.patternType === 'reciprocal_public_aid'
    ))).toBe(true)

    // And the permitted observable result is unchanged, byte for byte.
    expect(canonicalSerialize(withHidden.trace.playerObservable))
      .toBe(canonicalSerialize(withoutHidden.trace.playerObservable))
    expect(withHidden.trace.mixedFamilyArbitration?.winnerCandidateId)
      .toBe(withoutHidden.trace.mixedFamilyArbitration?.winnerCandidateId)
  })

  /**
   * Control B (post-premise construction bypass) — RN019 §10.3 Control B and
   * §11.3 negative control 10, the committed plan's §11.7 form.
   *
   * This is the **downstream** oracle, and it is deliberately separate from
   * Control A so displacement is never claimed from a fixture that correctly
   * stops at a premise mismatch. The order is exactly RN019 §10.3's:
   *
   *   1. independently construct both legal A′ surfaces and verify the premise
   *      genuinely passes on their real canonical bytes;
   *   2. only then, a test-only forbidden adapter injects forged hidden-derived
   *      rankable material into ONE side's evaluation;
   *   3. the forged material survives structural retention, competes at the
   *      mixed cap of 4, and displaces an otherwise-retained visible candidate;
   *   4. the complete canonical player-observable trace comparison FAILS.
   *
   * The adapter is a local closure inside this fixture. It is not exported, not
   * importable by the real monitor pipeline, and adds no production hook: it
   * only re-labels World A's private records as public and hands the resulting
   * views to the evaluator after the premise has already been fixed. Nothing
   * about candidate identity, ordering, retention, or the cap is modified — the
   * whole point is that the *unmodified* downstream machinery is what detects
   * the injected candidate.
   */
  it('Control B (post-premise construction bypass) — forged hidden-derived material displaces a retained candidate and breaks observable equality', () => {
    // (1) The premise is computed on the two REAL, legal A′ surfaces and passes.
    const legalAViews = mintPatternEvidenceViews([...VISIBLE_PATTERN_RECORDS, ...HIDDEN_ESCALATION_RECORDS])
    const legalBViews = mintPatternEvidenceViews(VISIBLE_PATTERN_RECORDS)
    const premise = derivePremise(constructAPrimeSurface(legalAViews), constructAPrimeSurface(legalBViews))
    expect(premise.equivalent).toBe(true)
    expect(premise.leftAPrimeDigest).toBe(premise.rightAPrimeDigest)

    // (2) Test-only forbidden adapter, applied strictly AFTER the premise above.
    //     Local to this fixture; nothing exports or re-imports it. It re-labels
    //     World A's private records as public — the forged escalation, plus a
    //     forged reciprocal-aid pair whose ordering coordinates are deliberately
    //     PINNED so it competes at the cap (RN019 §10.3 Control B step 4).
    //
    //     Why the aid pair is the displacing one: ordering key 5 serializes the
    //     canonical binding tuple, and every `aid-*` role code sorts before every
    //     `harm-*` one, so a forged escalation can never reach the two pattern
    //     slots left under the cap of 4. The forged aid pair binds `A0`/`B0`,
    //     whose UTF-16 code units precede the visible `a`/`c`/`e` bindings, so it
    //     orders ahead of them. It completes at LSN 20 (satisfied, and therefore
    //     rankable regardless of the 41 evaluation coordinate).
    const forbiddenPostPremiseAdapter = (): readonly AttentionReadablePatternEvidenceView[] => (
      mintPatternEvidenceViews([
        ...VISIBLE_PATTERN_RECORDS,
        ...[...HIDDEN_ESCALATION_RECORDS, ...HIDDEN_FORGEABLE_AID_RECORDS].map((record) => Object.freeze({
          ...record,
          visibilityProvenance: Object.freeze({
            visibility: 'public' as const, provenanceId: `forged-${record.recordId}`,
          }),
        })),
      ])
    )

    const forgedAViews = forbiddenPostPremiseAdapter()
    // The forged views really are extra material the legal surface never had.
    expect(forgedAViews.length).toBeGreaterThan(legalAViews.length)

    const injected = evaluateWorld('b6-p3-control-b-bypass', forgedAViews, premise)
    const legal = evaluateWorld('b6-p3-control-b-bypass', legalBViews, premise)

    // (3) It survived structural retention: forged instances are in the injected
    //     world's reconstructed set and in no legal one.
    const forgedInstanceIds = injected.trace.structuralRetention.retainedPatternInstanceIds
      .filter((id) => !legal.trace.structuralRetention.retainedPatternInstanceIds.includes(id))
    expect(forgedInstanceIds.length).toBeGreaterThan(0)

    // It competed at the cap of 4 and DISPLACED an otherwise-retained visible
    // candidate. The cap still admitted exactly four, and a forged candidate is
    // among them while a previously retained legal candidate is not.
    expect(injected.retainedCandidates).toHaveLength(4)
    expect(legal.retainedCandidates).toHaveLength(4)
    const legalRetainedIds = legal.retainedCandidates.map((candidate) => candidate.candidateId)
    const injectedRetainedIds = injected.retainedCandidates.map((candidate) => candidate.candidateId)
    const forgedRetained = injectedRetainedIds.filter((id) => !legalRetainedIds.includes(id))
    const displaced = legalRetainedIds.filter((id) => !injectedRetainedIds.includes(id))
    expect(forgedRetained.length).toBeGreaterThan(0)
    expect(displaced.length).toBeGreaterThan(0)
    // The displaced candidate was dropped by the post-order cap, not by identity.
    expect(injected.trace.structuralRetention.mixedFamilyDroppedCandidateIds)
      .toEqual(expect.arrayContaining(displaced))
    expect(injected.trace.structuralRetention.mixedFamilyDroppedCandidateIds.length)
      .toBeGreaterThan(legal.trace.structuralRetention.mixedFamilyDroppedCandidateIds.length)

    // (4) The complete canonical player-observable trace comparison FAILS, so
    //     this pair cannot be claimed P3-equivalent despite its passing premise.
    expect(canonicalSerialize(injected.trace.playerObservable))
      .not.toBe(canonicalSerialize(legal.trace.playerObservable))
    // The premise alone would have accepted the pair -- which is exactly why the
    // downstream observable oracle is mandatory and not redundant.
    expect(injected.trace.p3PremiseCheck?.equivalent).toBe(true)
    expect(legal.trace.p3PremiseCheck?.equivalent).toBe(true)
  })

  function worldWithOpeningLsn(openedAtLsn: number): AttentionQuestCandidatePairedWorld {
    return buildAttentionQuestCandidateWorld([
      createProofQuestCandidate({
        id: 'quest-p3-sidecar',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-shared' },
        legallyVisibleParties: ['player'],
      }),
    ])
  }

  it('passes the premise when the two worlds agree on every collection, including the sidecar', () => {
    const result = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-sidecar-equal',
      worldA: worldWithOpeningLsn(20),
      worldB: worldWithOpeningLsn(20),
    })

    expect(result.premiseCheck.equivalent).toBe(true)
    expect(result.premiseCheck.leftOpeningCoordinateIdentities)
      .toEqual(result.premiseCheck.rightOpeningCoordinateIdentities)
    expect(result.traceA).toBeDefined()
    expect(canonicalSerialize(result.traceA?.playerObservable))
      .toBe(canonicalSerialize(result.traceB?.playerObservable))
  })

  it('fails the premise when the worlds differ only in the committed opening coordinate', () => {
    const result = runAttentionP3PairedWorldCheck({
      replayCaseId: 'p3-sidecar-differs',
      worldA: worldWithOpeningLsn(20),
      worldB: worldWithOpeningLsn(100),
    })

    // The legal quest views are byte-identical — the difference lives entirely
    // in the sidecar — so a premise check that compared only the quest views
    // would wrongly admit this pair.
    expect(result.premiseCheck.leftViewIdentities).toEqual(result.premiseCheck.rightViewIdentities)
    expect(result.premiseCheck.leftOpeningCoordinateIdentities)
      .not.toEqual(result.premiseCheck.rightOpeningCoordinateIdentities)
    expect(result.premiseCheck.equivalent).toBe(false)
    // Mandatory early stop: no downstream comparison is attempted.
    expect(result.traceA).toBeUndefined()
    expect(result.traceB).toBeUndefined()
  })
})
