import { currentBeliefs } from './beliefProjection'
import { instantEquals } from './canonicalProposition'
import type { Observation } from './contracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { QueryBounds, WorldInstant } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { PlanLeafRef } from './planBodyContracts'
import type {
  ActionConsequence,
  AttemptVerdict,
  DispatchFault,
  GoalOption,
  IntentionCause,
  IntentionCommit,
  IntentionCommitment,
  IntentionFault,
  IntentionTransition,
  IntentionTransitionKind,
  ObjectiveAtomRegistry,
  ObjectiveMetadata,
  ObservedResult,
  OutcomeFault,
  PlanBinding,
  PlanTemplate,
  ProofActionAttempt,
  ProofActionOutcome,
  ReconsiderationPolicy,
} from './intentionContracts'
import { holderAtomKindsOf, objectiveJustifiedBy, planApplicable } from './intentionRules'

/**
 * The append-only intention store (ADR-0009 D2-D5/D8-D10, spec intention-
 * lifecycle-replay-v0.md §1/§2). Every mutator is pure -- it returns a new
 * store -- and every commit is appended to `commitLog` in the exact shape
 * `intentionReplay.ts` later materializes. A commitment's bytes never
 * change after mint; open/closed, suspension, current dependency support,
 * and the plan cursor are always folds over the transitions, never stored
 * fields (D4/D5). `commitAdoption`, `commitIntentionTransition`,
 * `dispatchAttempt`, and `commitOutcome` are the only four write paths.
 * No LLM, no I/O, no Date.now/Math.random.
 */

export interface IntentionStore {
  commitments: readonly IntentionCommitment[]
  transitions: readonly IntentionTransition[]
  attempts: readonly ProofActionAttempt[]
  outcomes: readonly ProofActionOutcome[]
  consequences: readonly ActionConsequence[]
  observations: readonly Observation[]
  commitLog: readonly IntentionCommit[]
  nextSeq: number
}

export function initIntentionStore(): IntentionStore {
  return {
    commitments: [],
    transitions: [],
    attempts: [],
    outcomes: [],
    consequences: [],
    observations: [],
    commitLog: [],
    nextSeq: 1,
  }
}

/** The store's own transaction bound: everything committed so far is visible. */
export function intentionTxBound(store: IntentionStore): number {
  return store.nextSeq - 1
}

// ---- Validation context (the committed belief layer, read-only) ------------

export interface IntentionCommitContext {
  conflict: ConflictStore
  universe: readonly ReadableRecord[]
  atoms: ObjectiveAtomRegistry
  metadataById: ReadonlyMap<string, ObjectiveMetadata>
  templates: readonly PlanTemplate[]
}

function beliefEntryOf(universe: readonly ReadableRecord[], beliefId: string) {
  const entry = universe.find((candidate) => candidate.kind === 'belief' && candidate.record.id === beliefId)
  return entry !== undefined && entry.kind === 'belief' ? entry.record : undefined
}

function beliefBounds(ctx: IntentionCommitContext, validT: WorldInstant): QueryBounds {
  return { validT, txBound: ctx.conflict.nextSeq - 1 }
}

function beliefCurrent(ctx: IntentionCommitContext, holder: string, beliefId: string, at: WorldInstant): boolean {
  return currentBeliefs(holder, ctx.universe, ctx.conflict, beliefBounds(ctx, at)).beliefs.some((belief) => belief.id === beliefId)
}

/** A trigger must resolve to a committed BeliefTransition, a committed (timed) Belief, or a committed ActionOutcome (D8/F2). */
function triggerResolves(store: IntentionStore, ctx: IntentionCommitContext, triggerId: string): boolean {
  return (
    ctx.conflict.transitions.some((transition) => transition.transitionId === triggerId) ||
    ctx.conflict.timing.has(triggerId) ||
    store.outcomes.some((outcome) => outcome.id === triggerId)
  )
}

