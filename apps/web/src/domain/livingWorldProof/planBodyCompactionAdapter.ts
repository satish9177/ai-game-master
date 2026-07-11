import type { CompactionProposal, CompactionRecord, ProofConsequenceRecord } from './compactionContracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { QueryBounds } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { runIntentionAwareCompactionPass } from './intentionCompactionAdapter'
import type { IntentionAwareCompactionResult } from './intentionCompactionAdapter'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import type { ObjectiveAtomRegistry } from './intentionContracts'
import type { IntentionStore } from './intentionStore'
import { currentBeliefs } from './beliefProjection'
import type { PlanBodyTemplate } from './planBodyContracts'
import { isScopeOpen } from './planBodyProjection'

/**
 * Additive bridge from open plan-body execution scopes onto the
 * already-committed, unmodified compaction gates (ADR-0010 D20, spec
 * §2.14): the ADR-0007 D9 predicate list gains `execution-quiescence`,
 * exactly the sibling-adapter shape `intentionCompactionAdapter.ts`
 * already established for `intention-quiescence` -- `compactionGates.ts`,
 * `compactionPass.ts`, `conflictCompactionAdapter.ts`, and every committed
 * compaction fixture/test stay byte-identical. Execution pins are
 * additive over intention-quiescence, never a replacement for it (D20;
 * P69). `ActionAttempt`/`ActionOutcome`/world-time marks are not
 * `ReadableRecord`s at all -- no compaction proposal in this model can
 * ever name one, so they are pinned by structural exclusion (P64/P65/F36),
 * never by a new pin-set entry here; this adapter's own job is the
 * `ReadableRecord`-addressable half: the template/binding version pin and
 * the active template's condition read-set beliefs/evidence (P63/P66/P67).
 */

export interface ExecutionVersionPin {
  executionScopeId: string
  intentionId: string
  templateId: string
  templateVersion: string
  semanticsVersion: string
}

export interface ExecutionPinSet {
  recordIds: ReadonlySet<string>
  versionPins: readonly ExecutionVersionPin[]
}

export interface OpenExecutionScope {
  executionScopeId: string
  intentionId: string
  holder: string
  template: PlanBodyTemplate
}

function templateBeliefAtomKinds(template: PlanBodyTemplate): ReadonlySet<string> {
  const kinds = new Set<string>()
  function walk(node: PlanBodyTemplate['root']): void {
    if (node.type === 'Condition') {
      for (const entry of node.readSet) {
        if (entry.source === 'belief-atom') kinds.add(entry.atomKind)
      }
    } else if (node.type === 'SequenceWithMemory' || node.type === 'ReactiveFallback') {
      node.children.forEach(walk)
    }
  }
  walk(template.root)
  return kinds
}

/**
 * Derives the pin set for every OPEN execution scope: the template/binding
 * version pin, plus every belief (and its cited evidence) that currently
 * entails a read-set atom kind ANY `Condition` in the bound template
 * declares (a conservative, template-wide superset of the active path's
 * read sets -- always a safe over-approximation for a pin, never an
 * under-approximation, D11/D20).
 */
export function deriveExecutionPins(
  scopes: readonly OpenExecutionScope[],
  intentions: IntentionStore,
  conflict: ConflictStore,
  universe: readonly ReadableRecord[],
  atoms: ObjectiveAtomRegistry,
  bounds: QueryBounds,
): ExecutionPinSet {
  const recordIds = new Set<string>()
  const versionPins: ExecutionVersionPin[] = []

  for (const scope of scopes) {
    const txBound = intentions.nextSeq - 1
    if (!isScopeOpen(intentions, scope.intentionId, scope.executionScopeId, txBound)) continue

    versionPins.push({
      executionScopeId: scope.executionScopeId,
      intentionId: scope.intentionId,
      templateId: scope.template.id,
      templateVersion: scope.template.version,
      semanticsVersion: scope.template.semanticsVersion,
    })

    const relevantAtomKinds = templateBeliefAtomKinds(scope.template)
    const projection = currentBeliefs(scope.holder, universe, conflict, bounds)
    for (const belief of projection.beliefs) {
      const beliefAtoms = atoms.get(belief.id) ?? []
      if (!beliefAtoms.some((atom) => relevantAtomKinds.has(atom.kind))) continue
      recordIds.add(belief.id)
      for (const citedId of belief.supporting) {
        recordIds.add(citedId)
      }
    }
  }

  return { recordIds, versionPins }
}

function executionQuiescenceRejection(proposal: CompactionProposal): CompactionRecord {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: proposal.id,
    action: proposal.action,
    memberIds: proposal.memberIds,
    rationale: proposal.rationale,
    proposedBy: proposal.proposedBy,
    verdict: 'rejected',
    rejectReason: 'pinned-member',
    ...(proposal.targetArcId !== undefined ? { targetArcId: proposal.targetArcId } : {}),
  }
}

export interface ExecutionAwareCompactionResult {
  /** Proposals rejected by execution-quiescence, before the unchanged intention-aware pass ever sees them. */
  executionQuiescenceRejections: readonly CompactionRecord[]
  pass: IntentionAwareCompactionResult
}

/**
 * The extended gate (D20/P67): a grouping/demotion proposal covering any
 * member pinned by an OPEN execution scope is rejected by
 * `execution-quiescence`, additively over `intention-quiescence`
 * (P69) -- everything else delegates, unchanged, to the committed
 * intention-aware pass. After every open scope referencing a pin closes,
 * the same proposal flows through and may commit (P68).
 */
export function runExecutionAwareCompactionPass(
  scopes: readonly OpenExecutionScope[],
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  conflict: ConflictStore,
  intentions: IntentionStore,
  atoms: ObjectiveAtomRegistry,
  intentionTxBound: number,
  consequences: readonly ProofConsequenceRecord[],
  proposals: readonly CompactionProposal[],
  budget: number,
  bounds: QueryBounds,
): ExecutionAwareCompactionResult {
  const pins = deriveExecutionPins(scopes, intentions, conflict, universe, atoms, bounds)

  const executionQuiescenceRejections: CompactionRecord[] = []
  const admissible: CompactionProposal[] = []
  for (const proposal of proposals) {
    const touchesPin =
      (proposal.action === 'demote' || proposal.action === 'merge_projection' || proposal.action === 'delete') &&
      proposal.memberIds.some((memberId) => pins.recordIds.has(memberId))
    if (touchesPin) {
      executionQuiescenceRejections.push(executionQuiescenceRejection(proposal))
    } else {
      admissible.push(proposal)
    }
  }

  const pass = runIntentionAwareCompactionPass(universe, arcs, conflict, intentions, intentionTxBound, consequences, admissible, budget, bounds)
  return { executionQuiescenceRejections, pass }
}
