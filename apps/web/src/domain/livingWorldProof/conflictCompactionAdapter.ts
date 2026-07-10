import { isConflictActive } from './beliefProjection'
import type { CompactionProposal, ContradictionEdge, ProofConsequenceRecord } from './compactionContracts'
import { runCompactionPass } from './compactionPass'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { QueryBounds } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'

/**
 * Additive bridge from the real ConflictEdge/BeliefTransition records onto
 * the already-committed, unmodified Compaction Preservation v0 gates
 * (ADR-0007 D7a, spec conflict-edge-replay-v0.md §1.11). This is the only
 * place the conflict rig and the compaction rig touch: `compactionPass.ts`,
 * `compactionGates.ts`, and every committed compaction fixture/test stay
 * byte-identical. Derivation order is an iteration artifact, not a
 * semantic property -- compare derived edges as a set, not an ordered
 * array.
 */

function recordKind(universe: readonly ReadableRecord[], recordId: string): ReadableRecord['kind'] | undefined {
  return universe.find((entry) => entry.record.id === recordId)?.kind
}

function debunks(fromId: string, toId: string): ContradictionEdge {
  return { schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION, kind: 'debunks', from: fromId, to: toId }
}

function supersedes(fromId: string, toId: string): ContradictionEdge {
  return { schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION, kind: 'supersedes', from: fromId, to: toId }
}

/**
 * Converts real conflict-store state into the legacy fixture-form
 * ContradictionEdge[] the unmodified gates consume: each *active*
 * ConflictEdge (§1.4 -- derived, never stored) whose two witness records
 * are one Evidence and one Belief yields a `debunks(evidence, belief)`;
 * each committed transition yields a `supersedes(toBelief, fromBelief)`;
 * and when the superseded belief was rumor-sourced, the correcting
 * evidence also debunks the rumor that grounded it (debunk is derived,
 * ADR-0008 D1) -- no new persistent edge type, and no destructive merge is
 * ever produced.
 */
export function deriveContradictionEdges(store: ConflictStore, universe: readonly ReadableRecord[], bounds: QueryBounds): ContradictionEdge[] {
  const derived: ContradictionEdge[] = []

  for (const edge of store.edges) {
    if (edge.commitSeq > bounds.txBound || !isConflictActive(edge, universe, store, bounds)) {
      continue
    }

    const [first, second] = edge.endpoints
    const firstKind = recordKind(universe, first.witnessRecordId)
    const secondKind = recordKind(universe, second.witnessRecordId)

    if (firstKind === 'evidence' && secondKind === 'belief') {
      derived.push(debunks(first.witnessRecordId, second.witnessRecordId))
    } else if (secondKind === 'evidence' && firstKind === 'belief') {
      derived.push(debunks(second.witnessRecordId, first.witnessRecordId))
    }
  }

  for (const transition of store.transitions) {
    if (transition.commitSeq > bounds.txBound) {
      continue
    }
    derived.push(supersedes(transition.toBeliefId, transition.fromBeliefId))

    const fromEntry = universe.find((entry) => entry.record.id === transition.fromBeliefId)
    const [onlyEvidenceId, ...restEvidenceIds] = transition.inputEvidenceIds
    if (fromEntry?.kind === 'belief' && fromEntry.record.sourceType === 'rumor' && onlyEvidenceId !== undefined && restEvidenceIds.length === 0) {
      derived.push(debunks(onlyEvidenceId, fromEntry.record.sourceRef))
    }
  }

  return derived
}

/**
 * Thin delegate to the unmodified `runCompactionPass`: derives real
 * contradiction edges first, then hands them to the committed gate/pass
 * logic unchanged. Upgrades ADR-0007 D7a to real records with zero risk to
 * committed compaction behavior -- this function never reimplements a
 * gate.
 */
export function runConflictAwareCompactionPass(
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  store: ConflictStore,
  consequences: readonly ProofConsequenceRecord[],
  proposals: readonly CompactionProposal[],
  budget: number,
  bounds: QueryBounds,
): ReturnType<typeof runCompactionPass> {
  const edges = deriveContradictionEdges(store, universe, bounds)
  return runCompactionPass(universe, arcs, edges, consequences, proposals, budget)
}
