import { z } from 'zod'
import { ConfidenceSchema, LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { Observation } from './contracts'
import { CONFLICT_CANONICALIZER_VERSION, WorldInstantSchema } from './conflictContracts'
import { PlanLeafRefSchema } from './planBodyContracts'

/**
 * Intention Lifecycle Replay v0 schema (ADR-0009 D1-D16, spec intention-
 * lifecycle-replay-v0.md §1). Kept in a separate file so every already-
 * passed proof's schema surface (contracts.ts, hierarchyContracts.ts,
 * compactionContracts.ts, conflictContracts.ts) stays untouched -- purely
 * additive. Exactly two new persistent record families are introduced
 * (D1): an immutable, per-holder `IntentionCommitment` and an append-only,
 * cause-typed `IntentionTransition`. Neither ever carries a mutable status
 * field, and neither is ever rewritten after commit -- open/closed,
 * current dependency support, and the plan cursor are always derived
 * (intentionStore.ts). GoalOption, PlanCandidate, and the plan-step cursor
 * are deliberately NOT record types (D1).
 */

export const INTENTION_RULE_VERSION = 'ir_v0' as const
export const OBJECTIVE_METADATA_VERSION = 'om_v0' as const
export const PLAN_TEMPLATE_VERSION = 'pt_v0' as const

export const DERIVE_REPORT_OPTION_RULE_ID = 'derive_report_option' as const
export const DERIVE_WARN_OPTION_RULE_ID = 'derive_warn_option' as const
export const DERIVE_CORRECT_RUMOR_OPTION_RULE_ID = 'derive_correct_rumor_option' as const
export const RECONSIDER_SUPPORT_RULE_ID = 'reconsider_support' as const
export const RECONSIDER_OUTCOME_RULE_ID = 'reconsider_outcome' as const

// ---- Canonical typed objective (D2: never prose; reuses the ADR-0008 D11
// versioned canonicalizer discipline and version tag) -----------------------

export const CanonicalObjectiveSchema = z
  .object({
    objectiveType: z.string().min(1),
    roles: z.record(z.string(), z.string()),
    canonicalizerVersion: z.literal(CONFLICT_CANONICALIZER_VERSION),
  })
  .strict()

export type CanonicalObjective = z.infer<typeof CanonicalObjectiveSchema>

// ---- Plan binding (D9: recorded on the adopt/rebind transition, never a
// stored PlanCandidate type) -------------------------------------------------

export const PlanBindingSchema = z
  .object({
    templateId: z.string().min(1),
    templateVersion: z.string().min(1),
    params: z.record(z.string(), z.string()),
  })
  .strict()

export type PlanBinding = z.infer<typeof PlanBindingSchema>

export const ReconsiderationPolicySchema = z.enum(['default'])
export type ReconsiderationPolicy = z.infer<typeof ReconsiderationPolicySchema>

// ---- IntentionCommitment (immutable, engine-issued, per-holder -- D2) ------

export const IntentionCommitmentSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    intentionId: z.string().min(1),
    holder: z.string().min(1),
    canonicalObjective: CanonicalObjectiveSchema,
    sourceObjectiveMetadataId: z.string().min(1),
    sourceObjectiveMetadataVersion: z.string().min(1),
    /** Immutable: why the intention was originally adopted (D5). Never rewritten by refresh-support. */
    adoptionSupport: z.array(z.string().min(1)).min(1),
    adoptionRuleId: z.string().min(1),
    adoptionRuleVersion: z.string().min(1),
    priorityBasis: z.string().min(1),
    reconsiderationPolicy: ReconsiderationPolicySchema,
    // Populated only when an LLM proposal participated (empty in v0 --
    // fully deterministic adoption, spec §4).
    proposalKey: z.string().min(1).optional(),
    recordedProposal: z.string().min(1).optional(),
    effectiveValidTime: WorldInstantSchema,
    commitSeq: z.number().int().nonnegative(),
  })
  .strict()

