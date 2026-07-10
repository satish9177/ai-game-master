import { applyEvidenceCorrection } from './beliefUpdate'
import { canonicalSerialize } from './canonicalSerialization'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { CompactionProposal, ContradictionEdge, ProofConsequenceRecord } from './compactionContracts'
import { pantryStockReducer } from './consequenceReplay'
import { beliefC1 } from './evidenceScenario'
import type { ReadableRecord } from './evidenceRecords'
import {
  arcCellarPostEvidence,
  arcGate,
  arcPantry,
  arcsPostEvidence,
  beliefC2,
  observationB_T2,
  observationC_T2,
  postEvidenceHierarchyRecords,
} from './hierarchyScenario'
import { clawEvidence } from './scenario'

/**
 * Fixture extension for the Compaction Preservation Test v0 (ADR-0007,
 * spec compaction-preservation-test.md), on top of the already-committed
 * cellar/pantry/gate scenario (hierarchyScenario.ts, unmodified). Adds
 * exactly: (1) the Bel_C1 -> Bel_C1' supersession/debunk edges, derived by
 * running the already-proven applyEvidenceCorrection (no invented
 * proposition text), (2) one settled ConsequenceRecord over a pantry
 * input so P5 has a subject, and (3) the hand-authored compaction
 * proposals for the happy path and each fault injection. No new world
 * content; arc_pantry, arc_cellar, and arc_gate are reused unchanged.
 */

// ---- Bel_C1 -> Bel_C1' correction chain (spec §0.2 prerequisite) ----------

// Reuses the already-proven belief-update calculus: clawEvidence.contradicts
// is exactly beliefC1.proposition (both equal rumorBToC.proposition), so
// this is a real correction, not a hand-typed one.
const correctionOutcome = applyEvidenceCorrection(beliefC1, clawEvidence, 'Bel_C1_prime')
if (correctionOutcome.status !== 'corrected') {
  throw new Error('compactionScenario: expected clawEvidence to correct beliefC1 -- fixture invariant broken')
}

// Only the *corrected* belief is added as a new record. The original
// Bel_C1 stays exactly as committed in hierarchyScenario.ts (byte-
// identical, per ADR-0007 D1 -- correction never rewrites the prior
// record); `correctionOutcome.contradicted` (Bel_C1 downgraded) shares
// Bel_C1's id and is intentionally not inserted as a second record, which
// would collide on id with the existing entry.
export const beliefC1Prime = correctionOutcome.corrected

export const contradictionEdges: ContradictionEdge[] = [
  { schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION, kind: 'supersedes', from: beliefC1Prime.id, to: beliefC1.id },
  { schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION, kind: 'debunks', from: clawEvidence.id, to: beliefC1.id },
  // The evidence also debunks the rumor that grounded Bel_C1 (they share
  // the same contradicted proposition) -- included so a grouping fault
  // can be exercised via either the belief or the rumor leg of the chain.
  { schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION, kind: 'debunks', from: clawEvidence.id, to: 'R_B_to_C' },
]

export const compactionUniverse: ReadableRecord[] = [
  ...postEvidenceHierarchyRecords,
  { kind: 'belief', record: beliefC1Prime },
]

export const compactionArcs = arcsPostEvidence

// ---- Proof-local consequence record (spec §5 P5) ---------------------------

// settled: the pantry incident is closed and its reducer already ran;
// per the design's status split (§2.3c vs §2.4), a settled consequence's
// inputs may demote but must remain byte-recoverable and point-replayable
// -- this is the record P5 replays after O_NPC_C_T2 goes cold.
export const pantryConsequence: ProofConsequenceRecord = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CONSEQ_pantry_stock',
  reducer: 'pantry_stock_reducer',
  inputIds: [observationC_T2.id],
  // Derived by running the reducer itself, not hand-typed -- P5's replay
  // assertion is that re-running it post-demotion reproduces this exactly.
  outputs: pantryStockReducer([{ kind: 'observation', record: observationC_T2 }]),
  status: 'settled',
}

// live: an unrelated consequence (gate arc, never a compaction target in
// v0) whose input must therefore pin -- exercises the live/settled split
// in derivePinSet without affecting the pantry demotion outcome.
export const gateConsequenceLive: ProofConsequenceRecord = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CONSEQ_gate_watch',
  reducer: 'gate_watch_reducer',
  inputIds: ['O_NPC_D_T3'],
  outputs: { patrol_status: 'rotated' },
  status: 'live',
}

