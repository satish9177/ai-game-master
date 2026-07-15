import type { ObjectAffordance, ObjectPurpose } from './contracts'
import { validateObjectPurpose } from './contracts'
import type { PurposeGraphIssueCode } from './issueCodes'
import { buildPurposeGraph, effectNodeId, preconditionNodeId, purposeGraphNodeId, type PurposeGraph } from './purposeGraph'

export type PurposeGraphIssue = Readonly<{
  code: PurposeGraphIssueCode
  nodeIds: readonly string[]
  affordanceIds: readonly string[]
}>

export type PurposeGraphValidationResult = Readonly<{
  valid: boolean
  issues: readonly PurposeGraphIssue[]
  reachableNodeIds: readonly string[]
  firedAffordanceIds: readonly string[]
  walkthroughAffordanceIds: readonly string[]
}>

export type PurposeGraphReferenceCatalog = Readonly<{
  objectIds: readonly string[]
  itemIds: readonly string[]
  objectiveIds: readonly string[]
  exitIds: readonly string[]
}>

export type PurposeGraphValidationInput = Readonly<{
  purposes: readonly ObjectPurpose[]
  catalog: PurposeGraphReferenceCatalog
  initialAvailableNodeIds: readonly string[]
  requiredNodeIds: readonly string[]
}>

type AffordanceEntry = Readonly<{ objectId: string; affordance: ObjectAffordance; nodeId: string }>

/** Validates the declared room-scoped graph against an explicit reference catalog. */
export function validatePurposeGraph(input: PurposeGraphValidationInput): PurposeGraphValidationResult {
  const issues: PurposeGraphIssue[] = []
  const purposes = validatedPurposes(input.purposes, issues)
  const graph = buildPurposeGraph(purposes)
  const entries = affordanceEntries(purposes)
  const available = new Set(input.initialAvailableNodeIds)
  const fired = new Set<string>()
  const walkthrough: string[] = []

  for (;;) {
    const round = entries.filter(({ affordance, nodeId }) => !fired.has(nodeId)
      && affordance.preconditions.every((precondition) => available.has(preconditionNodeId(precondition))))
    if (round.length === 0) break
    for (const entry of round) fired.add(entry.nodeId)
    for (const entry of round) {
      walkthrough.push(entry.nodeId)
      for (const effect of entry.affordance.effects) available.add(effectNodeId(effect))
    }
  }

  addStructuralIssues(purposes, entries, issues)
  addReferenceIssues(purposes, entries, input, issues)
  addRewardSafetyIssues(entries, fired, graph, issues)
  addReachabilityIssues(input.requiredNodeIds, available, issues)
  addCycleIssues(graph, input.requiredNodeIds, available, issues)

  const sortedIssues = issues.map(normalizeIssue).sort(compareIssue)
  return {
    valid: sortedIssues.length === 0,
    issues: sortedIssues,
    reachableNodeIds: [...available].sort(),
    firedAffordanceIds: [...fired].sort(),
    walkthroughAffordanceIds: walkthrough,
  }
}

function validatedPurposes(rawPurposes: readonly ObjectPurpose[], issues: PurposeGraphIssue[]): ObjectPurpose[] {
  const valid: ObjectPurpose[] = []
  for (const rawPurpose of rawPurposes) {
    const purpose = validateObjectPurpose(rawPurpose)
    if (purpose !== null) {
      valid.push(purpose)
      continue
    }
    issues.push({ code: 'INVALID_CONTRACT', nodeIds: [], affordanceIds: [] })
    addUnknownVocabularyIssues(rawPurpose, issues)
  }
  return valid
}

function addUnknownVocabularyIssues(rawPurpose: unknown, issues: PurposeGraphIssue[]): void {
  if (typeof rawPurpose !== 'object' || rawPurpose === null || !('affordances' in rawPurpose)) return
  const affordances = rawPurpose.affordances
  if (!Array.isArray(affordances)) return
  for (const rawAffordance of affordances) {
    if (typeof rawAffordance !== 'object' || rawAffordance === null) continue
    const affordance = rawAffordance as Record<string, unknown>
    if (typeof affordance.action === 'string' && !['inspect', 'read', 'search', 'open', 'take', 'use'].includes(affordance.action)) {
      issues.push({ code: 'UNKNOWN_ACTION', nodeIds: [], affordanceIds: [] })
    }
    addUnknownKindIssues(affordance.preconditions, ['room-flag', 'has-item', 'object-state', 'objective-stage'], 'UNKNOWN_PRECONDITION', issues)
    addUnknownKindIssues(affordance.effects, ['set-object-state', 'set-room-flag', 'add-item', 'reveal-clue', 'progress-objective', 'unlock-exit'], 'UNKNOWN_EFFECT', issues)
  }
}

