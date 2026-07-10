import type { WorldInstant } from './conflictContracts'
import { readConflictRecord } from './conflictScope'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import { readEvidence } from './evidenceRecords'
import type {
  CanonicalObjective,
  IntentionCause,
  IntentionCommitment,
  IntentionTransition,
  IntentionTransitionKind,
} from './intentionContracts'
import type { IntentionStore } from './intentionStore'

/**
 * Scope and existence hiding for the intention record family (ADR-0009
 * D12, spec §2.11). A holder may read ITS OWN IntentionCommitments and
 * IntentionTransitions; no other NPC reads any of it through any surface,
 * and denied is byte-identical to nonexistent -- there is no existence
 * oracle for another holder's goals. The holder-facing views and the
 * explanation assembly expose NO adoption/priority/rule identities, no
 * reconsideration-policy internals, no theta-keys, and no validator
 * internals: those stay engine-side for audit only. Explanations are
 * engine-templated citations of scope-readable records -- no LLM
 * reconstructs why, and none is called (§4).
 */

// ---- Holder-facing redacted views (D12) -------------------------------------

export interface HolderCommitmentView {
  intentionId: string
  objective: CanonicalObjective
  adoptionSupport: readonly string[]
  effectiveValidTime: WorldInstant
}

export interface HolderIntentionTransitionView {
  transitionId: string
  intentionId: string
  kind: IntentionTransitionKind
  cause: IntentionCause
  triggeringIds: readonly string[]
  planTemplateId?: string
  currentDependencySupport?: readonly string[]
  previousDependencySupport?: readonly string[]
  effectiveValidTime: WorldInstant
}

function toCommitmentView(commitment: IntentionCommitment): HolderCommitmentView {
  return {
    intentionId: commitment.intentionId,
    objective: commitment.canonicalObjective,
    adoptionSupport: commitment.adoptionSupport,
    effectiveValidTime: commitment.effectiveValidTime,
  }
}

function toTransitionView(transition: IntentionTransition): HolderIntentionTransitionView {
  return {
    transitionId: transition.transitionId,
    intentionId: transition.intentionId,
    kind: transition.kind,
    cause: transition.cause,
    triggeringIds: transition.triggeringIds,
    effectiveValidTime: transition.effectiveValidTime,
    ...(transition.planBinding !== undefined ? { planTemplateId: transition.planBinding.templateId } : {}),
    ...(transition.currentDependencySupport !== undefined ? { currentDependencySupport: transition.currentDependencySupport } : {}),
    ...(transition.previousDependencySupport !== undefined ? { previousDependencySupport: transition.previousDependencySupport } : {}),
  }
}

export type IntentionRecordView =
  | { kind: 'commitment'; view: HolderCommitmentView }
  | { kind: 'transition'; view: HolderIntentionTransitionView }

export interface IntentionReadCall {
  reader: string
  recordId: string
  verdict: 'granted' | 'denied'
}

export type ReadIntentionOutcome =
  | { verdict: 'granted'; record: IntentionRecordView; call: IntentionReadCall }
  | { verdict: 'denied'; call: IntentionReadCall }

/**
 * Dereferences an IntentionCommitment or IntentionTransition by id, gated
 * per-holder. A hidden record and a nonexistent id return the identical
 * denied shape (existence hiding, D12).
 */
export function readIntentionRecord(npc: string, recordId: string, store: IntentionStore): ReadIntentionOutcome {
  const denied = (): ReadIntentionOutcome => ({ verdict: 'denied', call: { reader: npc, recordId, verdict: 'denied' } })

  const commitment = store.commitments.find((candidate) => candidate.intentionId === recordId)
  if (commitment !== undefined) {
    if (commitment.holder !== npc) return denied()
    return { verdict: 'granted', record: { kind: 'commitment', view: toCommitmentView(commitment) }, call: { reader: npc, recordId, verdict: 'granted' } }
  }

  const transition = store.transitions.find((candidate) => candidate.transitionId === recordId)
  if (transition !== undefined) {
    if (transition.holder !== npc) return denied()
    return { verdict: 'granted', record: { kind: 'transition', view: toTransitionView(transition) }, call: { reader: npc, recordId, verdict: 'granted' } }
  }

  return denied()
}

