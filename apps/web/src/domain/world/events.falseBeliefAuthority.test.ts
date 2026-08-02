import { describe, expect, it } from 'vitest'
import { WorldCommandSchema, WorldEventSchema } from './events'

const envelope = {
  schemaVersion: 1,
  eventId: '10000000-0000-4000-8000-000000000001',
  sessionId: '20000000-0000-4000-8000-000000000001',
  seq: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
}

describe('false-belief authority event and command schemas', () => {
  it.each([
    ['evidence-discovered', { roomId: 'room', evidenceId: 'evidence', sourceObjectId: 'source' }],
    ['evidence-presented', {
      roomId: 'room', evidenceId: 'evidence', toNpcId: 'npc',
      presentationObjectId: 'presentation', discoveryEventId: envelope.eventId,
    }],
    ['npc-action-retracted', {
      npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
      ruleId: 'authority-rule', defeatedPremiseId: 'p4-no-alternate-access',
      evidenceId: 'evidence', supersedesEventId: envelope.eventId,
      supportingEventIds: [envelope.eventId],
    }],
  ] as const)('%s is strict', (type, payload) => {
    expect(WorldEventSchema.safeParse({ ...envelope, type, payload }).success).toBe(true)
    expect(WorldEventSchema.safeParse({
      ...envelope, type, payload: { ...payload, extra: true },
    }).success).toBe(false)
  })

  it('rejects a successor belief from a retraction event', () => {
    expect(WorldEventSchema.safeParse({
      ...envelope,
      type: 'npc-action-retracted',
      payload: {
        npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
        ruleId: 'authority-rule', defeatedPremiseId: 'p4-no-alternate-access',
        evidenceId: 'evidence', supersedesEventId: envelope.eventId,
        supportingEventIds: [envelope.eventId], successorBelief: {},
      },
    }).success).toBe(false)
  })

  it.each(['offstage-item-taken', 'evidence-discovered', 'evidence-presented'])(
    'has no WorldCommand member for %s',
    (type) => expect(WorldCommandSchema.safeParse({ schemaVersion: 1, type }).success).toBe(false),
  )

  it('admits only the provenance-free retraction command shape', () => {
    const command = {
      schemaVersion: 1, type: 'npc-action-retracted', npcId: 'npc', roomId: 'room',
      action: 'bar-exit', targetObjectId: 'exit',
    }
    expect(WorldCommandSchema.parse(command)).toEqual(command)
    expect(WorldCommandSchema.safeParse({ ...command, evidenceId: 'caller-evidence' }).success)
      .toBe(false)
  })
})
