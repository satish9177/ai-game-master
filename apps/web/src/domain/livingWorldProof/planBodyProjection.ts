import { currentBeliefs } from './beliefProjection'
import { compareInstants } from './canonicalProposition'
import type { BeliefTransition, WorldInstant } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import { holderAtomKindsOf } from './intentionRules'
import type { IntentionStore } from './intentionStore'
import { isIntentionOpen, isSuspended, transitionsOf } from './intentionStore'
import type { ObjectiveAtomRegistry, ProofActionAttempt, ProofActionOutcome } from './intentionContracts'
import type { ActionNode, BTNode, NodePath, PlanBodyTemplate } from './planBodyContracts'
import { collectActionPaths, collectWaitPaths, nodePathEquals, nodePathKey, ROOT_PATH } from './planBodyContracts'
import type { WorldTimeStore } from './worldTimeStore'
import { firstCrossing } from './worldTimeStore'

/**
 * The plan-body derivation engine (ADR-0010 D2/D4-D9, spec §1.2/§2). Every
 * export here is a pure function of the four already-committed record
 * streams (intentions, conflict, world time, and the authored template
 * itself) plus an explicit query bound -- nothing here stores a cursor,
 * node status, active path, or retry counter (D2). Two calls with
 * identical inputs always return byte-identical results (D23); cold
 * replay reuses these same functions verbatim (planBodyReplay.ts).
 */

// ---- Execution scope identity (D2: the adopt/rebind transition's own id) ---

/** The current execution-scope id for `intentionId` at `txBound`: the latest adopt/rebind transition's id. Reuses `transitionsOf` verbatim -- no new store, no new field. */
export function currentExecutionScopeIdOf(store: IntentionStore, intentionId: string, txBound: number): string | undefined {
  const bindings = transitionsOf(store, intentionId, txBound).filter((t) => t.kind === 'adopt' || t.kind === 'rebind')
  return bindings[bindings.length - 1]?.transitionId
}

/** Whether `executionScopeId` is the CURRENT scope of an OPEN intention (P/F: scope closed by a later rebind or intention terminal transition is not open, D14). */
export function isScopeOpen(store: IntentionStore, intentionId: string, executionScopeId: string, txBound: number): boolean {
  return isIntentionOpen(store, intentionId, txBound) && currentExecutionScopeIdOf(store, intentionId, txBound) === executionScopeId
}

// ---- Inputs ------------------------------------------------------------------

export interface PlanBodyEvalInputs {
  template: PlanBodyTemplate
  executionScopeId: string
  intentionId: string
  holder: string
  intentions: IntentionStore
  conflict: ConflictStore
  universe: readonly ReadableRecord[]
  atoms: ObjectiveAtomRegistry
  worldTime: WorldTimeStore
}

export interface DispatchCandidate {
  path: NodePath
  node: ActionNode
  occurrenceOrdinal: string
}

export interface WaitDerivedState {
  path: NodePath
  anchor: WorldInstant
  target: WorldInstant
  status: 'running' | 'success'
  crossingMarkId: string | undefined
}

export type PlanLocalResult = 'running' | 'root-success' | 'root-failure'

export interface ExecutionStateSnapshot {
  scopeOpen: boolean
  suspended: boolean
  /** Node paths currently eligible under the versioned semantics -- derived, never stored (D2). */
  activePath: readonly NodePath[]
  dispatchCandidate: DispatchCandidate | undefined
  planLocalResult: PlanLocalResult
  waitStates: ReadonlyMap<string, WaitDerivedState>
  /** Node paths that were on the active path immediately before the most recent trigger, and are not now (D13/D15). */
  haltedThisPass: readonly NodePath[]
  retryCounts: ReadonlyMap<string, number>
}

// ---- Historical trigger fold (the ONLY place history is walked -- D9's
// Wait-anchor-establishment rule; everything else below is current-bound
// derivable because Action/Sequence/Fallback status is monotonic) ----------

interface Trigger {
  effectiveTime: WorldInstant
  typePriority: number
  ownOrder: number
  kind: 'scope-open' | 'outcome' | 'belief-transition' | 'world-time' | 'intention-transition'
  intentionCommitSeq: number | undefined
}

