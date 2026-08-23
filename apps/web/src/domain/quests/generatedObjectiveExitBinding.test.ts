import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import { meaningfulObjectiveFlagKey } from '../objectPurpose/meaningfulObjectConsequences'
import { meaningfulObjectStateFlagKey } from '../objectPurpose/meaningfulObjectRuntime'
import type { WorldState } from '../world/worldState'
import type { QuestSpec } from './questSpec'
import {
  evaluateGeneratedObjectiveExitGate,
  parseGeneratedObjectiveExitBinding,
  selectGeneratedObjectiveExitBinding,
  validateGeneratedObjectiveExitBinding,
  type GeneratedObjectiveExitBindingContext,
} from './generatedObjectiveExitBinding'

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'room-a',
  name: 'Room',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [
    { id: 'document', type: 'book', position: [0, 0, 0], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
    { id: 'box', type: 'crate', position: [-1, 0, 0], interaction: { key: 'E', prompt: 'Search', effect: { kind: 'take-item', item: { itemId: 'item', name: 'Item', quantity: 1 } } } },
    { id: 'exit-z', type: 'arch', position: [1, 0, 0], width: 2, height: 3, interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'room-a:exit:north' } } },
    { id: 'exit-a', type: 'arch', position: [2, 0, 0], width: 2, height: 3, interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'room-a:exit:east' } } },
  ],
})

const quest: QuestSpec = {
  questId: 'room-a-objective',
  title: 'Objective',
  anchorRoomId: room.id,
  objectives: [{ id: 'generated-0', text: 'Read the document', condition: { kind: 'has-status', status: 'never' } }],
}

const catalog = {
  clues: [],
  consequences: [{
    objectId: 'document',
    action: 'read' as const,
    objective: { objectiveId: 'generated-0', toStage: 1 as const },
  }],
}

function context(overrides: Partial<GeneratedObjectiveExitBindingContext> = {}): GeneratedObjectiveExitBindingContext {
  return {
    generatedPlay: true,
    provenance: 'generated',
    room,
    questSpec: quest,
    consequenceCatalog: catalog,
    independentGate: null,
    ...overrides,
  }
}