function triggerIsBeliefTransition(ctx: IntentionCommitContext, triggerId: string): boolean {
  return ctx.conflict.transitions.some((transition) => transition.transitionId === triggerId)
}

// ---- Derived projections (D4: no stored status, ever) -----------------------

export function transitionsOf(store: IntentionStore, intentionId: string, txBound: number): readonly IntentionTransition[] {
  return store.transitions.filter((transition) => transition.intentionId === intentionId && transition.commitSeq <= txBound)
}

const TERMINAL_KINDS: readonly IntentionTransitionKind[] = ['complete', 'fail', 'abandon']

export function terminalTransitionOf(store: IntentionStore, intentionId: string, txBound: number): IntentionTransition | undefined {
  return transitionsOf(store, intentionId, txBound).find((transition) => TERMINAL_KINDS.includes(transition.kind))
}

/** Open iff the commitment is visible and has no terminal transition at the bound (D4). */
export function isIntentionOpen(store: IntentionStore, intentionId: string, txBound: number): boolean {
  const commitment = store.commitments.find((candidate) => candidate.intentionId === intentionId && candidate.commitSeq <= txBound)
  if (commitment === undefined) return false
  return terminalTransitionOf(store, intentionId, txBound) === undefined
}

export function isSuspended(store: IntentionStore, intentionId: string, txBound: number): boolean {
  const relevant = transitionsOf(store, intentionId, txBound).filter(
    (transition) => transition.kind === 'suspend' || transition.kind === 'resume',
  )
  const last = relevant[relevant.length - 1]
  return last !== undefined && last.kind === 'suspend'
}

/**
 * Current dependency support (D5): the immutable adoption support folded
 * with the ordered refresh-support transitions visible at the bound --
 * the latest wins. Never stored, never written back onto the commitment.
 */
export function currentSupportOf(store: IntentionStore, intentionId: string, txBound: number): readonly string[] | undefined {
  const commitment = store.commitments.find((candidate) => candidate.intentionId === intentionId && candidate.commitSeq <= txBound)
  if (commitment === undefined) return undefined
  const refreshes = transitionsOf(store, intentionId, txBound).filter((transition) => transition.kind === 'refresh-support')
  const latest = refreshes[refreshes.length - 1]
  return latest?.currentDependencySupport ?? commitment.adoptionSupport
}

export function currentPlanBindingOf(store: IntentionStore, intentionId: string, txBound: number): PlanBinding | undefined {
  const bindings = transitionsOf(store, intentionId, txBound).filter(
    (transition) => transition.kind === 'adopt' || transition.kind === 'rebind',
  )
  return bindings[bindings.length - 1]?.planBinding
}

/** Read-only derived view (D4): equivalent values a caller may read, never mutable authority. */
export interface IntentionProjection {
  intentionId: string
  holder: string
  open: boolean
  suspended: boolean
  currentDependencySupport: readonly string[]
  planBinding: PlanBinding | undefined
  terminalTransitionId: string | undefined
}

export function projectIntention(store: IntentionStore, intentionId: string, txBound: number): IntentionProjection | undefined {
  const commitment = store.commitments.find((candidate) => candidate.intentionId === intentionId && candidate.commitSeq <= txBound)
  if (commitment === undefined) return undefined
  return {
    intentionId,
    holder: commitment.holder,
    open: isIntentionOpen(store, intentionId, txBound),
    suspended: isSuspended(store, intentionId, txBound),
    currentDependencySupport: currentSupportOf(store, intentionId, txBound) ?? commitment.adoptionSupport,
    planBinding: currentPlanBindingOf(store, intentionId, txBound),
    terminalTransitionId: terminalTransitionOf(store, intentionId, txBound)?.transitionId,
  }
}

export function openIntentionsOf(store: IntentionStore, holder: string, txBound: number): readonly IntentionCommitment[] {
  return store.commitments.filter(
    (commitment) =>
      commitment.holder === holder && commitment.commitSeq <= txBound && isIntentionOpen(store, commitment.intentionId, txBound),
  )
}