function addUnknownKindIssues(rawValues: unknown, known: readonly string[], code: PurposeGraphIssueCode, issues: PurposeGraphIssue[]): void {
  if (!Array.isArray(rawValues)) return
  for (const value of rawValues) {
    if (typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string' && !known.includes(value.kind)) {
      issues.push({ code, nodeIds: [], affordanceIds: [] })
    }
  }
}

function affordanceEntries(purposes: readonly ObjectPurpose[]): AffordanceEntry[] {
  return purposes.flatMap((purpose) => purpose.affordances.map((affordance) => ({
    objectId: purpose.objectId,
    affordance,
    nodeId: purposeGraphNodeId.affordance(purpose.objectId, affordance.id),
  }))).sort((left, right) => left.objectId.localeCompare(right.objectId) || left.affordance.id.localeCompare(right.affordance.id))
}

function addStructuralIssues(purposes: readonly ObjectPurpose[], entries: readonly AffordanceEntry[], issues: PurposeGraphIssue[]): void {
  const byObject = new Map<string, AffordanceEntry[]>()
  for (const entry of entries) byObject.set(entry.objectId, [...(byObject.get(entry.objectId) ?? []), entry])
  for (const purpose of purposes) {
    if (purpose.category !== 'decorative' && purpose.affordances.length > 3) {
      issues.push({ code: 'TOO_MANY_AFFORDANCES', nodeIds: [], affordanceIds: purpose.affordances.map((affordance) => purposeGraphNodeId.affordance(purpose.objectId, affordance.id)) })
    }
    if (purpose.required && purpose.category !== 'decorative' && purpose.affordances.every((affordance) => affordance.effects.length === 0)) {
      issues.push({ code: 'PURPOSELESS_REQUIRED_OBJECT', nodeIds: [], affordanceIds: purpose.affordances.map((affordance) => purposeGraphNodeId.affordance(purpose.objectId, affordance.id)) })
    }
  }
  for (const objectEntries of byObject.values()) {
    const duplicateIds = objectEntries.filter((entry, index, all) => all.findIndex((other) => other.affordance.id === entry.affordance.id) !== index)
    if (duplicateIds.length > 0) issues.push({ code: 'DUPLICATE_AFFORDANCE_ID', nodeIds: [], affordanceIds: objectEntries.filter((entry) => duplicateIds.some((duplicate) => duplicate.affordance.id === entry.affordance.id)).map((entry) => entry.nodeId) })
  }
}

function addReferenceIssues(purposes: readonly ObjectPurpose[], entries: readonly AffordanceEntry[], input: PurposeGraphValidationInput, issues: PurposeGraphIssue[]): void {
  const objectIds = new Set([...input.catalog.objectIds, ...purposes.map((purpose) => purpose.objectId)])
  const itemIds = new Set(input.catalog.itemIds)
  const objectiveIds = new Set(input.catalog.objectiveIds)
  const exitIds = new Set(input.catalog.exitIds)
  const missing = new Map<string, { code: PurposeGraphIssueCode; nodeId: string; affordanceIds: Set<string> }>()
  const report = (code: PurposeGraphIssueCode, nodeId: string, affordanceId?: string): void => {
    const key = `${code}|${nodeId}`
    const issue = missing.get(key) ?? { code, nodeId, affordanceIds: new Set<string>() }
    if (affordanceId !== undefined) issue.affordanceIds.add(affordanceId)
    missing.set(key, issue)
  }
  const checkNode = (nodeId: string, affordanceId?: string): void => {
    const objectId = nodeReferent(nodeId, 'object-state', true)
    const itemId = nodeReferent(nodeId, 'item', false)
    const objectiveId = nodeReferent(nodeId, 'objective-stage', true)
    const exitId = nodeReferent(nodeId, 'exit', false)
    if (objectId !== null && !objectIds.has(objectId)) report('MISSING_OBJECT_REFERENCE', nodeId, affordanceId)
    if (itemId !== null && !itemIds.has(itemId)) report('MISSING_ITEM_REFERENCE', nodeId, affordanceId)
    if (objectiveId !== null && !objectiveIds.has(objectiveId)) report('MISSING_OBJECTIVE_REFERENCE', nodeId, affordanceId)
    if (exitId !== null && !exitIds.has(exitId)) report('MISSING_EXIT_REFERENCE', nodeId, affordanceId)
  }

  for (const nodeId of [...input.initialAvailableNodeIds, ...input.requiredNodeIds]) checkNode(nodeId)
  for (const entry of entries) {
    for (const precondition of entry.affordance.preconditions) {
      checkNode(preconditionNodeId(precondition), entry.nodeId)
    }
    for (const effect of entry.affordance.effects) {
      checkNode(effectNodeId(effect), entry.nodeId)
    }
  }
  for (const issue of missing.values()) addIssue(issues, issue.code, issue.nodeId, ...issue.affordanceIds)
}