export type IntentionCommitment = z.infer<typeof IntentionCommitmentSchema>

// ---- IntentionTransition (append-only, cause-typed, per-holder -- D3) ------

export const IntentionTransitionKindSchema = z.enum([
  'adopt',
  'suspend',
  'resume',
  'rebind',
  'refresh-support',
  'complete',
  'fail',
  'abandon',
])

export type IntentionTransitionKind = z.infer<typeof IntentionTransitionKindSchema>

export const IntentionCauseSchema = z.enum([
  'option-adopted',
  'preempted',
  'preemption-lifted',
  'plan-inapplicable',
  'support-superseded-but-re-entailed',
  'believed-achieved',
  'plan-exhausted',
  'unsupported',
  'impossible-by-belief',
  'forbidden-by-belief',
  'superseded-by-intention',
  'demoted-tier',
])

export type IntentionCause = z.infer<typeof IntentionCauseSchema>

// Structural D3/D5/D9 invariants live in the schema itself: a plan binding
// exists exactly on adopt/rebind, dependency support exactly on
// adopt/refresh-support, previous support only on refresh-support --
// `rebind` and `refresh-support` can never carry each other's payload.
export const IntentionTransitionSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    transitionId: z.string().min(1),
    intentionId: z.string().min(1),
    holder: z.string().min(1),
    kind: IntentionTransitionKindSchema,
    cause: IntentionCauseSchema,
    triggeringIds: z.array(z.string().min(1)).min(1),
    ruleId: z.string().min(1),
    ruleVersion: z.string().min(1),
    planBinding: PlanBindingSchema.optional(),
    currentDependencySupport: z.array(z.string().min(1)).min(1).optional(),
    previousDependencySupport: z.array(z.string().min(1)).min(1).optional(),
    effectiveValidTime: WorldInstantSchema,
    commitSeq: z.number().int().nonnegative(),
    adjudicationKey: z.string().min(1).optional(),
    recordedProposal: z.string().min(1).optional(),
  })
  .strict()
  .refine((t) => t.planBinding === undefined || t.kind === 'adopt' || t.kind === 'rebind', {
    message: 'plan binding may appear only on adopt/rebind (ADR-0009 D3/D9)',
  })
  .refine((t) => (t.kind !== 'adopt' && t.kind !== 'rebind') || t.planBinding !== undefined, {
    message: 'adopt/rebind must carry a plan binding (ADR-0009 D3/D9)',
  })
  .refine((t) => t.currentDependencySupport === undefined || t.kind === 'adopt' || t.kind === 'refresh-support', {
    message: 'dependency support may appear only on adopt/refresh-support (ADR-0009 D5)',
  })
  .refine((t) => (t.kind !== 'adopt' && t.kind !== 'refresh-support') || t.currentDependencySupport !== undefined, {
    message: 'adopt/refresh-support must carry dependency support (ADR-0009 D5)',
  })
  .refine((t) => t.previousDependencySupport === undefined || t.kind === 'refresh-support', {
    message: 'previous dependency support may appear only on refresh-support (ADR-0009 D5)',
  })
  .refine((t) => t.kind !== 'refresh-support' || t.previousDependencySupport !== undefined, {
    message: 'refresh-support must record the support it replaces (ADR-0009 D5)',
  })

export type IntentionTransition = z.infer<typeof IntentionTransitionSchema>

// ---- ActionAttempt / ActionOutcome (proof-local reuse of the ADR-0003
// shape, gaining only the nullable intention linkage -- D1/D15) -------------

export const ProofActionAttemptSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    actor: z.string().min(1),
    action: z.string().min(1),
    target: z.string().min(1),
    /** Nullable by design: routines and reflexes attempt actions with no intention (D1/D15). */
    intentionId: z.string().min(1).nullable(),
    planTemplateId: z.string().min(1).nullable(),
    dispatchedAtSeq: z.number().int().nonnegative(),
    /** ADR-0010 D3: the one additive field. Present only for attempts emitted by a plan-body Action leaf; absent for Tier-1/routine attempts (D22). */
    planLeafRef: PlanLeafRefSchema.optional(),
  })
  .strict()

