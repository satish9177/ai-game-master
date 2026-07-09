import { describe, expect, it } from 'vitest'
import { arcsPreEvidence, arcsPostEvidence, postEvidenceHierarchyRecords, preEvidenceHierarchyRecords } from './hierarchyScenario'
import { listChildren, openNode, projectTree, renderPath, ROOT_NODE_ID, searchScope } from './hierarchyNavigation'

describe('projectTree', () => {
  it("NPC_C's tree contains arc_cellar and arc_pantry, never arc_gate (P1)", () => {
    const tree = projectTree('NPC_C', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(tree.children.map((child) => child.nodeId).sort()).toEqual(['arc_cellar', 'arc_pantry'])
  })

  it("NPC_D's tree contains arc_cellar and arc_gate, never arc_pantry (P10)", () => {
    const tree = projectTree('NPC_D', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(tree.children.map((child) => child.nodeId).sort()).toEqual(['arc_cellar', 'arc_gate'])
  })

  it('the root digest cites exactly the visible arc ids, one clause each', () => {
    const tree = projectTree('NPC_C', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(tree.rootDigest.clauses.map((clause) => clause.citations)).toEqual([['arc_cellar'], ['arc_pantry']])
    expect(tree.rootDigest.asOf).toEqual(['arc_cellar', 'arc_pantry'])
  })

  it('is deterministic and does not mutate its inputs', () => {
    const snapshot = structuredClone(arcsPreEvidence)
    expect(projectTree('NPC_C', arcsPreEvidence, preEvidenceHierarchyRecords)).toEqual(
      projectTree('NPC_C', arcsPreEvidence, preEvidenceHierarchyRecords),
    )
    expect(arcsPreEvidence).toEqual(snapshot)
  })
})

describe('listChildren', () => {
  it('lists root children within scope, logging the call', () => {
    const outcome = listChildren('NPC_C', ROOT_NODE_ID, arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(outcome.result.map((child) => child.nodeId).sort()).toEqual(['arc_cellar', 'arc_pantry'])
    expect(outcome.call).toEqual({
      caller: 'NPC_C',
      op: 'list',
      target: ROOT_NODE_ID,
      verdict: 'granted',
      returnedIds: outcome.result.map((child) => child.nodeId),
    })
  })

  it('F3 -- listing a node NPC_C has no entitlement under returns not_found, not a locked-but-visible result', () => {
    const outcome = listChildren('NPC_C', 'arc_gate', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(outcome.result).toEqual([])
    expect(outcome.call.verdict).toBe('not_found')
  })

  it('a hidden node and a nonexistent node id produce the identical not_found verdict', () => {
    const hidden = listChildren('NPC_C', 'arc_gate', arcsPreEvidence, preEvidenceHierarchyRecords)
    const nonexistent = listChildren('NPC_C', 'arc_does_not_exist', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(nonexistent.call.verdict).toBe(hidden.call.verdict)
    expect(nonexistent.result).toEqual(hidden.result)
  })
})

describe('openNode', () => {
  it('opens root and returns the projected root digest', () => {
    const outcome = openNode('NPC_C', ROOT_NODE_ID, arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(outcome.call.verdict).toBe('granted')
    expect(outcome.result?.clauses.map((clause) => clause.citations[0])).toEqual(['arc_cellar', 'arc_pantry'])
  })

  it('opens arc_cellar for NPC_C and returns exactly her three entitled leaf citations', () => {
    const outcome = openNode('NPC_C', 'arc_cellar', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(outcome.call.verdict).toBe('granted')
    expect(outcome.result?.clauses.flatMap((clause) => clause.citations).sort()).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'])
  })

  it('F3 -- opening arc_gate for NPC_C is not_found, and no digest is returned', () => {
    const outcome = openNode('NPC_C', 'arc_gate', arcsPreEvidence, preEvidenceHierarchyRecords)
    expect(outcome.call.verdict).toBe('not_found')
    expect(outcome.result).toBeUndefined()
  })

  it('P3 -- no TruthEvent id ever appears in any digest citation, for any NPC, at any node', () => {
    for (const npc of ['NPC_A', 'NPC_B', 'NPC_C', 'NPC_D']) {
      for (const nodeId of [ROOT_NODE_ID, 'arc_cellar', 'arc_pantry', 'arc_gate']) {
        const outcome = openNode(npc, nodeId, arcsPostEvidence, postEvidenceHierarchyRecords)
        const citations = outcome.result?.clauses.flatMap((clause) => clause.citations) ?? []
        expect(citations).not.toContain('T0')
        expect(citations).not.toContain('T1')
        expect(citations).not.toContain('T2')
        expect(citations).not.toContain('T3')
      }
    }
  })
})

describe('searchScope', () => {
  it("F4 -- NPC_D's search for 'zombie_17' finds her own full-sight observation and the belief it grounded; NPC_C finds nothing", () => {
    const dResult = searchScope('NPC_D', 'zombie_17', preEvidenceHierarchyRecords)
    expect(dResult.result.map((entry) => entry.recordId).sort()).toEqual(['Bel_D1', 'O_NPC_D_T1'])

    const cResult = searchScope('NPC_C', 'zombie_17', preEvidenceHierarchyRecords)
    expect(cResult.result).toEqual([])
  })

  it('an observation match never leaks the matched perceived field into its returned description (D6)', () => {
    const dResult = searchScope('NPC_D', 'zombie_17', preEvidenceHierarchyRecords)
    const observationMatch = dResult.result.find((entry) => entry.recordId === 'O_NPC_D_T1')
    expect(observationMatch).toBeDefined()
    expect(observationMatch?.description).not.toContain('zombie_17')
  })

  it('the search call always succeeds; scope filters the result, not the operation itself', () => {
    expect(searchScope('NPC_C', 'zombie_17', preEvidenceHierarchyRecords).call).toEqual({
      caller: 'NPC_C',
      op: 'search',
      target: 'zombie_17',
      verdict: 'granted',
      returnedIds: [],
    })
  })
})

describe('renderPath', () => {
  it('P4 -- is a display-only rendering, unrelated to citation identity', () => {
    expect(renderPath([ROOT_NODE_ID, 'arc_cellar'])).toBe('root/arc_cellar')
    expect(renderPath([ROOT_NODE_ID, 'the_cellar_incident_renamed'])).toBe('root/the_cellar_incident_renamed')
  })
})
