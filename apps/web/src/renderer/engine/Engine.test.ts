import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { loadRoomSpec } from '../../domain/loadRoomSpec'
import type { LoadedRoom } from '../../domain/loadRoomSpec'
import { buildInteractables } from '../../domain/ports/interaction'
import { assembleRoom } from '../../domain/assembleRoom'
import { fallbackRoom } from '../../domain/examples/fallbackRoom'
import { buildNpcWanderField, NPC_WANDER } from '../../domain/npcMovementContract'
import { buildNpcPatrolRoute } from '../../domain/npcPatrolContract'
import { stableHash32 } from '../../domain/stableHash'
import { Engine } from './Engine'
import { IDLE_BOB_AMPLITUDE, IdleAnimator, idleOffsets, idlePhase } from './animation/idleAnimation'
import { NpcBehaviorTracker } from './npc/behaviorTracker'
import { WanderMotor } from './npc/WanderMotor'
import { NpcAwarenessTracker } from './npc/awarenessTracker'
import type { NpcRoutineMode } from '../../domain/npcRoutine'

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
      npcBehavior: new NpcBehaviorTracker(),
      wanderMotor: new WanderMotor(),
      wanderNpcIds: [] as string[],
      npcAwareness: new NpcAwarenessTracker(),
      awarenessNodes: new Map<string, THREE.Object3D>(),
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
    npcBehavior: new NpcBehaviorTracker(),
    wanderMotor: new WanderMotor(),
    wanderNpcIds: [] as string[],
    npcAwareness: new NpcAwarenessTracker(),
    awarenessNodes: new Map<string, THREE.Object3D>(),
    onNpcAwarenessChange: null as ((changes: unknown) => void) | null,
    player: new THREE.Object3D(),
    locked: false,
  }
}

/** Finds the objects group among a fake `scene.add` mock's recorded calls. */
function objectsGroupFrom(sceneAdd: ReturnType<typeof vi.fn>): THREE.Group {
  const call = sceneAdd.mock.calls.find(([node]) => (node as THREE.Object3D).name === 'objects')
  return call![0] as THREE.Group
}

function updateNpcWander(fakeEngine: unknown, dt: number): void {
  (Engine.prototype as unknown as { updateNpcWander: (dt: number) => void })
    .updateNpcWander.call(fakeEngine, dt)
}

function updateAwareness(fakeEngine: unknown): void {
  (Engine.prototype as unknown as { updateAwareness: () => void })
    .updateAwareness.call(fakeEngine)
}

function wanderRoom(id = 'engine-wander-room') {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Engine Wander Room',
    shell: { dimensions: { width: 14, depth: 14, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'npc',
        type: 'npc',
        name: 'Wanderer',
        position: [0, 0, 2],
        interaction: { key: 'F', prompt: 'Talk to Wanderer' },
      },
      {
        id: 'scroll',
        type: 'scroll',
        position: [3, 0.5, 2],
        interaction: { key: 'E', prompt: 'Read scroll', body: 'A note.' },
      },
      {
        id: 'pillar',
        type: 'pillar',
        position: [-3, 0, 2],
      },
    ],
  })
}

