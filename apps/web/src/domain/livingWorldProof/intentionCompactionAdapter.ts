import type { CompactionProposal, CompactionRecord, ProofConsequenceRecord } from './compactionContracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import { runConflictAwareCompactionPass } from './conflictCompactionAdapter'
import type { QueryBounds } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import type { IntentionStore } from './intentionStore'
import { currentSupportOf, isIntentionOpen } from './intentionStore'

/**
 * Additive bridge from open IntentionCommitments onto the already-committed,
 * unmodified compaction gates (ADR-0009 D13, spec §2.10): the ADR-0007 D9
 * predicate list gains `intention-quiescence`. This is the only place the
 * intention rig and the compaction rig touch -- `compactionPass.ts`,
 * `compactionGates.ts`, `conflictCompactionAdapter.ts`, and every committed
 * compaction fixture/test stay byte-identical. "Open" is derived, never
 * stored (D4): an intention pins iff it has no terminal transition at the
 * query bound, and a closed intention with no remaining pins no longer
 * blocks by itself (P24).
 */

/** The version pins an open intention holds beyond record ids (D13: objective-metadata and plan-template versions). */
export interface IntentionVersionPin {
  intentionId: string
  sourceObjectiveMetadataId: string
  sourceObjectiveMetadataVersion: string
  planTemplateId: string | undefined
  planTemplateVersion: string | undefined
}

export interface IntentionPinSet {
  /** Record ids that must stay hot or addressable: projected current dependency support + adoption support + cited evidence. */
  recordIds: ReadonlySet<string>
  versionPins: readonly IntentionVersionPin[]
}

/**
 * Derives the pin set for every OPEN intention at `intentionTxBound` (D5's
 * derivation rule): the PROJECTED current dependency support (latest
 * refresh-support wins -- never only the immutable adoption support), plus
 * the adoption support itself, plus the evidence each pinned belief cites.
 */
export function deriveIntentionPins(
  intentions: IntentionStore,
  universe: readonly ReadableRecord[],
  intentionTxBound: number,
): IntentionPinSet {
  const recordIds = new Set<string>()
  const versionPins: IntentionVersionPin[] = []

  for (const commitment of intentions.commitments) {
    if (commitment.commitSeq > intentionTxBound || !isIntentionOpen(intentions, commitment.intentionId, intentionTxBound)) {
      continue
    }

    const pinnedBeliefIds = new Set([
      ...(currentSupportOf(intentions, commitment.intentionId, intentionTxBound) ?? []),
      ...commitment.adoptionSupport,
    ])
    for (const beliefId of pinnedBeliefIds) {
      recordIds.add(beliefId)
      const entry = universe.find((candidate) => candidate.kind === 'belief' && candidate.record.id === beliefId)
      if (entry !== undefined && entry.kind === 'belief') {
        for (const citedId of entry.record.supporting) {
          recordIds.add(citedId)
        }
      }
    }

    const bindings = intentions.transitions.filter(
      (transition) =>
        transition.intentionId === commitment.intentionId &&
        transition.commitSeq <= intentionTxBound &&
        transition.planBinding !== undefined,
    )
    const latestBinding = bindings[bindings.length - 1]?.planBinding
    versionPins.push({
      intentionId: commitment.intentionId,
      sourceObjectiveMetadataId: commitment.sourceObjectiveMetadataId,
      sourceObjectiveMetadataVersion: commitment.sourceObjectiveMetadataVersion,
      planTemplateId: latestBinding?.templateId,
      planTemplateVersion: latestBinding?.templateVersion,
    })
  }

  return { recordIds, versionPins }
}

function intentionQuiescenceRejection(proposal: CompactionProposal): CompactionRecord {
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

export interface IntentionAwareCompactionResult {
  /** Proposals rejected by the intention-quiescence predicate, before the unchanged pass ever sees them. */
  intentionQuiescenceRejections: readonly CompactionRecord[]
  pass: ReturnType<typeof runConflictAwareCompactionPass>
}

/**
 * The extended gate (D13/P23/P24/F11): a grouping/demotion proposal
 * covering any member pinned by an OPEN intention is rejected by
 * `intention-quiescence`; everything else delegates, unchanged, to the
 * committed conflict-aware pass. After the intention closes and no pin
 * remains, the same proposal flows through and may commit -- compaction
 * changes residence, not identity (ADR-0007 D1/D2, inherited).
 */
export function runIntentionAwareCompactionPass(
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
  const pins = deriveIntentionPins(intentions, universe, intentionTxBound)

  const intentionQuiescenceRejections: CompactionRecord[] = []
  const admissible: CompactionProposal[] = []
  for (const proposal of proposals) {
    const touchesPin =
      (proposal.action === 'demote' || proposal.action === 'merge_projection' || proposal.action === 'delete') &&
      proposal.memberIds.some((memberId) => pins.recordIds.has(memberId))
    if (touchesPin) {
      intentionQuiescenceRejections.push(intentionQuiescenceRejection(proposal))
    } else {
      admissible.push(proposal)
    }
  }

  const pass = runConflictAwareCompactionPass(universe, arcs, conflict, consequences, admissible, budget, bounds)
  return { intentionQuiescenceRejections, pass }
}
