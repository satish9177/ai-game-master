import { z } from 'zod'

/**
 * Plan-Body Execution Replay v0 schema (ADR-0010 D1-D23, spec plan-body-
 * execution-replay-v0.md §1). Kept in a separate file so every already-
 * passed proof's schema surface (contracts.ts, intentionContracts.ts,
 * compactionContracts.ts, conflictContracts.ts) stays untouched -- purely
 * additive. A restricted, typed Behavior Tree body is authored content
 * (versioned, semantics-pinned), never runtime state: no node here ever
 * carries a mutable status, cursor, or active-path field (D2). Node
 * semantics are pinned by name AND by `BT_SEMANTICS_VERSION` (D4) -- the
 * field's own canon disagrees about what "Sequence" or "SequenceWithMemory"
 * mean (Note 015 Table 1), so a template's `version` string is the only
 * thing that ever authorizes reinterpreting its tree.
 */

export const BT_SEMANTICS_VERSION = 'btsem_v0' as const

// ---- Canonical node_path grammar (D3) ---------------------------------------

// An ordered array of non-negative integers, resolved only against the
// exact template_id + template_version whose `children` arrays it indexes.
// Never a free-form string; canonical serialization preserves array order
// exactly (canonicalSerialization.ts sorts object keys but never reorders
// array elements, so node_path bytes are stable by construction).
export const NodePathSchema = z.array(z.number().int().nonnegative())

export type NodePath = readonly number[]

export function nodePathKey(path: NodePath): string {
  return JSON.stringify(path)
}

export function nodePathEquals(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

export const ROOT_PATH: NodePath = []

// ---- plan_leaf_ref (D3, the one additive ActionAttempt field) --------------

export const PlanLeafRefSchema = z
  .object({
    executionScopeId: z.string().min(1),
    templateId: z.string().min(1),
    templateVersion: z.string().min(1),
    nodePath: NodePathSchema,
    occurrenceOrdinal: z.string().min(1),
  })
  .strict()

export type PlanLeafRef = z.infer<typeof PlanLeafRefSchema>

// ---- Condition read sets (D10/D11) ------------------------------------------

// Exactly two approved read-set sources in v0: a holder-scoped belief atom
// kind (D10.1, indexed the same way ADR-0009's ObjectiveAtomRegistry already
// is), or a holder-local execution fact established by a specific Action
// leaf's committed success earlier in this same execution scope (D10.3) --
// never a raw belief predicate string, never a global blackboard read.
export const ConditionReadSetEntrySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('belief-atom'), atomKind: z.string().min(1) }).strict(),
  z.object({ source: z.literal('execution-fact'), factKind: z.string().min(1) }).strict(),
])

export type ConditionReadSetEntry = z.infer<typeof ConditionReadSetEntrySchema>

// ---- The restricted v0 node set (D4), pinned by BT_SEMANTICS_VERSION -------

export const ConditionNodeSchema = z
  .object({
    type: z.literal('Condition'),
    conditionId: z.string().min(1),
    // D11: a canonical, template-versioned, holder-scoped read set. Static
    // and authored -- v0 never discovers a read dependency at runtime.
    readSet: z.array(ConditionReadSetEntrySchema).min(1),
  })
  .strict()

export type ConditionNode = z.infer<typeof ConditionNodeSchema>

export const ActionNodeSchema = z
  .object({
    type: z.literal('Action'),
    // The BT-authored name (e.g. "GoToGatehouse") is distinct from the
    // underlying dispatch verb so two identical Action *definitions* at
    // different node_paths remain nameable without colliding (P4) -- but
    // path identity, not this name, is what ADR-0010 D3 makes canonical.
    actionId: z.string().min(1),
    action: z.string().min(1),
    target: z.string().min(1),
    // D18: explicit, bounded, deterministic. 0 = one attempt total, no retry.
    retryBudget: z.number().int().nonnegative(),
    // D10.3: the holder-local execution fact this leaf's committed success
    // establishes for later Conditions (authored on the template, never a
    // side registry the engine invents at runtime).
    establishesExecutionFact: z.string().min(1).optional(),
  })
  .strict()