describe('Engine setRoom idle NPC registration', () => {
  it('updates the presentation tracker through setTalkingNpc without throwing', () => {
    const fakeEngine = { npcBehavior: new NpcBehaviorTracker() }

    expect(() => Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'npc')).not.toThrow()
    expect(() => Engine.prototype.setTalkingNpc.call(fakeEngine as never, null)).not.toThrow()
  })

  it('resolves talking NPC idle intensity to 0', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)

      Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'npc')
      Engine.prototype.setRoom.call(fakeEngine as never, room)
      Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'npc')

      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const npcBaseY = npcNode.position.y
      const npcBaseRotY = npcNode.rotation.y

      idleAnimator.update(5)

      expect(npcNode.position.y).toBe(npcBaseY)
      expect(npcNode.rotation.y).toBe(npcBaseRotY)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })

  it('keeps unknown and non-talking NPC idle intensity at 1', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)

      Engine.prototype.setRoom.call(fakeEngine as never, room)
      Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'other-npc')

      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const npcBaseY = npcNode.position.y

      idleAnimator.update(5)

      const expectedBobY = idleOffsets(idlePhase(room.id, 'npc'), 5).bobY
      expect(npcNode.position.y).toBeCloseTo(npcBaseY + expectedBobY, 12)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })

  it('clears stale talking state when a room is set', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const idleAnimator = new IdleAnimator()
      const fakeEngine = makeFakeEngine(idleAnimator)

      Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'npc')
      Engine.prototype.setRoom.call(fakeEngine as never, room)

      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const npcBaseY = npcNode.position.y

      idleAnimator.update(5)

      const expectedBobY = idleOffsets(idlePhase(room.id, 'npc'), 5).bobY
      expect(npcNode.position.y).toBeCloseTo(npcBaseY + expectedBobY, 12)
    } finally {
      if (originalWindow === undefined) {
        vi.unstubAllGlobals()
      } else {
        vi.stubGlobal('window', originalWindow)
      }
    }
  })

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

describe('Engine local NPC wander wiring', () => {
  it('registers only tagged NPC nodes with WanderMotor', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')

      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())

      expect(registerSpy).toHaveBeenCalledTimes(1)
      expect(registerSpy.mock.calls[0]![0]).toMatchObject({ npcId: 'npc' })
      expect(fakeEngine.wanderNpcIds).toEqual(['npc'])
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('ignores non-NPC nodes and unrelated rings', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const scrollNode = group.children.find((node) => node.userData.objectType === 'scroll')!
      const scrollRing = group.children.find((node) => node.userData.forObjectId === 'scroll')!
      const before = {
        scrollX: scrollNode.position.x,
        scrollZ: scrollNode.position.z,
        ringX: scrollRing.position.x,
        ringZ: scrollRing.position.z,
      }

      updateNpcWander(fakeEngine, 0.25)

      expect(scrollNode.position.x).toBe(before.scrollX)
      expect(scrollNode.position.z).toBe(before.scrollZ)
      expect(scrollRing.position.x).toBe(before.ringX)
      expect(scrollRing.position.z).toBe(before.ringZ)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('moves the matching NPC ring and interactable X/Z with the NPC node', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const npcRing = group.children.find((node) => node.userData.forObjectId === 'npc')!
      const npcInteractable = fakeEngine.interactables.find((interactable) => interactable.id === 'npc')!

      updateNpcWander(fakeEngine, 0.25)

      expect(npcRing.position.x).toBe(npcNode.position.x)
      expect(npcRing.position.z).toBe(npcNode.position.z)
      expect(npcInteractable.position.x).toBe(npcNode.position.x)
      expect(npcInteractable.position.z).toBe(npcNode.position.z)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('does not change node Y or rotation.y through wander updates', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!
      const beforeY = npcNode.position.y
      const beforeRotY = npcNode.rotation.y

      updateNpcWander(fakeEngine, 0.25)

      expect(npcNode.position.y).toBe(beforeY)
      expect(npcNode.rotation.y).toBe(beforeRotY)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('pauses wander while interaction locked and resumes when unlocked', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!

      updateNpcWander(fakeEngine, 0.25)
      const moving = { x: npcNode.position.x, z: npcNode.position.z }
      fakeEngine.locked = true
      updateNpcWander(fakeEngine, 1)
      expect(npcNode.position.x).toBe(moving.x)
      expect(npcNode.position.z).toBe(moving.z)

      fakeEngine.locked = false
      updateNpcWander(fakeEngine, 0.25)
      expect(Math.hypot(npcNode.position.x - moving.x, npcNode.position.z - moving.z))
        .toBeGreaterThan(0)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('pauses wander while the NPC is talking', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectType === 'npc')!

      updateNpcWander(fakeEngine, 0.25)
      const moving = { x: npcNode.position.x, z: npcNode.position.z }
      Engine.prototype.setTalkingNpc.call(fakeEngine as never, 'npc')
      updateNpcWander(fakeEngine, 1)

      expect(npcNode.position.x).toBe(moving.x)
      expect(npcNode.position.z).toBe(moving.z)
      expect(fakeEngine.npcBehavior.stateOf('npc')).toBe('talking')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('updates npcBehavior wandering state from WanderMotor walking state', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const setWanderingSpy = vi.spyOn(fakeEngine.npcBehavior, 'setWandering')
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())

      updateNpcWander(fakeEngine, 0.25)

      expect(setWanderingSpy).toHaveBeenLastCalledWith('npc', true)
      expect(fakeEngine.npcBehavior.stateOf('npc')).toBe('wandering')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('clears stale wander registrations when a room is replaced', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom('wander-a'))
      const groupA = objectsGroupFrom(fakeEngine.scene.add)
      const npcA = groupA.children.find((node) => node.userData.objectType === 'npc')!
      updateNpcWander(fakeEngine, 0.25)
      const npcAFrozen = { x: npcA.position.x, z: npcA.position.z }

      fakeEngine.scene.add.mockClear()
      Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom('wander-b'))
      const groupB = objectsGroupFrom(fakeEngine.scene.add)
      const npcB = groupB.children.find((node) => node.userData.objectType === 'npc')!
      updateNpcWander(fakeEngine, 0.25)

      expect(npcA.position.x).toBe(npcAFrozen.x)
      expect(npcA.position.z).toBe(npcAFrozen.z)
      expect(Math.hypot(npcB.position.x, npcB.position.z - 2)).toBeGreaterThan(0)
      expect(fakeEngine.wanderNpcIds).toEqual(['npc'])
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('uses fake Engine objects only for local wander wiring tests', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())

      expect(() => {
        Engine.prototype.setRoom.call(fakeEngine as never, wanderRoom())
        updateNpcWander(fakeEngine, 0.1)
      }).not.toThrow()
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })
})

function patrolWiringRoom(id = 'engine-patrol-room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Engine Patrol Room',
    shell: { dimensions: { width: 20, depth: 20, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'guard',
        type: 'npc',
        name: 'Guard',
        position: [0, 0, 6],
        interaction: { key: 'F', prompt: 'Talk to Guard' },
      },
      {
        id: 'villager',
        type: 'npc',
        name: 'Villager',
        position: [6, 0, -6],
        interaction: { key: 'F', prompt: 'Talk to Villager' },
      },
    ],
  })
}

