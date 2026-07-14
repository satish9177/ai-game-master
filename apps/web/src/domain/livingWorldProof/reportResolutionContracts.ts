import { z } from 'zod'
import { WorldInstantSchema } from './conflictContracts'
import type { CanonicalClaim, WorldInstant } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { canonicalKeyOf } from './canonicalProposition'

/**
 * Source-Trust Ledger Replay v0 schema (research vault ADR-0012 D1-D14,
 * spec source-trust-ledger-replay-v0.md §3/§4). Kept in a separate file so
 * every already-passed proof's schema surface (contracts.ts,
 * conflictContracts.ts, attributionContracts.ts, compactionContracts.ts)
 * stays untouched -- purely additive. `ReportResolution` is the ONE new
 * authoritative record family this rig introduces (D1); it is deliberately
 * NOT a member of `evidenceRecords.ts`'s `ReadableRecord` union and never
 * flows through `compactionGates.ts`'s demote/merge pipeline (spec §3.2) --
 * it follows the `ConflictEdge`/`BeliefTransition` precedent (ADR-0008 D1)
 * of a dedicated store plus a dedicated holder-scoped visibility rule,
 * never `evidenceRecords.ts`'s `readable()`/`readEvidence()`.
 */

// ---- Rule/schema versions (D8, §7.2) ---------------------------------------

export const REPORT_RESOLUTION_SCHEMA_VERSION = 1 as const
export const SOURCE_TRUST_RULE_VERSION = 'srt_v0' as const

// ---- Topics: closed, authored, versioned, predicate-mapped (D9, §4) -------

export const TOPIC_GRAMMAR_VERSION = 'tg_v0' as const
export const TOPIC_IDS = ['village-events', 'monster-knowledge'] as const
export type TopicId = (typeof TOPIC_IDS)[number]
export const TopicIdSchema = z.enum(TOPIC_IDS)

/**
 * Total predicate -> topic map (§4.1). A predicate absent from this table
 * is `'unmapped'` -- a validation fault (F14), never a default bucket. One
 * canonical claim maps to exactly one topic (checked once, structurally,
 * by `assertTopicMapWellFormed` below, P24) -- no predicate ever appears in
 * two rows because this is a single flat object literal (a JS object
 * cannot hold two values under one key).
 */
export const PREDICATE_TOPIC_MAP: Readonly<Record<string, TopicId>> = {
  'gate-mechanism-broken': 'village-events',
  'well-fouled': 'village-events',
  'mill-burned': 'village-events',
  'gate-hinge-rusted': 'village-events',
  'bridge-collapsed': 'village-events',
  'troll-weak-to-fire': 'monster-knowledge',
  'ghoul-lair-location': 'monster-knowledge',
  'cave-beast-nocturnal': 'monster-knowledge',
  'swamp-hag-silver-immune': 'monster-knowledge',
}

/**
 * `topicOf` (§4.1/§4.2): the ONLY function that may determine a report's
 * `topicId`. Total over strings; a predicate absent from
 * `PREDICATE_TOPIC_MAP` returns `'unmapped'`, never a default bucket and
 * never silently assigned to either topic (F14/F15).
 */
export function topicOf(predicate: string): TopicId | 'unmapped' {
  return PREDICATE_TOPIC_MAP[predicate] ?? 'unmapped'
}

/** P24: structurally checks the table is total-over-its-own-keys and injective (one predicate, one topic row) -- trivially true for a flat object literal, asserted here so a future edit that accidentally duplicates a key (JS silently keeps only the last) is still caught. */
export function assertTopicMapWellFormed(): true {
  const keys = Object.keys(PREDICATE_TOPIC_MAP)
  if (new Set(keys).size !== keys.length) {
    throw new Error('reportResolutionContracts: PREDICATE_TOPIC_MAP has a duplicate predicate key')
  }
  for (const value of Object.values(PREDICATE_TOPIC_MAP)) {
    if (!(TOPIC_IDS as readonly string[]).includes(value)) {
      throw new Error(`reportResolutionContracts: PREDICATE_TOPIC_MAP maps to unknown topic '${value}'`)
    }
  }
  return true
}

// ---- ReportResolution (D1/D3, §3.0) ----------------------------------------

export const ReportResolutionOutcomeSchema = z.enum(['confirmed', 'refuted'])
export type ReportResolutionOutcome = z.infer<typeof ReportResolutionOutcomeSchema>

export const ReportResolutionCauseSchema = z.enum(['ordinary', 'refuted-after-source-retraction'])
export type ReportResolutionCause = z.infer<typeof ReportResolutionCauseSchema>

/**
 * `.strict()`, mirroring `BeliefTransitionSchema`'s shape/discipline
 * (conflictContracts.ts). Reuses `WorldInstantSchema` verbatim for the
 * bitemporal field (D1). Carries exactly the identity/provenance fields
 * D1 names -- never `competence`/`certainty`/a trust tier/a probability/an
 * accept-reject decision/any mutable field (P2/F13): `.strict()` rejects
 * any object literal carrying an unrecognized key.
 */
export const ReportResolutionSchema = z
  .object({
    schemaVersion: z.literal(REPORT_RESOLUTION_SCHEMA_VERSION),
    resolutionId: z.string().min(1),
    holderId: z.string().min(1),
    sourceId: z.string().min(1),
    topicId: TopicIdSchema,
    reportRef: z.string().min(1),
    reportClaimKey: z.string().min(1),
    reportProvenanceRoot: z.string().min(1),
    resolutionRef: z.string().min(1),
    outcome: ReportResolutionOutcomeSchema,
    resolutionCause: ReportResolutionCauseSchema,
    ruleId: z.literal('resolve_report_from_observation'),
    ruleVersion: z.literal(SOURCE_TRUST_RULE_VERSION),
    validTime: WorldInstantSchema,
    commitSeq: z.number().int().nonnegative(),
    beliefTransitionRef: z.string().min(1).optional(),
  })
  .strict()

