/**
 * Stage B / B3 — the single deterministic narrative-pattern monitor.
 *
 * The architectural oracle is cold stateless reconstruction from the complete
 * admitted A-prime prefix (`commitLsn <= evaluationSnapshotLsn`) plus the closed
 * B3 library and pinned versions. Every call begins from empty state and holds
 * no authority between calls; there is no module-level mutable state, wall clock,
 * RNG, locale collation, generative-service, ledger, trace, or template dependency.
 *
 * The monitor only *proposes* transitions by interpreting the closed library
 * descriptor. Every emitted instance is minted and validated by the pinned B2
 * lifecycle/contract, which remains the load-bearing semantic gate. The monitor
 * normalizes nothing into `AttentionCandidate` (that is B4) and enforces no
 * structural/global resource policy (that is B4); the only bound it applies is
 * the authored two-child conflict fork cap, which is part of B3 monitor
 * semantics.
 */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
} from './attentionCandidatePolicy'
import { canonicalSerialize } from './canonicalSerialization'
import type {
  NarrativePatternBinding,
  NarrativePatternDirectEvidenceAssertionInput,
  NarrativePatternInstance,
} from './attentionNarrativePatternContracts'
import {
  canonicalizeNarrativePatternBindings,
  deduplicateNarrativePatternInstances,
} from './attentionNarrativePatternIdentity'
import type {
  NarrativePatternType,
} from './attentionNarrativePatternIdentity'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionReadablePatternEvidenceView,
} from './attentionPatternEvidenceContracts'
import { isAttentionReadablePatternEvidenceViewFromAccessor } from './attentionPatternEvidenceAccessor'
import {
  NARRATIVE_PATTERN_LIBRARY_TYPES,
  getNarrativePatternDefinition,
  narrativePatternContentHash,
} from './attentionNarrativePatternLibrary'
import type {
  NarrativePatternAssertionKind,
  NarrativePatternDefinition,
  NarrativePatternEvidenceRule,
} from './attentionNarrativePatternLibrary'
import {
  abandonNarrativePatternInstance,
  advanceNarrativePatternInstance,
  completeNarrativePatternInstance,
  createNarrativePatternInstance,
  invalidateNarrativePatternInstance,
  refreshNarrativePatternAnnotation,
} from './attentionNarrativePatternLifecycle'

export const ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP = 2

export type NarrativePatternMonitorDiagnosticKind =
  | 'duplicate-suppressed'
  | 'fork-child-cap-exceeded'
  | 'terminal-record-excluded'

export interface NarrativePatternMonitorDiagnostic {
  readonly diagnosticKind: NarrativePatternMonitorDiagnosticKind
  readonly patternType: NarrativePatternType
  readonly recordId: string
  readonly commitLsn: number
  readonly detail: string
}

export type NarrativePatternMonitorRefusal =
  | 'input-not-accessor-minted'
  | 'invalid-evaluation-snapshot'
  | 'narrative-pattern-identity-collision'
  | 'invalid-instance-contract'

export type NarrativePatternMonitorResult =
  | {
      readonly kind: 'ok'
      readonly instances: readonly NarrativePatternInstance[]
      readonly diagnostics: readonly NarrativePatternMonitorDiagnostic[]
    }
  | { readonly kind: 'refused'; readonly reason: NarrativePatternMonitorRefusal }

export interface NarrativePatternMonitorInput {
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
  readonly evaluationSnapshotLsn: number
}

function isCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** Canonical `(commitLsn, recordId)` order; never Array insertion order. */
function compareCanonicalEvidence(
  left: AttentionReadablePatternEvidenceView,
  right: AttentionReadablePatternEvidenceView,
): number {
  if (left.commitLsn !== right.commitLsn) return left.commitLsn - right.commitLsn
  return left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
}

function bindingEntities(bindingMap: readonly NarrativePatternBinding[]): readonly [string, string] {
  return [bindingMap[0]!.entityId, bindingMap[1]!.entityId]
}