export type ProofActionAttempt = z.infer<typeof ProofActionAttemptSchema>

export const AttemptVerdictSchema = z.enum(['succeeded', 'failed', 'rejected-impossible', 'rejected-forbidden'])
export type AttemptVerdict = z.infer<typeof AttemptVerdictSchema>

// What the actor perceives in fiction (D12: scope-computed, never the
// validator's hidden internal reason).
export const ObservedResultSchema = z.enum(['done', 'blocked', 'target-absent', 'no-effect'])
export type ObservedResult = z.infer<typeof ObservedResultSchema>

export const ProofActionOutcomeSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    attemptId: z.string().min(1),
    verdict: AttemptVerdictSchema,
    observedResult: ObservedResultSchema,
    /** Present only on a succeeded consequential action -- an invalid attempt never mints one (2.9/P16). */
    consequenceId: z.string().min(1).optional(),
    observationId: z.string().min(1).optional(),
    /** Engine-side audit only; never rendered to the holder or an explanation (D12). */
    engineReason: z.string().min(1).optional(),
    commitSeq: z.number().int().nonnegative(),
    /**
     * ADR-0010 D9/D21: the effective world time this outcome took effect,
     * bitemporally distinct from `commitSeq` (recorded/commit time) exactly
     * as ADR-0008's vocabulary already separates the two axes elsewhere.
     * Optional and additive -- absent for outcomes outside the plan-body
     * proof (existing intention-lifecycle tests never populate it); the
     * plan-body pipeline always sets it, since a Wait's anchor is defined
     * as the effective time of the trigger that first places it on the
     * active path, and a committed ActionOutcome is one such trigger.
     */
    effectiveValidTime: WorldInstantSchema.optional(),
  })
  .strict()

export type ProofActionOutcome = z.infer<typeof ProofActionOutcomeSchema>

// Proof-local consequence minted only by the deterministic validator on a
// succeeded consequential attempt (2.9). Deliberately not the production
// journal's consequence types -- same reasoning as ProofConsequenceRecord.
export const ActionConsequenceSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    attemptId: z.string().min(1),
    effects: z.record(z.string(), z.string()),
  })
  .strict()

export type ActionConsequence = z.infer<typeof ActionConsequenceSchema>

// ---- Authored objective metadata (D14: motivational input, not runtime
// intention; content knobs evaluated deterministically) ----------------------

export const ObjectiveMetadataSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    version: z.string().min(1),
    objectiveType: z.string().min(1),
    minConfidence: ConfidenceSchema,
    allowUnresolved: z.boolean(),
    priorityBasis: z.string().min(1),
    priorityRank: z.number().int().nonnegative(),
    retryLimit: z.number().int().nonnegative(),
    reconsiderationPolicy: ReconsiderationPolicySchema,
    /** A holder-scoped belief atom whose presence makes an open intention of this type forbidden (D14). */
    forbiddenAtomKind: z.string().min(1).optional(),
  })
  .strict()

export type ObjectiveMetadata = z.infer<typeof ObjectiveMetadataSchema>

// ---- Authored plan templates (ADR-0003 shape + goal-type trigger, D9) ------

export const PlanTemplateSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    version: z.string().min(1),
    servesObjectiveType: z.string().min(1),
    /** Applicability context: a belief atom kind the holder's projection must entail (D9). */
    contextAtomKind: z.string().min(1),
    // Empty for a restricted-BT-bodied template (ADR-0010 D4): its authored
    // body then lives in the separate PlanBodyTemplate registry
    // (planBodyContracts.ts), keyed by the same id+version. `derivePlanState`/
    // `nextAttemptRequestFor` below treat an empty step list as immediately
    // finished, so the linear-cursor pipeline never dispatches from a
    // BT-bodied template by construction -- the plan-body pipeline dispatches
    // it instead (planBodyPipeline.ts), never touching `.steps`.
    steps: z.array(z.object({ action: z.string().min(1), target: z.string().min(1) }).strict()),
  })
  .strict()

