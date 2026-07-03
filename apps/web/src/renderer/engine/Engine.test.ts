import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { loadRoomSpec } from '../../domain/loadRoomSpec'
import { buildInteractables } from '../../domain/ports/interaction'
import { assembleRoom } from '../../domain/assembleRoom'
import { fallbackRoom } from '../../domain/examples/fallbackRoom'
import { Engine } from './Engine'
import { IDLE_BOB_AMPLITUDE, IdleAnimator, idleOffsets, idlePhase } from './animation/idleAnimation'

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
      idleAnimator: new IdleAnimator(),
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

function makeFakeEngine(idleAnimator: IdleAnimator) {
  return {
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
    interactables: [] as ReturnType<typeof buildInteractables>,
    bounds: null,
    movement: null,
    idleAnimator,
  }
}

/** Finds the objects group among a fake `scene.add` mock's recorded calls. */
function objectsGroupFrom(sceneAdd: ReturnType<typeof vi.fn>): THREE.Group {
  const call = sceneAdd.mock.calls.find(([node]) => (node as THREE.Object3D).name === 'objects')
  return call![0] as THREE.Group
}

describe('Engine setRoom idle NPC registration', () => {
  it('registers tagged NPC nodes and ignores rings/helpers, without throwing', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)

      expect(() => {
        Engine.prototype.setRoom.call(fakeEngine as never, room)
      }).not.toThrow()

      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const ring = group.children.find((node) => node.name === 'interactable-indicator')!
      const statueNode = group.children.find((node) => node.userData.objectType === 'statue')!

      const npcBaseY = npcNode.position.y
      const ringBaseY = ring.position.y
      const statueBaseY = statueNode.position.y

      idleAnimator.update(5)

      // The room's npc object carries id 'npc', so the registration key is that id.
      const expectedBobY = idleOffsets(idlePhase(room.id, 'npc'), 5).bobY
      expect(expectedBobY).toBeGreaterThan(0)
      expect(expectedBobY).toBeLessThanOrEqual(IDLE_BOB_AMPLITUDE)
      expect(npcNode.position.y).toBeCloseTo(npcBaseY + expectedBobY, 12)

      // Rings and non-npc objects are never registered, so they never move.
      expect(ring.position.y).toBe(ringBaseY)
      expect(statueNode.position.y).toBe(statueBaseY)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })

  it('derives a deterministic fallback key for an id-less NPC from room.objects order, not group child order', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      // Tagged top-level nodes end up as [statue(idx0), npc(idx1)] — the
      // interactable ring for the statue sits between them as an untagged
      // sibling in raw `group.children`, so a group-child-index fallback would
      // wrongly compute "npc#2"; the room.objects-order fallback is "npc#1".
      const fallbackRoom = loadRoomSpec({
        schemaVersion: 1,
        id: 'idle-fallback-room',
        name: 'Idle Fallback Room',
        shell: { dimensions: { width: 10, depth: 10, height: 4 } },
        spawn: { position: [0, 1.6, 0], yaw: 0 },
        objects: [
          {
            id: 'deco',
            type: 'statue',
            position: [1, 0, -3],
            interaction: { key: 'F', prompt: 'Look', dialogue: { greeting: 'Hi.' } },
          },
          {
            type: 'npc',
            name: 'Wanderer',
            position: [2, 0, -3],
            interaction: { key: 'F', prompt: 'Talk to wanderer' },
          },
        ],
      })

      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)
      Engine.prototype.setRoom.call(fakeEngine as never, fallbackRoom)

      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const npcBaseY = npcNode.position.y

      idleAnimator.update(3.25)

      const expectedBobY = idleOffsets(idlePhase(fallbackRoom.id, 'npc#1'), 3.25).bobY
      expect(npcNode.position.y).toBeCloseTo(npcBaseY + expectedBobY, 12)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })

  it('clears previous room idle registrations when a new room replaces it', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const roomA = loadRoomSpec({
        schemaVersion: 1,
        id: 'idle-room-a',
        name: 'Idle Room A',
        shell: { dimensions: { width: 8, depth: 8, height: 4 } },
        spawn: { position: [0, 1.6, 0], yaw: 0 },
        objects: [{
          id: 'npc-a',
          type: 'npc',
          name: 'A',
          position: [0, 0, -2],
          interaction: { key: 'F', prompt: 'Talk to A' },
        }],
      })
      const roomB = loadRoomSpec({
        schemaVersion: 1,
        id: 'idle-room-b',
        name: 'Idle Room B',
        shell: { dimensions: { width: 8, depth: 8, height: 4 } },
        spawn: { position: [0, 1.6, 0], yaw: 0 },
        objects: [{
          id: 'npc-b',
          type: 'npc',
          name: 'B',
          position: [0, 0, -2],
          interaction: { key: 'F', prompt: 'Talk to B' },
        }],
      })

      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)

      Engine.prototype.setRoom.call(fakeEngine as never, roomA)
      const groupA = objectsGroupFrom(fakeEngine.scene.add)
      const npcA = groupA.children.find((node) => node.userData.objectType === 'npc')!

      idleAnimator.update(1)
      const npcABobbedY = npcA.position.y
      expect(npcABobbedY).toBeGreaterThan(0) // proves npc-a was actually registered

      fakeEngine.scene.add.mockClear()
      Engine.prototype.setRoom.call(fakeEngine as never, roomB)
      const groupB = objectsGroupFrom(fakeEngine.scene.add)
      const npcB = groupB.children.find((node) => node.userData.objectType === 'npc')!

      idleAnimator.update(1)

      // The stale npc-a node was cleared out of the animator, so it never
      // receives another update; npc-b, from the replacement room, does.
      expect(npcA.position.y).toBe(npcABobbedY)
      expect(npcB.position.y).toBeGreaterThan(0)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })
})

describe('Engine dispose', () => {
  it('calls idleAnimator.clear() safely during teardown', () => {
    const originalWindow = globalThis.window
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    vi.stubGlobal('window', { removeEventListener: vi.fn() })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const idleAnimator = new IdleAnimator()
    const clearSpy = vi.spyOn(idleAnimator, 'clear')
    const fakeEngine = {
      rafId: 0,
      resizeObserver: { disconnect: vi.fn() },
      onInteractKey: () => {},
      movement: null,
      bounds: null,
      interactables: [] as unknown[],
      activeInteractable: null,
      locked: false,
      onActiveInteractionChange: null,
      onRequestOpenInteraction: null,
      scene: new THREE.Scene(),
      disposables: { dispose: vi.fn() },
      cameraController: { dispose: vi.fn() },
      renderer: {
        dispose: vi.fn(),
        forceContextLoss: vi.fn(),
        domElement: { parentNode: null },
      },
      room: null,
      idleAnimator,
    }

    try {
      expect(() => Engine.prototype.dispose.call(fakeEngine as never)).not.toThrow()
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
        vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame)
      }
    }

    expect(clearSpy).toHaveBeenCalledTimes(1)
  })
})