// ---- Engine-issued deterministic identity -----------------------------------

function holderSuffix(holder: string): string {
  return holder.startsWith('NPC_') ? holder.slice(4) : holder
}

function mintIntentionId(store: IntentionStore, holder: string): string {
  const count = store.commitments.filter((commitment) => commitment.holder === holder).length
  return `IC_${holderSuffix(holder)}${count + 1}`
}

function mintTransitionId(store: IntentionStore, holder: string): string {
  const count = store.transitions.filter((transition) => transition.holder === holder).length
  return `IT_${holderSuffix(holder)}_${String(count + 1).padStart(4, '0')}`
}

// ---- Adoption (§2.2: the atomic adoption envelope) ---------------------------

export interface AdoptionCandidate {
  holder: string
  option: GoalOption
  planBinding: PlanBinding
  reconsiderationPolicy: ReconsiderationPolicy
  effectiveValidTime: WorldInstant
  proposalKey?: string
  recordedProposal?: string
}

export type AdoptionOutcome =
  | { verdict: 'committed'; commitment: IntentionCommitment; transition: IntentionTransition }
  | { verdict: 'rejected'; fault: IntentionFault }

function planBindingApplicable(
  ctx: IntentionCommitContext,
  holder: string,
  objectiveType: string,
  binding: PlanBinding,
  at: WorldInstant,
): boolean {
  const template = ctx.templates.find((candidate) => candidate.id === binding.templateId)
  if (template === undefined || template.version !== binding.templateVersion || template.servesObjectiveType !== objectiveType) {
    return false
  }
  const projection = currentBeliefs(holder, ctx.universe, ctx.conflict, beliefBounds(ctx, at))
  return planApplicable(template, holderAtomKindsOf(projection.beliefs, ctx.atoms))
}

/**
 * Mints an `IntentionCommitment` and its `adopt` transition atomically --
 * both visible under one shared commit sequence, mirroring the conflict
 * store's revision envelope. Adoption support is pinned immutably here
 * (D2/D5); the adopt transition records the same set as the INITIAL
 * current dependency support. Capacity is capped at one open intention per
 * holder (v0).
 */