export const compactionConsequences: ProofConsequenceRecord[] = [pantryConsequence, gateConsequenceLive]

// ---- Budgets (spec §2.5, derived from actual record sizes, never hand-tuned) --

function canonicalSize(entry: ReadableRecord): number {
  return canonicalSerialize(entry).length
}

const initialHotSize = compactionUniverse.reduce((sum, entry) => sum + canonicalSize(entry), 0)
const pantryLeafDemotionSize =
  canonicalSize({ kind: 'observation', record: observationB_T2 }) + canonicalSize({ kind: 'observation', record: observationC_T2 })

/** Exactly the hot size after the happy-path pass demotes both pantry observations -- the pass must complete with no alarm. */
export const HAPPY_PATH_BUDGET = initialHotSize - pantryLeafDemotionSize

/** One byte tighter than reachable without demoting the pinned Bel_C2 -- forces the F5 alarm. */
export const BUDGET_ALARM_BUDGET = HAPPY_PATH_BUDGET - 1

// ---- Hand-authored compaction proposals ------------------------------------

/**
 * The natural (unsplit) pantry demotion proposal. Spans NPC_B's and
 * NPC_C's scopes -- runCompactionPass must split it per readable() set
 * (spec §3 step 2); evaluateProposal called directly on it (bypassing the
 * pass) demonstrates the scope gate rejecting the unsplit form (F3).
 */
export const pantryDemoteProposal: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_0001',
  action: 'demote',
  memberIds: [observationB_T2.id, observationC_T2.id, beliefC2.id],
  rationale: 'arc_pantry closed, contradiction-quiescent, unread since night_2',
  proposedBy: 'llm',
}

/**
 * arc_pantry becomes the routing projection over its demoted leaves (spec
 * §0.1/§1.2). Because arc_pantry legitimately spans NPC_B's and NPC_C's
 * scopes, the projection is minted per-scope -- one committed
 * merge_projection per readable owner -- each naming arc_pantry as its
 * `targetArcId`. A single cross-scope projection over both leaves would be
 * (and is, see compactionGates.test.ts) rejected 'scope-boundary': a
 * projection must never become a cross-scope read surface (ADR-0007 D7).
 */
export const pantryMergeProjectionProposalB: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_0002',
  action: 'merge_projection',
  targetArcId: arcPantry.id,
  memberIds: [observationB_T2.id],
  rationale: "arc_pantry projection over NPC_B's demoted leaf",
  proposedBy: 'llm',
}

export const pantryMergeProjectionProposalC: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_0003',
  action: 'merge_projection',
  targetArcId: arcPantry.id,
  memberIds: [observationC_T2.id],
  rationale: "arc_pantry projection over NPC_C's demoted leaf",
  proposedBy: 'llm',
}

export const happyPathProposals: CompactionProposal[] = [
  pantryDemoteProposal,
  pantryMergeProjectionProposalB,
  pantryMergeProjectionProposalC,
]

/** F1 -- MemRefine-style physical DELETE, not demotion. Must be rejected. */
export const deleteProposal: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_F1',
  action: 'delete',
  memberIds: [observationC_T2.id],
  rationale: 'free space by removing the record outright',
  proposedBy: 'llm',
}

/** F2 -- groups a belief with the belief that superseded it. */
export const contradictionGroupingProposal: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_F2',
  action: 'merge_projection',
  memberIds: [beliefC1.id, beliefC1Prime.id],
  rationale: 'consolidate the belief and its correction into one projection',
  proposedBy: 'llm',
}

/** F3 -- the unsplit cross-scope grouping an operator insisted on (spec §3 note). */
export const crossScopeGroupingProposal: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_F3',
  action: 'demote',
  memberIds: [observationB_T2.id, observationC_T2.id],
  rationale: 'demote both pantry observations together',
  proposedBy: 'llm',
}

/** F5 -- explicitly proposes demoting the pinned current belief. */
export const pinnedDemotionProposal: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_F5',
  action: 'demote',
  memberIds: [beliefC2.id],
  rationale: 'reclaim more space by demoting Bel_C2 too',
  proposedBy: 'llm',
}

export { arcCellarPostEvidence, arcGate, arcPantry, beliefC1 }
