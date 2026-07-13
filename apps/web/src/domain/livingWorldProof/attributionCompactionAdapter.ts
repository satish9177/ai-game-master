import type { CompactionProposal, ProofConsequenceRecord } from './compactionContracts'
import type { QueryBounds } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import type { IntentionStore } from './intentionStore'
import { runIntentionAwareCompactionPass } from './intentionCompactionAdapter'
import type { IntentionAwareCompactionResult } from './intentionCompactionAdapter'

/**
 * Attribution compaction (research vault ADR-0011 D19, spec §14): because
 * an attribution IS an ordinary, holder-private `Belief`, it inherits
 * every existing compaction/quiescence gate UNCHANGED -- an open
 * `IntentionCommitment` citing it as adoption/current-dependency support
 * already pins it via the unmodified `intention-quiescence`
 * (`intentionCompactionAdapter.ts`); an active `ConflictEdge` between two
 * attribution claims already pins both endpoints via the unmodified
 * `conflict-quiescence` (`conflictCompactionAdapter.ts`, one layer further
 * down). This is the first content layer since ADR-0007 that adds ZERO new
 * positive quiescence predicates (D19) -- this module is therefore a thin,
 * documentary pass-through, never a new gate. The `AttributionTransitionSupport`
 * sidecar has no independent pin lifecycle of its own (D8/D19): it is
 * addressable only through its owning `BeliefTransition`'s id, so it stays
 * hot or compacts precisely when that transition's holder-local record
 * does, through these SAME existing gates -- no sidecar-specific code path
 * exists here or anywhere else in this proof.
 *
 * What an open attribution must NEVER pin (D14/D19): any record of the
 * modeled holder's. This holds structurally, not through a new check --
 * an attribution's own committed bytes never reference a modeled-holder
 * record id (attributionBuilder.ts's builder), so no pin-set derivation
 * anywhere in the existing chain (`deriveIntentionPins`/`deriveExecutionPins`/
 * `derivePinSet`) can ever resolve one.
 */
export function runAttributionAwareCompactionPass(
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  conflict: ConflictStore,
  intentions: IntentionStore,
  intentionTxBound: number,
  consequences: readonly ProofConsequenceRecord[],
  proposals: readonly CompactionProposal[],
  budget: number,
  bounds: QueryBounds,
): IntentionAwareCompactionResult {
  return runIntentionAwareCompactionPass(universe, arcs, conflict, intentions, intentionTxBound, consequences, proposals, budget, bounds)
}
