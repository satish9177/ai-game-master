import { z } from 'zod'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'

/**
 * Conflict-Edge Replay v0 schema (ADR-0008 D1-D12, spec conflict-edge-
 * replay-v0.md). Kept in a separate file so every already-passed proof's
 * schema surface (contracts.ts, hierarchyContracts.ts, compactionContracts.ts)
 * stays untouched -- purely additive. A ConflictEdge is a symmetric,
 * engine-minted, non-authoritative incompatibility fact; a BeliefTransition
 * is an immutable, per-holder, directed correction record. Neither ever
 * carries a mutable status field, and neither is ever rewritten after
 * commit -- activity/currency are always derived (beliefProjection.ts).
 */

export const CONFLICT_CANONICALIZER_VERSION = 'cz_v0' as const
export const TRANSITION_RULE_VERSION = 'r_v0' as const
export const OVERTURN_BY_HARD_EVIDENCE_RULE_ID = 'overturn_by_hard_evidence' as const

// ---- World time (the claims' own temporal referent, tick-granular) -------

// Sub-night ticks are required by the fixture itself: R_B_to_C is received
// and E_claw corrects it within the same `night_4` -- a night-only axis
// cannot express "Bel_C1 held, then Bel_C1' held" at all (design plan I1).
export const WorldInstantSchema = z
  .object({
    night: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
  })
  .strict()

export type WorldInstant = z.infer<typeof WorldInstantSchema>

// A claim's own asserted validity: a point-event claim ("X attacked Y at
// night_3") is an `instant`; a world-state claim ("the door is open") is an
// `interval` whose effective end is derived from the next claim on the same
// object, never stored back (ADR-0008 D5, design plan clarification 3).
// Deliberately not an empty half-open `[t, t)` -- that would make an
// instant claim spuriously fail to overlap itself.
export const ValidExtentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instant'), at: WorldInstantSchema }).strict(),
  z.object({ kind: z.literal('interval'), from: WorldInstantSchema, to: WorldInstantSchema.nullable() }).strict(),
])

export type ValidExtent = z.infer<typeof ValidExtentSchema>

// ---- Canonical proposition model (design plan decision 2) ------------------

export const ClaimPolaritySchema = z.enum(['asserts', 'denies'])
export type ClaimPolarity = z.infer<typeof ClaimPolaritySchema>

/**
 * An engine-validated canonical proposition (D11): `predicate` + `fixedRoles`
 * form the shared question (`canonicalKeyOf`); `contestedRole` names which
 * role varies between competing answers; `contestedValue` + `polarity` are
 * this claim's specific answer. Claims enter the rig only through a
 * hand-registered claim registry (conflictScenario.ts) -- this type models
 * ADR-0008 D11's "engine-validated canonical propositions" as an input,
 * never something parsed from a `proposition` string (design plan I3).
 */
export const CanonicalClaimSchema = z
  .object({
    predicate: z.string().min(1),
    fixedRoles: z.record(z.string(), z.string()),
    contestedRole: z.string().min(1),
    contestedValue: z.string().min(1),
    polarity: ClaimPolaritySchema,
    validity: ValidExtentSchema,
    canonicalizerVersion: z.string().min(1),
  })
  .strict()

export type CanonicalClaim = z.infer<typeof CanonicalClaimSchema>

/**
 * A world-state assertion about one object, open-ended until a successor
 * claim on the same `objectKey` closes it (ADR-0008 D5). Proof-local: not
 * added to the `ReadableRecord` union (design plan I6) -- the door fixture
 * never touches evidenceRecords.ts/readable().
 */
export const WorldStateClaimSchema = z
  .object({
    recordId: z.string().min(1),
    objectKey: z.string().min(1),
    state: z.string().min(1),
    from: WorldInstantSchema,
    canonicalizerVersion: z.string().min(1),
  })
  .strict()

export type WorldStateClaim = z.infer<typeof WorldStateClaimSchema>

/** recordId -> the canonical claim that record carries. Proof-local input, never derived from prose. */
export type ClaimRegistry = ReadonlyMap<string, CanonicalClaim>

// ---- ConflictEdge (symmetric, engine-minted incompatibility, D2) ----------

export const ConflictEdgeEndpointSchema = z
  .object({
    claimKey: z.string().min(1),
    witnessRecordId: z.string().min(1),
  })
  .strict()

export type ConflictEdgeEndpoint = z.infer<typeof ConflictEdgeEndpointSchema>

