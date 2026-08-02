import { describe, expect, it } from 'vitest'
import { WorldEventSchema } from './events'

const validEvent = {
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000003',
  sessionId: '00000000-0000-4000-8000-000000000002',
  seq: 2,
  occurredAt: '2026-08-02T10:00:01.000Z',
  type: 'offstage-item-taken',
  payload: {
    roomId: 'heralds-hall',
    containerId: 'offering-coffer',
    itemId: 'gold-coin',
    actorId: 'night-porter',
    ruleId: 'false-belief/offstage-removal@1',
    concealed: true,
  },
} as const

describe('offstageTruth event schema', () => {
  it('accepts and preserves the exact authoritative concealed-truth event', () => {
    const parsed = WorldEventSchema.parse(validEvent)

    expect(parsed).toEqual(validEvent)
    expect(parsed.type === 'offstage-item-taken' && parsed.payload.actorId)
      .toBe('night-porter')
  })

  it.each([
    'roomId',
    'containerId',
    'itemId',
    'actorId',
    'ruleId',
  ] as const)('rejects an empty %s', (field) => {
    expect(WorldEventSchema.safeParse({
      ...validEvent,
      payload: { ...validEvent.payload, [field]: '' },
    }).success).toBe(false)
  })

  it('requires actorId and literal concealed true', () => {
    const { actorId: _actorId, ...withoutActorId } = validEvent.payload
    const { concealed: _concealed, ...withoutConcealed } = validEvent.payload
    void _actorId
    void _concealed

    expect(WorldEventSchema.safeParse({
      ...validEvent,
      payload: withoutActorId,
    }).success).toBe(false)
    expect(WorldEventSchema.safeParse({
      ...validEvent,
      payload: withoutConcealed,
    }).success).toBe(false)
    expect(WorldEventSchema.safeParse({
      ...validEvent,
      payload: { ...validEvent.payload, concealed: false },
    }).success).toBe(false)
  })

  it('rejects unknown payload and event-envelope keys', () => {
    expect(WorldEventSchema.safeParse({
      ...validEvent,
      payload: { ...validEvent.payload, extra: true },
    }).success).toBe(false)
    expect(WorldEventSchema.safeParse({ ...validEvent, extra: true }).success).toBe(false)
  })
})
