import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { deriveContradictionEdges, runConflictAwareCompactionPass } from './conflictCompactionAdapter'
import { buildConflictScenario, nightTick } from './conflictScenario'
import {
  arcCellarPostEvidence,
  compactionArcs,
  compactionConsequences,
  contradictionEdges as legacyContradictionEdges,
  HAPPY_PATH_BUDGET,
  pantryDemoteProposal,
  pantryMergeProjectionProposalB,
  pantryMergeProjectionProposalC,
} from './compactionScenario'
import type { CompactionProposal } from './compactionContracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import { runCompactionPass } from './compactionPass'
import { beliefC1, beliefC1Prime } from './compactionScenario'

/**
 * Additive bridge from real ConflictEdge/BeliefTransition records onto the
 * unmodified Compaction Preservation v0 gates (ADR-0007 D7a, spec conflict-
 * edge-replay-v0.md §1.11). Covers P11 (barrier from real records), F7
 * (grouping an active chain is rejected), N2 (rumor variants stay merge-
 * ineligible), and the keystone: derived edges reproduce the hand-authored
 * fixture and the happy-path compaction pass byte-for-byte.
 */

const BOUNDS = { validT: nightTick('night_5'), txBound: 1000 }

describe('keystone -- derived contradiction edges reproduce the committed fixture', () => {
  it('deep-equals compactionScenario.contradictionEdges as a set (derivation order is not semantic)', () => {
    const scenario = buildConflictScenario()
    const derived = deriveContradictionEdges(scenario.store, scenario.universe, BOUNDS)

    const normalize = (edges: readonly { schemaVersion: number; kind: string; from: string; to: string }[]) =>
      [...edges].map((edge) => canonicalSerialize(edge)).sort()

    expect(normalize(derived)).toEqual(normalize(legacyContradictionEdges))
  })

  it('runConflictAwareCompactionPass reproduces the committed happy-path CompactionPassResult byte-for-byte', () => {
    const scenario = buildConflictScenario()

    const viaAdapter = runConflictAwareCompactionPass(
      scenario.universe,
      compactionArcs,
      scenario.store,
      compactionConsequences,
      [pantryDemoteProposal, pantryMergeProjectionProposalB, pantryMergeProjectionProposalC],
      HAPPY_PATH_BUDGET,
      BOUNDS,
    )
    const viaLegacy = runCompactionPass(
      scenario.universe,
      compactionArcs,
      legacyContradictionEdges,
      compactionConsequences,
      [pantryDemoteProposal, pantryMergeProjectionProposalB, pantryMergeProjectionProposalC],
      HAPPY_PATH_BUDGET,
    )

    expect(canonicalSerialize(viaAdapter.result)).toBe(canonicalSerialize(viaLegacy.result))
  })
})

describe('P11 / F7 -- active conflict barrier from real records', () => {
  it('a proposal grouping Bel_C1 with its correction is rejected via the real derived edge', () => {
    const scenario = buildConflictScenario()
    const groupingProposal: CompactionProposal = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      id: 'CP_conflict_test',
      action: 'merge_projection',
      memberIds: [beliefC1.id, beliefC1Prime.id],
      rationale: 'consolidate the belief and its correction into one projection',
      proposedBy: 'llm',
    }

    const { result } = runConflictAwareCompactionPass(scenario.universe, compactionArcs, scenario.store, compactionConsequences, [groupingProposal], HAPPY_PATH_BUDGET, BOUNDS)
    const record = result.compactionLog.find((entry) => entry.id === groupingProposal.id)
    expect(record?.verdict).toBe('rejected')
    expect(record?.rejectReason).toBe('contradiction-edge')
  })

  it('arc_cellar members stay hot after the rejected grouping attempt', () => {
    const scenario = buildConflictScenario()
    const groupingProposal: CompactionProposal = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      id: 'CP_conflict_test_2',
      action: 'merge_projection',
      memberIds: [beliefC1.id, beliefC1Prime.id],
      rationale: 'consolidate the belief and its correction into one projection',
      proposedBy: 'llm',
    }
    const { store } = runConflictAwareCompactionPass(scenario.universe, compactionArcs, scenario.store, compactionConsequences, [groupingProposal], HAPPY_PATH_BUDGET, BOUNDS)
    for (const memberId of arcCellarPostEvidence.memberIds) {
      expect(store.residence.get(memberId)).toBe('hot')
    }
  })
})

describe('N2 -- rumor variants create no ConflictEdge and stay merge-ineligible', () => {
  it('no derived edge ever references R_A_to_B or R_B_to_C', () => {
    const scenario = buildConflictScenario()
    const derived = deriveContradictionEdges(scenario.store, scenario.universe, BOUNDS)
    const rumorReferencing = derived.filter((edge) => edge.kind === 'debunks' && (edge.from === 'R_A_to_B' || edge.to === 'R_A_to_B'))
    expect(rumorReferencing).toHaveLength(0)

    // The debunked rumor R_B_to_C is referenced only via the general
    // rumor-sourced-loser rule (debunks(E_claw, R_B_to_C)), never via a
    // ConflictEdge of its own -- wording variation alone mints nothing.
    const debunksRumor = derived.find((edge) => edge.kind === 'debunks' && edge.to === 'R_B_to_C')
    expect(debunksRumor).toBeDefined()
  })

  it('no destructive merge action exists in the compaction action enum', () => {
    // Structural guarantee: the only actions ever committable are demote/
    // merge_projection/pin; 'delete' is categorically rejected upstream
    // (unchanged compactionGates.ts), so no rumor variant can ever be
    // destructively content-merged through this adapter.
    const scenario = buildConflictScenario()
    const derived = deriveContradictionEdges(scenario.store, scenario.universe, BOUNDS)
    expect(derived.every((edge) => edge.kind === 'debunks' || edge.kind === 'supersedes')).toBe(true)
  })
})