function state(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: room.id,
    player: { health: { current: 1, max: 1 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

function withObjects(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({ ...room, objects })
}

describe('generated objective exit binding parser', () => {
  it('accepts the exact shape, trims identifiers, and does not mutate input', () => {
    const input = { objectiveId: ' generated-0 ', exitId: ' exit-a ' }
    const before = JSON.stringify(input)
    expect(parseGeneratedObjectiveExitBinding(input)).toEqual({ objectiveId: 'generated-0', exitId: 'exit-a' })
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([
    { objectiveId: 'generated-0', exitId: 'exit-a', extra: true },
    { objectiveId: ' ', exitId: 'exit-a' },
    { objectiveId: 'generated-0', exitId: ' ' },
    { objectiveId: 'generated-0' },
    { objectiveId: 1, exitId: 'exit-a' },
    null,
    [],
    Object.assign(Object.create({ inherited: true }), { objectiveId: 'generated-0', exitId: 'exit-a' }),
  ])('rejects malformed binding %#', (input) => {
    expect(parseGeneratedObjectiveExitBinding(input)).toBeNull()
  })
})

describe('generated objective exit binding validation', () => {
  const binding = { objectiveId: 'generated-0', exitId: 'exit-a' }

  it('accepts generated provenance, including benign assembly normalizations', () => {
    expect(validateGeneratedObjectiveExitBinding({ ...context(), binding })).toEqual(binding)
    const benignDiagnosticContext = context({
      provenance: 'generated',
      room: { ...room, warnings: ['objects-normalized', 'spawn-normalized', 'exits-normalized', 'aliases-normalized', 'transform-normalized', 'size-normalized'] },
    })
    expect(validateGeneratedObjectiveExitBinding({ ...benignDiagnosticContext, binding })).toEqual(binding)
  })

  it.each(['repaired', 'fallback', 'authored', 'static'] as const)('rejects %s provenance', (provenance) => {
    expect(validateGeneratedObjectiveExitBinding({ ...context({ provenance }), binding })).toBeNull()
  })

  it('rejects non-generated play even with otherwise valid generated data', () => {
    expect(validateGeneratedObjectiveExitBinding({ ...context({ generatedPlay: false }), binding })).toBeNull()
  })

  it('rejects stale objective, stale or duplicate exits, and malformed/return/compound exits', () => {
    expect(validateGeneratedObjectiveExitBinding({ ...context(), binding: { ...binding, objectiveId: 'stale' } })).toBeNull()
    expect(validateGeneratedObjectiveExitBinding({ ...context(), binding: { ...binding, exitId: 'missing' } })).toBeNull()
    const duplicate = withObjects([...room.objects, { ...room.objects[3]! }])
    expect(validateGeneratedObjectiveExitBinding({ ...context({ room: duplicate }), binding })).toBeNull()
    const malformed = withObjects(room.objects.map((object) => object.id === 'exit-a'
      ? { ...object, interaction: { ...object.interaction!, exit: { toRoomId: 'other:exit:east' } } }
      : object))
    expect(validateGeneratedObjectiveExitBinding({ ...context({ room: malformed }), binding })).toBeNull()
    const returned = withObjects(room.objects.map((object) => object.id === 'exit-a'
      ? { ...object, id: 'room-a:return-exit:south', interaction: { ...object.interaction!, exit: { toRoomId: 'room-a:exit:south' } } }
      : object))
    expect(validateGeneratedObjectiveExitBinding({ ...context({ room: returned }), binding: { ...binding, exitId: 'room-a:return-exit:south' } })).toBeNull()
    for (const key of ['encounter', 'dialogue', 'effect'] as const) {
      const compound = withObjects(room.objects.map((object) => object.id === 'exit-a'
        ? { ...object, interaction: { ...object.interaction!, [key]: key === 'effect' ? { kind: 'inspect' } : { id: 'x', type: 'combat', enemyId: 'x' } } }
        : object))
      expect(validateGeneratedObjectiveExitBinding({ ...context({ room: compound }), binding })).toBeNull()
    }
  })

  it('rejects invalid, missing, multiple, or independently governed objective routes', () => {
    expect(validateGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: null }), binding })).toBeNull()
    expect(validateGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: { clues: [], consequences: [] } }), binding })).toBeNull()
    expect(validateGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: { ...catalog, consequences: [...catalog.consequences, { ...catalog.consequences[0]!, objectId: 'document', action: 'search' }] } }), binding })).toBeNull()
    const gated = {
      id: 'gate', kind: 'locked-exit' as const,
      condition: { kind: 'room-flag' as const, roomId: room.id, flag: 'x' },
      effect: { kind: 'unlock-exit' as const, toRoomId: 'room-a:exit:east' },
    }
    const gateRoom = withObjects([...room.objects, { id: 'machine', type: 'machine', position: [3, 0, 0], interaction: { key: 'E', prompt: 'Use', effect: { kind: 'inspect', flag: 'x' } } }])
    expect(validateGeneratedObjectiveExitBinding({ ...context({ room: gateRoom, independentGate: gated }), binding })).toBeNull()
  })
})

