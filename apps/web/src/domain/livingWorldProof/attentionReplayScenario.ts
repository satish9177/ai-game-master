/**
 * Stage A / A5 — replay-level scenario fixtures: single-world resource-limit
 * (rankingSnapshotLsn boundary) inputs and the deterministic authoritative-
 * domain data P2's fixtures share. Proof-local to `domain/livingWorldProof`;
 * not a production module, reducer, event, or persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P2 fixed-input world noninterference);
 *  - `docs/experiments/attention-ledger-replay-v0.md` (§9 P2 fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6.1(1) the one presently pinned bounded integer, `rankingSnapshotLsn`;
 *    §8 "5. CACHE, REVALIDATION AND LIMIT EVIDENCE"; §9 A5 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **Why the boundary fixtures live here and not in
 * `attentionQuestCandidateScenario.ts`.** The controlling A5 plan section
 * authorizes that file's edit "only to add paired-world inputs"; a
 * single-world LSN-boundary fixture is not a paired-world input, so it
 * belongs in this new A5 file instead.
 *
 * **No new resource cap is invented here.** Plan §6.1(3) is explicit that
 * the candidate cap, template assertion cap, and window-density limit remain
 * unpinned and deferred; nothing below constructs a fixture for any of them.
 * The only bounded integer Stage A owns is `rankingSnapshotLsn`
 * (`ATTENTION_RANKING_SNAPSHOT_LSN_MIN`/`_MAX`, already pinned in
 * `attentionCandidatePolicy.ts`), and the fixtures below probe exactly that
 * boundary, through the complete replay pipeline rather than in isolation.
 */
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import {
  ATTENTION_RANKING_SNAPSHOT_LSN_MAX,
  ATTENTION_RANKING_SNAPSHOT_LSN_MIN,
} from './attentionCandidatePolicy'
import type { QuestCandidate } from './attentionQuestCandidateContracts'
import {
  deriveAttentionPatternPrimeCandidates,
  runAttentionQuestCandidatePrimePipeline,
} from './attentionReplay'
import type {
  AttentionMixedFamilyEvaluationInput,
  AttentionMixedPatternPresentationInput,
  AttentionQuestCandidateWorldInput,
} from './attentionReplay'
import type { AttentionReplayWallClockInput } from './attentionReplayResources'
import {
  A1_RANKING_SNAPSHOT_LSN,
  buildAttentionQuestCandidateTwoVisibleCandidates,
} from './attentionQuestCandidateScenario'
import { buildB6ReciprocalAidPatternViews } from './attentionNarrativePatternScenario'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'

/** A stable seed for every P2 fixture's authoritative RNG stream. */
export const A5_RNG_SEED = 7

/** Two ordinary authoritative commands, shared by every P2 fixture that needs a non-empty log. */
export const A5_AUTHORITATIVE_COMMAND_IDS: readonly string[] = Object.freeze([
  'authoritative-command-1',
  'authoritative-command-2',
])

/** Injected (never real) wall-clock inputs, one per command above. */
export const A5_AUTHORITATIVE_WALL_CLOCK_INPUTS: readonly AttentionReplayWallClockInput[] = Object.freeze([1000, 1001])

/** A single public-open quest-candidate world — the "quest-candidate-only load" P2/P2-1 needs. */
export function buildAttentionReplayQuestCandidateOnlyWorld(): AttentionQuestCandidateWorldInput {
  const candidate = createProofQuestCandidate({
    id: 'quest-p2-only',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 30,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-30' },
    legallyVisibleParties: ['player'],
    legallyVisiblePublicStakes: 'restore-public-trust',
  })
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: [candidate],
  })
  return Object.freeze({
    snapshot,
    request: Object.freeze({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    }),
  })
}

/**
 * Correction round — a standalone world with two independently admitted
 * public-open candidates, for real order/tie-break trace evidence (every
 * other A5 world admits at most one candidate, which cannot exercise
 * `attentionCandidateOrdering.ts`'s comparator at all). `order` lets a caller
 * request the same two candidates in either array position, so a permutation
 * test can prove the replay-level ordered output and tie-break trace do not
 * depend on snapshot insertion order — on top of, not a substitute for, A3's
 * own `attentionCandidateOrdering.test.ts` insertion-order evidence, which
 * this reuses at the full-pipeline level.
 */
