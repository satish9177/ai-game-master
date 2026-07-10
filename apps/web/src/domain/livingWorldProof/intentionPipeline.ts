import { currentBeliefs } from './beliefProjection'
import type { BeliefTransition, WorldInstant } from './conflictContracts'
import type {
  GoalOption,
  IntentionTransition,
  ObjectiveMetadata,
  PlanBinding,
  ProofActionAttempt,
  SupportIndexFault,
} from './intentionContracts'
import { INTENTION_RULE_VERSION, RECONSIDER_OUTCOME_RULE_ID, RECONSIDER_SUPPORT_RULE_ID } from './intentionContracts'
import {
  deriveOptions,
  holderAtomKindsOf,
  planApplicable,
  reconsiderOnBeliefAcquired,
  reconsiderOnBeliefTransition,
  reconsiderOnOutcome,
  scopedOptionInputs,
} from './intentionRules'
import type { ReconsiderationContext } from './intentionRules'
import type { AdoptionOutcome, IntentionCommitContext, IntentionStore } from './intentionStore'
import {
  commitAdoption,
  commitIntentionTransition,
  currentSupportOf,
  derivePlanState,
  dispatchAttempt,
  intentionTxBound,
  isIntentionOpen,
  nextAttemptRequestFor,
  openIntentionsOf,
} from './intentionStore'

/**
 * The normative tick pipeline (ADR-0009 D8, spec §2.4):
 *
 *   commit observations and belief changes
 *   -> commit BeliefTransitions               (conflict store, unchanged)
 *   -> identify intentions affected through CURRENT dependency support
 *   -> reconsider only those intentions
 *   -> commit resulting IntentionTransitions
 *   -> dispatch new ActionAttempts
 *
 * Reconsideration precedes dispatch by construction, so an intention
 * unsupported by the holder's current beliefs can never dispatch a stale
 * attempt in the same tick (P5). Reconsideration is event-driven and
 * support-addressed: unrelated belief changes touch no intention (P9) and
 * leave every bystander byte-identical (D8 core-retainment).
 */

export interface IntentionPipelineContext extends IntentionCommitContext {
  metadataByHolder: ReadonlyMap<string, readonly ObjectiveMetadata[]>
}

// ---- Support-addressed identification (D5/D8) --------------------------------

export type SupportIndexMode = 'current-support' | 'adoption-support-only'

/**
 * Finds the intentions a BeliefTransition affects. The correct index
 * watches PROJECTED CURRENT dependency support (D5); the
 * 'adoption-support-only' mode exists solely as the F4 fault under test --
 * an index frozen on immutable adoption support misses every post-refresh
 * supersession.
 */
export function identifyAffectedIntentions(
  store: IntentionStore,
  transition: BeliefTransition,
  mode: SupportIndexMode = 'current-support',
): readonly string[] {
  const txBound = intentionTxBound(store)
  return openIntentionsOf(store, transition.holder, txBound)
    .filter((commitment) => {
      const watched =
        mode === 'current-support'
          ? (currentSupportOf(store, commitment.intentionId, txBound) ?? commitment.adoptionSupport)
          : commitment.adoptionSupport
      return watched.includes(transition.fromBeliefId)
    })
    .map((commitment) => commitment.intentionId)
}

export type StaleIndexReport = { stale: false } | { stale: true; fault: SupportIndexFault; missedIntentionIds: readonly string[] }

/** The F4 checker: any intention the current-support index catches but the adoption-support-only index misses is a stale-index fault. */
export function detectStaleSupportIndex(store: IntentionStore, transition: BeliefTransition): StaleIndexReport {
  const correct = identifyAffectedIntentions(store, transition, 'current-support')
  const staleView = new Set(identifyAffectedIntentions(store, transition, 'adoption-support-only'))
  const missed = correct.filter((intentionId) => !staleView.has(intentionId))
  if (missed.length === 0) {
    return { stale: false }
  }
  return { stale: true, fault: 'stale-support-index', missedIntentionIds: missed }
}

// ---- Reconsideration commits (engine-derived; a rejection is a rig bug) ------

