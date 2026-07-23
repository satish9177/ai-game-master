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
import { runAttentionQuestCandidatePrimePipeline } from './attentionReplay'
import type { AttentionQuestCandidateWorldInput } from './attentionReplay'
import type { AttentionReplayWallClockInput } from './attentionReplayResources'
import {
  A1_RANKING_SNAPSHOT_LSN,
  buildAttentionQuestCandidateTwoVisibleCandidates,
} from './attentionQuestCandidateScenario'

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
