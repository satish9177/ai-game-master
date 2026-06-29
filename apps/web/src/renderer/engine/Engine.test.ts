import { describe, expect, it, vi } from 'vitest'
import { loadRoomSpec } from '../../domain/loadRoomSpec'
import { buildInteractables } from '../../domain/ports/interaction'
import { assembleRoom } from '../../domain/assembleRoom'
import { fallbackRoom } from '../../domain/examples/fallbackRoom'
import { Engine } from './Engine'

const fallback = loadRoomSpec(fallbackRoom)
const INSPECT_BODY = 'You inspect it carefully, but do not take anything.'

const encounter = {
  id: 'threat',
  title: 'Threat',
  description: 'A threat blocks the way.',
  choices: [{
    id: 'run',
    action: 'run',
    label: 'Run',
    outcome: { effects: [] },
  }],
}

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'affordance-room',
  name: 'Affordance Room',
  shell: {
    dimensions: { width: 12, depth: 12, height: 4 },
  },
  spawn: { position: [0, 1.6, 0], yaw: 0 },
  objects: [
    {
      id: 'exit',
      type: 'arch',
      position: [0, 0, -4],
      interaction: { key: 'E', prompt: 'Enter the archway', exit: { toRoomId: 'next' } },
    },
    {
      id: 'dialogue',
      type: 'statue',
      position: [1, 0, -4],
      interaction: { key: 'F', prompt: 'Ask the statue', dialogue: { greeting: 'Hello.' } },
    },
    {
      id: 'npc',
      type: 'npc',
      name: 'Survivor',
      position: [2, 0, -4],
      interaction: { key: 'F', prompt: 'Speak with survivor' },
    },
    {
      id: 'encounter',
      type: 'zombie',
      position: [3, 0, -4],
      interaction: { key: 'F', prompt: 'Face the threat', encounter },
    },
    {
      id: 'inspect',
      type: 'scroll',
      position: [4, 0, -4],
      interaction: { key: 'E', prompt: 'Read the note', effect: { kind: 'inspect' } },
    },
    {
      id: 'take',
      type: 'chest',
      position: [5, 0, -4],
      interaction: {
        key: 'E',
        prompt: 'Gather supplies',
        effect: {
          kind: 'take-item',
          item: { itemId: 'bandage', name: 'Bandage', quantity: 1 },
        },
      },
    },
    {
      id: 'use',
      type: 'machine',
      position: [6, 0, -4],
      interaction: {
        key: 'E',
        prompt: 'Use medkit',
        effect: { kind: 'use-item', itemId: 'medkit', quantity: 1 },
      },
    },
    {
      id: 'body-only',
      type: 'chest',
      position: [7, 0, -4],
      interaction: { key: 'E', prompt: 'Open chest', body: 'A locked chest.' },
    },
    {
      id: 'visual-only',
      type: 'crate',
      position: [8, 0, -4],
    },
  ],
})

describe('buildInteractables', () => {
  it('adds deterministic affordances to Engine interactable view models', () => {
    const byId = new Map(buildInteractables(room).map((interactable) => [
      interactable.id,
      interactable,
    ]))

    expect(byId.get('exit')?.affordance).toBe('exit')
    expect(byId.get('dialogue')?.affordance).toBe('talk')
    expect(byId.get('npc')?.affordance).toBe('talk')
    expect(byId.get('encounter')?.affordance).toBe('approach')
    expect(byId.get('inspect')?.affordance).toBe('inspect')
    expect(byId.get('take')?.affordance).toBe('take')
    expect(byId.get('use')?.affordance).toBe('use')
    expect(byId.get('body-only')?.affordance).toBe('inspect')
    expect(byId.has('visual-only')).toBe(false)
  })


  it('carries synthesized generated-room title and body without using generated object names as titles', () => {
    const leakedName = 'ProviderTrace raw-json {"prompt":"steal-name"} generated_object_name'
    const result = assembleRoom(JSON.stringify({
      schemaVersion: 1,
      id: 'generated-port-room',
      name: 'Generated Port Room',
      shell: {
        dimensions: { width: 18, depth: 18, height: 4 },
        exits: [{ side: 'north', width: 3 }],
      },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ id: 'generated-chest', type: 'chest', name: leakedName, position: [2, 0, 0] }],
    }), fallback)

    const interactable = buildInteractables(result.room).find((candidate) => candidate.id === 'generated-chest')

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.purposesAssigned).toBe(1)
    expect(interactable).toMatchObject({
      id: 'generated-chest',
      type: 'chest',
      label: 'chest',
      affordance: 'inspect',
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: INSPECT_BODY,
    })
    expect(interactable?.title).not.toBe(interactable?.label)
    expect(JSON.stringify(interactable)).not.toContain('ProviderTrace')
    expect(JSON.stringify(interactable)).not.toContain('raw-json')
    expect(JSON.stringify(interactable)).not.toContain('steal-name')
    expect(JSON.stringify(interactable)).not.toContain('generated_object_name')
  })

  it('preserves existing interaction view-model fields and precedence data', () => {
    const exit = buildInteractables(room).find((interactable) => interactable.id === 'exit')

    expect(exit).toMatchObject({
      id: 'exit',
      type: 'arch',
      label: 'arch',
      affordance: 'exit',
      key: 'E',
      prompt: 'Enter the archway',
      position: { x: 0, y: 0, z: -4 },
    })
  })

  it('marks an interactable resolved when its object id is in resolvedObjectIds', () => {
    const inspect = buildInteractables(room, new Set(['inspect']))
      .find((interactable) => interactable.id === 'inspect')

    expect(inspect).toMatchObject({
      id: 'inspect',
      affordance: 'inspect',
      prompt: 'Read the note',
      resolved: true,
    })
  })

  it('leaves interactables unresolved when their ids are absent', () => {
    const inspect = buildInteractables(room, new Set(['take']))
      .find((interactable) => interactable.id === 'inspect')

    expect(inspect).toMatchObject({
      id: 'inspect',
      affordance: 'inspect',
      prompt: 'Read the note',
    })
    expect(inspect).not.toHaveProperty('resolved')
  })

  it('keeps existing behavior when resolvedObjectIds is omitted', () => {
    const inspect = buildInteractables(room)
      .find((interactable) => interactable.id === 'inspect')

    expect(inspect).toMatchObject({
      id: 'inspect',
      affordance: 'inspect',
      prompt: 'Read the note',
    })
    expect(inspect).not.toHaveProperty('resolved')
  })

  it('marks only matching interactables as resolved', () => {
    const byId = new Map(buildInteractables(room, new Set(['take'])).map((interactable) => [
      interactable.id,
      interactable,
    ]))

    expect(byId.get('take')?.resolved).toBe(true)
    expect(byId.get('inspect')).not.toHaveProperty('resolved')
    expect(byId.get('use')).not.toHaveProperty('resolved')
    expect(byId.has('visual-only')).toBe(false)
  })
})

describe('Engine.setRoom options', () => {
  it('passes resolvedObjectIds through so matching interactables become resolved', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const interactables: ReturnType<typeof buildInteractables> = []
    const fakeEngine = {
      room: null,
      scene: { add: vi.fn() },
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this
        },
      },
      cutawaySides: () => [],
      placePlayer: vi.fn(),
      interactables,
      bounds: null,
      movement: null,
    }

    try {
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { resolvedObjectIds: new Set(['inspect']) },
      )
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }

    const inspect = interactables.find((interactable) => interactable.id === 'inspect')
    const take = interactables.find((interactable) => interactable.id === 'take')

    expect(inspect?.resolved).toBe(true)
    expect(take).not.toHaveProperty('resolved')
  })
})