function reconsiderationContext(ctx: IntentionPipelineContext, holder: string, metadata: ObjectiveMetadata, validT: WorldInstant): ReconsiderationContext {
  const projection = currentBeliefs(holder, ctx.universe, ctx.conflict, { validT, txBound: ctx.conflict.nextSeq - 1 })
  return { beliefs: projection.beliefs, atoms: ctx.atoms, metadata }
}

function mustCommit(
  result: { store: IntentionStore; outcome: { verdict: 'committed'; transition: IntentionTransition } | { verdict: 'rejected'; fault: string } },
  label: string,
): { store: IntentionStore; transition: IntentionTransition } {
  if (result.outcome.verdict !== 'committed') {
    throw new Error(`intentionPipeline: engine-derived ${label} transition rejected (${result.outcome.fault}) -- rig invariant broken`)
  }
  return { store: result.store, transition: result.outcome.transition }
}

export interface TickResult {
  store: IntentionStore
  committedTransitions: readonly IntentionTransition[]
}

/**
 * Reconsiders every intention affected by the given committed
 * BeliefTransitions (already in the conflict store), committing the
 * resulting IntentionTransitions. Yields exactly one of the §2.4 verdicts
 * per affected intention: nothing (continuation), refresh-support,
 * complete, or a typed abandon.
 */
export function runReconsiderationTick(
  store: IntentionStore,
  ctx: IntentionPipelineContext,
  beliefTransitionIds: readonly string[],
  validT: WorldInstant,
): TickResult {
  let nextStore = store
  const committedTransitions: IntentionTransition[] = []

  for (const transitionId of beliefTransitionIds) {
    const beliefTransition = ctx.conflict.transitions.find((candidate) => candidate.transitionId === transitionId)
    if (beliefTransition === undefined) {
      throw new Error(`intentionPipeline: unknown BeliefTransition ${transitionId} -- rig invariant broken`)
    }

    for (const intentionId of identifyAffectedIntentions(nextStore, beliefTransition)) {
      const commitment = nextStore.commitments.find((candidate) => candidate.intentionId === intentionId)
      if (commitment === undefined) continue
      const metadata = ctx.metadataById.get(commitment.sourceObjectiveMetadataId)
      if (metadata === undefined) {
        throw new Error(`intentionPipeline: unknown objective metadata for ${intentionId} -- rig invariant broken`)
      }

      const decision = reconsiderOnBeliefTransition(
        commitment.canonicalObjective,
        currentSupportOf(nextStore, intentionId, intentionTxBound(nextStore)) ?? commitment.adoptionSupport,
        beliefTransition,
        reconsiderationContext(ctx, commitment.holder, metadata, validT),
      )

      if (decision.decision === 'none') continue

      if (decision.decision === 'refresh-support') {
        const committed = mustCommit(
          commitIntentionTransition(
            nextStore,
            {
              intentionId,
              holder: commitment.holder,
              kind: 'refresh-support',
              cause: 'support-superseded-but-re-entailed',
              triggeringIds: [beliefTransition.transitionId],
              ruleId: RECONSIDER_SUPPORT_RULE_ID,
              ruleVersion: INTENTION_RULE_VERSION,
              currentDependencySupport: decision.replacement,
              previousDependencySupport: decision.previous,
              effectiveValidTime: validT,
            },
            ctx,
          ),
          'refresh-support',
        )
        nextStore = committed.store
        committedTransitions.push(committed.transition)
        continue
      }

      const kind = decision.decision === 'complete' ? ('complete' as const) : ('abandon' as const)
      const cause = decision.decision === 'complete' ? ('believed-achieved' as const) : decision.cause
      const triggeringIds = decision.triggeringIds.length > 0 ? decision.triggeringIds : [beliefTransition.transitionId]
      const committed = mustCommit(
        commitIntentionTransition(
          nextStore,
          {
            intentionId,
            holder: commitment.holder,
            kind,
            cause,
            triggeringIds,
            ruleId: RECONSIDER_SUPPORT_RULE_ID,
            ruleVersion: INTENTION_RULE_VERSION,
            effectiveValidTime: validT,
          },
          ctx,
        ),
        kind,
      )
      nextStore = committed.store
      committedTransitions.push(committed.transition)
    }
  }

  return { store: nextStore, committedTransitions }
}

