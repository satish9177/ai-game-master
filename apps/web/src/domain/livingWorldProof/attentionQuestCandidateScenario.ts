import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { ProofQuestCandidateSnapshot } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'

export const A1_RANKING_SNAPSHOT_LSN = 41

/**
 * A5 addition — paired-world QuestCandidate inputs only (the exact, narrow
 * edit the controlling A5 plan section, §9, authorizes for this file). Each
 * pair below is raw QuestCandidate/snapshot construction — the A5 replay
 * harness in `attentionReplayScenario.ts` is what turns a pair into a full
 * replay-pass input and runs the P3 premise check (independent A′
 * construction, canonical comparison) before any observable-trace
 * comparison; nothing here performs that check itself.
 *
 * A later presentation-time coordinate for the two-clock revalidation
 * fixtures (ADR-0013 D15). It is strictly after `A1_RANKING_SNAPSHOT_LSN`,
 * consistent with "presentation happens after ranking".
 */
export const A5_REVALIDATION_SNAPSHOT_LSN = 55

export function buildAttentionQuestCandidateA1Scenario() {
  const publicOpenCandidate = createProofQuestCandidate({
    id: 'quest-public-open',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 37,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
    legallyVisibleParties: ['player', 'warden'],
    legallyVisiblePublicStakes: 'restore-public-trust',
    legallyVisibleOriginConsequenceReference: 'consequence-public-37',
    privateParties: ['warden-confidant'],
    secretOpeningDetail: 'private-belief-overturn',
  })
  const hiddenOpenCandidate = createProofQuestCandidate({
    id: 'quest-hidden-open',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 38,
    openingProvenance: { visibility: 'private' },
    legallyVisibleParties: ['player'],
    privateParties: ['warden'],
    secretOpeningDetail: 'unobserved-belief-overturn',
  })
  const resolvedCandidate = createProofQuestCandidate({
    id: 'quest-resolved',
    type: 'reputation_repair',
    status: 'resolved',
    openedAtLsn: 39,
    openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-39' },
    legallyVisibleParties: ['player', 'merchant'],
    legallyVisiblePublicStakes: 'repair-merchant-standing',
  })

  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: [resolvedCandidate, hiddenOpenCandidate, publicOpenCandidate],
  })
  const result = readAttentionReadableQuestCandidateViews(snapshot, {
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  })
  if (result.kind !== 'ok') {
    throw new Error('attentionQuestCandidateScenario: canonical A1 scenario must admit its public candidate')
  }

  return Object.freeze({
    expectedVisibleCandidateIds: Object.freeze(['quest-public-open']),
    views: result.views,
  })
}

function snapshotOf(candidates: Parameters<typeof createProofQuestCandidateSnapshot>[0]['candidates'], snapshotLsn: number): ProofQuestCandidateSnapshot {
  return createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn,
    candidates,
  })
}

/** One world's half of a P3 fixture: its snapshot and the A1 request that reads it. */
export interface AttentionQuestCandidatePairedWorld {
  readonly snapshot: ProofQuestCandidateSnapshot
  readonly request: { readonly accessorContractVersion: string; readonly rankingSnapshotLsn: number }
}

function pairedWorld(snapshot: ProofQuestCandidateSnapshot): AttentionQuestCandidatePairedWorld {
  return Object.freeze({
    snapshot,
    request: Object.freeze({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: snapshot.snapshotLsn,
    }),
  })
}

/**
 * Two independently admitted public-open `QuestCandidate`s (correction
 * round: real multi-candidate ordering/tie-break evidence, so ranking and
 * ordering displacement checks are non-vacuous). Distinct source IDs are the
 * only thing that differs between them at the ordering tuple's first
 * non-tied key (D14: `source-kind` ties for both, since Stage A has exactly
 * one kind; `source-id` decides), so which one orders first is deterministic
 * and does not depend on a ranking score Stage A does not build (plan
 * §6.1(1)). Shared by the standalone two-candidate replay world
 * (`attentionReplayScenario.ts`) and the hidden-`QuestCandidate` P3 pair
 * below, so "no ranking or ordering displacement" is checked against a real
 * second candidate rather than an empty comparison set.
 */