export type ReportResolution = z.infer<typeof ReportResolutionSchema>

// ---- Store, visibility, and commit-log shapes (§3.2) -----------------------
//
// ReportResolution follows the ConflictEdge/BeliefTransition precedent, not
// the Belief-shaped one: it is NOT a ReadableRecord and never enters
// evidenceRecords.ts's readable()/readEvidence() gate or
// compactionGates.ts's derivePinSet/evaluateProposal pipeline (both are
// exhaustive switches over exactly the five ReadableRecord kinds). It lives
// in its own dedicated store, and holder-facing visibility is gated by a
// dedicated function -- mirroring conflictScope.ts's `transitionVisible`
// verbatim in shape.

/**
 * Mirrors `transitionVisible(npc, transition) = transition.holder === npc`
 * (conflictScope.ts) exactly, for the new record family: the sole
 * visibility gate for a `ReportResolution` (P55-P57, P66).
 */
export function resolutionVisible(holderId: string, resolution: ReportResolution): boolean {
  return resolution.holderId === holderId
}

/**
 * beliefId (an epSpeakerAct-minted report Belief) -> the source and full
 * canonical claim it carries. Hand-registered, proof-local input (mirrors
 * the existing ClaimRegistry/TrustRegistry discipline) -- never parsed from
 * prose. Carries the report's typed `claim` (not just its predicate or its
 * key) so `claim.predicate` is the ONE trusted source `topicOf` may ever be
 * evaluated against at the live mint boundary -- a caller-supplied
 * `reportPredicate` field is not a member of this rig's input surface at
 * all (D9; closes the reportPredicate-authority gap: a caller can no longer
 * pair an unrelated predicate with a topicId of its choosing, because there
 * is no predicate parameter left to supply). `reportClaimKey` is retained
 * as a precomputed, always-consistent field (never independently supplied)
 * purely so existing lookups need not recompute `canonicalKeyOf(claim)` on
 * every call -- `buildReportIndexEntry` below is the ONLY way to construct
 * one, so `reportClaimKey === canonicalKeyOf(claim)` holds by construction,
 * never by caller discipline.
 */
export interface ReportIndexEntry {
  reportRef: string
  sourceId: string
  claim: CanonicalClaim
  reportClaimKey: string
}
export type ReportIndex = ReadonlyMap<string, ReportIndexEntry>

/**
 * The one way a `ReportIndexEntry` may ever be constructed (D9): derives
 * `reportClaimKey` from `claim` itself via `canonicalKeyOf`, so it can never
 * independently drift from the claim it names. Callers never hand-write a
 * `reportClaimKey` alongside a `claim` -- there is no other constructor.
 */
export function buildReportIndexEntry(reportRef: string, sourceId: string, claim: CanonicalClaim): ReportIndexEntry {
  return { reportRef, sourceId, claim, reportClaimKey: canonicalKeyOf(claim) }
}

/**
 * This store's own additive, append-only commit log (a sibling to
 * `ConflictCommit`, never a modification of it): the only two ways a fact
 * ever enters this store outside of a report Belief's own timing (already
 * covered by the reused, unmodified `ConflictStore`/`conflictStore.ts`
 * commit log).
 */
export type ReportResolutionCommit =
  | { kind: 'observation-commit'; observationId: string; commitSeq: number }
  | { kind: 'resolution'; resolution: ReportResolution }

/**
 * The dedicated authoritative store (§3.2): `conflict` is the reused,
 * unmodified `ConflictStore` that carries every report Belief's timing
 * (`epSpeakerAct` + `commitBelief`, D6 item 1) and supplies the ONE shared
 * transaction-time counter (`conflict.nextSeq`) every commit in this rig --
 * report, resolving-Observation, and ReportResolution alike -- draws from,
 * so condition 2's ordering check is always comparing values from a single
 * monotonic sequence. `observationCommits` is this rig's own commit-order
 * marker for resolving Observations (the harness has no existing "commit an
 * Observation" concept; report Beliefs already have one via
 * `conflict.timing`). `resolutions` is the append-only `ReportResolution`
 * ledger itself -- never a `ReadableRecord`.
 */
export interface ReportResolutionStore {
  conflict: ConflictStore
  observationCommits: ReadonlyMap<string, number>
  resolutions: readonly ReportResolution[]
  commitLog: readonly ReportResolutionCommit[]
}

// ---- Derived projection tiers (D8, §7) -------------------------------------

export const SOURCE_TRUST_TIERS = ['low', 'medium', 'high'] as const
export type SourceTrustTier = (typeof SOURCE_TRUST_TIERS)[number]

export interface SourceTrustProjection {
  competence: SourceTrustTier
  certainty: SourceTrustTier
}

// ---- Typed faults (plain unions -- never persisted, matching the existing
// TransitionFault/AscriptionRejectReason-adjacent style) --------------------

export type MintRejectReason =
  | 'unknown-predicate-topic-mapping'
  | 'topic-mismatch'
  | 'report-not-committed'
  | 'resolution-not-after-report'
  | 'claim-key-mismatch'
  | 'resolution-not-holder-observation'
  | 'provenance-already-consumed'

export type { WorldInstant }