function severityValue(
  definition: NarrativePatternDefinition,
  view: AttentionReadablePatternEvidenceView,
): number | null {
  if (
    definition.severityOrder === null
    || view.recordKind !== 'observable_action'
    || view.actionCode !== 'harm'
  ) return null
  return definition.severityOrder[view.publicSeverityBand]
}

interface RuleMatchContext {
  readonly definition: NarrativePatternDefinition
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly startView: AttentionReadablePatternEvidenceView
  readonly priorSeverity: number | null
}

type NarrativePatternRuleDirection = 'forward' | 'reverse' | 'either'

function directionMatches(
  direction: NarrativePatternRuleDirection,
  first: string,
  second: string,
  entity0: string,
  entity1: string,
): boolean {
  const forward = first === entity0 && second === entity1
  const reverse = first === entity1 && second === entity0
  if (direction === 'forward') return forward
  if (direction === 'reverse') return reverse
  return forward || reverse
}

function startCommitmentKey(startView: AttentionReadablePatternEvidenceView): string | undefined {
  return startView.recordKind === 'validated_public_communication'
    && startView.communicationCode === 'commitment'
    ? startView.commitmentKey
    : undefined
}

function ruleMatchesView(
  rule: NarrativePatternEvidenceRule,
  view: AttentionReadablePatternEvidenceView,
  context: RuleMatchContext,
): boolean {
  const [entity0, entity1] = bindingEntities(context.bindingMap)
  if (rule.ruleKind === 'observable_action') {
    if (view.recordKind !== 'observable_action') return false
    if (!(rule.actionCodes as readonly string[]).includes(view.actionCode)) return false
    if (!directionMatches(rule.direction, view.actorId, view.targetId, entity0, entity1)) return false
    if (rule.requiresSeverity) {
      if (view.recordKind !== 'observable_action' || view.actionCode !== 'harm') return false
      const value = context.definition.severityOrder?.[view.publicSeverityBand]
      if (value === undefined) return false
      if (rule.severityConstraint === 'gte-previous' && context.priorSeverity !== null) {
        if (value < context.priorSeverity) return false
      }
      if (rule.severityConstraint === 'gt-previous' && context.priorSeverity !== null) {
        if (value <= context.priorSeverity) return false
      }
    }
    if (rule.requiresCommitmentKeyMatchesStart) {
      const startKey = startCommitmentKey(context.startView)
      if (
        view.actionCode !== 'fulfill_commitment'
        || startKey === undefined
        || view.commitmentKey !== startKey
      ) return false
    }
    if (rule.requiresWithinDeadline) {
      const deadline = context.startView.recordKind === 'validated_public_communication'
        && context.startView.communicationCode === 'commitment'
        ? context.startView.publicDeadlineLsn
        : undefined
      if (deadline === undefined || view.commitLsn > deadline) return false
    }
    return true
  }
  if (rule.ruleKind === 'validated_public_communication') {
    if (view.recordKind !== 'validated_public_communication') return false
    if (!(rule.communicationCodes as readonly string[]).includes(view.communicationCode)) return false
    if (!directionMatches(rule.direction, view.speakerId, view.recipientId, entity0, entity1)) return false
    if (rule.requiresCommitmentKey) {
      if (
        view.communicationCode === 'reconciliation'
        || typeof view.commitmentKey !== 'string'
        || view.commitmentKey.length === 0
      ) return false
    }
    if (rule.requiresPublicDeadline) {
      if (view.communicationCode !== 'commitment' || !isCoordinate(view.publicDeadlineLsn)) return false
    }
    if (rule.requiresCommitmentKeyMatchesStart) {
      const startKey = startCommitmentKey(context.startView)
      const viewKey = view.communicationCode === 'reconciliation' ? undefined : view.commitmentKey
      if (startKey === undefined || viewKey === undefined || viewKey !== startKey) return false
    }
    return true
  }
  if (view.recordKind !== 'world_observable_availability') return false
  return view.entityId === entity0 || view.entityId === entity1
}