describe('generated objective exit binding selection', () => {
  it('requires explicit true intent and sorts target then exit id independently of object order', () => {
    expect(selectGeneratedObjectiveExitBinding({ ...context(), progressUnlocksExit: false })).toBeNull()
    expect(selectGeneratedObjectiveExitBinding({ ...context(), progressUnlocksExit: true })).toEqual({ objectiveId: 'generated-0', exitId: 'exit-a' })
    const reordered = withObjects([...room.objects].reverse())
    expect(selectGeneratedObjectiveExitBinding({ ...context({ room: reordered }), progressUnlocksExit: true })).toEqual({ objectiveId: 'generated-0', exitId: 'exit-a' })
    const targetFirst = withObjects(room.objects.map((object) => object.id === 'exit-a'
      ? { ...object, interaction: { ...object.interaction!, exit: { toRoomId: 'room-a:exit:north' } } }
      : object.id === 'exit-z'
        ? { ...object, interaction: { ...object.interaction!, exit: { toRoomId: 'room-a:exit:east' } } }
        : object))
    expect(selectGeneratedObjectiveExitBinding({ ...context({ room: targetFirst }), progressUnlocksExit: true }))
      .toEqual({ objectiveId: 'generated-0', exitId: 'exit-z' })
  })

  it('does not depend on consequence/proposal order', () => {
    const withClue = {
      clues: [{ id: 'clue', sourceObjectId: 'box' }],
      consequences: [
        ...catalog.consequences,
        { objectId: 'box', action: 'search' as const, clueId: 'clue' },
      ],
    }
    const reversed = { ...withClue, consequences: [...withClue.consequences].reverse() }
    expect(selectGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: withClue }), progressUnlocksExit: true }))
      .toEqual({ objectiveId: 'generated-0', exitId: 'exit-a' })
    expect(selectGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: reversed }), progressUnlocksExit: true }))
      .toEqual({ objectiveId: 'generated-0', exitId: 'exit-a' })
  })

  it('excludes returns and settled independent gates, revalidates selection, and fails closed without candidates', () => {
    const onlyReturn = withObjects(room.objects.filter((object) => object.id !== 'exit-a').map((object) => object.id === 'exit-z'
      ? { ...object, id: 'room-a:return-exit:north' }
      : object))
    expect(selectGeneratedObjectiveExitBinding({ ...context({ room: onlyReturn }), progressUnlocksExit: true })).toBeNull()
    const gated = {
      id: 'gate', kind: 'locked-exit' as const,
      condition: { kind: 'room-flag' as const, roomId: room.id, flag: 'x' },
      effect: { kind: 'unlock-exit' as const, toRoomId: 'room-a:exit:east' },
    }
    const gateRoom = withObjects([...room.objects, { id: 'machine', type: 'machine', position: [3, 0, 0], interaction: { key: 'E', prompt: 'Use', effect: { kind: 'inspect', flag: 'x' } } }])
    expect(selectGeneratedObjectiveExitBinding({ ...context({ room: gateRoom, independentGate: gated }), progressUnlocksExit: true })).toEqual({ objectiveId: 'generated-0', exitId: 'exit-z' })
    expect(selectGeneratedObjectiveExitBinding({ ...context({ consequenceCatalog: { clues: [], consequences: [] } }), progressUnlocksExit: true })).toBeNull()
  })
})

describe('generated objective exit gate evaluation', () => {
  const binding = { objectiveId: 'generated-0', exitId: 'exit-a' }

  it('blocks only the selected exit while incomplete and opens it once evaluateQuest reports completion', () => {
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-a', binding, state: state() }))
      .toEqual({ gated: true, reason: 'objective-incomplete' })
    const complete = state({ roomStates: { [room.id]: { visited: true, flags: { [meaningfulObjectiveFlagKey(quest.questId, 'generated-0')]: true } } } })
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-a', binding, state: complete })).toEqual({ gated: false })
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-z', binding, state: state() })).toEqual({ gated: false })
  })

  it('fails open for missing/invalid bindings, independent-gate conflicts, and terminal stranded sources', () => {
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-a', binding: null, state: state() })).toEqual({ gated: false })
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-a', binding: { objectiveId: 'stale', exitId: 'exit-a' }, state: state() })).toEqual({ gated: false })
    const terminal = state({ roomStates: { [room.id]: { visited: true, flags: { [meaningfulObjectStateFlagKey('document', 'read')]: true } } } })
    expect(evaluateGeneratedObjectiveExitGate({ ...context(), attemptedExitId: 'exit-a', binding, state: terminal })).toEqual({ gated: false })
    const independentGate = {
      id: 'gate', kind: 'locked-exit' as const,
      condition: { kind: 'room-flag' as const, roomId: room.id, flag: 'x' },
      effect: { kind: 'unlock-exit' as const, toRoomId: 'room-a:exit:east' },
    }
    const gateRoom = withObjects([...room.objects, { id: 'machine', type: 'machine', position: [3, 0, 0], interaction: { key: 'E', prompt: 'Use', effect: { kind: 'inspect', flag: 'x' } } }])
    expect(evaluateGeneratedObjectiveExitGate({ ...context({ room: gateRoom, independentGate }), attemptedExitId: 'exit-a', binding, state: state() })).toEqual({ gated: false })
  })

  it('is deterministic, idempotent, and does not mutate any input', () => {
    const input = { ...context(), attemptedExitId: 'exit-a', binding, state: state() }
    const before = JSON.stringify(input)
    expect(evaluateGeneratedObjectiveExitGate(input)).toEqual(evaluateGeneratedObjectiveExitGate(input))
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('generated objective exit binding runtime boundary', () => {
  const sourceModules = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  it('has no production runtime caller in Slice 1', () => {
    const callers = Object.entries(sourceModules).filter(([path, source]) =>
      !path.endsWith('.test.ts')
      && !path.endsWith('generatedObjectiveExitBinding.ts')
      && /from\s+['"][^'"]*generatedObjectiveExitBinding['"]/.test(source),
    )
    expect(callers).toEqual([])
  })
})