function atomsOf(atoms: ObjectiveAtomRegistry, id: string): readonly { kind: string }[] {
  return atoms.get(id) ?? []
}

/** Every belief-atom kind ANY Condition in the template declares -- the D11 trigger-relevance test (P14/P15). */
function templateBeliefAtomReadSet(root: BTNode): ReadonlySet<string> {
  const kinds = new Set<string>()
  function walk(node: BTNode): void {
    if (node.type === 'Condition') {
      for (const entry of node.readSet) {
        if (entry.source === 'belief-atom') kinds.add(entry.atomKind)
      }
    } else if (node.type === 'SequenceWithMemory' || node.type === 'ReactiveFallback') {
      node.children.forEach(walk)
    }
  }
  walk(root)
  return kinds
}

/** Whether `transition` touches the template's active-path condition read set (D11): its from/to belief's atom kinds intersect it. */
export function beliefTransitionIsRelevant(
  transition: BeliefTransition,
  template: PlanBodyTemplate,
  atoms: ObjectiveAtomRegistry,
): boolean {
  const readSet = templateBeliefAtomReadSet(template.root)
  const fromKinds = atomsOf(atoms, transition.fromBeliefId).map((atom) => atom.kind)
  const toKinds = atomsOf(atoms, transition.toBeliefId).map((atom) => atom.kind)
  return [...fromKinds, ...toKinds].some((kind) => readSet.has(kind))
}

const LIFECYCLE_KINDS = new Set(['suspend', 'resume', 'rebind', 'complete', 'fail', 'abandon'])

function buildTriggerTimeline(inputs: PlanBodyEvalInputs): { triggers: Trigger[]; scopeOpenSeq: number } | undefined {
  const opening = inputs.intentions.transitions.find((t) => t.transitionId === inputs.executionScopeId)
  if (opening === undefined || (opening.kind !== 'adopt' && opening.kind !== 'rebind')) return undefined

  const scopeAttempts = inputs.intentions.attempts.filter(
    (a) =>
      a.planLeafRef !== undefined &&
      a.planLeafRef.executionScopeId === inputs.executionScopeId &&
      a.planLeafRef.templateId === inputs.template.id &&
      a.planLeafRef.templateVersion === inputs.template.version,
  )
  const attemptIds = new Set(scopeAttempts.map((a) => a.id))

  const triggers: Trigger[] = [
    { effectiveTime: opening.effectiveValidTime, typePriority: 0, ownOrder: opening.commitSeq, kind: 'scope-open', intentionCommitSeq: opening.commitSeq },
  ]

  for (const outcome of inputs.intentions.outcomes) {
    if (!attemptIds.has(outcome.attemptId) || outcome.effectiveValidTime === undefined) continue
    triggers.push({ effectiveTime: outcome.effectiveValidTime, typePriority: 3, ownOrder: outcome.commitSeq, kind: 'outcome', intentionCommitSeq: outcome.commitSeq })
  }

  for (const transition of inputs.conflict.transitions) {
    if (transition.holder !== inputs.holder) continue
    if (!beliefTransitionIsRelevant(transition, inputs.template, inputs.atoms)) continue
    triggers.push({ effectiveTime: transition.effectiveValidTime, typePriority: 1, ownOrder: transition.commitSeq, kind: 'belief-transition', intentionCommitSeq: undefined })
  }

  for (const mark of inputs.worldTime.marks) {
    triggers.push({ effectiveTime: mark.at, typePriority: 2, ownOrder: mark.commitSeq, kind: 'world-time', intentionCommitSeq: undefined })
  }

  for (const transition of inputs.intentions.transitions) {
    if (transition.intentionId !== inputs.intentionId) continue
    if (transition.commitSeq <= opening.commitSeq) continue
    if (!LIFECYCLE_KINDS.has(transition.kind)) continue
    triggers.push({
      effectiveTime: transition.effectiveValidTime,
      typePriority: 4,
      ownOrder: transition.commitSeq,
      kind: 'intention-transition',
      intentionCommitSeq: transition.commitSeq,
    })
  }

  triggers.sort((a, b) => {
    const byTime = compareInstants(a.effectiveTime, b.effectiveTime)
    if (byTime !== 0) return byTime
    if (a.typePriority !== b.typePriority) return a.typePriority - b.typePriority
    return a.ownOrder - b.ownOrder
  })

  return { triggers, scopeOpenSeq: opening.commitSeq }
}