function directAssertionFor(
  assertionKind: NarrativePatternAssertionKind,
  view: AttentionReadablePatternEvidenceView,
): NarrativePatternDirectEvidenceAssertionInput | null {
  if (assertionKind === 'public_aid') {
    if (view.recordKind !== 'observable_action' || view.actionCode !== 'aid') return null
    return {
      assertionKind: 'public_aid',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      actorId: view.actorId,
      targetId: view.targetId,
    }
  }
  if (assertionKind === 'public_harm_severity') {
    if (view.recordKind !== 'observable_action' || view.actionCode !== 'harm') return null
    return {
      assertionKind: 'public_harm_severity',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      actorId: view.actorId,
      targetId: view.targetId,
      publicSeverityBand: view.publicSeverityBand,
    }
  }
  if (assertionKind === 'public_commitment') {
    if (view.recordKind !== 'validated_public_communication' || view.communicationCode !== 'commitment') {
      return null
    }
    return {
      assertionKind: 'public_commitment',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      speakerId: view.speakerId,
      recipientId: view.recipientId,
      commitmentKey: view.commitmentKey,
    }
  }
  if (view.recordKind !== 'observable_action' || view.actionCode !== 'fulfill_commitment') return null
  return {
    assertionKind: 'public_fulfillment_record',
    sourceRecordId: view.recordId,
    visibilityProvenanceId: view.visibilityProvenanceId,
    actorId: view.actorId,
    targetId: view.targetId,
    commitmentKey: view.commitmentKey,
  }
}

/** A live partial the monitor is still folding evidence into. */
interface OpenBranch {
  instance: NarrativePatternInstance
  evidenceViews: AttentionReadablePatternEvidenceView[]
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly startView: AttentionReadablePatternEvidenceView
  currentSeverity: number | null
  readonly creationOrder: number
  readonly parentStartRecordId: string
}

interface PerPatternFoldState {
  readonly definition: NarrativePatternDefinition
  readonly contentHash: string
  readonly open: OpenBranch[]
  readonly terminal: NarrativePatternInstance[]
  readonly diagnostics: NarrativePatternMonitorDiagnostic[]
  /** parentStartRecordId -> whether the E1-only parent branch is still emittable. */
  readonly parentHasChild: Set<string>
  creationCounter: number
}

function pairMatches(view: AttentionReadablePatternEvidenceView, a: string, b: string): boolean {
  if (view.recordKind === 'observable_action') {
    return (view.actorId === a && view.targetId === b) || (view.actorId === b && view.targetId === a)
  }
  if (view.recordKind === 'validated_public_communication') {
    return (view.speakerId === a && view.recipientId === b)
      || (view.speakerId === b && view.recipientId === a)
  }
  return view.entityId === a || view.entityId === b
}

function makeBinding(
  patternType: NarrativePatternType,
  entity0: string,
  entity1: string,
): readonly NarrativePatternBinding[] {
  const definition = getNarrativePatternDefinition(patternType)
  return canonicalizeNarrativePatternBindings(patternType, [
    { role: definition.bindingRoleOrder[0]!, entityId: entity0 },
    { role: definition.bindingRoleOrder[1]!, entityId: entity1 },
  ])
}

function bindingFromStart(
  definition: NarrativePatternDefinition,
  startView: AttentionReadablePatternEvidenceView,
): readonly NarrativePatternBinding[] | null {
  // Forward start: entity0 = actor/speaker, entity1 = target/recipient.
  if (startView.recordKind === 'observable_action') {
    if (startView.actorId === startView.targetId) return null
    return makeBinding(definition.patternType, startView.actorId, startView.targetId)
  }
  if (startView.recordKind === 'validated_public_communication') {
    if (startView.speakerId === startView.recipientId) return null
    return makeBinding(definition.patternType, startView.speakerId, startView.recipientId)
  }
  return null
}