function nodeReferent(nodeId: string, kind: 'object-state' | 'item' | 'objective-stage' | 'exit', hasSuffix: boolean): string | null {
  const prefix = `${kind}:`
  if (!nodeId.startsWith(prefix)) return null
  const remainder = nodeId.slice(prefix.length)
  const separator = hasSuffix ? remainder.indexOf(':') : remainder.length
  if (separator <= 0) return null
  try {
    return decodeURIComponent(remainder.slice(0, separator))
  } catch {
    return null
  }
}

function addRewardSafetyIssues(entries: readonly AffordanceEntry[], fired: ReadonlySet<string>, graph: PurposeGraph, issues: PurposeGraphIssue[]): void {
  const rewardProviders = new Map<string, AffordanceEntry[]>()
  const transitions = new Map<string, AffordanceEntry[]>()
  for (const entry of entries) for (const effect of entry.affordance.effects) {
    if ((effect.kind === 'add-item' || effect.kind === 'progress-objective') && entry.affordance.repeat !== 'once') {
      addIssue(issues, 'REPEATABLE_NON_IDEMPOTENT_EFFECT', effectNodeId(effect), entry.nodeId)
    }
  }
  for (const entry of entries.filter((candidate) => fired.has(candidate.nodeId))) {
    for (const effect of entry.affordance.effects) {
      if (effect.kind === 'add-item' || effect.kind === 'progress-objective') rewardProviders.set(effectNodeId(effect), [...(rewardProviders.get(effectNodeId(effect)) ?? []), entry])
      if (entry.affordance.repeat === 'once' && (effect.kind === 'set-object-state' || effect.kind === 'set-room-flag')) {
        const key = effect.kind === 'set-object-state' ? `object:${effect.objectId}` : `flag:${effect.roomId}:${effect.flag}`
        transitions.set(key, [...(transitions.get(key) ?? []), entry])
      }
    }
  }
  for (const [nodeId, providers] of rewardProviders) if (providers.length > 1) addIssue(issues, 'DUPLICATE_NON_IDEMPOTENT_REWARD', nodeId, ...providers.map((provider) => provider.nodeId))
  for (const providers of transitions.values()) {
    for (let index = 0; index < providers.length; index += 1) for (let other = index + 1; other < providers.length; other += 1) {
      const left = providers[index]
      const right = providers[other]
      if (left === undefined || right === undefined || sameTransition(left, right) || ordered(graph, left.nodeId, right.nodeId)) continue
      addIssue(issues, 'CONFLICTING_STATE_TRANSITIONS', transitionNodeIds(left, right), left.nodeId, right.nodeId)
    }
  }
}

function sameTransition(left: AffordanceEntry, right: AffordanceEntry): boolean {
  const values = (entry: AffordanceEntry): string[] => entry.affordance.effects.filter((effect) => effect.kind === 'set-object-state' || effect.kind === 'set-room-flag').map(effectNodeId).sort()
  return values(left).some((nodeId) => values(right).includes(nodeId))
}

function transitionNodeIds(left: AffordanceEntry, right: AffordanceEntry): string[] {
  return [...left.affordance.effects, ...right.affordance.effects].filter((effect) => effect.kind === 'set-object-state' || effect.kind === 'set-room-flag').map(effectNodeId)
}