/**
 * Reconsiders a holder's open intentions after the holder ACQUIRES a new
 * committed belief (no supersession): the believed-achieved /
 * believed-forbidden / believed-impossible D8 triggers.
 */
export function reconsiderAcquiredBelief(
  store: IntentionStore,
  ctx: IntentionPipelineContext,
  holder: string,
  beliefId: string,
  validT: WorldInstant,
): TickResult {
  let nextStore = store
  const committedTransitions: IntentionTransition[] = []

  for (const commitment of openIntentionsOf(nextStore, holder, intentionTxBound(nextStore))) {
    const metadata = ctx.metadataById.get(commitment.sourceObjectiveMetadataId)
    if (metadata === undefined) continue
    const decision = reconsiderOnBeliefAcquired(commitment.canonicalObjective, reconsiderationContext(ctx, holder, metadata, validT))
    if (decision.decision !== 'complete' && decision.decision !== 'abandon') continue

    const committed = mustCommit(
      commitIntentionTransition(
        nextStore,
        {
          intentionId: commitment.intentionId,
          holder,
          kind: decision.decision,
          cause: decision.decision === 'complete' ? 'believed-achieved' : decision.cause,
          triggeringIds: decision.triggeringIds.length > 0 ? decision.triggeringIds : [beliefId],
          ruleId: RECONSIDER_SUPPORT_RULE_ID,
          ruleVersion: INTENTION_RULE_VERSION,
          effectiveValidTime: validT,
        },
        ctx,
      ),
      decision.decision,
    )
    nextStore = committed.store
    committedTransitions.push(committed.transition)
  }

  return { store: nextStore, committedTransitions }
}

/**
 * Reconsiders one intention after an ActionOutcome belonging to it (via
 * `intention_id`, D8) commits: the strict D9 failure hierarchy -- retry
 * writes nothing, plan inapplicability rebinds, exhaustion fails.
 */
export function reconsiderOutcomeTrigger(store: IntentionStore, ctx: IntentionPipelineContext, outcomeId: string, validT: WorldInstant): TickResult {
  const outcome = store.outcomes.find((candidate) => candidate.id === outcomeId)
  const attempt = outcome === undefined ? undefined : store.attempts.find((candidate) => candidate.id === outcome.attemptId)
  if (outcome === undefined || attempt === undefined || attempt.intentionId === null) {
    return { store, committedTransitions: [] }
  }
  const intentionId = attempt.intentionId
  const txBound = intentionTxBound(store)
  if (!isIntentionOpen(store, intentionId, txBound)) {
    return { store, committedTransitions: [] }
  }
  const commitment = store.commitments.find((candidate) => candidate.intentionId === intentionId)
  const metadata = commitment === undefined ? undefined : ctx.metadataById.get(commitment.sourceObjectiveMetadataId)
  const planState = derivePlanState(store, intentionId, txBound, ctx.templates)
  if (commitment === undefined || metadata === undefined || planState === undefined) {
    return { store, committedTransitions: [] }
  }

  const projection = currentBeliefs(commitment.holder, ctx.universe, ctx.conflict, { validT, txBound: ctx.conflict.nextSeq - 1 })
  const decision = reconsiderOnOutcome(
    commitment.canonicalObjective,
    outcome,
    { failuresAtStep: planState.failuresAtStep, boundTemplateIds: planState.boundTemplateIds },
    ctx.templates,
    holderAtomKindsOf(projection.beliefs, ctx.atoms),
    metadata,
  )

  if (decision.decision === 'none' || decision.decision === 'retry') {
    return { store, committedTransitions: [] }
  }

  const candidate =
    decision.decision === 'rebind'
      ? {
          intentionId,
          holder: commitment.holder,
          kind: 'rebind' as const,
          cause: 'plan-inapplicable' as const,
          triggeringIds: [outcomeId],
          ruleId: RECONSIDER_OUTCOME_RULE_ID,
          ruleVersion: INTENTION_RULE_VERSION,
          planBinding: decision.binding,
          effectiveValidTime: validT,
        }
      : {
          intentionId,
          holder: commitment.holder,
          kind: 'fail' as const,
          cause: 'plan-exhausted' as const,
          triggeringIds: [outcomeId],
          ruleId: RECONSIDER_OUTCOME_RULE_ID,
          ruleVersion: INTENTION_RULE_VERSION,
          effectiveValidTime: validT,
        }

  const committed = mustCommit(commitIntentionTransition(store, candidate, ctx), candidate.kind)
  return { store: committed.store, committedTransitions: [committed.transition] }
}

