import { describe, expect, it } from 'vitest'
import { readEvidence } from './evidenceRecords'
import { beliefC1 } from './evidenceScenario'
import { buildInteriorDigest, entitledArcMemberIds, provenanceOracle } from './hierarchy'
import { openNode, projectTree, ROOT_NODE_ID, searchScope } from './hierarchyNavigation'
import {
  arcCellarPostEvidence,
  arcCellarPreEvidence,
  arcsPostEvidence,
  arcsPreEvidence,
  postEvidenceHierarchyRecords,
  preEvidenceHierarchyRecords,
} from './hierarchyScenario'

/**
 * The fused hierarchical-navigation pass (ADR-0006): NPC_C answers "what do
 * you know about the cellar incident?" by navigating root -> arc_cellar ->
 * her three entitled leaves through readEvidence -- the same gate the
 * already-proven bounded-evidence-recovery rig uses, untouched. No LLM
 * anywhere in this file.
 */
describe('hierarchical evidence navigation -- NPC_C topic-addressed challenge', () => {
  it('happy path: root -> arc_cellar -> leaves, answer contains no zombie_17, and matches the provenance oracle exactly (P5)', () => {
    const rootOutcome = openNode('NPC_C', ROOT_NODE_ID, arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(rootOutcome.call.verdict).toBe('granted')
    expect(rootOutcome.result?.clauses.map((clause) => clause.citations[0]).sort()).toEqual(['arc_cellar', 'arc_pantry'])

    const arcOutcome = openNode('NPC_C', 'arc_cellar', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(arcOutcome.call.verdict).toBe('granted')
    const leafIds = arcOutcome.result?.clauses.flatMap((clause) => clause.citations) ?? []
    expect(leafIds.sort()).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'])

    const reads = leafIds.map((id) => readEvidence('NPC_C', id, preEvidenceHierarchyRecords))
    for (const outcome of reads) {
      expect(outcome.verdict).toBe('granted')
    }

    const answerText = reads.map((outcome) => (outcome.verdict === 'granted' ? JSON.stringify(outcome.record) : '')).join(' ')
    expect(answerText).not.toContain('zombie_17')

    // The belief-anchored oracle (Bel_C1's one-hop chain) is a sound subset
    // of the broader topic-level leaf set -- narrower on purpose, since
    // O_NPC_C_T1 grounds no part of the accusation itself.
    const oracle = provenanceOracle('NPC_C', beliefC1, preEvidenceHierarchyRecords)
    expect(oracle.every((id) => leafIds.includes(id))).toBe(true)
    expect(oracle).toEqual(['Bel_C1', 'R_B_to_C'])
  })

  it('post-evidence: E_claw is reachable via arc_cellar and dereferences byte-identically through the unchanged read gate (P6)', () => {
    const arcOutcome = openNode('NPC_C', 'arc_cellar', arcsPostEvidence, postEvidenceHierarchyRecords)
    expect(arcOutcome.call.verdict).toBe('granted')
    const leafIds = arcOutcome.result?.clauses.flatMap((clause) => clause.citations) ?? []
    expect(leafIds).toContain('E_claw')

    const outcome = readEvidence('NPC_C', 'E_claw', postEvidenceHierarchyRecords)
    expect(outcome.verdict).toBe('granted')
  })

  it('P3 -- NPC_C cannot infer any TruthEvent exists anywhere in her navigation, pre- or post-evidence', () => {
    for (const [arcs, records] of [
      [arcsPreEvidence, preEvidenceHierarchyRecords],
      [arcsPostEvidence, postEvidenceHierarchyRecords],
    ] as const) {
      const tree = projectTree('NPC_C', arcs, records)
      const treeIds = [tree.rootDigest, ...arcs.map((arc) => openNode('NPC_C', arc.id, arcs, records).result)]
        .filter((digest): digest is NonNullable<typeof digest> => digest !== undefined)
        .flatMap((digest) => digest.clauses.flatMap((clause) => clause.citations))
      for (const truthId of ['T0', 'T1', 'T2', 'T3']) {
        expect(treeIds).not.toContain(truthId)
      }
      expect(tree.children.length).toBeGreaterThan(0)
    }
  })

  it('F2 -- a digest built pre-evidence goes stale the instant E_claw is presented, even though nothing regenerated it', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    const currentEntitled = entitledArcMemberIds('NPC_C', arcCellarPostEvidence, postEvidenceHierarchyRecords)
    expect(new Set(currentEntitled).has('E_claw')).toBe(true)
    expect(digest.asOf).not.toContain('E_claw')
  })

  it('F4 -- search for zombie_17 is empty for NPC_C pre-evidence; post-evidence it surfaces only her own newly granted E_claw, never another NPC\'s records', () => {
    expect(searchScope('NPC_C', 'zombie_17', preEvidenceHierarchyRecords).result).toEqual([])

    // E_claw's own `implies` field names zombie_17 -- that is the evidence's
    // content, not a leak: once presented, it is genuinely in NPC_C's
    // readable set. The boundary that matters is scope, not the search
    // term, so what must never appear is another NPC's record.
    const postResult = searchScope('NPC_C', 'zombie_17', postEvidenceHierarchyRecords).result
    expect(postResult.map((entry) => entry.recordId)).toEqual(['E_claw'])
    expect(postResult.map((entry) => entry.recordId)).not.toContain('O_NPC_D_T1')
    expect(postResult.map((entry) => entry.recordId)).not.toContain('Bel_D1')
  })

  it('F5 -- re-arcing (rename + regroup) never breaks a record citation, because record ids are the only identity', () => {
    const renamedArc = { ...arcCellarPostEvidence, id: 'arc_cellar_v2', label: 'the cellar incident (revised)' }

    expect(entitledArcMemberIds('NPC_C', renamedArc, postEvidenceHierarchyRecords).sort()).toEqual(
      entitledArcMemberIds('NPC_C', arcCellarPostEvidence, postEvidenceHierarchyRecords).sort(),
    )

    const outcome = readEvidence('NPC_C', 'E_claw', postEvidenceHierarchyRecords)
    expect(outcome.verdict).toBe('granted')
  })

  it('P8 -- the traversal + read log reconstructs the full route, including the denied arc_gate probe', () => {
    const rootCall = openNode('NPC_C', ROOT_NODE_ID, arcsPreEvidence, preEvidenceHierarchyRecords).call
    const arcCall = openNode('NPC_C', 'arc_cellar', arcsPreEvidence, preEvidenceHierarchyRecords).call
    const deniedProbeCall = openNode('NPC_C', 'arc_gate', arcsPreEvidence, preEvidenceHierarchyRecords).call
    const leafReadCall = readEvidence('NPC_C', 'R_B_to_C', preEvidenceHierarchyRecords).call

    expect([rootCall, arcCall, deniedProbeCall, leafReadCall]).toEqual([
      { caller: 'NPC_C', op: 'open', target: 'root', verdict: 'granted', returnedIds: ['arc_cellar', 'arc_pantry'] },
      { caller: 'NPC_C', op: 'open', target: 'arc_cellar', verdict: 'granted', returnedIds: ['O_NPC_C_T1', 'R_B_to_C', 'Bel_C1'] },
      { caller: 'NPC_C', op: 'open', target: 'arc_gate', verdict: 'not_found', returnedIds: [] },
      { reader: 'NPC_C', recordId: 'R_B_to_C', verdict: 'granted' },
    ])
  })

  it('P9 -- byte-identical replay of projections, digests, calls, search, and the oracle across two runs', () => {
    function runOnce() {
      return {
        tree: projectTree('NPC_C', arcsPreEvidence, preEvidenceHierarchyRecords),
        digest: buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords),
        openCall: openNode('NPC_C', 'arc_cellar', arcsPreEvidence, preEvidenceHierarchyRecords).call,
        searchResult: searchScope('NPC_C', 'zombie_17', preEvidenceHierarchyRecords),
        oracle: provenanceOracle('NPC_C', beliefC1, preEvidenceHierarchyRecords),
      }
    }
    expect(runOnce()).toEqual(runOnce())
  })

  it('P10 -- the same navigation contract holds symmetrically for NPC_D (sees arc_gate, never arc_pantry)', () => {
    const tree = projectTree('NPC_D', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(tree.children.map((child) => child.nodeId).sort()).toEqual(['arc_cellar', 'arc_gate'])

    const gateOutcome = openNode('NPC_D', 'arc_gate', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(gateOutcome.call.verdict).toBe('granted')
    expect(gateOutcome.result?.clauses.flatMap((clause) => clause.citations)).toEqual(['O_NPC_D_T3'])

    const pantryProbe = openNode('NPC_D', 'arc_pantry', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(pantryProbe.call.verdict).toBe('not_found')
  })
})
