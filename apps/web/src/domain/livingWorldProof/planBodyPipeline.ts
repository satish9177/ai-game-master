import type { WorldInstant } from './conflictContracts'
import { observationFor, validateAttempt } from './intentionActions'
import type { WorldActionFacts } from './intentionActions'
import type { ActionConsequence, CanonicalObjective, PlanBinding, PlanTemplate, ProofActionAttempt } from './intentionContracts'
import { nextApplicableBinding } from './intentionRules'
import type { OutcomeCommitResult } from './intentionStore'
import { commitOutcome, dispatchAttempt, isIntentionOpen } from './intentionStore'
import type { IntentionStore } from './intentionStore'
import type { NodePath, PlanBodyTemplate, PlanLeafRef } from './planBodyContracts'
import { nodePathEquals, resolveActionPath } from './planBodyContracts'
import type { ExecutionStateSnapshot, PlanBodyEvalInputs } from './planBodyProjection'
import { currentExecutionScopeIdOf, deriveExecutionState } from './planBodyProjection'

/**
 * The event-driven plan-body pipeline (ADR-0010 D6/D12/D15/D17, spec
 * §2.4/§2.9/§2.12). Orchestration only: every decision is computed by the
 * pure `deriveExecutionState` fold (planBodyProjection.ts) or the reused
 * ADR-0009 rules (`nextApplicableBinding`); this module's only job is to
 * commit the ONE next valid `ActionAttempt` (via the unmodified,
 * body-agnostic `dispatchAttempt`) and to hand a derived plan-local result
 * to the caller for an ADR-0009 `rebind`/`fail` decision -- **it never
 * commits an `IntentionTransition` itself** (D17).
 */

export type PlanLeafRefFault =
  | 'unknown-execution-scope' // F2
  | 'cross-holder-execution-scope' // F3
  | 'node-path-not-found' // F4
  | 'node-path-not-action' // F4
  | 'template-version-mismatch' // F5

export type PlanBodyDispatchFault =
  | PlanLeafRefFault
  | 'intention-closed' // F7
  | 'scope-closed' // F8
  | 'not-on-active-path' // F9
  | 'occurrence-reused-while-open' // F6/F10

export type PlanBodyTemplateRegistry = ReadonlyMap<string, PlanBodyTemplate>

/** F1: a plan-body Action leaf's attempt must always carry `plan_leaf_ref`; only Tier-1/routine attempts (`intentionId: null`, D22) may omit it. */
export function validateAttemptCarriesPlanLeafRef(attempt: ProofActionAttempt): 'missing-plan-leaf-ref' | undefined {
  if (attempt.intentionId !== null && attempt.planLeafRef === undefined) return 'missing-plan-leaf-ref'
  return undefined
}

export function templateKey(templateId: string, templateVersion: string): string {
  return `${templateId}@${templateVersion}`
}

/** F2/F3/F4/F5: validates a `plan_leaf_ref` in isolation, against the committed scope-binding transition and the pinned template version -- usable directly by fault-injection tests supplying a forged ref. */
export function validatePlanLeafRef(
  store: IntentionStore,
  holder: string,
  templates: PlanBodyTemplateRegistry,
  ref: PlanLeafRef,
): PlanLeafRefFault | undefined {
  const scopeTransition = store.transitions.find((t) => t.transitionId === ref.executionScopeId)
  if (scopeTransition === undefined || (scopeTransition.kind !== 'adopt' && scopeTransition.kind !== 'rebind')) {
    return 'unknown-execution-scope'
  }
  if (scopeTransition.holder !== holder) {
    return 'cross-holder-execution-scope'
  }
  if (scopeTransition.planBinding?.templateId !== ref.templateId || scopeTransition.planBinding.templateVersion !== ref.templateVersion) {
    return 'template-version-mismatch'
  }
  const template = templates.get(templateKey(ref.templateId, ref.templateVersion))
  if (template === undefined) return 'template-version-mismatch'
  const resolved = resolveActionPath(template.root, ref.nodePath)
  if ('fault' in resolved) return resolved.fault
  return undefined
}

export type PlanBodyDispatchResult =
  | { verdict: 'dispatched'; attempt: ProofActionAttempt }
  | { verdict: 'no-dispatch-due' }
  | { verdict: 'refused'; fault: PlanBodyDispatchFault }

/**
 * The single mechanical dispatch gate (D6/D15, F2-F10): validates the ref,
 * intention/scope openness, active-path membership, and duplicate-open
 * exclusion, in that order, then commits via the unmodified `dispatchAttempt`.
 * Used both by the normal derived path (`dispatchNextPlanBodyAttempt`) and
 * directly by fault-injection tests supplying a forged ref/active-path.
 */