// ---- Dispatch phase (strictly after reconsideration -- §2.4/§2.6) -----------

export interface DispatchPhaseResult {
  store: IntentionStore
  dispatched: readonly ProofActionAttempt[]
}

/**
 * Dispatches the next plan-step attempt for every OPEN, unsuspended,
 * non-pending intention -- in deterministic intentionId order. Closed
 * intentions dispatch nothing: this running strictly after
 * `runReconsiderationTick` is the P5 ordering rule.
 */
export function dispatchNextAttempts(store: IntentionStore, ctx: IntentionPipelineContext, holders?: readonly string[]): DispatchPhaseResult {
  let nextStore = store
  const dispatched: ProofActionAttempt[] = []

  const commitments = [...nextStore.commitments]
    .filter((commitment) => holders === undefined || holders.includes(commitment.holder))
    .sort((a, b) => (a.intentionId < b.intentionId ? -1 : 1))

  for (const commitment of commitments) {
    const request = nextAttemptRequestFor(nextStore, commitment, intentionTxBound(nextStore), ctx.templates)
    if (request === undefined) continue
    const result = dispatchAttempt(nextStore, request)
    if (result.outcome.verdict !== 'dispatched') continue
    nextStore = result.store
    dispatched.push(result.outcome.attempt)
  }

  return { store: nextStore, dispatched }
}

// ---- Deliberation (§2.2: deterministic ranking, capacity cap of one) ---------

export interface DeliberationResult {
  store: IntentionStore
  adopted: AdoptionOutcome | undefined
  options: readonly GoalOption[]
}

function firstApplicableBinding(ctx: IntentionPipelineContext, holder: string, objectiveType: string, validT: WorldInstant): PlanBinding | undefined {
  const projection = currentBeliefs(holder, ctx.universe, ctx.conflict, { validT, txBound: ctx.conflict.nextSeq - 1 })
  const atomKinds = holderAtomKindsOf(projection.beliefs, ctx.atoms)
  const eligible = ctx.templates
    .filter((template) => template.servesObjectiveType === objectiveType && planApplicable(template, atomKinds))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const [first] = eligible
  return first === undefined ? undefined : { templateId: first.id, templateVersion: first.version, params: {} }
}

/**
 * Derives options from the holder's committed projection, ranks them
 * deterministically, and adopts the top-ranked option if the holder has
 * capacity (v0: one open intention). Every input flows through
 * `scopedOptionInputs` -- there is no path here for a TruthEvent, another
 * holder's record, or an uncommitted rumor (D6/D16).
 */
export function deliberateAndAdopt(store: IntentionStore, ctx: IntentionPipelineContext, holder: string, validT: WorldInstant): DeliberationResult {
  const inputs = scopedOptionInputs(
    holder,
    ctx.universe,
    ctx.conflict,
    { validT, txBound: ctx.conflict.nextSeq - 1 },
    ctx.atoms,
    ctx.metadataByHolder.get(holder) ?? [],
  )
  const derived = deriveOptions(inputs)
  if (derived.verdict === 'rejected') {
    throw new Error(`intentionPipeline: scoped option inputs rejected (${derived.fault}) -- rig invariant broken`)
  }

  const [top] = derived.options
  if (top === undefined) {
    return { store, adopted: undefined, options: derived.options }
  }
  if (openIntentionsOf(store, holder, intentionTxBound(store)).length > 0) {
    return { store, adopted: { verdict: 'rejected', fault: 'capacity-exceeded' }, options: derived.options }
  }

  const binding = firstApplicableBinding(ctx, holder, top.candidateObjective.objectiveType, validT)
  if (binding === undefined) {
    return { store, adopted: { verdict: 'rejected', fault: 'plan-not-applicable' }, options: derived.options }
  }

  const adoption = commitAdoption(
    store,
    { holder, option: top, planBinding: binding, reconsiderationPolicy: 'default', effectiveValidTime: validT },
    ctx,
  )
  return { store: adoption.store, adopted: adoption.outcome, options: derived.options }
}