function refusedContract(): NarrativePatternMonitorResult {
  return { kind: 'refused', reason: 'invalid-instance-contract' }
}

// ---------------------------------------------------------------------------
// Non-fork drivers (reciprocal overlap, keyed no-fork).
// ---------------------------------------------------------------------------

function tryStartBranch(
  state: PerPatternFoldState,
  view: AttentionReadablePatternEvidenceView,
): OpenBranch | null {
  const { definition, contentHash } = state
  const context: RuleMatchContext = {
    definition,
    bindingMap: [] as readonly NarrativePatternBinding[],
    startView: view,
    priorSeverity: null,
  }
  const binding = bindingFromStart(definition, view)
  if (binding === null) return null
  if (!ruleMatchesView(definition.startRule, view, { ...context, bindingMap: binding })) return null
  const assertionKind = definition.directAssertionByRole[definition.startRule.semanticRole]
  if (assertionKind === undefined) return null
  const directAssertionInput = directAssertionFor(assertionKind, view)
  if (directAssertionInput === null) return null
  const result = createNarrativePatternInstance({
    patternType: definition.patternType,
    patternContentHash: contentHash,
    evaluationSnapshotLsn: view.commitLsn,
    bindingMap: binding,
    startEvidence: view,
    startSemanticRole: definition.startRule.semanticRole,
    directAssertionInput,
  })
  if (result.kind !== 'ok') return null
  state.creationCounter += 1
  return {
    instance: result.instance,
    evidenceViews: [view],
    bindingMap: binding,
    startView: view,
    currentSeverity: severityValue(definition, view),
    creationOrder: state.creationCounter,
    parentStartRecordId: view.recordId,
  }
}

/** Apply an advancing/completing evidence view to the single earliest open branch. */
function tryAdvanceEarliest(
  state: PerPatternFoldState,
  view: AttentionReadablePatternEvidenceView,
  snapshotLsn: number,
): boolean {
  const { definition } = state
  for (let index = 0; index < state.open.length; index += 1) {
    const branch = state.open[index]!
    const stepRule = definition.advancementRules[branch.instance.progressStep - 1]
    if (stepRule === undefined) continue
    const context: RuleMatchContext = {
      definition,
      bindingMap: branch.bindingMap,
      startView: branch.startView,
      priorSeverity: branch.currentSeverity,
    }
    if (view.commitLsn <= branch.instance.lastProgressLsn) continue
    if (!ruleMatchesView(stepRule, view, context)) continue
    const assertionKind = definition.directAssertionByRole[stepRule.semanticRole]
    if (assertionKind === undefined) continue
    const directAssertionInput = directAssertionFor(assertionKind, view)
    if (directAssertionInput === null) continue
    const completes = branch.instance.progressStep + 1 === branch.instance.totalSteps
    const transitionInput = {
      instance: branch.instance,
      supportingEvidenceViews: branch.evidenceViews,
      evidence: view,
      semanticRole: stepRule.semanticRole,
      evaluationSnapshotLsn: snapshotLsn,
      directAssertionInput,
    }
    const result = completes
      ? completeNarrativePatternInstance(transitionInput)
      : advanceNarrativePatternInstance(transitionInput)
    if (result.kind !== 'ok') continue
    if (completes) {
      state.terminal.push(result.instance)
      state.open.splice(index, 1)
    } else {
      branch.instance = result.instance
      branch.evidenceViews = [...branch.evidenceViews, view]
      branch.currentSeverity = severityValue(definition, view) ?? branch.currentSeverity
    }
    return true
  }
  return false
}

type TerminalOutcome = 'violated' | 'abandoned'