export function buildAttentionReplayTwoQuestCandidateWorld(
  order: 'authored' | 'reversed' = 'authored',
): AttentionQuestCandidateWorldInput {
  const { first, second } = buildAttentionQuestCandidateTwoVisibleCandidates()
  const candidates = order === 'authored' ? [first, second] : [second, first]
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  return Object.freeze({
    snapshot,
    request: Object.freeze({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    }),
  })
}

/**
 * B4 — a replay world over an explicit candidate list, in authored or reversed
 * snapshot order. Every world built here threads the accessor-minted quest
 * opening-coordinate sidecars through the full replay pass exactly as the
 * committed worlds do: the accessor mints one sidecar per admitted candidate,
 * the common boundary carries the collection under surface schema v2, and the
 * one normalizer joins it one-to-one before ordering. Reversing the snapshot
 * order must not move the resulting sequence, the sidecar collection, or the
 * canonical premise bytes.
 */
export function buildAttentionReplayQuestCandidateWorld(
  candidates: readonly QuestCandidate[],
  order: 'authored' | 'reversed' = 'authored',
): AttentionQuestCandidateWorldInput {
  const ordered = order === 'authored' ? [...candidates] : [...candidates].reverse()
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: ordered,
  })
  return Object.freeze({
    snapshot,
    request: Object.freeze({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    }),
  })
}

/**
 * The four `rankingSnapshotLsn` boundary worlds (plan §6.1(1)): exactly at
 * the minimum, exactly at the maximum, one past the maximum (unsafe integer,
 * refused at A3 normalization), and a negative request coordinate (refused
 * at the A1 accessor). `worldAtMin`/`worldAtMax` are self-validated here —
 * a scenario the accessor cannot actually admit is a fixture defect, caught
 * at build time rather than surfacing as a confusing test failure later,
 * exactly as `attentionQuestCandidateScenario.ts`'s own canonical scenario
 * self-validates.
 */
export function buildAttentionReplayLsnBoundaryWorlds() {
  const atMinLsn = ATTENTION_RANKING_SNAPSHOT_LSN_MIN
  const atMaxLsn = ATTENTION_RANKING_SNAPSHOT_LSN_MAX
  const overMaxLsn = ATTENTION_RANKING_SNAPSHOT_LSN_MAX + 1

  function worldAt(id: string, provenanceId: string, snapshotLsn: number, requestLsn: number): AttentionQuestCandidateWorldInput {
    const candidate = createProofQuestCandidate({
      id,
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 0,
      openingProvenance: { visibility: 'public', provenanceId },
      legallyVisibleParties: ['player'],
    })
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn,
      candidates: [candidate],
    })
    return Object.freeze({
      snapshot,
      request: Object.freeze({
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: requestLsn,
      }),
    })
  }

  const worldAtMin = worldAt('quest-lsn-min', 'consequence-public-lsn-min', atMinLsn, atMinLsn)
  const worldAtMax = worldAt('quest-lsn-max', 'consequence-public-lsn-max', atMaxLsn, atMaxLsn)
  const worldOverMax = worldAt('quest-lsn-over-max', 'consequence-public-lsn-over-max', overMaxLsn, overMaxLsn)
  const worldNegativeRequest = worldAt('quest-lsn-negative-request', 'consequence-public-lsn-negative', atMinLsn, -1)

  for (const [label, world] of [['at-min', worldAtMin], ['at-max', worldAtMax]] as const) {
    const prime = runAttentionQuestCandidatePrimePipeline(world)
    if (prime.kind !== 'ok') {
      throw new Error(`attentionReplayScenario: expected the ${label} LSN-boundary world to admit its candidate`)
    }
  }

  return Object.freeze({ worldAtMin, worldAtMax, worldOverMax, worldNegativeRequest })
}

/**
 * B6 — the one mixed-family fixture builder. Every B6 world is described by the
 * two family-owned derivation collections (quest candidates and accessor-minted
 * pattern-evidence views) plus their independently supplied revalidation-coordinate
 * counterparts (RN019 §9.4.2, plan §11.3 inputs 2-5). Nothing here fabricates a
 * candidate: the normalized pattern `candidateId`s and their direct-evidence
 * assertion inputs come from `deriveAttentionPatternPrimeCandidates`, reached
 * through this module's pre-existing `./attentionReplay` import, so they are
 * produced by exactly the committed chain the evaluator re-runs.
 *
 * This module owns only the **scenario-supplied** remainder of §11.3 input 7 —
 * the two opaque cache keys and any satisfied completion coordinate — attached
 * below onto the returned normalized `candidateId`s. See
 * `B6MixedEvaluationFixtureOptions.patternCacheKeyPairing` for why attaching
 * those needs no cache-key import and mints no cache identity.
 */