export function commitAdoption(
  store: IntentionStore,
  candidate: AdoptionCandidate,
  ctx: IntentionCommitContext,
): { store: IntentionStore; outcome: AdoptionOutcome } {
  const rejected = (fault: IntentionFault): { store: IntentionStore; outcome: AdoptionOutcome } => ({
    store,
    outcome: { verdict: 'rejected', fault },
  })

  const adoptionSupport = candidate.option.derivedFromBeliefs
  if (adoptionSupport.length === 0) {
    return rejected('adoption-without-support')
  }
  for (const beliefId of adoptionSupport) {
    const belief = beliefEntryOf(ctx.universe, beliefId)
    if (belief === undefined) return rejected('unknown-support-belief')
    if (belief.holder !== candidate.holder) return rejected('cross-holder-support')
    if (!beliefCurrent(ctx, candidate.holder, beliefId, candidate.effectiveValidTime)) return rejected('support-not-current')
  }

  if (openIntentionsOf(store, candidate.holder, intentionTxBound(store)).length > 0) {
    return rejected('capacity-exceeded')
  }

  if (!ctx.metadataById.has(candidate.option.sourceObjectiveMetadataId)) {
    return rejected('unknown-objective-metadata')
  }

  if (
    !planBindingApplicable(
      ctx,
      candidate.holder,
      candidate.option.candidateObjective.objectiveType,
      candidate.planBinding,
      candidate.effectiveValidTime,
    )
  ) {
    return rejected('plan-not-applicable')
  }

  const commitSeq = store.nextSeq
  const commitment: IntentionCommitment = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    intentionId: mintIntentionId(store, candidate.holder),
    holder: candidate.holder,
    canonicalObjective: candidate.option.candidateObjective,
    sourceObjectiveMetadataId: candidate.option.sourceObjectiveMetadataId,
    sourceObjectiveMetadataVersion: candidate.option.sourceObjectiveMetadataVersion,
    adoptionSupport: [...adoptionSupport],
    adoptionRuleId: candidate.option.ruleId,
    adoptionRuleVersion: candidate.option.ruleVersion,
    priorityBasis: candidate.option.priorityBasis,
    reconsiderationPolicy: candidate.reconsiderationPolicy,
    effectiveValidTime: candidate.effectiveValidTime,
    commitSeq,
    ...(candidate.proposalKey !== undefined ? { proposalKey: candidate.proposalKey } : {}),
    ...(candidate.recordedProposal !== undefined ? { recordedProposal: candidate.recordedProposal } : {}),
  }

  const transition: IntentionTransition = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    transitionId: mintTransitionId(store, candidate.holder),
    intentionId: commitment.intentionId,
    holder: candidate.holder,
    kind: 'adopt',
    cause: 'option-adopted',
    triggeringIds: [...adoptionSupport],
    ruleId: candidate.option.ruleId,
    ruleVersion: candidate.option.ruleVersion,
    planBinding: candidate.planBinding,
    currentDependencySupport: [...adoptionSupport],
    effectiveValidTime: candidate.effectiveValidTime,
    commitSeq,
  }

  const nextStore: IntentionStore = {
    ...store,
    commitments: [...store.commitments, commitment],
    transitions: [...store.transitions, transition],
    nextSeq: commitSeq + 1,
    commitLog: [...store.commitLog, { kind: 'adoption', commitment, transition }],
  }

  return { store: nextStore, outcome: { verdict: 'committed', commitment, transition } }
}

// ---- Lifecycle transitions (D3, §2.4/§2.5/§2.5a) -----------------------------

export interface IntentionTransitionCandidate {
  intentionId: string
  holder: string
  kind: Exclude<IntentionTransitionKind, 'adopt'>
  cause: IntentionCause
  triggeringIds: readonly string[]
  ruleId: string
  ruleVersion: string
  planBinding?: PlanBinding
  currentDependencySupport?: readonly string[]
  previousDependencySupport?: readonly string[]
  /** F19 injection channel: any attempt to rewrite the immutable adoption support is categorically rejected. */
  adoptionSupportOverride?: readonly string[]
  effectiveValidTime: WorldInstant
  adjudicationKey?: string
  recordedProposal?: string
}

export type IntentionTransitionOutcome =
  | { verdict: 'committed'; transition: IntentionTransition }
  | { verdict: 'rejected'; fault: IntentionFault }

const SUSPEND_CAUSES: readonly IntentionCause[] = ['preempted', 'demoted-tier', 'superseded-by-intention']
const ABANDON_CAUSES: readonly IntentionCause[] = [
  'unsupported',
  'impossible-by-belief',
  'forbidden-by-belief',
  'superseded-by-intention',
  'demoted-tier',
]

function sortedEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

function isExactDuplicate(committed: IntentionTransition, candidate: IntentionTransitionCandidate): boolean {
  return (
    committed.intentionId === candidate.intentionId &&
    committed.holder === candidate.holder &&
    committed.kind === candidate.kind &&
    committed.cause === candidate.cause &&
    sortedEqual(committed.triggeringIds, candidate.triggeringIds) &&
    instantEquals(committed.effectiveValidTime, candidate.effectiveValidTime) &&
    committed.ruleId === candidate.ruleId &&
    committed.ruleVersion === candidate.ruleVersion
  )
}

function hasSupportFields(candidate: IntentionTransitionCandidate): boolean {
  return candidate.currentDependencySupport !== undefined || candidate.previousDependencySupport !== undefined
}

