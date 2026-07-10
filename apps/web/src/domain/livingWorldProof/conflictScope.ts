import { claimKeyOf } from './canonicalProposition'
import type { BeliefTransition, ClaimRegistry, ConflictEdge, OverlapWitness, TransitionCause, WorldInstant } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord, ReadEvidenceOutcome } from './evidenceRecords'
import { readable, readEvidence } from './evidenceRecords'

/**
 * Scope and existence hiding for ConflictEdges and BeliefTransitions
 * (ADR-0008 D10, spec conflict-edge-replay-v0.md §1.10). Every gate here
 * is engine-side by default and re-derives visibility from the record
 * universe on every call -- the same discipline evidenceRecords.readable/
 * readEvidence already use. Denied and nonexistent look byte-identical:
 * there is no existence oracle for a hidden edge or transition.
 */

/** An edge is visible to an NPC only when both endpoint claims already have a readable carrier (ADR-0008 D2/D10). */
export function edgeVisible(npc: string, edge: ConflictEdge, universe: readonly ReadableRecord[], claims: ClaimRegistry): boolean {
  const readableIds = new Set(readable(npc, universe).map((entry) => entry.record.id))
  return edge.endpoints.every((endpoint) =>
    [...claims.entries()].some(([recordId, claim]) => claimKeyOf(claim) === endpoint.claimKey && readableIds.has(recordId)),
  )
}

/** A transition is visible only to its own holder -- never global (ADR-0008 D6/D10). */
export function transitionVisible(npc: string, transition: BeliefTransition): boolean {
  return transition.holder === npc
}

/**
 * NPC-facing redacted view of a BeliefTransition: no adjudication/proposal
 * key, no rule identity/version, no transaction-time internals -- those
 * stay engine-side (D10).
 */
export interface HolderTransitionView {
  transitionId: string
  fromBeliefId: string
  toBeliefId: string
  cause: TransitionCause
  effectiveValidTime: WorldInstant
  citedEvidenceIds: readonly string[]
}

function toHolderView(transition: BeliefTransition): HolderTransitionView {
  return {
    transitionId: transition.transitionId,
    fromBeliefId: transition.fromBeliefId,
    toBeliefId: transition.toBeliefId,
    cause: transition.cause,
    effectiveValidTime: transition.effectiveValidTime,
    citedEvidenceIds: transition.inputEvidenceIds,
  }
}

export type ConflictRecordView =
  | { kind: 'edge'; edgeId: string; canonicalKey: string; overlapWitness: OverlapWitness }
  | { kind: 'transition'; view: HolderTransitionView }

export interface ConflictReadCall {
  reader: string
  recordId: string
  verdict: 'granted' | 'denied'
}

export type ReadConflictOutcome = { verdict: 'granted'; record: ConflictRecordView; call: ConflictReadCall } | { verdict: 'denied'; call: ConflictReadCall }

/**
 * Dereferences a ConflictEdge or BeliefTransition by id, gated exactly like
 * `readEvidence`. A hidden edge/transition and a nonexistent id return the
 * identical denied shape -- an unauthorized NPC cannot distinguish "hidden"
 * from "does not exist" (N8).
 */
export function readConflictRecord(npc: string, recordId: string, store: ConflictStore, universe: readonly ReadableRecord[]): ReadConflictOutcome {
  const denied = (): ReadConflictOutcome => ({ verdict: 'denied', call: { reader: npc, recordId, verdict: 'denied' } })

  const edge = store.edges.find((candidate) => candidate.edgeId === recordId)
  if (edge !== undefined) {
    if (!edgeVisible(npc, edge, universe, store.claims)) {
      return denied()
    }
    return {
      verdict: 'granted',
      record: { kind: 'edge', edgeId: edge.edgeId, canonicalKey: edge.canonicalKey, overlapWitness: edge.overlapWitness },
      call: { reader: npc, recordId, verdict: 'granted' },
    }
  }

  const transition = store.transitions.find((candidate) => candidate.transitionId === recordId)
  if (transition !== undefined) {
    if (!transitionVisible(npc, transition)) {
      return denied()
    }
    return {
      verdict: 'granted',
      record: { kind: 'transition', view: toHolderView(transition) },
      call: { reader: npc, recordId, verdict: 'granted' },
    }
  }

  return denied()
}

export interface ExplanationClause {
  text: string
  citations: readonly string[]
}

export type ExplainTransitionOutcome = { verdict: 'granted'; clauses: readonly ExplanationClause[]; citations: readonly ReadEvidenceOutcome[] } | { verdict: 'denied' }

function describeCitation(outcome: ReadEvidenceOutcome): string {
  if (outcome.verdict !== 'granted') {
    return ''
  }
  const entry = outcome.record
  if (entry.kind === 'belief') {
    return `'${entry.record.proposition}'`
  }
  if (entry.kind === 'evidence') {
    return `implies '${entry.record.implies}'`
  }
  return ''
}

/**
 * Assembles a holder's "why did your belief change?" explanation from the
 * transition's own provenance -- old belief -> evidence -> new belief
 * (P9) -- dereferencing every citation through the committed, unchanged
 * `readEvidence` gate so each cited record is provably scope-readable to
 * this holder. Engine-templated phrasing only; no semantic reconstruction
 * of *why* the correction happened, only cited facts.
 */
export function explainTransition(npc: string, transitionId: string, store: ConflictStore, universe: readonly ReadableRecord[]): ExplainTransitionOutcome {
  const transition = store.transitions.find((candidate) => candidate.transitionId === transitionId)
  if (transition === undefined || !transitionVisible(npc, transition)) {
    return { verdict: 'denied' }
  }

  const fromCitation = readEvidence(npc, transition.fromBeliefId, universe)
  const toCitation = readEvidence(npc, transition.toBeliefId, universe)
  const evidenceCitations = transition.inputEvidenceIds.map((id) => ({ id, outcome: readEvidence(npc, id, universe) }))
  const citations = [fromCitation, ...evidenceCitations.map((entry) => entry.outcome), toCitation]

  if (citations.some((outcome) => outcome.verdict === 'denied')) {
    return { verdict: 'denied' }
  }

  const clauses: ExplanationClause[] = [
    { text: `previously believed ${describeCitation(fromCitation)}`, citations: [transition.fromBeliefId] },
    ...evidenceCitations.map(({ id, outcome }) => ({ text: `presented evidence that ${describeCitation(outcome)}`, citations: [id] })),
    { text: `now believes ${describeCitation(toCitation)}`, citations: [transition.toBeliefId] },
  ]

  return { verdict: 'granted', clauses, citations }
}