export interface B6MixedEvaluationFixtureOptions {
  readonly replayCaseId: string
  readonly ledger: AttentionMixedFamilyEvaluationInput['ledger']
  /** Quest candidates admitted at the ranking coordinate. Default: none. */
  readonly questCandidates?: readonly QuestCandidate[]
  /** Quest candidates admitted at the revalidation coordinate. Default: the ranking set. */
  readonly revalidationQuestCandidates?: readonly QuestCandidate[]
  /** Accessor-minted pattern evidence at the ranking coordinate. Default: none. */
  readonly patternEvidenceViews?: readonly AttentionReadablePatternEvidenceView[]
  /** Accessor-minted pattern evidence at the revalidation coordinate. Default: the ranking set. */
  readonly revalidationPatternEvidenceViews?: readonly AttentionReadablePatternEvidenceView[]
  /**
   * Snapshot insertion order for the **quest** collections. It deliberately
   * does not reverse the pattern-evidence collections: an accessor-minted
   * `AttentionReadablePatternEvidenceView` list is canonically ordered by
   * `(commitLsn, recordId)` by contract (RN019 §4.1), so a reversed view list
   * is not a legal A′ input at all. Pattern-side insertion-order independence
   * is proved one layer earlier, by minting from a reversed *record* list and
   * comparing the resulting view bytes.
   */
  readonly order?: 'authored' | 'reversed'
  /**
   * The revalidation coordinate (RN019 §9.4's second clock). It defaults to the
   * ranking coordinate; setting it later makes the two clocks genuinely differ,
   * so the evaluator must reconstruct pattern candidates independently there
   * rather than reuse a derivation-time object.
   */
  readonly revalidationSnapshotLsn?: number
  /**
   * The LSN the revalidation snapshot is *minted* at. It defaults to the
   * revalidation coordinate; setting it to a different value makes the committed
   * quest accessor refuse `ranking-snapshot-lsn-mismatch` at the revalidation
   * coordinate, which is RN019 §9.4.2's quest-accessor-refusal lever.
   */
  readonly revalidationSnapshotMintedAtLsn?: number
  /** Per-candidate satisfied completion coordinates, keyed by pattern candidate ID. */
  readonly satisfiedCompletionLsnByCandidateId?: Readonly<Record<string, number>>
  /**
   * How this fixture pairs input 7's two **opaque, scenario-supplied** cache-key
   * strings (plan §11.7). `revalidateAttentionPatternPresentation` consumes them
   * through a single equality comparison, so:
   *
   *  - `'matched'` (the default) supplies an equal pair — a valid
   *    cache/revalidation pairing, and revalidation proceeds;
   *  - `'mismatched'` supplies a deliberately unequal pair — the existing
   *    `cache-key-mismatch` refusal lever of §11.2C row 2.
   *
   * Nothing in the committed contract requires these strings to come from
   * `deriveAttentionCandidateRankingCacheKey`, and this module deliberately does
   * not call it: §11.4's "already-derived keys" means values the caller already
   * supplied. Attaching them adds no cache-key algorithm, format, identity,
   * schema, version, or field, and the real derivation evidence stays where it
   * is committed, in `attentionCacheRevalidation.test.ts`.
   */
  readonly patternCacheKeyPairing?: 'matched' | 'mismatched'
}

export interface B6MixedEvaluationFixture {
  readonly input: AttentionMixedFamilyEvaluationInput
  /** The pattern candidate IDs the real derivation chain produces, in normalizer order. */
  readonly patternCandidateIds: readonly string[]
}