describe('Engine patrol opt-in seam (ADR-0080)', () => {
  it('does not assign patrol to any NPC when patrolOptInNpcIds is omitted (no blanket assignment)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')

      Engine.prototype.setRoom.call(fakeEngine as never, patrolWiringRoom())

      expect(registerSpy).toHaveBeenCalledTimes(2)
      for (const call of registerSpy.mock.calls) {
        expect(call[0]).not.toHaveProperty('policy', 'patrol')
      }
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('leaves ineligible (non-opted-in) NPCs on the existing wander/idle path even when a sibling NPC opts in', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        patrolWiringRoom(),
        { patrolOptInNpcIds: new Set(['guard']) },
      )

      const villagerCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'villager')!
      expect(villagerCall[0]).not.toHaveProperty('policy', 'patrol')
      expect(villagerCall[0]).toMatchObject({ npcId: 'villager' })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('registers the explicitly opted-in fixture/test-seam NPC with a validated patrol route', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom()

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { patrolOptInNpcIds: new Set(['guard']) },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const expectedRoute = buildNpcPatrolRoute(field, stableHash32(`${room.id}:guard`))
      expect(expectedRoute).not.toBeNull()

      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'patrol', route: expectedRoute })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('never mutates room.objects across N patrol ticks (no authoritative mutation)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const room = patrolWiringRoom()

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { patrolOptInNpcIds: new Set(['guard']) },
      )

      const before = structuredClone(room.objects)

      for (let tick = 0; tick < 50; tick += 1) {
        updateNpcWander(fakeEngine, 0.1)
      }

      expect(room.objects).toEqual(before)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })
})

