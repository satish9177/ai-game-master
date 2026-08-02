import type { EvidenceArtifact } from './defeasibleBindings'
import type { NpcBeliefWarrant } from './beliefVersions'

export type BeliefRevision =
  | Readonly<{
      status: 'retracted'
      defeatedPremiseId: string
      evidenceId: string
      ruleId: string
    }>
  | Readonly<{
      status: 'replaced'
      evidenceId: string
      successorPredicate: string
    }>
  | Readonly<{
      status: 'unchanged'
      reason:
        | 'no-defeater'
        | 'defeater-targets-unknown-premise'
        | 'defeater-targets-indefeasible-premise'
        | 'no-belief'
    }>

export function evaluateDefeat(input: {
  warrant: NpcBeliefWarrant | null
  artifact: EvidenceArtifact
}): BeliefRevision {
  if (input.warrant === null) return { status: 'unchanged', reason: 'no-belief' }
  if (input.artifact.class === 'inert') {
    return { status: 'unchanged', reason: 'no-defeater' }
  }
  if (input.artifact.class === 'rebutting') {
    return {
      status: 'replaced',
      evidenceId: input.artifact.evidenceId,
      successorPredicate: input.artifact.rebuts,
    }
  }

  const target = input.artifact.defeats
  if (target.ruleId !== input.warrant.ruleId) {
    return { status: 'unchanged', reason: 'defeater-targets-unknown-premise' }
  }
  const premise = input.warrant.premises.find((candidate) => candidate.id === target.premiseId)
  if (premise === undefined) {
    return { status: 'unchanged', reason: 'defeater-targets-unknown-premise' }
  }
  if (!premise.defeasible || !input.warrant.defeasiblePremiseIds.includes(premise.id)) {
    return { status: 'unchanged', reason: 'defeater-targets-indefeasible-premise' }
  }

  return {
    status: 'retracted',
    defeatedPremiseId: premise.id,
    evidenceId: input.artifact.evidenceId,
    ruleId: input.warrant.ruleId,
  }
}