/** The general B6 mixed-family fixture. Quest-only, pattern-only, and empty worlds are its degenerate cases. */
export function buildB6MixedEvaluationFixture(
  options: B6MixedEvaluationFixtureOptions,
): B6MixedEvaluationFixture {
  const order = options.order ?? 'authored'
  const orderedOf = <T,>(values: readonly T[]): readonly T[] => (
    order === 'authored' ? Object.freeze([...values]) : Object.freeze([...values].reverse())
  )
  const questCandidates = orderedOf(options.questCandidates ?? [])
  const revalidationQuestCandidates = orderedOf(options.revalidationQuestCandidates ?? options.questCandidates ?? [])
  const patternEvidenceViews = Object.freeze([...(options.patternEvidenceViews ?? [])])
  const revalidationPatternEvidenceViews = Object.freeze([
    ...(options.revalidationPatternEvidenceViews ?? options.patternEvidenceViews ?? []),
  ])
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: questCandidates,
  })
  const revalidationSnapshotLsn = options.revalidationSnapshotLsn ?? A1_RANKING_SNAPSHOT_LSN
  const revalidationSnapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: options.revalidationSnapshotMintedAtLsn ?? revalidationSnapshotLsn,
    candidates: revalidationQuestCandidates,
  })
  // §11.3 — the normalized pattern-prime material comes from the one pure
  // derivation function, reached through this module's pre-existing
  // `./attentionReplay` import. This module therefore needs no monitor,
  // retention, A′-boundary, or normalizer specifier of its own.
  const derived = deriveAttentionPatternPrimeCandidates({
    patternEvidenceViews,
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    evaluationSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  })
  if (derived.kind !== 'ok') {
    throw new Error(`B6 fixture pattern-prime derivation refused at ${derived.stage}: ${derived.reason}`)
  }
  // §11.7 — the scenario-owned remainder of input 7, attached outside the pure
  // derivation. Both cache keys are opaque scenario strings: equal for a valid
  // pairing, deliberately unequal for the `cache-key-mismatch` lever.
  const satisfiedCompletionLsnByCandidateId = options.satisfiedCompletionLsnByCandidateId ?? {}
  const mismatchCacheKeys = (options.patternCacheKeyPairing ?? 'matched') === 'mismatched'
  const patternPresentationInputs: readonly AttentionMixedPatternPresentationInput[] = Object.freeze(
    derived.candidates.map((candidate, index) => {
      const satisfiedCompletionLsn = satisfiedCompletionLsnByCandidateId[candidate.candidateId]
      return Object.freeze({
        candidateId: candidate.candidateId,
        directEvidenceAssertionInputs: candidate.directEvidenceAssertionInputs,
        rankingCacheKey: `b6-pattern-ranking-cache-${index}`,
        revalidationCacheKey: mismatchCacheKeys
          ? `b6-pattern-revalidation-cache-mismatched-${index}`
          : `b6-pattern-ranking-cache-${index}`,
        ...(satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn }),
      })
    }),
  )
  const digest = digestAttentionReplayAuthoritativeLog({ commits: [] })
  return Object.freeze({
    patternCandidateIds: Object.freeze(patternPresentationInputs.map((entry) => entry.candidateId)),
    input: Object.freeze({
      replayCaseId: options.replayCaseId,
      snapshot,
      request: Object.freeze({
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      }),
      patternEvidenceViews,
      revalidationSnapshot,
      revalidationSnapshotLsn,
      revalidationPatternEvidenceViews,
      ledger: options.ledger,
      patternPresentationInputs,
      patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v1',
      authoritativeLogDigestBefore: digest,
      authoritativeLogDigestAfter: digest,
    }),
  })
}

/** A real accessor-minted pattern-only B6 input, reusable by replay/P2/P3 evidence. */
export function buildB6PatternOnlyEvaluationInput(
  replayCaseId: string,
  ledger: AttentionMixedFamilyEvaluationInput['ledger'],
): AttentionMixedFamilyEvaluationInput {
  return buildB6MixedEvaluationFixture({
    replayCaseId,
    ledger,
    patternEvidenceViews: buildB6ReciprocalAidPatternViews(),
  }).input
}

/**
 * The B6 quest candidate that reproduces `ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single`
 * — the single-candidate case where the Stage A harness and the Stage B evaluator
 * agree (plan §11.6 item 12). It is the same authored candidate
 * `buildAttentionReplayQuestCandidateOnlyWorld` admits.
 */
export function buildB6StageASingleQuestCandidate(): QuestCandidate {
  return createProofQuestCandidate({
    id: 'quest-p2-only',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 30,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-30' },
    legallyVisibleParties: ['player'],
    legallyVisiblePublicStakes: 'restore-public-trust',
  })
}