// ---- Bottom-up structural evaluation at one bound --------------------------

interface Bound {
  /** Attempts/outcomes/transitions in the intention store visible up to (and including) this commitSeq. */
  intentionSeq: number
  /** The bitemporal valid-time this pass evaluates Conditions against (D10.1). */
  effectiveTime: WorldInstant
  /** The latest committed world-time mark's own effective time, tracked ONLY by world-time-mark triggers (D9: no other trigger may advance it). */
  currentWorldTime: WorldInstant | undefined
}

interface NodeEvalResult {
  status: 'success' | 'failure' | 'running'
  /** Node paths on the active path within this subtree (including this node's own path when it is a leaf on the path). */
  activePaths: NodePath[]
  dispatchCandidate: DispatchCandidate | undefined
  waitStates: Map<string, WaitDerivedState>
  retryCounts: Map<string, number>
}

function attemptsAtPath(
  intentions: IntentionStore,
  scope: string,
  templateId: string,
  templateVersion: string,
  path: NodePath,
  boundSeq: number,
): readonly ProofActionAttempt[] {
  return intentions.attempts
    .filter(
      (a) =>
        a.planLeafRef !== undefined &&
        a.planLeafRef.executionScopeId === scope &&
        a.planLeafRef.templateId === templateId &&
        a.planLeafRef.templateVersion === templateVersion &&
        nodePathEquals(a.planLeafRef.nodePath, path) &&
        a.dispatchedAtSeq <= boundSeq,
    )
    .sort((a, b) => a.dispatchedAtSeq - b.dispatchedAtSeq)
}

function outcomeOf(intentions: IntentionStore, attemptId: string, boundSeq: number): ProofActionOutcome | undefined {
  return intentions.outcomes.find((o) => o.attemptId === attemptId && o.commitSeq <= boundSeq)
}

function evaluateAction(
  node: ActionNode,
  path: NodePath,
  ctx: { intentions: IntentionStore; scope: string; templateId: string; templateVersion: string; bound: Bound },
): NodeEvalResult {
  const attempts = attemptsAtPath(ctx.intentions, ctx.scope, ctx.templateId, ctx.templateVersion, path, ctx.bound.intentionSeq)
  let retriesUsed = 0

  for (const attempt of attempts) {
    const outcome = outcomeOf(ctx.intentions, attempt.id, ctx.bound.intentionSeq)
    if (outcome === undefined) {
      return { status: 'running', activePaths: [path], dispatchCandidate: undefined, waitStates: new Map(), retryCounts: new Map([[nodePathKey(path), retriesUsed]]) }
    }
    if (outcome.verdict === 'succeeded') {
      return { status: 'success', activePaths: [], dispatchCandidate: undefined, waitStates: new Map(), retryCounts: new Map([[nodePathKey(path), retriesUsed]]) }
    }
    // A non-retryable in-fiction failure (target-absent, D18's epistemic
    // loop-break) is terminal regardless of remaining budget.
    if (outcome.observedResult === 'target-absent') {
      return { status: 'failure', activePaths: [], dispatchCandidate: undefined, waitStates: new Map(), retryCounts: new Map([[nodePathKey(path), retriesUsed]]) }
    }
    retriesUsed += 1
    if (retriesUsed > node.retryBudget) {
      return {
        status: 'failure',
        activePaths: [],
        dispatchCandidate: undefined,
        waitStates: new Map(),
        retryCounts: new Map([[nodePathKey(path), retriesUsed - 1]]),
      }
    }
  }

  // No attempts yet, or every attempt so far was a retry-eligible failure
  // within budget: a new dispatch is due.
  return {
    status: 'running',
    activePaths: [path],
    dispatchCandidate: { path, node, occurrenceOrdinal: `occ_${attempts.length + 1}` },
    waitStates: new Map(),
    retryCounts: new Map([[nodePathKey(path), retriesUsed]]),
  }
}