function applyTerminalToMatchingBranches(
  state: PerPatternFoldState,
  view: AttentionReadablePatternEvidenceView,
  snapshotLsn: number,
  outcome: TerminalOutcome,
  rule: NarrativePatternEvidenceRule,
): void {
  const { definition } = state
  const survivors: OpenBranch[] = []
  for (const branch of state.open) {
    const context: RuleMatchContext = {
      definition,
      bindingMap: branch.bindingMap,
      startView: branch.startView,
      priorSeverity: branch.currentSeverity,
    }
    if (view.commitLsn <= branch.instance.lastProgressLsn || !ruleMatchesView(rule, view, context)) {
      survivors.push(branch)
      continue
    }
    const transitionInput = {
      instance: branch.instance,
      supportingEvidenceViews: branch.evidenceViews,
      evidence: view,
      semanticRole: rule.semanticRole,
      evaluationSnapshotLsn: snapshotLsn,
    }
    const result = outcome === 'violated'
      ? invalidateNarrativePatternInstance(transitionInput)
      : abandonNarrativePatternInstance(transitionInput)
    if (result.kind === 'ok') {
      state.terminal.push(result.instance)
    } else {
      survivors.push(branch)
    }
  }
  state.open.length = 0
  state.open.push(...survivors)
}

function foldNonForkPattern(
  state: PerPatternFoldState,
  views: readonly AttentionReadablePatternEvidenceView[],
  snapshotLsn: number,
): void {
  const { definition } = state
  for (const view of views) {
    // Terminal evidence is applied before advancement at its canonical position.
    if (view.recordKind === 'world_observable_availability') {
      applyTerminalToMatchingBranches(state, view, snapshotLsn, 'abandoned', definition.abandonmentRule)
      continue
    }
    const invalidated = tryTerminalInvalidation(state, view, snapshotLsn)
    if (invalidated) continue
    // A single record advances at most one earliest branch, then may start a new one.
    tryAdvanceEarliest(state, view, snapshotLsn)
    const started = tryStartBranch(state, view)
    if (started !== null) state.open.push(started)
  }
}

function tryTerminalInvalidation(
  state: PerPatternFoldState,
  view: AttentionReadablePatternEvidenceView,
  snapshotLsn: number,
): boolean {
  const rule = state.definition.invalidationRule
  const before = state.terminal.length
  // Only treat as invalidation when it cannot also be a legal advancement of a
  // branch (advancement is preferred); reciprocal harm is never an aid advance,
  // and commitment retraction is never a fulfillment, so no overlap exists here.
  applyTerminalToMatchingBranches(state, view, snapshotLsn, 'violated', rule)
  return state.terminal.length > before
}

// ---------------------------------------------------------------------------
// Conflict two-child fork driver.
// ---------------------------------------------------------------------------

interface ConflictParent {
  readonly startView: AttentionReadablePatternEvidenceView
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly s1: number
  parentInstance: NarrativePatternInstance
  parentEvidenceViews: AttentionReadablePatternEvidenceView[]
  readonly children: OpenBranch[]
  childrenRetained: number
  readonly creationOrder: number
}

