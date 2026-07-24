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
import { runAttentionP3PairedWorldCheck } from './attentionReplay'

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