describe('Engine npcRoutineModes seam (Slice 2)', () => {
  it('registers idle motor policy for a routine mode of "idle"', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-idle-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'idle']]) },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'idle', home: field.home })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('registers idle motor policy for a routine mode of "rest"', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-rest-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'rest']]) },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'idle', home: field.home })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('registers wander motor policy for a routine mode of "passive"', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-passive-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'passive']]) },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).not.toHaveProperty('policy', 'idle')
      expect(guardCall[0]).not.toHaveProperty('policy', 'patrol')
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', home: field.home })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('registers patrol motor policy for a routine mode of "patrol" using the existing route logic', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-patrol-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'patrol']]) },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const expectedRoute = buildNpcPatrolRoute(field, stableHash32(`${room.id}:guard`))
      expect(expectedRoute).not.toBeNull()

      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'patrol', route: expectedRoute })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('leaves an NPC absent from npcRoutineModes on the existing wander/idle path', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-unconfigured-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'idle']]) },
      )

      const villagerCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'villager')!
      expect(villagerCall[0]).not.toHaveProperty('policy', 'idle')
      expect(villagerCall[0]).not.toHaveProperty('policy', 'patrol')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('still honors patrolOptInNpcIds for an NPC absent from npcRoutineModes', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-patrol-optin-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        {
          patrolOptInNpcIds: new Set(['guard']),
          npcRoutineModes: new Map<string, NpcRoutineMode>([['villager', 'idle']]),
        },
      )

      const field = buildNpcWanderField(room, 'guard')!
      const expectedRoute = buildNpcPatrolRoute(field, stableHash32(`${room.id}:guard`))
      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      const villagerCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'villager')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'patrol', route: expectedRoute })
      expect(villagerCall[0]).toMatchObject({ npcId: 'villager', policy: 'idle' })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('keeps chaseOptInNpcIds independent of npcRoutineModes', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      const room = patrolWiringRoom('routine-chase-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        {
          chaseOptInNpcIds: new Set(['guard']),
          npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'idle']]),
        },
      )

      const guardCall = registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')!
      expect(guardCall[0]).toMatchObject({ npcId: 'guard', policy: 'idle', chaseEligible: true })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('never mutates room.objects across N ticks with npcRoutineModes set (no authoritative mutation)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const room = patrolWiringRoom('routine-no-mutation-room')

      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        {
          npcRoutineModes: new Map<string, NpcRoutineMode>([['guard', 'idle'], ['villager', 'patrol']]),
        },
      )

      const before = structuredClone(room.objects)

      for (let tick = 0; tick < 50; tick += 1) {
        updateNpcWander(fakeEngine, 0.1)
      }

      expect(room.objects).toEqual(before)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })
})

function awarenessRoom(id = 'engine-awareness-room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Engine Awareness Room',
    shell: { dimensions: { width: 20, depth: 20, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'guard',
        type: 'npc',
        name: 'Guard',
        position: [3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk to Guard' },
      },
      {
        // No `id`: registerWanderNpcs skips it (it needs an objectId to look up
        // a wander field), so this NPC never joins WanderMotor and never
        // moves — a fully static NPC. It must still be tracked for awareness.
        type: 'npc',
        name: 'Statue Guard',
        position: [-3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk to statue guard' },
      },
    ],
  })
}