function foldConflictPattern(
  state: PerPatternFoldState,
  views: readonly AttentionReadablePatternEvidenceView[],
  snapshotLsn: number,
): ConflictParent[] {
  const { definition } = state
  const parents: ConflictParent[] = []
  const replyRule = definition.advancementRules[0]!
  const escalationRule = definition.advancementRules[1]!

  for (const view of views) {
    if (view.recordKind === 'world_observable_availability') {
      applyConflictTerminal(state, parents, view, snapshotLsn, 'abandoned', definition.abandonmentRule)
      continue
    }
    if (
      view.recordKind === 'observable_action' && view.actionCode === 'reconcile'
      || view.recordKind === 'validated_public_communication' && view.communicationCode === 'reconciliation'
    ) {
      applyConflictTerminal(state, parents, view, snapshotLsn, 'violated', definition.invalidationRule)
      continue
    }
    if (!(view.recordKind === 'observable_action' && view.actionCode === 'harm')) continue

    // 1. E3 escalation completes every compatible retained open child.
    for (const parent of parents) {
      for (let index = 0; index < parent.children.length; index += 1) {
        const child = parent.children[index]!
        if (child.instance.progressStep !== 2) continue
        const context: RuleMatchContext = {
          definition,
          bindingMap: child.bindingMap,
          startView: child.startView,
          priorSeverity: child.currentSeverity,
        }
        if (view.commitLsn <= child.instance.lastProgressLsn) continue
        if (!ruleMatchesView(escalationRule, view, context)) continue
        const assertionKind = definition.directAssertionByRole[escalationRule.semanticRole]!
        const directAssertionInput = directAssertionFor(assertionKind, view)
        if (directAssertionInput === null) continue
        const result = completeNarrativePatternInstance({
          instance: child.instance,
          supportingEvidenceViews: child.evidenceViews,
          evidence: view,
          semanticRole: escalationRule.semanticRole,
          evaluationSnapshotLsn: snapshotLsn,
          directAssertionInput,
        })
        if (result.kind !== 'ok') continue
        state.terminal.push(result.instance)
        parent.children.splice(index, 1)
        index -= 1
      }
    }

    // 2. E2 reply forks a new child under every compatible parent, capped at two.
    for (const parent of parents) {
      const context: RuleMatchContext = {
        definition,
        bindingMap: parent.bindingMap,
        startView: parent.startView,
        priorSeverity: parent.s1,
      }
      if (view.commitLsn <= parent.startView.commitLsn) continue
      if (!ruleMatchesView(replyRule, view, context)) continue
      if (parent.childrenRetained >= (definition.forkChildCap ?? Infinity)) {
        state.diagnostics.push({
          diagnosticKind: 'fork-child-cap-exceeded',
          patternType: definition.patternType,
          recordId: view.recordId,
          commitLsn: view.commitLsn,
          detail: `resource_limit_exceeded:conflict_fork_child_cap:${parent.startView.recordId}`,
        })
        continue
      }
      const assertionKind = definition.directAssertionByRole[replyRule.semanticRole]!
      const directAssertionInput = directAssertionFor(assertionKind, view)
      if (directAssertionInput === null) continue
      const advanced = advanceNarrativePatternInstance({
        instance: parent.parentInstance,
        supportingEvidenceViews: parent.parentEvidenceViews,
        evidence: view,
        semanticRole: replyRule.semanticRole,
        evaluationSnapshotLsn: snapshotLsn,
        directAssertionInput,
      })
      if (advanced.kind !== 'ok') continue
      state.creationCounter += 1
      parent.children.push({
        instance: advanced.instance,
        evidenceViews: [...parent.parentEvidenceViews, view],
        bindingMap: parent.bindingMap,
        startView: parent.startView,
        currentSeverity: severityValue(definition, view),
        creationOrder: state.creationCounter,
        parentStartRecordId: parent.startView.recordId,
      })
      parent.childrenRetained += 1
    }

    // 3. Every harm is also a new E1 parent start.
    const branch = tryStartBranch(state, view)
    if (branch !== null) {
      parents.push({
        startView: view,
        bindingMap: branch.bindingMap,
        s1: severityValue(definition, view) ?? 0,
        parentInstance: branch.instance,
        parentEvidenceViews: branch.evidenceViews,
        children: [],
        childrenRetained: 0,
        creationOrder: branch.creationOrder,
      })
    }
  }

  return parents
}