/**
 * Validates and commits one lifecycle transition. Every rejection is a
 * typed fault and commits nothing. The refresh-support branch is the
 * §2.5a validator: each of F15-F20 maps to exactly one rejection below.
 */
export function commitIntentionTransition(
  store: IntentionStore,
  candidate: IntentionTransitionCandidate,
  ctx: IntentionCommitContext,
): { store: IntentionStore; outcome: IntentionTransitionOutcome } {
  const rejected = (fault: IntentionFault): { store: IntentionStore; outcome: IntentionTransitionOutcome } => ({
    store,
    outcome: { verdict: 'rejected', fault },
  })

  const commitment = store.commitments.find((entry) => entry.intentionId === candidate.intentionId)
  if (commitment === undefined) return rejected('unknown-intention')
  if (commitment.holder !== candidate.holder) return rejected('holder-mismatch')

  // The immutable adoption-support set is never rewritable through any
  // transition (D2/F19) -- checked before anything else so the attempt is
  // named for what it is.
  if (candidate.adoptionSupportOverride !== undefined) {
    return rejected('refresh-mutates-adoption-support')
  }

  // Exact-duplicate detection before currency/closed checks, mirroring the
  // conflict store's ordering (otherwise a terminal resubmission would
  // always be masked as intention-closed).
  if (store.transitions.some((committed) => isExactDuplicate(committed, candidate))) {
    return rejected('duplicate-transition')
  }

  const txBound = intentionTxBound(store)
  const open = isIntentionOpen(store, candidate.intentionId, txBound)
  if (!open) {
    return rejected(candidate.kind === 'refresh-support' ? 'refresh-intention-closed' : 'intention-closed')
  }

  if (candidate.kind === 'refresh-support') {
    if (candidate.planBinding !== undefined) return rejected('refresh-carries-plan')
    // §2.5a / F15: must cite at least one committed BeliefTransition.
    if (!candidate.triggeringIds.some((id) => triggerIsBeliefTransition(ctx, id))) {
      return rejected('refresh-missing-trigger')
    }
    const replacement = candidate.currentDependencySupport
    if (replacement === undefined || replacement.length === 0) return rejected('refresh-missing-support')
    const projectedCurrent = currentSupportOf(store, candidate.intentionId, txBound) ?? []
    if (candidate.previousDependencySupport === undefined || !sortedEqual(candidate.previousDependencySupport, projectedCurrent)) {
      return rejected('refresh-previous-support-mismatch')
    }
    for (const beliefId of replacement) {
      const belief = beliefEntryOf(ctx.universe, beliefId)
      // §2.5a / F17: replacement beliefs must be live current-projection
      // beliefs at the transition's effective bound.
      if (belief === undefined) return rejected('refresh-support-not-current')
      // §2.5a / F16: no other holder's belief may enter dependency support.
      if (belief.holder !== candidate.holder) return rejected('refresh-cross-holder-support')
      if (!beliefCurrent(ctx, candidate.holder, beliefId, candidate.effectiveValidTime)) {
        return rejected('refresh-support-not-current')
      }
    }
    // §2.5a / F18: the replacement must still justify the open intention
    // under the holder's new projection (the correct outcome for a
    // non-justifying supersession is abandon(unsupported), not refresh).
    const metadata = ctx.metadataById.get(commitment.sourceObjectiveMetadataId)
    if (metadata === undefined) return rejected('unknown-objective-metadata')
    const beliefsById = new Map(
      ctx.universe.flatMap((entry) => (entry.kind === 'belief' ? [[entry.record.id, entry.record] as const] : [])),
    )
    if (!objectiveJustifiedBy(commitment.canonicalObjective, replacement, beliefsById, ctx.atoms, metadata)) {
      return rejected('refresh-support-not-justifying')
    }
    if (candidate.cause !== 'support-superseded-but-re-entailed') return rejected('invalid-cause-for-kind')
  } else {
    if (candidate.triggeringIds.length === 0 || !candidate.triggeringIds.every((id) => triggerResolves(store, ctx, id))) {
      return rejected('missing-trigger')
    }

    if (candidate.kind === 'suspend') {
      if (candidate.planBinding !== undefined || hasSupportFields(candidate)) return rejected('invalid-fields-for-kind')
      if (!SUSPEND_CAUSES.includes(candidate.cause)) return rejected('invalid-cause-for-kind')
    } else if (candidate.kind === 'resume') {
      if (candidate.planBinding !== undefined || hasSupportFields(candidate)) return rejected('invalid-fields-for-kind')
      if (candidate.cause !== 'preemption-lifted') return rejected('invalid-cause-for-kind')
      // D3/D9, F6: resume requires the intention to actually be suspended.
      if (!isSuspended(store, candidate.intentionId, txBound)) return rejected('resume-without-suspend')
    } else if (candidate.kind === 'rebind') {
      // D5/D9: rebind changes ONLY the plan binding -- it never touches
      // dependency support (that is refresh-support) and never implies a
      // suspension.
      if (hasSupportFields(candidate)) return rejected('rebind-carries-support')
      if (candidate.planBinding === undefined) return rejected('missing-plan-binding')
      if (candidate.cause !== 'plan-inapplicable') return rejected('invalid-cause-for-kind')
      if (
        !planBindingApplicable(
          ctx,
          candidate.holder,
          commitment.canonicalObjective.objectiveType,
          candidate.planBinding,
          candidate.effectiveValidTime,
        )
      ) {
        return rejected('rebind-plan-inapplicable')
      }
    } else {
      // Terminal kinds: complete / fail / abandon.
      if (candidate.planBinding !== undefined || hasSupportFields(candidate)) return rejected('invalid-fields-for-kind')
      if (candidate.kind === 'complete' && candidate.cause !== 'believed-achieved') return rejected('invalid-cause-for-kind')
      if (candidate.kind === 'fail' && candidate.cause !== 'plan-exhausted') return rejected('invalid-cause-for-kind')
      if (candidate.kind === 'abandon' && !ABANDON_CAUSES.includes(candidate.cause)) return rejected('invalid-cause-for-kind')
    }
  }

  const commitSeq = store.nextSeq
  const transition: IntentionTransition = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    transitionId: mintTransitionId(store, candidate.holder),
    intentionId: candidate.intentionId,
    holder: candidate.holder,
    kind: candidate.kind,
    cause: candidate.cause,
    triggeringIds: [...candidate.triggeringIds],
    ruleId: candidate.ruleId,
    ruleVersion: candidate.ruleVersion,
    effectiveValidTime: candidate.effectiveValidTime,
    commitSeq,
    ...(candidate.planBinding !== undefined ? { planBinding: candidate.planBinding } : {}),
    ...(candidate.currentDependencySupport !== undefined ? { currentDependencySupport: [...candidate.currentDependencySupport] } : {}),
    ...(candidate.previousDependencySupport !== undefined
      ? { previousDependencySupport: [...candidate.previousDependencySupport] }
      : {}),
    ...(candidate.adjudicationKey !== undefined ? { adjudicationKey: candidate.adjudicationKey } : {}),
    ...(candidate.recordedProposal !== undefined ? { recordedProposal: candidate.recordedProposal } : {}),
  }

  const nextStore: IntentionStore = {
    ...store,
    transitions: [...store.transitions, transition],
    nextSeq: commitSeq + 1,
    commitLog: [...store.commitLog, { kind: 'transition', transition }],
  }

  return { store: nextStore, outcome: { verdict: 'committed', transition } }
}

