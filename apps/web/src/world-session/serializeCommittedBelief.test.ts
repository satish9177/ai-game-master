import { describe, expect, it } from 'vitest'
import type { NpcBeliefV1, NpcBeliefV2 } from '../domain/npcBelief/beliefVersions'
import { serializeCommittedBelief } from './serializeCommittedBelief'

const SUPPORT_ID = '10000000-0000-4000-8000-000000000001'
const v1: NpcBeliefV1 = {
  schemaVersion: 1, holderNpcId: 'npc', predicate: 'player-took-item', itemId: 'item',
  roomId: 'room', confidence: 'high', supportingEventIds: [SUPPORT_ID], lastUpdatedSeq: 1,
}
const v2: NpcBeliefV2 = {
  schemaVersion: 2, holderNpcId: 'npc', predicate: 'player-took-item', itemId: 'item',
  roomId: 'room', confidence: 'low', supportingEventIds: [SUPPORT_ID], lastUpdatedSeq: 1,
  warrant: {
    ruleId: 'sole-copresent-candidate@1',
    premises: [{
      id: 'p4-no-alternate-access', kind: 'default', observationEventIds: [], defeasible: true,
    }],
    defeasiblePremiseIds: ['p4-no-alternate-access'],
  },
}

describe('serializeCommittedBelief', () => {
  it('serializes V1 byte-identically to the baseline payload', () => {
    expect(JSON.stringify(serializeCommittedBelief(v1))).toBe(JSON.stringify({
      predicate: 'player-took-item', itemId: 'item', roomId: 'room', confidence: 'high',
    }))
  })

  it('serializes V2 exactly while preserving warrant ordering and input identity', () => {
    const before = JSON.stringify(v2)
    expect(serializeCommittedBelief(v2)).toEqual({
      beliefSchemaVersion: 2,
      predicate: 'player-took-item',
      itemId: 'item',
      roomId: 'room',
      confidence: 'low',
      warrant: v2.warrant,
    })
    expect(JSON.stringify(v2)).toBe(before)
  })
})
