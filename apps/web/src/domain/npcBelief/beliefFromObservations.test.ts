import { describe, expect, it } from 'vitest'
import type { NpcObservation } from './contracts'
import { deriveNpcBelief } from './beliefFromObservations'

const observation: NpcObservation = {
  schemaVersion: 1,
  observerNpcId: 'herald-asha',
  kind: 'item-taken-from-room',
  roomId: 'throne-room',
  itemId: 'gold-coin',
  fidelity: 'full',
  sourceEventId: '30000000-0000-4000-8000-000000000003',
  sourceSeq: 3,
  occurredAt: '2026-01-01T00:00:03.000Z',
}

describe('deriveNpcBelief', () => {
  it('T8 returns null for no observations', () => {
    expect(deriveNpcBelief([])).toBeNull()
  })

  it('T9 derives the one reachable confidence and provenance', () => {
    expect(deriveNpcBelief([observation])).toEqual({
      schemaVersion: 1,
      holderNpcId: 'herald-asha',
      predicate: 'player-took-item',
      itemId: 'gold-coin',
      roomId: 'throne-room',
      confidence: 'high',
      supportingEventIds: [observation.sourceEventId],
      lastUpdatedSeq: observation.sourceSeq,
    })
  })

  it('T10 is deterministic and uses the newest observation', () => {
    const newest = {
      ...observation,
      itemId: 'newer-item',
      sourceEventId: '30000000-0000-4000-8000-000000000005',
      sourceSeq: 5,
    }
    const input = [newest, observation]
    const first = deriveNpcBelief(input)
    expect(deriveNpcBelief(input)).toEqual(first)
    expect(first?.itemId).toBe('newer-item')
    expect(first?.supportingEventIds).toEqual([observation.sourceEventId, newest.sourceEventId])
  })
})