function ordered(graph: PurposeGraph, left: string, right: string): boolean { return pathExists(graph, left, right) || pathExists(graph, right, left) }

function addReachabilityIssues(requiredNodeIds: readonly string[], available: ReadonlySet<string>, issues: PurposeGraphIssue[]): void {
  for (const nodeId of [...new Set(requiredNodeIds)].sort()) if (!available.has(nodeId)) {
    addIssue(issues, 'UNREACHABLE_REQUIRED_NODE', nodeId)
    if (nodeId.startsWith('objective-stage:')) addIssue(issues, 'OBJECTIVE_INCOMPLETABLE', nodeId)
  }
}

function addCycleIssues(graph: PurposeGraph, requiredNodeIds: readonly string[], available: ReadonlySet<string>, issues: PurposeGraphIssue[]): void {
  const required = new Set(requiredNodeIds.filter((nodeId) => !available.has(nodeId)))
  for (const component of stronglyConnectedComponents(graph)) {
    const cyclic = component.length > 1 || graph.edges.some((edge) => edge.from === component[0] && edge.to === component[0])
    if (!cyclic || component.some((nodeId) => available.has(nodeId)) || !component.some((nodeId) => reachesRequired(graph, nodeId, required))) continue
    addIssue(issues, 'UNREACHABLE_DEPENDENCY_CYCLE', component, ...component.filter((nodeId) => nodeId.startsWith('affordance:')))
  }
}

function stronglyConnectedComponents(graph: PurposeGraph): string[][] {
  const adjacency = adjacencyFor(graph)
  const index = new Map<string, number>(); const low = new Map<string, number>(); const stack: string[] = []; const onStack = new Set<string>(); const components: string[][] = []; let next = 0
  const visit = (nodeId: string): void => { index.set(nodeId, next); low.set(nodeId, next); next += 1; stack.push(nodeId); onStack.add(nodeId)
    for (const target of adjacency.get(nodeId) ?? []) if (!index.has(target)) { visit(target); low.set(nodeId, Math.min(low.get(nodeId) ?? 0, low.get(target) ?? 0)) } else if (onStack.has(target)) low.set(nodeId, Math.min(low.get(nodeId) ?? 0, index.get(target) ?? 0))
    if (low.get(nodeId) === index.get(nodeId)) { const component: string[] = []; for (;;) { const member = stack.pop(); if (member === undefined) break; onStack.delete(member); component.push(member); if (member === nodeId) break }; components.push(component.sort()) }
  }
  for (const node of graph.nodes.map((node) => node.id).sort()) if (!index.has(node)) visit(node)
  return components
}

function adjacencyFor(graph: PurposeGraph): Map<string, string[]> { const adjacency = new Map<string, string[]>(); for (const edge of graph.edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to].sort()); return adjacency }
function pathExists(graph: PurposeGraph, from: string, to: string): boolean { const todo = [from]; const seen = new Set<string>(); const adjacency = adjacencyFor(graph); while (todo.length > 0) { const node = todo.pop(); if (node === to) return true; if (node === undefined || seen.has(node)) continue; seen.add(node); todo.push(...(adjacency.get(node) ?? [])) } return false }
function reachesRequired(graph: PurposeGraph, from: string, required: ReadonlySet<string>): boolean { return [...required].some((nodeId) => pathExists(graph, from, nodeId)) }
function addIssue(issues: PurposeGraphIssue[], code: PurposeGraphIssueCode, nodeIds: string | readonly string[], ...affordanceIds: string[]): void { issues.push({ code, nodeIds: Array.isArray(nodeIds) ? nodeIds : [nodeIds], affordanceIds }) }
function normalizeIssue(issue: PurposeGraphIssue): PurposeGraphIssue { return { ...issue, nodeIds: [...new Set(issue.nodeIds)].sort(), affordanceIds: [...new Set(issue.affordanceIds)].sort() } }
function compareIssue(left: PurposeGraphIssue, right: PurposeGraphIssue): number { return left.code.localeCompare(right.code) || (left.nodeIds[0] ?? '').localeCompare(right.nodeIds[0] ?? '') || (left.affordanceIds[0] ?? '').localeCompare(right.affordanceIds[0] ?? '') }
