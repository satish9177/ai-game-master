import { describe, expect, it } from 'vitest'
import {
  arcCellarPostEvidence,
  arcGate,
  beliefC1,
  beliefC1Prime,
  compactionArcs,
  compactionConsequences,
  compactionUniverse,
  contradictionEdges,
  contradictionGroupingProposal,
  crossScopeGroupingProposal,
  deleteProposal,
  pantryDemoteProposal,
  pantryMergeProjectionProposalC,
  pinnedDemotionProposal,
} from './compactionScenario'
import { derivePinSet, evaluateProposal } from './compactionGates'
import type { CompactionProposal } from './compactionContracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import { beliefC2, observationB_T2, observationC_T2 } from './hierarchyScenario'
import { clawEvidence } from './scenario'

describe('derivePinSet', () => {
  const pinSet = derivePinSet(compactionUniverse, compactionArcs, contradictionEdges, compactionConsequences)

  it('pins Bel_C2 (a current belief) even though its arc (arc_pantry) is cold-bound', () => {
    expect(pinSet.has(beliefC2.id)).toBe(true)
  })

  it('pins every arc_cellar member, because it is contradiction-active', () => {
    for (const memberId of arcCellarPostEvidence.memberIds) {
      expect(pinSet.has(memberId)).toBe(true)
    }
  })

  it('pins granted evidence (E_claw)', () => {
    expect(pinSet.has(clawEvidence.id)).toBe(true)
  })

  it('pins Bel_C1 (an active-arc member) even though a supersedes edge makes it not "current"', () => {
    expect(pinSet.has(beliefC1.id)).toBe(true)
  })

  it('pins the corrected belief Bel_C1_prime as a current belief', () => {
    expect(pinSet.has(beliefC1Prime.id)).toBe(true)
  })

  it('pins the live consequence input (O_NPC_D_T3) but not the unrelated arc_gate sibling (O_NPC_A_T3)', () => {
    expect(pinSet.has('O_NPC_D_T3')).toBe(true)
    expect(pinSet.has('O_NPC_A_T3')).toBe(false)
  })

  it('does not pin the pantry observations -- arc_pantry is contradiction-quiescent and they are not current beliefs, active-arc members, evidence, or live-reducer inputs', () => {
    expect(pinSet.has(observationB_T2.id)).toBe(false)
    expect(pinSet.has(observationC_T2.id)).toBe(false)
  })

  it('never consults arc_gate as active (no contradiction edge touches it)', () => {
    for (const memberId of arcGate.memberIds) {
      // O_NPC_D_T3 is pinned only via the live-reducer-input clause, not
      // arc activity -- arc_gate itself contributes nothing to the pin set.
      if (memberId !== 'O_NPC_D_T3') {
        expect(pinSet.has(memberId)).toBe(false)
      }
    }
  })
})

describe('evaluateProposal', () => {
  const pinSet = derivePinSet(compactionUniverse, compactionArcs, contradictionEdges, compactionConsequences)

  it('F1 -- rejects a physical-deletion proposal outright, before any other gate runs', () => {
    const record = evaluateProposal(deleteProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('deletion-forbidden')
    expect(record.action).toBe('delete')
  })

  it('F2 -- rejects grouping a belief with the belief that superseded it', () => {
    const record = evaluateProposal(contradictionGroupingProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('contradiction-edge')
  })

  it('F3 -- rejects the unsplit cross-scope pantry grouping', () => {
    const record = evaluateProposal(crossScopeGroupingProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('scope-boundary')
  })

  it('rejects a pure demote of only the pinned Bel_C2', () => {
    const record = evaluateProposal(pinnedDemotionProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('pinned-member')
  })

  it('rejects an unknown record id', () => {
    const bogus = { ...pantryDemoteProposal, id: 'CP_bogus', memberIds: ['NOT_A_RECORD'] }
    const record = evaluateProposal(bogus, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('unknown-record')
  })

  it('commits a single-scope, non-pinned, non-contradicting demote group', () => {
    const record = evaluateProposal(
      { ...pantryDemoteProposal, id: 'CP_single', memberIds: [observationC_T2.id] },
      compactionUniverse,
      contradictionEdges,
      pinSet,
      compactionArcs,
    )
    expect(record.verdict).toBe('committed')
    expect(record.action).toBe('demote')
  })

  it('commits a single-scope merge_projection that rides its exact validated target arc', () => {
    const record = evaluateProposal(pantryMergeProjectionProposalC, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('committed')
    expect(record.action).toBe('merge_projection')
    expect(record.targetArcId).toBe('arc_pantry')
  })

  it('the natural unsplit pantry proposal is rejected atomically, not partially committed', () => {
    const record = evaluateProposal(pantryDemoteProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    // scope-boundary fires before the pinned-member check would even be reached.
    expect(record.rejectReason).toBe('scope-boundary')
  })

  it('rejects a merge_projection whose members are not all in its named target arc (different-arc / wrong member)', () => {
    // beliefC1 belongs to arc_cellar, not arc_pantry. Naming arc_pantry as the
    // target does not let beliefC1 ride it: the subset check against the exact
    // target arc fails, so the projection is 'projection-not-validated' rather
    // than blessed against some other arc that happens to contain beliefC1.
    const wrongMember: CompactionProposal = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      id: 'CP_wrong_member',
      action: 'merge_projection',
      targetArcId: 'arc_pantry',
      memberIds: [observationB_T2.id, beliefC1.id],
      rationale: 'try to smuggle a foreign record into a real arc projection',
      proposedBy: 'llm',
    }
    const record = evaluateProposal(wrongMember, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('projection-not-validated')
  })

  it('rejects a merge_projection naming an unknown / unresolvable target arc', () => {
    const noTarget: CompactionProposal = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      id: 'CP_no_target',
      action: 'merge_projection',
      targetArcId: 'arc_does_not_exist',
      memberIds: [observationC_T2.id],
      rationale: 'projection with no resolvable arc',
      proposedBy: 'llm',
    }
    const record = evaluateProposal(noTarget, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('projection-not-validated')
  })

  it('rejects a same-arc, cross-scope merge_projection with scope-boundary (arc_pantry spans NPC_B and NPC_C)', () => {
    // arc_pantry validly contains both observationB_T2 (NPC_B) and
    // observationC_T2 (NPC_C), so the subset check alone passes -- but a
    // single projection over both would be a cross-scope read surface. The
    // scope-boundary rule, now applied to merge_projection too, rejects it.
    const crossScopeProjection: CompactionProposal = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      id: 'CP_cross_scope_projection',
      action: 'merge_projection',
      targetArcId: 'arc_pantry',
      memberIds: [observationB_T2.id, observationC_T2.id],
      rationale: 'one projection over both pantry leaves, across NPC_B and NPC_C',
      proposedBy: 'llm',
    }
    const record = evaluateProposal(crossScopeProjection, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(record.verdict).toBe('rejected')
    expect(record.rejectReason).toBe('scope-boundary')
  })
})