export function attemptPlanBodyDispatch(
  store: IntentionStore,
  holder: string,
  intentionId: string,
  templates: PlanBodyTemplateRegistry,
  ref: PlanLeafRef,
  activePath: readonly NodePath[],
  action: string,
  target: string,
): { store: IntentionStore; result: PlanBodyDispatchResult } {
  const refFault = validatePlanLeafRef(store, holder, templates, ref)
  if (refFault !== undefined) {
    return { store, result: { verdict: 'refused', fault: refFault } }
  }

  const txBound = store.nextSeq - 1
  if (!isIntentionOpen(store, intentionId, txBound)) {
    return { store, result: { verdict: 'refused', fault: 'intention-closed' } }
  }
  if (currentExecutionScopeIdOf(store, intentionId, txBound) !== ref.executionScopeId) {
    return { store, result: { verdict: 'refused', fault: 'scope-closed' } }
  }
  if (!activePath.some((path) => nodePathEquals(path, ref.nodePath))) {
    return { store, result: { verdict: 'refused', fault: 'not-on-active-path' } }
  }
  const hasOpenDuplicate = store.attempts.some(
    (attempt) =>
      attempt.planLeafRef !== undefined &&
      attempt.planLeafRef.executionScopeId === ref.executionScopeId &&
      attempt.planLeafRef.templateId === ref.templateId &&
      attempt.planLeafRef.templateVersion === ref.templateVersion &&
      nodePathEquals(attempt.planLeafRef.nodePath, ref.nodePath) &&
      attempt.planLeafRef.occurrenceOrdinal === ref.occurrenceOrdinal &&
      !store.outcomes.some((outcome) => outcome.attemptId === attempt.id),
  )
  if (hasOpenDuplicate) {
    return { store, result: { verdict: 'refused', fault: 'occurrence-reused-while-open' } }
  }

  const dispatched = dispatchAttempt(store, {
    actor: holder,
    action,
    target,
    intentionId,
    planTemplateId: ref.templateId,
    planLeafRef: ref,
  })
  if (dispatched.outcome.verdict !== 'dispatched') {
    return { store: dispatched.store, result: { verdict: 'refused', fault: 'intention-closed' } }
  }
  return { store: dispatched.store, result: { verdict: 'dispatched', attempt: dispatched.outcome.attempt } }
}

/** The normal event-driven path: derive, then admit at most the next valid dispatch from the freshly-derived active path (D15). */
export function dispatchNextPlanBodyAttempt(
  inputs: PlanBodyEvalInputs,
  templates: PlanBodyTemplateRegistry,
): { store: IntentionStore; result: PlanBodyDispatchResult; state: ExecutionStateSnapshot } {
  const state = deriveExecutionState(inputs)
  if (state.dispatchCandidate === undefined) {
    return { store: inputs.intentions, result: { verdict: 'no-dispatch-due' }, state }
  }
  const ref: PlanLeafRef = {
    executionScopeId: inputs.executionScopeId,
    templateId: inputs.template.id,
    templateVersion: inputs.template.version,
    nodePath: [...state.dispatchCandidate.path],
    occurrenceOrdinal: state.dispatchCandidate.occurrenceOrdinal,
  }
  const { store, result } = attemptPlanBodyDispatch(
    inputs.intentions,
    inputs.holder,
    inputs.intentionId,
    templates,
    ref,
    state.activePath,
    state.dispatchCandidate.node.action,
    state.dispatchCandidate.node.target,
  )
  return { store, result, state }
}

/**
 * Executes a validly-dispatched plan-body attempt through the SAME
 * deterministic validator every attempt in this proof passes through
 * (`validateAttempt`, unmodified), committing an `ActionOutcome` that
 * additionally carries the bitemporal `effectiveValidTime` a `Wait`
 * anchor may later need (D9/D21). No leaf ever fabricates its own result.
 */
export function executePlanBodyAttempt(
  store: IntentionStore,
  attemptId: string,
  facts: WorldActionFacts,
  effectiveValidTime: WorldInstant,
  timeLabel: string,
): { store: IntentionStore; outcome: OutcomeCommitResult } {
  const attempt = store.attempts.find((candidate) => candidate.id === attemptId)
  if (attempt === undefined) {
    return commitOutcome(store, { attemptId, verdict: 'failed', observedResult: 'no-effect', effectiveValidTime })
  }

  const decision = validateAttempt(attempt, facts)
  const consequence: ActionConsequence | undefined = decision.mintsConsequence
    ? { schemaVersion: attempt.schemaVersion, id: `AC_${attempt.id}`, attemptId: attempt.id, effects: decision.effects ?? {} }
    : undefined

  return commitOutcome(store, {
    attemptId: attempt.id,
    verdict: decision.verdict,
    observedResult: decision.observedResult,
    observation: observationFor(attempt, decision, timeLabel),
    effectiveValidTime,
    ...(decision.engineReason !== undefined ? { engineReason: decision.engineReason } : {}),
    ...(consequence !== undefined ? { consequence } : {}),
  })
}

// ---- Root-result -> rebind/fail handoff (D17: the plan body never writes
// an IntentionTransition; this is the pipeline layer, one level up) --------

export type PlanBodyRootFollowUp = { decision: 'none' } | { decision: 'rebind'; binding: PlanBinding } | { decision: 'fail' }

/**
 * Only ever consulted on `root-failure` (D17): searches for another
 * authored template serving the same objective, not yet bound in this
 * intention's history, still applicable under the holder's current beliefs
 * -- reusing ADR-0009's exact deterministic search (`nextApplicableBinding`),
 * never a plan-body-local reimplementation. `root-success` and `running`
 * both yield `none` -- completion is belief-recognized (D17), never
 * plan-triggered.
 */
export function decideRootResultFollowUp(
  planLocalResult: ExecutionStateSnapshot['planLocalResult'],
  candidate: CanonicalObjective,
  boundTemplateIds: readonly string[],
  templates: readonly PlanTemplate[],
  holderAtomKinds: ReadonlySet<string>,
): PlanBodyRootFollowUp {
  if (planLocalResult !== 'root-failure') return { decision: 'none' }
  const binding = nextApplicableBinding(candidate, { failuresAtStep: 0, boundTemplateIds }, templates, holderAtomKinds)
  if (binding !== undefined) return { decision: 'rebind', binding }
  return { decision: 'fail' }
}

export { deriveExecutionState }
export type { ExecutionStateSnapshot, PlanBodyEvalInputs }