// ---- Dispatch gate (§2.6, D10) -----------------------------------------------

export interface AttemptRequest {
  actor: string
  action: string
  target: string
  intentionId: string | null
  planTemplateId: string | null
  /** ADR-0010 D3: present only for attempts a plan-body Action leaf emits. */
  planLeafRef?: PlanLeafRef
}

export type DispatchOutcome = { verdict: 'dispatched'; attempt: ProofActionAttempt } | { verdict: 'refused'; fault: DispatchFault }

/**
 * A new ActionAttempt for an intention dispatches only if that intention is
 * OPEN at dispatch time (§2.6/F8) -- reconsideration precedes dispatch in
 * the tick pipeline, so an unsupported intention can never dispatch after
 * its supporting belief was superseded in the same tick. Routine/reflex
 * attempts (`intentionId: null`, D15) skip the gate by construction.
 */
export function dispatchAttempt(store: IntentionStore, request: AttemptRequest): { store: IntentionStore; outcome: DispatchOutcome } {
  if (request.intentionId !== null) {
    const commitment = store.commitments.find((entry) => entry.intentionId === request.intentionId)
    if (commitment === undefined) {
      return { store, outcome: { verdict: 'refused', fault: 'unknown-intention' } }
    }
    if (!isIntentionOpen(store, request.intentionId, intentionTxBound(store))) {
      return { store, outcome: { verdict: 'refused', fault: 'dispatch-closed-intention' } }
    }
  }

  const commitSeq = store.nextSeq
  const attempt: ProofActionAttempt = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: `AA_${String(store.attempts.length + 1).padStart(4, '0')}`,
    actor: request.actor,
    action: request.action,
    target: request.target,
    intentionId: request.intentionId,
    planTemplateId: request.planTemplateId,
    dispatchedAtSeq: commitSeq,
    ...(request.planLeafRef !== undefined ? { planLeafRef: request.planLeafRef } : {}),
  }

  const nextStore: IntentionStore = {
    ...store,
    attempts: [...store.attempts, attempt],
    nextSeq: commitSeq + 1,
    commitLog: [...store.commitLog, { kind: 'attempt', attempt }],
  }

  return { store: nextStore, outcome: { verdict: 'dispatched', attempt } }
}