function evaluateWait(
  path: NodePath,
  durationWorldTicks: number,
  ctx: { bound: Bound; waitAnchors: ReadonlyMap<string, WorldInstant>; worldTime: WorldTimeStore },
): NodeEvalResult {
  const key = nodePathKey(path)
  const anchor = ctx.waitAnchors.get(key) ?? ctx.bound.effectiveTime
  const target: WorldInstant = { night: anchor.night, tick: anchor.tick + durationWorldTicks }
  const now = ctx.bound.currentWorldTime
  const crossed = now !== undefined && compareInstants(now, target) >= 0
  const waitState: WaitDerivedState = {
    path,
    anchor,
    target,
    status: crossed ? 'success' : 'running',
    crossingMarkId: crossed ? firstCrossing(ctx.worldTime, target, ctx.worldTime.nextSeq - 1)?.id : undefined,
  }
  return {
    status: crossed ? 'success' : 'running',
    activePaths: crossed ? [] : [path],
    dispatchCandidate: undefined,
    waitStates: new Map([[key, waitState]]),
    retryCounts: new Map(),
  }
}

function mergeResults(results: readonly NodeEvalResult[]): { waitStates: Map<string, WaitDerivedState>; retryCounts: Map<string, number> } {
  const waitStates = new Map<string, WaitDerivedState>()
  const retryCounts = new Map<string, number>()
  for (const result of results) {
    for (const [key, value] of result.waitStates) waitStates.set(key, value)
    for (const [key, value] of result.retryCounts) retryCounts.set(key, value)
  }
  return { waitStates, retryCounts }
}

function evaluateNode(
  node: BTNode,
  path: NodePath,
  ctx: {
    intentions: IntentionStore
    scope: string
    templateId: string
    templateVersion: string
    bound: Bound
    beliefAtomKinds: ReadonlySet<string>
    executionFacts: ReadonlySet<string>
    waitAnchors: ReadonlyMap<string, WorldInstant>
    worldTime: WorldTimeStore
  },
): NodeEvalResult {
  if (node.type === 'Condition') {
    const satisfied = node.readSet.every((entry) =>
      entry.source === 'belief-atom' ? ctx.beliefAtomKinds.has(entry.atomKind) : ctx.executionFacts.has(entry.factKind),
    )
    return {
      status: satisfied ? 'success' : 'failure',
      activePaths: [],
      dispatchCandidate: undefined,
      waitStates: new Map(),
      retryCounts: new Map(),
    }
  }

  if (node.type === 'Action') {
    return evaluateAction(node, path, { intentions: ctx.intentions, scope: ctx.scope, templateId: ctx.templateId, templateVersion: ctx.templateVersion, bound: ctx.bound })
  }

  if (node.type === 'Wait') {
    return evaluateWait(path, node.durationWorldTicks, { bound: ctx.bound, waitAnchors: ctx.waitAnchors, worldTime: ctx.worldTime })
  }

  if (node.type === 'SequenceWithMemory') {
    const childResults: NodeEvalResult[] = []
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]
      if (child === undefined) continue
      const childPath = [...path, index]
      const result = evaluateNode(child, childPath, ctx)
      childResults.push(result)
      if (result.status === 'success') continue
      const merged = mergeResults(childResults)
      return {
        status: result.status,
        activePaths: result.status === 'running' ? result.activePaths : [],
        dispatchCandidate: result.dispatchCandidate,
        waitStates: merged.waitStates,
        retryCounts: merged.retryCounts,
      }
    }
    const merged = mergeResults(childResults)
    return { status: 'success', activePaths: [], dispatchCandidate: undefined, waitStates: merged.waitStates, retryCounts: merged.retryCounts }
  }

  // ReactiveFallback: leftmost child returning success|running wins (D8).
  const childResults: NodeEvalResult[] = []
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (child === undefined) continue
    const childPath = [...path, index]
    const result = evaluateNode(child, childPath, ctx)
    childResults.push(result)
    if (result.status === 'failure') continue
    const merged = mergeResults(childResults)
    return {
      status: result.status,
      activePaths: result.activePaths,
      dispatchCandidate: result.dispatchCandidate,
      waitStates: merged.waitStates,
      retryCounts: merged.retryCounts,
    }
  }
  const merged = mergeResults(childResults)
  return { status: 'failure', activePaths: [], dispatchCandidate: undefined, waitStates: merged.waitStates, retryCounts: merged.retryCounts }
}