export type PlanTemplate = z.infer<typeof PlanTemplateSchema>

// ---- Transient conative values (D1: NOT record types, never persisted) -----

/**
 * Holder-scoped deterministic entailment atoms per record id -- the
 * proof-level stand-in for the canonical objective grammar's eligibility
 * inputs (ADR-0009 open Q1). Hand-registered fixture input in
 * intentionScenario.ts, exactly as the conflict rig's ClaimRegistry is --
 * never parsed from prose.
 */
export interface ObjectiveAtom {
  kind: string
  roles: Record<string, string>
}

export type ObjectiveAtomRegistry = ReadonlyMap<string, readonly ObjectiveAtom[]>

/** Transient runtime value (D1): computed per event, never persisted; the selected option's content is captured on the adopt transition. */
export interface GoalOption {
  holder: string
  candidateObjective: CanonicalObjective
  derivedFromBeliefs: readonly string[]
  sourceObjectiveMetadataId: string
  sourceObjectiveMetadataVersion: string
  ruleId: string
  ruleVersion: string
  priorityBasis: string
  priorityRank: number
}

// ---- The append-only commit log (replay's exact input, D11) ----------------

// What the intention store actually appends, in commit order. Replay
// consumes only this -- never a rule, allocator, proposer, or judge -- so
// it is structurally incapable of re-deliberating or re-minting identity.
export type IntentionCommit =
  | { kind: 'adoption'; commitment: IntentionCommitment; transition: IntentionTransition }
  | { kind: 'transition'; transition: IntentionTransition }
  | { kind: 'attempt'; attempt: ProofActionAttempt }
  | { kind: 'outcome'; outcome: ProofActionOutcome; consequence?: ActionConsequence; observation?: Observation }

// ---- Typed faults (plain unions -- runtime-only outcome tags, never
// persisted, matching the TransitionFault/CompactionRejectReason style) ------

export type IntentionFault =
  // adoption (F1/F3 and friends)
  | 'adoption-without-support'
  | 'unknown-support-belief'
  | 'cross-holder-support'
  | 'support-not-current'
  | 'capacity-exceeded'
  | 'unknown-objective-metadata'
  | 'plan-not-applicable'
  // shared transition validation (F2/F5/F6/F7)
  | 'unknown-intention'
  | 'holder-mismatch'
  | 'intention-closed'
  | 'missing-trigger'
  | 'duplicate-transition'
  | 'invalid-cause-for-kind'
  | 'invalid-fields-for-kind'
  | 'resume-without-suspend'
  | 'missing-plan-binding'
  | 'rebind-plan-inapplicable'
  | 'rebind-carries-support'
  // refresh-support validation (§2.5a, F15-F20)
  | 'refresh-carries-plan'
  | 'refresh-missing-trigger'
  | 'refresh-missing-support'
  | 'refresh-cross-holder-support'
  | 'refresh-support-not-current'
  | 'refresh-support-not-justifying'
  | 'refresh-mutates-adoption-support'
  | 'refresh-intention-closed'
  | 'refresh-previous-support-mismatch'

export type DispatchFault = 'unknown-intention' | 'dispatch-closed-intention'

export type OutcomeFault = 'outcome-without-dispatch' | 'duplicate-outcome'

export type OptionInputFault =
  | 'truth-event-input'
  | 'truth-derived-feasibility'
  | 'uncommitted-rumor-input'
  | 'cross-holder-belief-input'

export type CorroborationFault = 'circular-corroboration'

export type SupportIndexFault = 'stale-support-index'