// ---- Delayed outcome commit (§2.7, D10) ---------------------------------------

export interface OutcomeRequest {
  attemptId: string
  verdict: AttemptVerdict
  observedResult: ObservedResult
  engineReason?: string
  consequence?: ActionConsequence
  observation?: Observation
  /** ADR-0010 D9/D21: the effective world time this outcome took effect (a Wait-anchor trigger candidate). */
  effectiveValidTime?: WorldInstant
}

export type OutcomeCommitResult = { verdict: 'committed'; outcome: ProofActionOutcome } | { verdict: 'rejected'; fault: OutcomeFault }

/**
 * Commits an ActionOutcome for a previously-dispatched attempt -- possibly
 * long after the intention closed (D10). Only validly-dispatched attempts
 * may commit late (F9); the outcome never touches a transition, so it can
 * never retroactively invalidate the attempt or reopen the intention by
 * construction.
 */
export function commitOutcome(store: IntentionStore, request: OutcomeRequest): { store: IntentionStore; outcome: OutcomeCommitResult } {
  const attempt = store.attempts.find((candidate) => candidate.id === request.attemptId)
  if (attempt === undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'outcome-without-dispatch' } }
  }
  if (store.outcomes.some((existing) => existing.attemptId === request.attemptId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'duplicate-outcome' } }
  }

  const commitSeq = store.nextSeq
  const outcome: ProofActionOutcome = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: `AO_${String(store.outcomes.length + 1).padStart(4, '0')}`,
    attemptId: request.attemptId,
    verdict: request.verdict,
    observedResult: request.observedResult,
    commitSeq,
    ...(request.consequence !== undefined ? { consequenceId: request.consequence.id } : {}),
    ...(request.observation !== undefined ? { observationId: request.observation.id } : {}),
    ...(request.engineReason !== undefined ? { engineReason: request.engineReason } : {}),
    ...(request.effectiveValidTime !== undefined ? { effectiveValidTime: request.effectiveValidTime } : {}),
  }

  const nextStore: IntentionStore = {
    ...store,
    outcomes: [...store.outcomes, outcome],
    consequences: request.consequence !== undefined ? [...store.consequences, request.consequence] : store.consequences,
    observations: request.observation !== undefined ? [...store.observations, request.observation] : store.observations,
    nextSeq: commitSeq + 1,
    commitLog: [
      ...store.commitLog,
      {
        kind: 'outcome',
        outcome,
        ...(request.consequence !== undefined ? { consequence: request.consequence } : {}),
        ...(request.observation !== undefined ? { observation: request.observation } : {}),
      },
    ],
  }

  return { store: nextStore, outcome: { verdict: 'committed', outcome } }
}

