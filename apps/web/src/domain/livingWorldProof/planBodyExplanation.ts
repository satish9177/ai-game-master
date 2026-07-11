import { readable } from './evidenceRecords'
import type { NodePath } from './planBodyContracts'
import { collectActionPaths, nodePathKey } from './planBodyContracts'
import type { ExecutionStateSnapshot, PlanBodyEvalInputs } from './planBodyProjection'
import { deriveExecutionState } from './planBodyProjection'

/**
 * Holder-scoped plan-execution explanation assembly (ADR-0010 D21, spec
 * §2.15). Assembles only from records `readable()` already scopes to this
 * holder (ADR-0005/0006 -- inherited existence-hiding) plus the derived
 * execution snapshot itself (never a hidden TruthEvent, another holder's
 * belief/plan state, validator-only truth, or a stochastic key).
 */

export interface AttemptedActionCitation {
  nodePath: NodePath
  actionId: string
  attemptId: string
  verdict: string | undefined
}

export interface PlanBodyExplanation {
  templateId: string
  templateVersion: string
  executionScopeId: string
  scopeOpen: boolean
  suspended: boolean
  activePath: readonly NodePath[]
  planLocalResult: ExecutionStateSnapshot['planLocalResult']
  attemptedActions: readonly AttemptedActionCitation[]
  haltedPaths: readonly NodePath[]
  /** Belief ids this explanation cites -- every one is checked `readable()` by the holder before assembly (D21). */
  citedBeliefIds: readonly string[]
}

export function explainPlanBodyExecution(inputs: PlanBodyEvalInputs): PlanBodyExplanation {
  const state = deriveExecutionState(inputs)
  const holderReadableBeliefIds = new Set(
    readable(inputs.holder, inputs.universe)
      .filter((entry): entry is Extract<typeof entry, { kind: 'belief' }> => entry.kind === 'belief')
      .map((entry) => entry.record.id),
  )

  const actionPaths = collectActionPaths(inputs.template.root)
  const attemptedActions: AttemptedActionCitation[] = []
  for (const { path, node } of actionPaths) {
    const attempts = inputs.intentions.attempts.filter(
      (attempt) =>
        attempt.planLeafRef !== undefined &&
        attempt.planLeafRef.executionScopeId === inputs.executionScopeId &&
        attempt.planLeafRef.templateId === inputs.template.id &&
        attempt.planLeafRef.templateVersion === inputs.template.version &&
        nodePathKey(attempt.planLeafRef.nodePath) === nodePathKey(path),
    )
    for (const attempt of attempts) {
      const outcome = inputs.intentions.outcomes.find((candidate) => candidate.attemptId === attempt.id)
      attemptedActions.push({ nodePath: path, actionId: node.actionId, attemptId: attempt.id, verdict: outcome?.verdict })
    }
  }

  // Cited beliefs: the current-projection beliefs the holder actually
  // holds, filtered to ones `readable()` also grants (holder-scoped by
  // construction -- there is no code path here that could name another
  // holder's belief or a hidden TruthEvent).
  const citedBeliefIds = [...holderReadableBeliefIds]

  return {
    templateId: inputs.template.id,
    templateVersion: inputs.template.version,
    executionScopeId: inputs.executionScopeId,
    scopeOpen: state.scopeOpen,
    suspended: state.suspended,
    activePath: state.activePath,
    planLocalResult: state.planLocalResult,
    attemptedActions,
    haltedPaths: state.haltedThisPass,
    citedBeliefIds,
  }
}

/**
 * F38/F39's mechanical checker: an explanation must cite no record id
 * outside the holder's own `readable()` set, and must reference the
 * requesting holder only. Used by fault-injection tests that attempt to
 * force a forged explanation citing a hidden TruthEvent or another
 * holder's belief -- this function is what rejects it.
 */
export function explanationCitesOnlyReadable(
  citedRecordIds: readonly string[],
  holder: string,
  universe: Parameters<typeof readable>[1],
): boolean {
  const allowed = new Set(readable(holder, universe).map((entry) => entry.record.id))
  return citedRecordIds.every((id) => allowed.has(id))
}