function executionFactsAt(inputs: PlanBodyEvalInputs, boundSeq: number): ReadonlySet<string> {
  const facts = new Set<string>()
  for (const { path, node } of collectActionPaths(inputs.template.root)) {
    if (node.establishesExecutionFact === undefined) continue
    const attempts = attemptsAtPath(inputs.intentions, inputs.executionScopeId, inputs.template.id, inputs.template.version, path, boundSeq)
    const succeeded = attempts.some((attempt) => {
      const outcome = outcomeOf(inputs.intentions, attempt.id, boundSeq)
      return outcome !== undefined && outcome.verdict === 'succeeded'
    })
    if (succeeded) facts.add(node.establishesExecutionFact)
  }
  return facts
}

function beliefAtomKindsAt(inputs: PlanBodyEvalInputs, validT: WorldInstant): ReadonlySet<string> {
  const projection = currentBeliefs(inputs.holder, inputs.universe, inputs.conflict, { validT, txBound: inputs.conflict.nextSeq - 1 })
  return holderAtomKindsOf(projection.beliefs, inputs.atoms)
}

// ---- The public fold (D2) ----------------------------------------------------

/**
 * Derives the exact plan-body execution state for `inputs.executionScopeId`
 * at the current commit bound of every input store. A pure fold: two calls
 * over identical (or replayed-identical) stores return byte-identical
 * results (D23). Establishes each `Wait` node's anchor by walking, in
 * effective-world-time order, only the small set of triggers ADR-0010 D12
 * names (D9) -- everything else (Action status, Sequence cursor, Fallback
 * selection) is monotonic and current-bound derivable directly.
 */