function applyConflictTerminal(
  state: PerPatternFoldState,
  parents: readonly ConflictParent[],
  view: AttentionReadablePatternEvidenceView,
  snapshotLsn: number,
  outcome: TerminalOutcome,
  rule: NarrativePatternEvidenceRule,
): void {
  for (const parent of parents) {
    const [entity0, entity1] = bindingEntities(parent.bindingMap)
    const participantsMatch = outcome === 'abandoned'
      ? (view.recordKind === 'world_observable_availability'
          && (view.entityId === entity0 || view.entityId === entity1))
      : pairMatches(view, entity0, entity1)
    if (!participantsMatch) continue
    // Live children first.
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]!
      if (view.commitLsn <= child.instance.lastProgressLsn) continue
      const result = runConflictTerminal(child.instance, child.evidenceViews, view, snapshotLsn, outcome, rule)
      if (result !== null) {
        state.terminal.push(result)
        parent.children.splice(index, 1)
        index -= 1
      }
    }
    // The E1-only parent branch, only while it has no child.
    if (parent.childrenRetained === 0 && !state.parentHasChild.has(parent.startView.recordId)) {
      if (view.commitLsn > parent.parentInstance.lastProgressLsn) {
        const result = runConflictTerminal(
          parent.parentInstance,
          parent.parentEvidenceViews,
          view,
          snapshotLsn,
          outcome,
          rule,
        )
        if (result !== null) {
          state.terminal.push(result)
          state.parentHasChild.add(parent.startView.recordId)
          parent.parentEvidenceViews = []
        }
      }
    }
  }
}

function runConflictTerminal(
  instance: NarrativePatternInstance,
  evidenceViews: readonly AttentionReadablePatternEvidenceView[],
  view: AttentionReadablePatternEvidenceView,
  snapshotLsn: number,
  outcome: TerminalOutcome,
  rule: NarrativePatternEvidenceRule,
): NarrativePatternInstance | null {
  const transitionInput = {
    instance,
    supportingEvidenceViews: evidenceViews,
    evidence: view,
    semanticRole: rule.semanticRole,
    evaluationSnapshotLsn: snapshotLsn,
  }
  const result = outcome === 'violated'
    ? invalidateNarrativePatternInstance(transitionInput)
    : abandonNarrativePatternInstance(transitionInput)
  return result.kind === 'ok' ? result.instance : null
}

// ---------------------------------------------------------------------------
// Final annotation of surviving open partials.
// ---------------------------------------------------------------------------

function finalizeOpenBranch(
  branch: OpenBranch,
  definition: NarrativePatternDefinition,
  snapshotLsn: number,
): NarrativePatternInstance | 'invalid' {
  if (branch.instance.evaluationSnapshotLsn === snapshotLsn) return branch.instance
  const deadline = expiryDeadlineOf(definition, branch.startView)
  if (deadline === null) return 'invalid'
  const refreshed = refreshNarrativePatternAnnotation(
    branch.instance,
    branch.evidenceViews,
    snapshotLsn,
    deadline,
  )
  return refreshed.kind === 'ok' ? refreshed.instance : 'invalid'
}

function expiryDeadlineOf(
  definition: NarrativePatternDefinition,
  startView: AttentionReadablePatternEvidenceView,
): number | null {
  if (definition.horizonRule.horizonKind === 'public-deadline') {
    return startView.recordKind === 'validated_public_communication'
      && startView.communicationCode === 'commitment'
      ? startView.publicDeadlineLsn
      : null
  }
  return startView.commitLsn + definition.horizonRule.delta
}

// ---------------------------------------------------------------------------
// Top-level cold reconstruction.
// ---------------------------------------------------------------------------

function newState(patternType: NarrativePatternType): PerPatternFoldState {
  return {
    definition: getNarrativePatternDefinition(patternType),
    contentHash: narrativePatternContentHash(patternType),
    open: [],
    terminal: [],
    diagnostics: [],
    parentHasChild: new Set(),
    creationCounter: 0,
  }
}

function canonicalInstanceSortKey(instance: NarrativePatternInstance): string {
  return canonicalSerialize([
    NARRATIVE_PATTERN_LIBRARY_TYPES.indexOf(instance.patternType),
    instance.bindingMap.map((entry) => [entry.role, entry.entityId]),
    instance.supportingRecordIdentityTuple.map((entry) => [
      entry.semanticRole,
      entry.recordKind,
      entry.recordId,
      entry.visibilityProvenanceId,
      entry.commitLsn,
    ]),
    instance.patternInstanceId,
  ])
}

