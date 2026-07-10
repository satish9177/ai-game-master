import type { CompactedStore } from './coldStore'
import { resolveRecord } from './coldStore'
import type { ProofConsequenceRecord } from './compactionContracts'
import type { ReadableRecord } from './evidenceRecords'

/**
 * Proof-local reducer + point-replay for P5 (spec §5): a settled
 * ConsequenceRecord's reducer inputs may demote (spec §2.3c) but must
 * remain byte-recoverable and re-runnable. `replayConsequence` resolves
 * every input through the store's residence-transparent `resolveRecord`
 * -- identical whether an input is hot or paged back from cold -- so
 * reproducing the same outputs after demotion is the actual proof, not
 * an assumption. Deliberately not the production journal's consequence
 * types (see design plan): proof-local, so this folder never imports
 * domain/journal. No LLM, no I/O.
 */

export function pantryStockReducer(inputs: readonly ReadableRecord[]): Record<string, string> {
  const observation = inputs.find((entry): entry is Extract<ReadableRecord, { kind: 'observation' }> => entry.kind === 'observation')
  if (observation === undefined) {
    throw new Error('pantryStockReducer: expected an observation input')
  }
  const { perceived } = observation.record
  return {
    pantry_stock: perceived.action === 'collapsed' ? 'damaged' : 'intact',
    restock_required: perceived.target === 'pantry_stock' ? 'true' : 'false',
  }
}

const REDUCERS: Record<string, (inputs: readonly ReadableRecord[]) => Record<string, string>> = {
  pantry_stock_reducer: pantryStockReducer,
}

export type ConsequenceReplayOutcome =
  | { status: 'replayed'; outputs: Record<string, string> }
  | { status: 'input-unresolvable'; recordId: string; reason: 'unknown-record' | 'hash-mismatch' }

/**
 * Re-runs a ConsequenceRecord's reducer over its inputs as currently
 * resolved from `store` (hot or paged-back cold, transparently). Never
 * re-judges a compaction decision -- it only re-derives the reducer's
 * output from the exact, hash-verified record bytes.
 */
export function replayConsequence(consequence: ProofConsequenceRecord, store: CompactedStore): ConsequenceReplayOutcome {
  const reducer = REDUCERS[consequence.reducer]
  if (reducer === undefined) {
    throw new Error(`replayConsequence: unknown reducer ${consequence.reducer}`)
  }

  const inputs: ReadableRecord[] = []
  for (const inputId of consequence.inputIds) {
    const resolved = resolveRecord(store, inputId)
    if (resolved.verdict === 'unknown-record' || resolved.verdict === 'hash-mismatch') {
      return { status: 'input-unresolvable', recordId: inputId, reason: resolved.verdict }
    }
    inputs.push(resolved.record)
  }

  return { status: 'replayed', outputs: reducer(inputs) }
}
