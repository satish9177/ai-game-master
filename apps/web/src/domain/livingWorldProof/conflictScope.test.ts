import { describe, expect, it } from 'vitest'
import { edgeVisible, explainTransition, readConflictRecord, transitionVisible } from './conflictScope'
import { buildConflictScenario } from './conflictScenario'
import { buildIndexMap } from './indexMap'
import { buildDigest, renderExplanation } from './digest'
import { readable } from './evidenceRecords'
import { clawEvidence } from './scenario'
import { beliefC1, beliefC1Prime } from './compactionScenario'

/**
 * Scope and existence hiding for conflict records (ADR-0008 D10, spec
 * conflict-edge-replay-v0.md §1.10). Covers P9 (transition-directed
 * explanation), P12 (NPC_B cannot see or infer NPC_C's correction), and
 * N8 (hidden existence never leaks through unrelated surfaces).
 */

describe('P9 -- transition-directed explanation', () => {
  it("assembles NPC_C's explanation from old belief -> evidence -> new belief, every citation scope-readable", () => {
    const scenario = buildConflictScenario()
    const outcome = explainTransition('NPC_C', scenario.transitionId, scenario.store, scenario.universe)
    expect(outcome.verdict).toBe('granted')
    if (outcome.verdict !== 'granted') throw new Error('unreachable')

    expect(outcome.clauses).toHaveLength(3)
    expect(outcome.clauses[0]?.citations).toEqual([beliefC1.id])
    expect(outcome.clauses[1]?.citations).toEqual([clawEvidence.id])
    expect(outcome.clauses[2]?.citations).toEqual([beliefC1Prime.id])
    expect(outcome.citations.every((citation) => citation.verdict === 'granted')).toBe(true)
    expect(renderExplanationText(outcome.clauses)).toContain('zombie_17')
  })

  it('is denied to a non-holder', () => {
    const scenario = buildConflictScenario()
    expect(explainTransition('NPC_B', scenario.transitionId, scenario.store, scenario.universe)).toEqual({ verdict: 'denied' })
  })
})

function renderExplanationText(clauses: readonly { text: string }[]): string {
  return clauses.map((clause) => clause.text).join(' ')
}

describe('P12 / N7 -- NPC_B cannot read or infer NPC_C\'s correction', () => {
  it('the edge is invisible to NPC_B (neither endpoint carrier is readable to B)', () => {
    const scenario = buildConflictScenario()
    const [edge] = scenario.store.edges
    expect(edge).toBeDefined()
    if (edge === undefined) throw new Error('unreachable')
    expect(edgeVisible('NPC_B', edge, scenario.universe, scenario.store.claims)).toBe(false)
    expect(edgeVisible('NPC_C', edge, scenario.universe, scenario.store.claims)).toBe(true)
  })

  it('the transition is invisible to NPC_B -- visible only to its own holder', () => {
    const scenario = buildConflictScenario()
    const [transition] = scenario.store.transitions
    expect(transition).toBeDefined()
    if (transition === undefined) throw new Error('unreachable')
    expect(transitionVisible('NPC_B', transition)).toBe(false)
    expect(transitionVisible('NPC_C', transition)).toBe(true)
  })

  it('readConflictRecord denies NPC_B for both the edge and the transition, and explainTransition is denied to NPC_B', () => {
    const scenario = buildConflictScenario()
    const edgeRead = readConflictRecord('NPC_B', scenario.conflictEdgeId, scenario.store, scenario.universe)
    const transitionRead = readConflictRecord('NPC_B', scenario.transitionId, scenario.store, scenario.universe)
    expect(edgeRead.verdict).toBe('denied')
    expect(transitionRead.verdict).toBe('denied')
  })
})

describe('N8 -- hidden existence does not leak through unrelated surfaces or through the denied-read shape', () => {
  it('a hidden transition id and a nonexistent id produce the identically-shaped denied outcome -- no existence oracle', () => {
    const scenario = buildConflictScenario()
    const hidden = readConflictRecord('NPC_B', scenario.transitionId, scenario.store, scenario.universe)
    const nonexistent = readConflictRecord('NPC_B', 'BT_does_not_exist', scenario.store, scenario.universe)
    expect(hidden.verdict).toBe('denied')
    expect(nonexistent.verdict).toBe('denied')
    expect(Object.keys(hidden).sort()).toEqual(Object.keys(nonexistent).sort())
    expect(Object.keys(hidden.call).sort()).toEqual(Object.keys(nonexistent.call).sort())
    expect(hidden.call.verdict).toBe(nonexistent.call.verdict)
  })

  it('NPC_B\'s index map, digest, and readable set never reference the conflict edge or transition ids', () => {
    const scenario = buildConflictScenario()
    const indexMap = buildIndexMap('NPC_B', scenario.universe)
    const digest = buildDigest('NPC_B', indexMap)
    const readableIds = readable('NPC_B', scenario.universe).map((entry) => entry.record.id)

    const forbiddenIds = [scenario.conflictEdgeId, scenario.transitionId]
    expect(indexMap.some((entry) => forbiddenIds.includes(entry.recordId))).toBe(false)
    expect(readableIds.some((id) => forbiddenIds.includes(id))).toBe(false)
    expect(renderExplanation(digest)).not.toContain(scenario.conflictEdgeId)
    expect(renderExplanation(digest)).not.toContain(scenario.transitionId)
  })

  it('the redacted transition view exposes no adjudication key, rule identity/version, or commit sequence', () => {
    const scenario = buildConflictScenario()
    const read = readConflictRecord('NPC_C', scenario.transitionId, scenario.store, scenario.universe)
    expect(read.verdict).toBe('granted')
    if (read.verdict !== 'granted' || read.record.kind !== 'transition') throw new Error('unreachable')
    expect(Object.keys(read.record.view).sort()).toEqual(
      ['citedEvidenceIds', 'cause', 'effectiveValidTime', 'fromBeliefId', 'toBeliefId', 'transitionId'].sort(),
    )
  })
})