// ---- Derived plan-step cursor (D1: never a stored cursor) ---------------------

export interface DerivedPlanState {
  binding: PlanBinding
  stepIndex: number
  finished: boolean
  pendingAttemptId: string | undefined
  failuresAtStep: number
  boundTemplateIds: readonly string[]
}

/**
 * Derives the plan cursor from the bound template version and the
 * intention's recorded attempt/outcome history (D1): succeeded outcomes
 * advance the cursor; failures accumulate at the current step; an attempt
 * with no outcome yet is pending.
 */
export function derivePlanState(
  store: IntentionStore,
  intentionId: string,
  txBound: number,
  templates: readonly PlanTemplate[],
): DerivedPlanState | undefined {
  const binding = currentPlanBindingOf(store, intentionId, txBound)
  if (binding === undefined) return undefined
  const template = templates.find((candidate) => candidate.id === binding.templateId)
  if (template === undefined) return undefined

  const boundTemplateIds = transitionsOf(store, intentionId, txBound).flatMap((transition) =>
    transition.planBinding !== undefined ? [transition.planBinding.templateId] : [],
  )

  const eraAttempts = store.attempts
    .filter(
      (attempt) =>
        attempt.intentionId === intentionId && attempt.planTemplateId === binding.templateId && attempt.dispatchedAtSeq <= txBound,
    )
    .sort((a, b) => a.dispatchedAtSeq - b.dispatchedAtSeq)

  let stepIndex = 0
  let failuresAtStep = 0
  let pendingAttemptId: string | undefined
  for (const attempt of eraAttempts) {
    const outcome = store.outcomes.find((candidate) => candidate.attemptId === attempt.id && candidate.commitSeq <= txBound)
    if (outcome === undefined) {
      pendingAttemptId = attempt.id
      break
    }
    if (outcome.verdict === 'succeeded') {
      stepIndex += 1
      failuresAtStep = 0
    } else {
      failuresAtStep += 1
    }
  }

  return {
    binding,
    stepIndex,
    finished: stepIndex >= template.steps.length,
    pendingAttemptId,
    failuresAtStep,
    boundTemplateIds,
  }
}

/** The next plan-step attempt an OPEN intention would dispatch, or undefined when closed, pending, or finished. */
export function nextAttemptRequestFor(
  store: IntentionStore,
  commitment: IntentionCommitment,
  txBound: number,
  templates: readonly PlanTemplate[],
): AttemptRequest | undefined {
  if (!isIntentionOpen(store, commitment.intentionId, txBound) || isSuspended(store, commitment.intentionId, txBound)) return undefined
  const state = derivePlanState(store, commitment.intentionId, txBound, templates)
  if (state === undefined || state.finished || state.pendingAttemptId !== undefined) return undefined
  const template = templates.find((candidate) => candidate.id === state.binding.templateId)
  const step = template?.steps[state.stepIndex]
  if (step === undefined) return undefined
  return {
    actor: commitment.holder,
    action: step.action,
    target: step.target,
    intentionId: commitment.intentionId,
    planTemplateId: state.binding.templateId,
  }
}
