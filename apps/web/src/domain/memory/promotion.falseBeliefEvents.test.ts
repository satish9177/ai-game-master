import { describe, expect, it } from 'vitest'
import { WorldEventSchema } from '../world/events'
import { importanceFor, promoteWorldEvent } from './promotion'

const payloads = {
  'evidence-discovered': { roomId: 'room', evidenceId: 'evidence', sourceObjectId: 'source' },
  'evidence-presented': {
    roomId: 'room', evidenceId: 'evidence', toNpcId: 'npc',
    presentationObjectId: 'presentation',
    discoveryEventId: '10000000-0000-4000-8000-000000000001',
  },
  'npc-action-retracted': {
    npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
    ruleId: 'rule', defeatedPremiseId: 'p4-no-alternate-access', evidenceId: 'evidence',
    supersedesEventId: '10000000-0000-4000-8000-000000000001',
    supportingEventIds: ['10000000-0000-4000-8000-000000000001'],
  },
} as const

describe('false-belief event memory classification', () => {
  it.each(Object.entries(payloads))('%s remains non-promotable', (type, payload) => {
    const event = WorldEventSchema.parse({
      schemaVersion: 1, eventId: '20000000-0000-4000-8000-000000000001',
      sessionId: '30000000-0000-4000-8000-000000000001', seq: 1,
      occurredAt: '2026-01-01T00:00:00.000Z', type, payload,
    })
    expect(importanceFor(event)).toBe(0)
    expect(promoteWorldEvent(event, { worldId: 'world' })).toBeNull()
  })
})