export function deriveExecutionState(inputs: PlanBodyEvalInputs): ExecutionStateSnapshot {
  const timeline = buildTriggerTimeline(inputs)
  if (timeline === undefined) {
    return {
      scopeOpen: false,
      suspended: false,
      activePath: [],
      dispatchCandidate: undefined,
      planLocalResult: 'running',
      waitStates: new Map(),
      haltedThisPass: [],
      retryCounts: new Map(),
    }
  }

  const currentTxBound = inputs.intentions.nextSeq - 1
  const scopeOpen = isScopeOpen(inputs.intentions, inputs.intentionId, inputs.executionScopeId, currentTxBound)
  const suspended = isSuspended(inputs.intentions, inputs.intentionId, currentTxBound)

  // ---- Pass 1: walk triggers at POINT-IN-TIME bounds, solely to establish
  // each Wait's anchor (D9's "first places on the active path" rule) and
  // the pre-final-pass active-path set (for halt detection below). This is
  // the only place history matters -- Action/Sequence/Fallback status is
  // otherwise monotonic and current-bound derivable (pass 2).
  const waitAnchors = new Map<string, WorldInstant>()
  let currentWorldTime: WorldInstant | undefined
  let visibleIntentionSeq = timeline.scopeOpenSeq
  // The active-path set as of just before the MOST RECENT processed trigger
  // -- i.e. one step behind `lastActivePaths` -- which is what pass 2's
  // full-visibility result must be diffed against for `haltedThisPass`.
  // `buildTriggerTimeline` includes every relevant trigger up to now on
  // EVERY call (there is no persisted "since last call" cursor, D2), so the
  // walk's own final step already reflects the latest trigger; comparing
  // against ONE STEP BEHIND is what isolates "what changed at the last
  // trigger" rather than comparing a point in time against itself.
  let activePathsBeforeLastStep = new Set<string>()
  let lastActivePaths = new Set<string>()
  let lastEvaluated: NodeEvalResult | undefined
  let walkSuspended = false

  for (const trigger of timeline.triggers) {
    if (trigger.kind === 'world-time') {
      currentWorldTime = trigger.effectiveTime
    }
    if (trigger.intentionCommitSeq !== undefined) {
      visibleIntentionSeq = Math.max(visibleIntentionSeq, trigger.intentionCommitSeq)
    }

    if (trigger.kind === 'intention-transition') {
      const transition = inputs.intentions.transitions.find((t) => t.commitSeq === trigger.ownOrder)
      if (transition?.kind === 'suspend') {
        activePathsBeforeLastStep = lastActivePaths
        walkSuspended = true
        lastActivePaths = new Set()
        continue
      }
      if (transition?.kind === 'resume') {
        walkSuspended = false
      } else if (transition !== undefined && LIFECYCLE_KINDS.has(transition.kind)) {
        // rebind / complete / fail / abandon: this scope's story ends here;
        // nothing past this point is relevant to ITS anchors.
        break
      }
    }

    if (walkSuspended) {
      // D16: a trigger arriving while suspended (e.g. a delayed outcome)
      // commits normally as world history but advances nothing here.
      continue
    }

    const beliefAtomKinds = beliefAtomKindsAt(inputs, trigger.effectiveTime)
    const executionFacts = executionFactsAt(inputs, visibleIntentionSeq)
    const bound: Bound = { intentionSeq: visibleIntentionSeq, effectiveTime: trigger.effectiveTime, currentWorldTime }

    const result = evaluateNode(inputs.template.root, ROOT_PATH, {
      intentions: inputs.intentions,
      scope: inputs.executionScopeId,
      templateId: inputs.template.id,
      templateVersion: inputs.template.version,
      bound,
      beliefAtomKinds,
      executionFacts,
      waitAnchors,
      worldTime: inputs.worldTime,
    })

    for (const path of result.activePaths) {
      const key = nodePathKey(path)
      if (!waitAnchors.has(key) && result.waitStates.has(key)) {
        waitAnchors.set(key, trigger.effectiveTime)
      }
    }

    activePathsBeforeLastStep = lastActivePaths
    lastActivePaths = new Set(result.activePaths.map(nodePathKey))
    lastEvaluated = result
  }

  if (!scopeOpen) {
    return {
      scopeOpen: false,
      suspended,
      activePath: [],
      dispatchCandidate: undefined,
      planLocalResult: 'running',
      waitStates: new Map(),
      haltedThisPass: [],
      retryCounts: new Map(),
    }
  }

  if (suspended) {
    return {
      scopeOpen,
      suspended: true,
      activePath: [],
      dispatchCandidate: undefined,
      planLocalResult: 'running',
      waitStates: lastEvaluated?.waitStates ?? new Map(),
      haltedThisPass: [...activePathsBeforeLastStep].map((key) => JSON.parse(key) as NodePath),
      retryCounts: lastEvaluated?.retryCounts ?? new Map(),
    }
  }

  // ---- Pass 2: the CURRENT state, full visibility (every attempt/outcome
  // committed so far, not just ones a trigger happened to reveal -- a
  // dispatch itself is not a trigger, D12, so it must still be visible to
  // the very next query). Reuses the anchors pass 1 already established.
  const lastTrigger = timeline.triggers[timeline.triggers.length - 1]
  const nowEffectiveTime = lastTrigger?.effectiveTime ?? inputs.intentions.transitions.find((t) => t.transitionId === inputs.executionScopeId)!.effectiveValidTime
  const finalBeliefAtomKinds = beliefAtomKindsAt(inputs, nowEffectiveTime)
  const finalExecutionFacts = executionFactsAt(inputs, currentTxBound)
  const finalBound: Bound = { intentionSeq: currentTxBound, effectiveTime: nowEffectiveTime, currentWorldTime }

  const finalResult = evaluateNode(inputs.template.root, ROOT_PATH, {
    intentions: inputs.intentions,
    scope: inputs.executionScopeId,
    templateId: inputs.template.id,
    templateVersion: inputs.template.version,
    bound: finalBound,
    beliefAtomKinds: finalBeliefAtomKinds,
    executionFacts: finalExecutionFacts,
    waitAnchors,
    worldTime: inputs.worldTime,
  })

  const newActive = new Set(finalResult.activePaths.map(nodePathKey))
  const haltedThisPass = [...activePathsBeforeLastStep].filter((key) => !newActive.has(key)).map((key) => JSON.parse(key) as NodePath)

  const planLocalResult: PlanLocalResult =
    finalResult.status === 'success' ? 'root-success' : finalResult.status === 'failure' ? 'root-failure' : 'running'

  return {
    scopeOpen,
    suspended: false,
    activePath: finalResult.activePaths,
    dispatchCandidate: finalResult.dispatchCandidate,
    planLocalResult,
    waitStates: finalResult.waitStates,
    haltedThisPass,
    retryCounts: finalResult.retryCounts,
  }
}

export { collectWaitPaths }
