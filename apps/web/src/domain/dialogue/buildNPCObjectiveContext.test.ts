import { describe, expect, it } from 'vitest'
import { buildNPCObjectiveContext } from './buildNPCObjectiveContext'
import type { NPCObjectiveContext } from './contracts'
import type { QuestObjective } from '../quests/questSpec'

function objective(condition: QuestObjective['condition']): QuestObjective {
  return {
    id: 'objective-secret-target',
    text: 'Generated objective text that must not leak',
    condition,
  }
}

describe('buildNPCObjectiveContext', () => {
  it.each([
    [
      'inspect',
      objective({
        kind: 'room-flag',
        roomId: 'generated-room-secret',
        flag: 'interaction:object-secret-target',
      }),
    ],
    [
      'resolve',
      objective({
        kind: 'room-flag',
        roomId: 'generated-room-secret',
        flag: 'encounter:threat-secret-target',
      }),
    ],
    [
      'reach',
      objective({
        kind: 'room-visited',
        roomId: 'generated-room-secret',
      }),
    ],
    [
      'general',
      objective({
        kind: 'room-flag',
        roomId: 'generated-room-secret',
        flag: 'mystery:secret-target',
      }),
    ],
    [
      'general',
      objective({
        kind: 'has-item',
        itemId: 'item-secret-target',
      }),
    ],
    [
      'general',
      objective({
        kind: 'has-status',
        status: 'status-secret-target',
      }),
    ],
  ] satisfies Array<[NPCObjectiveContext['kind'], QuestObjective]>)(
    'maps objective condition to %s without leaking target details',
    (kind, activeObjective) => {
      const context = buildNPCObjectiveContext(activeObjective, 'active')

      expect(context).toEqual({ status: 'active', kind })
      const serialized = JSON.stringify(context)
      expect(serialized).not.toContain(activeObjective.id)
      expect(serialized).not.toContain(activeObjective.text)
      expect(serialized).not.toContain('secret-target')
      expect(serialized).not.toContain('generated-room-secret')
    },
  )

  it('returns undefined when there is no active objective', () => {
    expect(buildNPCObjectiveContext(null, 'active')).toBeUndefined()
  })

  it.each(['active', 'complete'] satisfies NPCObjectiveContext['status'][])(
    'preserves %s status',
    (status) => {
      expect(buildNPCObjectiveContext(objective({
        kind: 'room-visited',
        roomId: 'generated-room-secret',
      }), status)).toEqual({ status, kind: 'reach' })
    },
  )

  it('is deterministic and does not mutate the active objective', () => {
    const activeObjective = objective({
      kind: 'room-flag',
      roomId: 'generated-room-secret',
      flag: 'interaction:object-secret-target',
    })
    const before = structuredClone(activeObjective)

    const first = buildNPCObjectiveContext(activeObjective, 'active')
    const second = buildNPCObjectiveContext(activeObjective, 'active')

    expect(second).toEqual(first)
    expect(activeObjective).toEqual(before)
  })
})