export type ActionNode = z.infer<typeof ActionNodeSchema>

export interface SequenceWithMemoryNode {
  type: 'SequenceWithMemory'
  children: readonly BTNode[]
}

export interface ReactiveFallbackNode {
  type: 'ReactiveFallback'
  children: readonly BTNode[]
}

export const WaitNodeSchema = z
  .object({
    type: z.literal('Wait'),
    // D9: v0 proves duration-based Wait only -- no absolute bound, no
    // wall-clock, no frame count.
    durationWorldTicks: z.number().int().positive(),
  })
  .strict()

export type WaitNode = z.infer<typeof WaitNodeSchema>

export type BTNode = ConditionNode | ActionNode | SequenceWithMemoryNode | ReactiveFallbackNode | WaitNode

export const BTNodeSchema: z.ZodType<BTNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    ConditionNodeSchema,
    ActionNodeSchema,
    z.object({ type: z.literal('SequenceWithMemory'), children: z.array(BTNodeSchema).min(1) }).strict(),
    z.object({ type: z.literal('ReactiveFallback'), children: z.array(BTNodeSchema).min(1) }).strict(),
    WaitNodeSchema,
  ]),
)

// ---- The authored, versioned plan-body template (D1/D4) --------------------

export const PlanBodyTemplateSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    semanticsVersion: z.literal(BT_SEMANTICS_VERSION),
    servesObjectiveType: z.string().min(1),
    // Reused verbatim from ADR-0009 D9 plan-applicability: the belief atom
    // kind the holder's projection must entail for this template to bind.
    contextAtomKind: z.string().min(1),
    root: BTNodeSchema,
  })
  .strict()

export type PlanBodyTemplate = z.infer<typeof PlanBodyTemplateSchema>

// ---- Template validation (static, deterministic; D8/D18 obligations) -------

export type TemplateValidationFault =
  | { fault: 'reactive-consequential-position'; nodePath: NodePath }
  | { fault: 'unbounded-retry'; nodePath: NodePath }
  | { fault: 'duplicate-execution-fact'; factKind: string }
  | { fault: 'undeclared-execution-fact'; factKind: string; nodePath: NodePath }

function walk(node: BTNode, path: NodePath, visit: (node: BTNode, path: NodePath) => void): void {
  visit(node, path)
  if (node.type === 'SequenceWithMemory' || node.type === 'ReactiveFallback') {
    node.children.forEach((child, index) => walk(child, [...path, index], visit))
  }
}

/**
 * Reachable consequential leaves under a `ReactiveFallback` are rejected
 * (D8, F11) UNLESS every ancestor from that ReactiveFallback down to the
 * leaf is the single currently-selected chain -- in v0's restricted grammar
 * that means: a `ReactiveFallback` may only ever re-tick a leaf if that
 * leaf is guarded by a `Condition` sibling earlier in the same fallback (the
 * fixture's own canonical shape). Concretely: a consequential Action must
 * not be a DIRECT child of a `ReactiveFallback` unless it is the LAST child
 * and every earlier sibling is a `Condition` or a `Wait` (never another
 * Action) -- v0 keeps this a static, mechanical, conservative check rather
 * than a full reachability analysis.
 */
function reactivePositionFaults(root: BTNode, consequentialActions: ReadonlySet<string>): TemplateValidationFault[] {
  const faults: TemplateValidationFault[] = []
  walk(root, ROOT_PATH, (node, path) => {
    if (node.type !== 'ReactiveFallback') return
    node.children.forEach((child, index) => {
      if (child.type === 'Action' && consequentialActions.has(child.action)) {
        const earlierSiblingsAreGuards = node.children.slice(0, index).every((sibling) => sibling.type === 'Condition')
        if (!earlierSiblingsAreGuards) {
          faults.push({ fault: 'reactive-consequential-position', nodePath: [...path, index] })
        }
      }
    })
  })
  return faults
}

function retryBudgetFaults(root: BTNode, maxAuthoredRetryBudget: number): TemplateValidationFault[] {
  const faults: TemplateValidationFault[] = []
  walk(root, ROOT_PATH, (node, path) => {
    if (node.type === 'Action' && node.retryBudget > maxAuthoredRetryBudget) {
      faults.push({ fault: 'unbounded-retry', nodePath: path })
    }
  })
  return faults
}

