import { z } from 'zod'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'

/**
 * Compaction Preservation Test v0 schema (ADR-0007 D1-D10, spec
 * compaction-preservation-test.md §1). Kept in a separate file so the
 * three already-passed proofs' schema surface (contracts.ts,
 * hierarchyContracts.ts) stays untouched -- purely additive. Records
 * described here are engine-owned structured rows; the LLM may propose a
 * CompactionProposal (D6) but the engine alone decides commit/reject
 * (compactionGates.ts) -- ADR-0002 applied at the maintenance arrow.
 */

// ---- Contradiction / supersession edges (spec §0.2, fixture form) ---------

export const ContradictionEdgeKindSchema = z.enum(['supersedes', 'debunks'])

export const ContradictionEdgeSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    kind: ContradictionEdgeKindSchema,
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict()

export type ContradictionEdgeKind = z.infer<typeof ContradictionEdgeKindSchema>
export type ContradictionEdge = z.infer<typeof ContradictionEdgeSchema>

// ---- Cold storage (spec §1.1) ---------------------------------------------

export const ColdSegmentSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    segmentId: z.string().min(1),
    recordId: z.string().min(1),
    canonicalBytes: z.string().min(1),
    mintHash: z.string().min(1),
  })
  .strict()

export type ColdSegment = z.infer<typeof ColdSegmentSchema>

// ---- Compaction proposals / records (spec §1.2) ----------------------------

// 'delete' is proposable -- an LLM may emit anything (D6) -- but is
// categorically rejected by the gate (D1/F1). A CompactionRecord may
// carry action 'delete' only to document a rejected proposal (the log
// preserves what was asked for); it can never be committed (enforced by
// the refine below), which is what actually keeps D1's guarantee intact.
export const CompactionProposalActionSchema = z.enum(['demote', 'merge_projection', 'pin', 'delete'])
export const CompactionRecordActionSchema = CompactionProposalActionSchema
export const CompactionProposedBySchema = z.enum(['llm', 'engine'])

export const CompactionProposalSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    action: CompactionProposalActionSchema,
    memberIds: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
    proposedBy: CompactionProposedBySchema,
    // The ArcRecord this projection claims to ride (ADR-0006 D7). Required
    // in practice for merge_projection (the gate rejects a merge_projection
    // without a resolvable target); irrelevant to demote/pin/delete.
    targetArcId: z.string().min(1).optional(),
  })
  .strict()

export type CompactionProposalAction = z.infer<typeof CompactionProposalActionSchema>
export type CompactionRecordAction = z.infer<typeof CompactionRecordActionSchema>
export type CompactionProposedBy = z.infer<typeof CompactionProposedBySchema>
export type CompactionProposal = z.infer<typeof CompactionProposalSchema>

export const CompactionRejectReasonSchema = z.enum([
  'deletion-forbidden',
  'contradiction-edge',
  'scope-boundary',
  'pinned-member',
  'unknown-record',
  'reducer-input-unrecoverable',
  // A merge_projection whose members are not a subset of any validated
  // ArcRecord (ADR-0007 D7 / ADR-0006 D7): merge_projection skips the raw
  // scope gate only because it must ride an already-validated arc; a
  // projection over an arbitrary/cross-scope member set that matches no
  // such arc is rejected here rather than blessed as a routing decision.
  'projection-not-validated',
])

export type CompactionRejectReason = z.infer<typeof CompactionRejectReasonSchema>

export const CompactionRecordSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    action: CompactionRecordActionSchema,
    memberIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
    proposedBy: CompactionProposedBySchema,
    verdict: z.enum(['committed', 'rejected']),
    rejectReason: CompactionRejectReasonSchema.optional(),
    // Preserved from the proposal so a committed merge_projection replays
    // against the exact validated arc it rode (ADR-0007 D7 / replay rule).
    targetArcId: z.string().min(1).optional(),
  })
  .strict()
  .refine((record) => (record.verdict === 'rejected' ? record.rejectReason !== undefined : record.rejectReason === undefined), {
    message: 'rejectReason is required iff verdict is rejected',
  })
  .refine((record) => record.action !== 'delete' || record.verdict === 'rejected', {
    message: 'a delete action can only ever be logged as rejected (ADR-0007 D1)',
  })

export type CompactionRecord = z.infer<typeof CompactionRecordSchema>

// ---- Tombstone (spec §1.3, operator-only, never a compaction outcome) -----

export const TombstoneEventSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    recordId: z.string().min(1),
    mintHash: z.string().min(1),
    operator: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()

export type TombstoneEvent = z.infer<typeof TombstoneEventSchema>

// ---- Proof-local consequence record (P5) -----------------------------------

// Deliberately not the production journal's consequence types (see design
// plan risk #8): proof-local so this folder never imports domain/journal.
// `status` operationalizes spec §2.4 vs §2.3c: a `live` consequence's
// reducer inputs are pinned (never demote); a `settled` one's inputs may
// demote but must remain byte-recoverable and point-replayable (P5).
export const ProofConsequenceStatusSchema = z.enum(['live', 'settled'])

export const ProofConsequenceRecordSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    reducer: z.string().min(1),
    inputIds: z.array(z.string().min(1)).min(1),
    outputs: z.record(z.string(), z.string()),
    status: ProofConsequenceStatusSchema,
  })
  .strict()

export type ProofConsequenceStatus = z.infer<typeof ProofConsequenceStatusSchema>
export type ProofConsequenceRecord = z.infer<typeof ProofConsequenceRecordSchema>

// ---- Runtime outcomes (not persisted state -- plain types, no zod, matching
// the existing ReadEvidenceOutcome/TraversalCall pattern in this folder) ---

export interface PageBackCall {
  reader: string
  recordId: string
  segmentId: string
  verdict: 'granted' | 'hash-mismatch'
}

export type PageBackOutcome =
  | { verdict: 'granted'; canonicalBytes: string; call: PageBackCall }
  | { verdict: 'hash-mismatch'; call: PageBackCall }

export interface BudgetPressureAlarm {
  budget: number
  hotSize: number
  blockedBy: readonly CompactionRejectReason[]
}

export interface CompactionPassResult {
  compactionLog: readonly CompactionRecord[]
  hotSize: number
  budget: number
  alarm: BudgetPressureAlarm | undefined
}
