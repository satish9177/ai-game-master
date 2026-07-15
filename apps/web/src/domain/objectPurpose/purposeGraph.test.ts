import { describe, expect, it } from 'vitest'
import { buildPurposeGraph, purposeGraphNodeId } from './purposeGraph'
import type { ObjectPurpose } from './contracts'

const purpose: ObjectPurpose = { objectId: 'document', category: 'lore', required: true, affordances: [{ id: 'read', action: 'read', repeat: 'once', preconditions: [{ kind: 'has-item', itemId: 'lens' }], effects: [{ kind: 'reveal-clue', clueId: 'map' }] }] }

describe('buildPurposeGraph', () => {
  it('derives requires and provides edges from affordance data', () => {
    expect(buildPurposeGraph([purpose])).toEqual({
      nodes: [
        { id: 'affordance:document:read', kind: 'affordance' },
        { id: 'clue:map', kind: 'clue' },
        { id: 'item:lens', kind: 'item' },
      ],
      edges: [
        { from: 'affordance:document:read', to: 'clue:map', kind: 'provides' },
        { from: 'item:lens', to: 'affordance:document:read', kind: 'requires' },
      ],
    })
  })
  it('reuses equivalent nodes and does not mutate input', () => {
    const snapshot = structuredClone([purpose])
    const graph = buildPurposeGraph([purpose, { ...purpose, objectId: 'second', affordances: [{ ...purpose.affordances[0]!, id: 'search' }] }])
    expect(graph.nodes.filter((node) => node.id === 'item:lens')).toHaveLength(1)
    expect([purpose]).toEqual(snapshot)
  })
  it('uses namespaced, collision-safe canonical ids', () => {
    expect(purposeGraphNodeId.affordance('a:b', 'c:d')).toBe('affordance:a%3Ab:c%3Ad')
    expect(purposeGraphNodeId.roomFlag('r', 'f', false)).toBe('room-flag:r:f=false')
    expect(purposeGraphNodeId.objectState('o', 'open')).toBe('object-state:o:open')
    expect(purposeGraphNodeId.item('i')).toBe('item:i')
    expect(purposeGraphNodeId.clue('c')).toBe('clue:c')
    expect(purposeGraphNodeId.objectiveStage('q', 2)).toBe('objective-stage:q:2')
    expect(purposeGraphNodeId.exit('e')).toBe('exit:e')
  })
})