// ---- Explanation assembly (§2.11, P25) ----------------------------------------

export interface IntentionExplanationClause {
  text: string
  citations: readonly string[]
}

export type ExplainIntentionOutcome = { verdict: 'granted'; clauses: readonly IntentionExplanationClause[] } | { verdict: 'denied' }

function beliefProposition(npc: string, beliefId: string, universe: readonly ReadableRecord[]): string | undefined {
  const read = readEvidence(npc, beliefId, universe)
  if (read.verdict !== 'granted' || read.record.kind !== 'belief') return undefined
  return read.record.record.proposition
}

/**
 * Assembles a holder's "why did you pursue / stop pursuing this?" answer
 * exclusively from holder-readable references:
 *
 *   IntentionCommitment -> supporting Belief -> its RumorTransmission,
 *   the triggering BeliefTransition -> its cited Evidence,
 *   the IntentionTransitions themselves.
 *
 * Every citation is dereferenced through the committed, unchanged
 * `readEvidence` / `readConflictRecord` gates, so each cited record is
 * provably scope-readable to this holder; any denied citation denies the
 * whole explanation. No rule ids, priorities, theta-keys, or validator
 * internals can appear -- the holder views they are built from do not
 * carry them.
 */
export function explainIntentionArc(
  npc: string,
  intentionId: string,
  intentions: IntentionStore,
  conflict: ConflictStore,
  universe: readonly ReadableRecord[],
): ExplainIntentionOutcome {
  const commitmentRead = readIntentionRecord(npc, intentionId, intentions)
  if (commitmentRead.verdict !== 'granted' || commitmentRead.record.kind !== 'commitment') {
    return { verdict: 'denied' }
  }
  const commitment = commitmentRead.record.view

  const clauses: IntentionExplanationClause[] = [
    { text: `decided to ${commitment.objective.objectiveType}`, citations: [commitment.intentionId] },
  ]

  for (const beliefId of commitment.adoptionSupport) {
    const proposition = beliefProposition(npc, beliefId, universe)
    if (proposition === undefined) return { verdict: 'denied' }
    clauses.push({ text: `because believed '${proposition}'`, citations: [beliefId] })

    const beliefRead = readEvidence(npc, beliefId, universe)
    if (beliefRead.verdict !== 'granted' || beliefRead.record.kind !== 'belief') return { verdict: 'denied' }
    const belief = beliefRead.record.record
    if (belief.sourceType === 'rumor') {
      const rumorRead = readEvidence(npc, belief.sourceRef, universe)
      if (rumorRead.verdict !== 'granted' || rumorRead.record.kind !== 'rumor') return { verdict: 'denied' }
      clauses.push({ text: `heard from ${rumorRead.record.record.from}`, citations: [belief.sourceRef] })
    }
  }

  const lifecycle = intentions.transitions.filter(
    (transition) => transition.intentionId === intentionId && transition.kind !== 'adopt',
  )
  for (const transition of lifecycle) {
    for (const triggerId of transition.triggeringIds) {
      const conflictRead = readConflictRecord(npc, triggerId, conflict, universe)
      if (conflictRead.verdict !== 'granted' || conflictRead.record.kind !== 'transition') continue
      for (const evidenceId of conflictRead.record.view.citedEvidenceIds) {
        const evidenceRead = readEvidence(npc, evidenceId, universe)
        if (evidenceRead.verdict !== 'granted' || evidenceRead.record.kind !== 'evidence') return { verdict: 'denied' }
        clauses.push({ text: `then evidence showed '${evidenceRead.record.record.implies}'`, citations: [evidenceId] })
      }
      clauses.push({ text: 'belief changed', citations: [triggerId] })
    }
    clauses.push({ text: `${transition.kind} (${transition.cause})`, citations: [transition.transitionId] })
  }

  return { verdict: 'granted', clauses }
}