describe('Engine NPC-player awareness (ADR-0083)', () => {
  it('computes a tighter awareness tier as the player approaches an NPC', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, awarenessRoom())

      fakeEngine.player.position.set(20, 0, 0)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('unaware')

      fakeEngine.player.position.set(3, 0, 4)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('nearby')

      fakeEngine.player.position.set(3, 0, 2)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('aware')

      fakeEngine.player.position.set(3, 0, 1)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('alerted')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('evaluates every same-room NPC node, including one excluded from WanderMotor (static)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, awarenessRoom())

      expect(fakeEngine.wanderNpcIds).toEqual(['guard'])
      expect(fakeEngine.awarenessNodes.has('guard')).toBe(true)
      expect(fakeEngine.awarenessNodes.has('npc#1')).toBe(true)

      fakeEngine.player.position.set(-3, 0, 1)
      updateAwareness(fakeEngine)

      expect(fakeEngine.npcAwareness.levelOf('npc#1')).toBe('alerted')
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('unaware')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('resets awareness state and the node map when a room is replaced', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, awarenessRoom('awareness-room-a'))

      fakeEngine.player.position.set(3, 0, 0)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('alerted')

      Engine.prototype.setRoom.call(fakeEngine as never, awarenessRoom('awareness-room-b'))

      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('unaware')
      expect(fakeEngine.awarenessNodes.size).toBe(2)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('never mutates room.objects across repeated awareness ticks (no authoritative mutation)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const room = awarenessRoom()
      Engine.prototype.setRoom.call(fakeEngine as never, room)
      const before = structuredClone(room.objects)

      for (let tick = 0; tick < 50; tick += 1) {
        fakeEngine.player.position.set(Math.sin(tick) * 4, 0, Math.cos(tick) * 4)
        updateAwareness(fakeEngine)
      }

      expect(room.objects).toEqual(before)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('does not move or rotate any NPC node when computing awareness (advisory-only, no movement override)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(fakeEngine as never, awarenessRoom())
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const npcNode = group.children.find((node) => node.userData.objectId === 'guard')!
      const before = {
        x: npcNode.position.x,
        y: npcNode.position.y,
        z: npcNode.position.z,
        rotY: npcNode.rotation.y,
      }

      for (let tick = 0; tick < 10; tick += 1) {
        fakeEngine.player.position.set(3, 0, tick * 0.5)
        updateAwareness(fakeEngine)
      }

      expect(npcNode.position.x).toBe(before.x)
      expect(npcNode.position.y).toBe(before.y)
      expect(npcNode.position.z).toBe(before.z)
      expect(npcNode.rotation.y).toBe(before.rotY)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('clears awareness state and the node map on dispose', () => {
    const originalWindow = globalThis.window
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    vi.stubGlobal('window', { removeEventListener: vi.fn() })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const npcAwareness = new NpcAwarenessTracker()
    npcAwareness.update({ npcId: 'guard', level: 'alerted', distance: 0.4, reason: 'proximity' })
    const clearSpy = vi.spyOn(npcAwareness, 'clear')
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
      onNpcAwarenessChange: null,
      scene: new THREE.Scene(),
      disposables: { dispose: vi.fn() },
      cameraController: { dispose: vi.fn() },
      renderer: {
        dispose: vi.fn(),
        forceContextLoss: vi.fn(),
        domElement: { parentNode: null },
      },
      room: null,
      idleAnimator: new IdleAnimator(),
      npcBehavior: new NpcBehaviorTracker(),
      wanderMotor: new WanderMotor(),
      wanderNpcIds: ['guard'],
      npcAwareness,
      awarenessNodes: new Map<string, THREE.Object3D>([['guard', new THREE.Object3D()]]),
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
    expect(fakeEngine.awarenessNodes.size).toBe(0)
    expect(fakeEngine.npcAwareness.levelOf('guard')).toBe('unaware')
  })
})

function chaseRoom(id = 'engine-chase-room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Engine Chase Room',
    shell: { dimensions: { width: 20, depth: 20, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'guard',
        type: 'npc',
        name: 'Guard',
        position: [3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk to Guard' },
      },
      {
        id: 'villager',
        type: 'npc',
        name: 'Villager',
        position: [-3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk to Villager' },
      },
    ],
  })
}

function nodeByObjectId(group: THREE.Group, objectId: string): THREE.Object3D {
  return group.children.find((node) => node.userData.objectId === objectId)!
}

function distanceXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('Engine hostile NPC chase opt-in seam (ADR-0084)', () => {
  it.each([
    { level: 'aware' as const, playerX: 1 },
    { level: 'alerted' as const, playerX: 2 },
  ])('moves an opted-in NPC toward the player when prior awareness is $level', ({ level, playerX }) => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        chaseRoom(`chase-${level}`),
        { chaseOptInNpcIds: new Set(['guard']) },
      )
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const guard = nodeByObjectId(group, 'guard')
      fakeEngine.player.position.set(playerX, 0, 0)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe(level)
      const before = { x: guard.position.x, z: guard.position.z }

      updateNpcWander(fakeEngine, 0.25)

      expect(guard.position.x).toBeLessThan(before.x)
      expect(guard.position.z).toBe(before.z)
      expect(distanceXZ(before, guard.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * 0.25) + 1e-12)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it.each([
    { level: 'nearby' as const, player: { x: 3, z: 4 } },
    { level: 'unaware' as const, player: { x: 20, z: 0 } },
  ])('does not activate chase for an opted-in NPC when awareness is $level', ({ level, player }) => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        chaseRoom(`chase-inactive-${level}`),
        { chaseOptInNpcIds: new Set(['guard']) },
      )
      const updateSpy = vi.spyOn(fakeEngine.wanderMotor, 'update')
      fakeEngine.player.position.set(player.x, 0, player.z)
      updateAwareness(fakeEngine)
      expect(fakeEngine.npcAwareness.levelOf('guard')).toBe(level)

      updateNpcWander(fakeEngine, 0.25)

      const context = updateSpy.mock.calls.at(-1)![1]
      expect(context.isChaseActive?.('guard')).toBe(false)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('does not chase a non-opted NPC even when awareness is aware', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const chaseContextEngine = makeFakeEngine(new IdleAnimator())
      const baselineEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(
        chaseContextEngine as never,
        chaseRoom('non-opted-context'),
        { chaseOptInNpcIds: new Set(['villager']) },
      )
      Engine.prototype.setRoom.call(baselineEngine as never, chaseRoom('non-opted-context'))
      const contextGroup = objectsGroupFrom(chaseContextEngine.scene.add)
      const baselineGroup = objectsGroupFrom(baselineEngine.scene.add)
      const contextGuard = nodeByObjectId(contextGroup, 'guard')
      const baselineGuard = nodeByObjectId(baselineGroup, 'guard')

      chaseContextEngine.player.position.set(1, 0, 0)
      baselineEngine.player.position.set(1, 0, 0)
      updateAwareness(chaseContextEngine)
      updateAwareness(baselineEngine)
      expect(chaseContextEngine.npcAwareness.levelOf('guard')).toBe('aware')

      updateNpcWander(chaseContextEngine, 0.25)
      updateNpcWander(baselineEngine, 0.25)

      expect({ x: contextGuard.position.x, z: contextGuard.position.z })
        .toEqual({ x: baselineGuard.position.x, z: baselineGuard.position.z })
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('keeps interaction lock pause behavior ahead of active chase', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        chaseRoom('chase-lock'),
        { chaseOptInNpcIds: new Set(['guard']) },
      )
      const group = objectsGroupFrom(fakeEngine.scene.add)
      const guard = nodeByObjectId(group, 'guard')
      fakeEngine.player.position.set(1, 0, 0)
      updateAwareness(fakeEngine)
      fakeEngine.locked = true
      const before = { x: guard.position.x, z: guard.position.z }

      updateNpcWander(fakeEngine, 1)

      expect({ x: guard.position.x, z: guard.position.z }).toEqual(before)
      expect(fakeEngine.npcBehavior.stateOf('guard')).toBe('idle')
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('clears chase eligibility when a room is replaced', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const registerSpy = vi.spyOn(fakeEngine.wanderMotor, 'register')
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        chaseRoom('chase-room-a'),
        { chaseOptInNpcIds: new Set(['guard']) },
      )
      expect(registerSpy.mock.calls.find((call) => call[0].npcId === 'guard')![0])
        .toMatchObject({ chaseEligible: true })

      fakeEngine.scene.add.mockClear()
      registerSpy.mockClear()
      Engine.prototype.setRoom.call(fakeEngine as never, chaseRoom('chase-room-b'))

      expect(registerSpy).toHaveBeenCalledTimes(2)
      for (const call of registerSpy.mock.calls) {
        expect(call[0]).toMatchObject({ chaseEligible: false })
      }
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })

  it('clears chase-capable WanderMotor runtime state on dispose', () => {
    const originalWindow = globalThis.window
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    vi.stubGlobal('window', { removeEventListener: vi.fn() })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const wanderMotor = new WanderMotor()
    const field = buildNpcWanderField(chaseRoom('dispose-chase'), 'guard')!
    wanderMotor.register({
      npcId: 'guard',
      node: new THREE.Object3D(),
      field,
      seed: 'dispose-chase:guard',
      home: field.home,
      chaseEligible: true,
    })
    const clearSpy = vi.spyOn(wanderMotor, 'clear')
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
      onNpcAwarenessChange: null,
      scene: new THREE.Scene(),
      disposables: { dispose: vi.fn() },
      cameraController: { dispose: vi.fn() },
      renderer: {
        dispose: vi.fn(),
        forceContextLoss: vi.fn(),
        domElement: { parentNode: null },
      },
      room: null,
      idleAnimator: new IdleAnimator(),
      npcBehavior: new NpcBehaviorTracker(),
      wanderMotor,
      wanderNpcIds: ['guard'],
      npcAwareness: new NpcAwarenessTracker(),
      awarenessNodes: new Map<string, THREE.Object3D>([['guard', new THREE.Object3D()]]),
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
    expect(fakeEngine.wanderNpcIds).toEqual([])
    expect(fakeEngine.awarenessNodes.size).toBe(0)
  })

  it('never mutates room.objects across chase movement ticks (no authoritative mutation)', () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })

    try {
      const fakeEngine = makeFakeEngine(new IdleAnimator())
      const room = chaseRoom('chase-no-authority')
      Engine.prototype.setRoom.call(
        fakeEngine as never,
        room,
        { chaseOptInNpcIds: new Set(['guard']) },
      )
      const before = structuredClone(room.objects)

      for (let tick = 0; tick < 20; tick += 1) {
        fakeEngine.player.position.set(1, 0, 0)
        updateAwareness(fakeEngine)
        updateNpcWander(fakeEngine, 0.1)
      }

      expect(room.objects).toEqual(before)
    } finally {
      if (originalWindow === undefined) vi.unstubAllGlobals()
      else vi.stubGlobal('window', originalWindow)
    }
  })
})

describe('Engine dispose', () => {
  it('clears idle and behavior state safely during teardown', () => {
    const originalWindow = globalThis.window
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    vi.stubGlobal('window', { removeEventListener: vi.fn() })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const idleAnimator = new IdleAnimator()
    const clearSpy = vi.spyOn(idleAnimator, 'clear')
    const npcBehavior = new NpcBehaviorTracker()
    const behaviorClearSpy = vi.spyOn(npcBehavior, 'clear')
    const wanderMotor = new WanderMotor()
    const wanderClearSpy = vi.spyOn(wanderMotor, 'clear')
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
      onNpcAwarenessChange: null,
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
      npcBehavior,
      wanderMotor,
      wanderNpcIds: ['npc'],
      npcAwareness: new NpcAwarenessTracker(),
      awarenessNodes: new Map<string, THREE.Object3D>(),
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
    expect(behaviorClearSpy).toHaveBeenCalledTimes(1)
    expect(wanderClearSpy).toHaveBeenCalledTimes(1)
    expect(fakeEngine.wanderNpcIds).toEqual([])
  })
})