export const OverlapWitnessSchema = z
  .object({
    a: ValidExtentSchema,
    b: ValidExtentSchema,
    intersection: ValidExtentSchema,
  })
  .strict()

export type OverlapWitness = z.infer<typeof OverlapWitnessSchema>

export const ConflictEdgeSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    edgeId: z.string().min(1),
    // Claim-level endpoints, sorted by claimKey -- symmetry and the
    // idempotency key both fall out of this sort (design plan decision 3).
    endpoints: z.tuple([ConflictEdgeEndpointSchema, ConflictEdgeEndpointSchema]),
    pairKey: z.string().min(1),
    canonicalKey: z.string().min(1),
    overlapWitness: OverlapWitnessSchema,
    canonicalizerVersion: z.literal(CONFLICT_CANONICALIZER_VERSION),
    // Absent on deterministic detection; present only when a stochastic
    // proposer supplied the candidate pair (D2's explainable-at-mint clause).
    proposalKey: z.string().min(1).optional(),
    commitSeq: z.number().int().nonnegative(),
    // Never mutated, never consulted to pick a winner -- literal `false` is
    // self-documenting rather than a flag any code path flips.
    authoritative: z.literal(false),
  })
  .strict()

export type ConflictEdge = z.infer<typeof ConflictEdgeSchema>

// ---- BeliefTransition (per-holder, directed, cause-typed, D3) -------------

export const TransitionCauseSchema = z.enum(['corrected-by-evidence', 'superseded-by-update', 'decayed', 'resolved-by-precedence'])

export type TransitionCause = z.infer<typeof TransitionCauseSchema>

export const BeliefTransitionSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    transitionId: z.string().min(1),
    holder: z.string().min(1),
    fromBeliefId: z.string().min(1),
    toBeliefId: z.string().min(1),
    effectiveValidTime: WorldInstantSchema,
    commitSeq: z.number().int().nonnegative(),
    cause: TransitionCauseSchema,
    ruleId: z.string().min(1),
    ruleVersion: z.string().min(1),
    canonicalizerVersion: z.literal(CONFLICT_CANONICALIZER_VERSION),
    inputEvidenceIds: z.array(z.string().min(1)),
    conflictEdgeIds: z.array(z.string().min(1)),
    adjudicationKey: z.string().min(1).optional(),
    recordedProposal: z.string().min(1).optional(),
  })
  .strict()

export type BeliefTransition = z.infer<typeof BeliefTransitionSchema>

// ---- Belief timing sidecar (design plan I2) --------------------------------

// BeliefSchema is `.strict()` and already committed/hashed by three passed
// proofs -- adding fields to it would change canonical bytes for every
// existing record. Timing lives here instead: an append-only, engine-side
// map from belief id to its `validFrom` (world time) and `mintSeq`
// (transaction time), populated only by conflictStore.ts's commit
// operations. No stored `validTo` anywhere.
export interface BeliefTimingEntry {
  validFrom: WorldInstant
  mintSeq: number
}

export type BeliefTimingMap = ReadonlyMap<string, BeliefTimingEntry>

// ---- The append-only commit log (replay's exact input, design plan §1.9) --

// What the store actually appends, in commit order. Replay consumes only
// this -- never a proposer, never a fresh allocator -- so it is
// structurally incapable of re-judging or re-minting an identity.
export type ConflictCommit =
  | { kind: 'belief'; beliefId: string; validFrom: WorldInstant; mintSeq: number }
  | { kind: 'edge'; edge: ConflictEdge }
  | { kind: 'revision'; toBeliefId: string; validFrom: WorldInstant; transition: BeliefTransition }
  | { kind: 'transition'; transition: BeliefTransition }

// ---- Typed faults (plain unions -- never persisted, so never zod; matches
// the existing ArcMembershipIssue/CompactionRejectReason-adjacent style for
// runtime-only outcome tags) -------------------------------------------------

export type ClaimFault = 'malformed-claim' | 'canonicalizer-version-mismatch'

export type EdgeRejectReason = ClaimFault | 'key-mismatch' | 'compatible-outcomes' | 'no-valid-time-overlap'

export type TransitionFault =
  | 'self-transition'
  | 'missing-transition-endpoint'
  | 'unknown-evidence'
  | 'holder-mismatch'
  | 'from-not-current'
  | 'to-not-current'
  | 'destination-not-new'
  | 'transition-branching'
  | 'duplicate-transition'
  | 'transition-cycle'
  | ClaimFault

export interface QueryBounds {
  validT: WorldInstant
  txBound: number
}