export function buildAttentionQuestCandidateTwoVisibleCandidates() {
  const first = createProofQuestCandidate({
    id: 'quest-pair-visible-a',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 20,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-20' },
    legallyVisibleParties: ['player', 'magistrate'],
    legallyVisiblePublicStakes: 'restore-public-trust',
  })
  const second = createProofQuestCandidate({
    id: 'quest-pair-visible-b',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 22,
    openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-22' },
    legallyVisibleParties: ['player', 'guildmaster'],
    legallyVisibleOriginConsequenceReference: 'consequence-declassified-22',
  })
  return Object.freeze({ first, second })
}

/**
 * The mandatory hidden-`QuestCandidate` pair (plan §8 P3; replay spec §11
 * Q1 = P3-5). Both worlds carry the identical two visible public-open
 * candidates above. World A additionally carries an authoritatively `open`
 * candidate whose opening provenance is private, so D4's admission gate
 * excludes it from A′; World B does not contain that candidate at all. Both
 * worlds' A′ surfaces must be independently constructed and found
 * byte-identical before any observable-trace comparison (the P3 premise
 * check), and — because there are now two real visible candidates rather
 * than one — a genuine ranking/ordering-displacement check is possible: the
 * hidden candidate must produce an identical order/tie-break trace between
 * the two worlds, not merely an identical candidate count.
 */
export function buildAttentionQuestCandidateHiddenPairScenario() {
  const { first: visibleFirst, second: visibleSecond } = buildAttentionQuestCandidateTwoVisibleCandidates()
  const hiddenOpen = createProofQuestCandidate({
    id: 'quest-pair-hidden-open',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 21,
    openingProvenance: { visibility: 'private' },
    legallyVisibleParties: ['player'],
    privateParties: ['confidant'],
    secretOpeningDetail: 'private-belief-overturn-never-observed',
  })

  const worldA = pairedWorld(snapshotOf([visibleFirst, hiddenOpen, visibleSecond], A1_RANKING_SNAPSHOT_LSN))
  const worldB = pairedWorld(snapshotOf([visibleFirst, visibleSecond], A1_RANKING_SNAPSHOT_LSN))

  return Object.freeze({
    worldA,
    worldB,
    hiddenCandidateId: hiddenOpen.id,
    expectedVisibleCandidateIds: Object.freeze([visibleFirst.id, visibleSecond.id].sort()),
  })
}

/**
 * The public-open paired case the plan requires alongside the hidden pair
 * (§8: "Also include the exact public-open ... paired cases required by the
 * plan"). Both worlds carry the identical public-open candidate, so this is
 * the trivial-equivalence positive control: independently constructed A′
 * must match because the underlying committed records already match.
 */
export function buildAttentionQuestCandidatePublicOpenPairScenario() {
  const publicOpen = createProofQuestCandidate({
    id: 'quest-pair-public-open-b',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 22,
    openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-22' },
    legallyVisibleParties: ['player', 'guildmaster'],
    legallyVisibleOriginConsequenceReference: 'consequence-declassified-22',
  })

  const worldA = pairedWorld(snapshotOf([publicOpen], A1_RANKING_SNAPSHOT_LSN))
  const worldB = pairedWorld(snapshotOf([publicOpen], A1_RANKING_SNAPSHOT_LSN))

  return Object.freeze({
    worldA,
    worldB,
    expectedVisibleCandidateIds: Object.freeze([publicOpen.id]),
  })
}

/**
 * The resolved paired case the plan requires alongside the hidden pair.
 * A `resolved` candidate never enters an open view (A1's `open`-gate), so
 * both worlds' A′ surfaces are identically empty of it, and the pair proves
 * that resolving a candidate that never appeared changes nothing observable.
 */