function executionFactFaults(root: BTNode): TemplateValidationFault[] {
  const faults: TemplateValidationFault[] = []
  const declaredFactKinds = new Set<string>()
  walk(root, ROOT_PATH, (node) => {
    if (node.type === 'Action' && node.establishesExecutionFact !== undefined) {
      if (declaredFactKinds.has(node.establishesExecutionFact)) {
        faults.push({ fault: 'duplicate-execution-fact', factKind: node.establishesExecutionFact })
      }
      declaredFactKinds.add(node.establishesExecutionFact)
    }
  })
  walk(root, ROOT_PATH, (node, path) => {
    if (node.type === 'Condition') {
      for (const entry of node.readSet) {
        if (entry.source === 'execution-fact' && !declaredFactKinds.has(entry.factKind)) {
          faults.push({ fault: 'undeclared-execution-fact', factKind: entry.factKind, nodePath: path })
        }
      }
    }
  })
  return faults
}

/**
 * D18's authored retry-budget cap: `RetryUntil`-style unbounded retry is
 * rejected outright (F25); a per-leaf budget above this authored ceiling is
 * treated the same as unbounded (F26's template-time twin). v0's fixture
 * never authors more than 1 retry, so the ceiling is generous but finite.
 */
export const MAX_AUTHORED_RETRY_BUDGET = 8

/** Static template validation (D8/D18): every consequential-leaf-placement and retry-budget obligation, checked once at authoring time, never at runtime. */
export function validateTemplate(template: PlanBodyTemplate, consequentialActions: ReadonlySet<string>): readonly TemplateValidationFault[] {
  return [
    ...reactivePositionFaults(template.root, consequentialActions),
    ...retryBudgetFaults(template.root, MAX_AUTHORED_RETRY_BUDGET),
    ...executionFactFaults(template.root),
  ]
}

// ---- node_path resolution (D3; F4's exact mechanical rejection) -----------

export type NodePathFault = 'node-path-not-found' | 'node-path-not-action'

/** Resolves `path` against `root`'s ordered `children` arrays -- object-key iteration order never enters this (Array indexing only). */
export function resolveNodePath(root: BTNode, path: NodePath): BTNode | undefined {
  let current: BTNode = root
  for (const segment of path) {
    if (current.type !== 'SequenceWithMemory' && current.type !== 'ReactiveFallback') return undefined
    const next = current.children[segment]
    if (next === undefined) return undefined
    current = next
  }
  return current
}

/** F4: a path must resolve to an attempt-emitting Action leaf; root `[]` is a valid general reference (D21) but never a valid dispatch path in v0. */
export function resolveActionPath(root: BTNode, path: NodePath): { node: ActionNode } | { fault: NodePathFault } {
  if (path.length === 0) return { fault: 'node-path-not-found' }
  const resolved = resolveNodePath(root, path)
  if (resolved === undefined) return { fault: 'node-path-not-found' }
  if (resolved.type !== 'Action') return { fault: 'node-path-not-action' }
  return { node: resolved }
}

/** Every Action node_path in `root`, in canonical (depth-first, authored-order) order -- used to derive the holder-local execution-fact map (D10.3). */
export function collectActionPaths(root: BTNode): ReadonlyArray<{ path: NodePath; node: ActionNode }> {
  const out: Array<{ path: NodePath; node: ActionNode }> = []
  walk(root, ROOT_PATH, (node, path) => {
    if (node.type === 'Action') out.push({ path, node })
  })
  return out
}

/** Every Wait node_path in `root`, in canonical order -- used to drive the anchor-establishment fold (D9). */
export function collectWaitPaths(root: BTNode): ReadonlyArray<{ path: NodePath; node: WaitNode }> {
  const out: Array<{ path: NodePath; node: WaitNode }> = []
  walk(root, ROOT_PATH, (node, path) => {
    if (node.type === 'Wait') out.push({ path, node })
  })
  return out
}