export function reconstructNarrativePatternInstances(
  input: NarrativePatternMonitorInput,
): NarrativePatternMonitorResult {
  if (!isCoordinate(input.evaluationSnapshotLsn)) {
    return { kind: 'refused', reason: 'invalid-evaluation-snapshot' }
  }
  if (
    !Array.isArray(input.patternEvidenceViews)
    || input.patternEvidenceViews.some((view) => !isAttentionReadablePatternEvidenceViewFromAccessor(view))
    || input.patternEvidenceViews.some((view) => (
      view.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    ))
  ) {
    return { kind: 'refused', reason: 'input-not-accessor-minted' }
  }

  const snapshotLsn = input.evaluationSnapshotLsn
  // Inclusive committed prefix, canonical (commitLsn, recordId) order. A fresh
  // copy is sorted every call, so forward/reverse input order cannot matter.
  const prefix = [...input.patternEvidenceViews]
    .filter((view) => view.commitLsn <= snapshotLsn)
    .sort(compareCanonicalEvidence)

  const allInstances: NarrativePatternInstance[] = []
  const diagnostics: NarrativePatternMonitorDiagnostic[] = []

  for (const patternType of NARRATIVE_PATTERN_LIBRARY_TYPES) {
    const state = newState(patternType)
    if (state.definition.overlapRule === 'conflict-two-child-fork') {
      const parents = foldConflictPattern(state, prefix, snapshotLsn)
      // Surviving open branches: E1-only parents with no child, and open children.
      for (const parent of parents) {
        if (parent.childrenRetained === 0 && !state.parentHasChild.has(parent.startView.recordId)) {
          state.open.push({
            instance: parent.parentInstance,
            evidenceViews: parent.parentEvidenceViews,
            bindingMap: parent.bindingMap,
            startView: parent.startView,
            currentSeverity: parent.s1,
            creationOrder: parent.creationOrder,
            parentStartRecordId: parent.startView.recordId,
          })
        }
        for (const child of parent.children) state.open.push(child)
      }
    } else {
      foldNonForkPattern(state, prefix, snapshotLsn)
    }

    for (const branch of state.open) {
      const finalized = finalizeOpenBranch(branch, state.definition, snapshotLsn)
      if (finalized === 'invalid') return refusedContract()
      allInstances.push(finalized)
    }
    for (const terminal of state.terminal) allInstances.push(terminal)
    for (const diagnostic of state.diagnostics) diagnostics.push(diagnostic)
  }

  const deduped = deduplicateNarrativePatternInstances(allInstances)
  if (deduped.kind === 'refused') {
    return deduped.reason === 'narrative-pattern-identity-collision'
      ? { kind: 'refused', reason: 'narrative-pattern-identity-collision' }
      : refusedContract()
  }
  const suppressed = allInstances.length - deduped.instances.length
  if (suppressed > 0) {
    diagnostics.push({
      diagnosticKind: 'duplicate-suppressed',
      patternType: deduped.instances[0]?.patternType ?? NARRATIVE_PATTERN_LIBRARY_TYPES[0]!,
      recordId: '',
      commitLsn: snapshotLsn,
      detail: `duplicate_suppressed:${suppressed}`,
    })
  }

  const sorted = [...deduped.instances].sort((left, right) => {
    const leftKey = canonicalInstanceSortKey(left)
    const rightKey = canonicalInstanceSortKey(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })

  return {
    kind: 'ok',
    instances: Object.freeze(sorted),
    diagnostics: Object.freeze(
      [...diagnostics].sort((left, right) => {
        const leftKey = `${left.patternType} ${left.commitLsn} ${left.recordId} ${left.diagnosticKind} ${left.detail}`
        const rightKey = `${right.patternType} ${right.commitLsn} ${right.recordId} ${right.diagnosticKind} ${right.detail}`
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
      }),
    ),
  }
}

export const ATTENTION_NARRATIVE_PATTERN_MONITOR_CONTRACT = Object.freeze({
  monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  identitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
})