export function buildAttentionQuestCandidateResolvedPairScenario() {
  const resolved = createProofQuestCandidate({
    id: 'quest-pair-resolved',
    type: 'reputation_repair',
    status: 'resolved',
    openedAtLsn: 23,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-23' },
    legallyVisibleParties: ['player', 'merchant'],
  })

  const worldA = pairedWorld(snapshotOf([resolved], A1_RANKING_SNAPSHOT_LSN))
  const worldB = pairedWorld(snapshotOf([resolved], A1_RANKING_SNAPSHOT_LSN))

  return Object.freeze({
    worldA,
    worldB,
    expectedVisibleCandidateIds: Object.freeze([]),
  })
}

/**
 * Two-clock revalidation inputs (ADR-0013 D15; plan §8 "cache-key
 * invalidation and revalidation evidence"). Each case pins a ranking-time
 * snapshot and a later presentation-time (`A5_REVALIDATION_SNAPSHOT_LSN`)
 * snapshot for the same candidate lineage, differing only in what changed
 * between the two committed coordinates.
 */
export function buildAttentionQuestCandidateRevalidationScenarios() {
  const stillLegal = createProofQuestCandidate({
    id: 'quest-revalidate-still-legal',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 24,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-24' },
    legallyVisibleParties: ['player'],
  })
  const disappearsBase = createProofQuestCandidate({
    id: 'quest-revalidate-disappears',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 25,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-25' },
    legallyVisibleParties: ['player'],
  })
  const resolvesBaseOpen = createProofQuestCandidate({
    id: 'quest-revalidate-resolves',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 26,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-26' },
    legallyVisibleParties: ['player'],
  })
  const resolvesBaseResolved = createProofQuestCandidate({
    id: 'quest-revalidate-resolves',
    type: 'reputation_repair',
    status: 'resolved',
    openedAtLsn: 26,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-26' },
    legallyVisibleParties: ['player'],
  })
  const provenanceLostOpen = createProofQuestCandidate({
    id: 'quest-revalidate-provenance-lost',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 27,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-27' },
    legallyVisibleParties: ['player'],
  })
  const provenanceLostPrivate = createProofQuestCandidate({
    id: 'quest-revalidate-provenance-lost',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 27,
    openingProvenance: { visibility: 'private' },
    legallyVisibleParties: ['player'],
  })

  return Object.freeze({
    stillLegal: Object.freeze({
      candidateId: stillLegal.id,
      atRanking: pairedWorld(snapshotOf([stillLegal], A1_RANKING_SNAPSHOT_LSN)),
      atRevalidation: pairedWorld(snapshotOf([stillLegal], A5_REVALIDATION_SNAPSHOT_LSN)),
    }),
    disappears: Object.freeze({
      candidateId: disappearsBase.id,
      atRanking: pairedWorld(snapshotOf([disappearsBase], A1_RANKING_SNAPSHOT_LSN)),
      atRevalidation: pairedWorld(snapshotOf([], A5_REVALIDATION_SNAPSHOT_LSN)),
    }),
    resolvesBetween: Object.freeze({
      candidateId: resolvesBaseOpen.id,
      atRanking: pairedWorld(snapshotOf([resolvesBaseOpen], A1_RANKING_SNAPSHOT_LSN)),
      atRevalidation: pairedWorld(snapshotOf([resolvesBaseResolved], A5_REVALIDATION_SNAPSHOT_LSN)),
    }),
    provenanceLostBetween: Object.freeze({
      candidateId: provenanceLostOpen.id,
      atRanking: pairedWorld(snapshotOf([provenanceLostOpen], A1_RANKING_SNAPSHOT_LSN)),
      atRevalidation: pairedWorld(snapshotOf([provenanceLostPrivate], A5_REVALIDATION_SNAPSHOT_LSN)),
    }),
  })
}
