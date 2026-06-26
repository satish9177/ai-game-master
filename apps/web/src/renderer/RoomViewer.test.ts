import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NPCDialogueTarget } from '../app/dialogue'
import { buildNPCDialogueReplyInput } from '../app/npcDialogueReplyInput'
import { buildRoomDialogueContext } from '../domain/dialogue/buildRoomDialogueContext'
import type { NPCDialogueTurn } from '../domain/dialogue/contracts'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { Interactable } from '../domain/ports/interaction'
import { RoomViewer } from './RoomViewer'

const mockState = vi.hoisted(() => ({
  refIndex: 0,
  engineInstances: [] as Array<{
    onRequestOpenInteraction: ((target: Interactable) => void) | null
    onActiveInteractionChange: ((target: Interactable | null) => void) | null
    setRoom: ReturnType<typeof vi.fn>
    setInteractionLock: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: (callback: () => void | (() => void)) => {
      callback()
    },
    useRef: (initial: unknown) => {
      const index = mockState.refIndex
      mockState.refIndex += 1
      return { current: index === 0 ? { nodeType: 1 } : initial }
    },
    useState: (initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      vi.fn(),
    ],
  }
})

vi.mock('../platform/browser/webglSupport', () => ({
  isWebGL2Available: () => true,
}))

vi.mock('./engine/Engine', () => ({
  Engine: class {
    onRequestOpenInteraction: ((target: Interactable) => void) | null = null
    onActiveInteractionChange: ((target: Interactable | null) => void) | null = null
    setRoom = vi.fn()
    setInteractionLock = vi.fn()
    dispose = vi.fn()

    constructor() {
      mockState.engineInstances.push(this)
    }
  },
}))

const target: NPCDialogueTarget = {
  npcId: 'room-npc',
  npcName: 'Secret NPC Name',
  dialogue: {
    persona: 'unknown-persona',
    prompts: [{ id: 'ask-room', label: 'Secret prompt label' }],
  },
  persona: 'unknown-persona',
}

const history: NPCDialogueTurn[] = [
  { speaker: 'player', text: 'Secret prior player text' },
]

function loadedRoom() {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'room-viewer-context-test',
    name: 'Secret Room Name',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6] },
    objects: [
      {
        id: 'room-npc',
        type: 'npc',
        name: 'Secret NPC Object Name',
        position: [0, 0, -3],
        interaction: {
          key: 'F',
          prompt: 'Secret interaction prompt',
          title: 'Secret interaction title',
          body: 'Secret interaction body',
          dialogue: { persona: 'unknown-persona' },
        },
      },
      { type: 'corpse', position: [0, 0, 5] },
    ],
  })
}

describe('RoomViewer NPC dialogue room context wiring', () => {
  beforeEach(() => {
    mockState.refIndex = 0
    mockState.engineInstances.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockState.refIndex = 0
    mockState.engineInstances.length = 0
  })

  it('passes roomContext built from the current LoadedRoom into dialogue reply input', () => {
    const roomContext = buildRoomDialogueContext(loadedRoom())

    expect(buildNPCDialogueReplyInput({
      sessionId: 'session-1',
      target,
      history: [],
      playerLine: undefined,
      roomContext,
    })).toMatchObject({
      sessionId: 'session-1',
      npcId: 'room-npc',
      npcName: 'Secret NPC Name',
      dialogue: target.dialogue,
      persona: 'unknown-persona',
      history: [],
      playerLine: undefined,
      roomContext: {
        focus: { type: 'corpse', direction: 'south' },
        features: [{ type: 'corpse', direction: 'south' }],
        affordances: ['talk'],
        npcCount: 1,
      },
    })
  })

  it('omits roomContext when no room context is available', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 'session-1',
      target,
      history,
      playerLine: 'ask-room',
      roomContext: undefined,
    })

    expect(input.roomContext).toBeUndefined()
    expect(input).not.toHaveProperty('roomContext')
    expect(input.history).toEqual(history)
    expect(input.playerLine).toBe('ask-room')
  })

  it('does not add room names, object names, or interaction text to the roomContext packet', () => {
    const roomContext = buildRoomDialogueContext(loadedRoom())
    const input = buildNPCDialogueReplyInput({
      sessionId: 'session-1',
      target,
      history: [],
      roomContext,
    })
    const serializedRoomContext = JSON.stringify(input.roomContext)

    expect(serializedRoomContext).toContain('corpse')
    expect(serializedRoomContext).not.toContain('Secret Room Name')
    expect(serializedRoomContext).not.toContain('Secret NPC Object Name')
    expect(serializedRoomContext).not.toContain('Secret interaction prompt')
    expect(serializedRoomContext).not.toContain('Secret interaction title')
    expect(serializedRoomContext).not.toContain('Secret interaction body')
  })

  it('passes loaded roomContext into NPCDialogueService.reply when opening NPC dialogue', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Room-aware line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room)
    engine?.onRequestOpenInteraction?.({
      id: 'room-npc',
      type: 'npc',
      label: 'Secret NPC Object Name',
      affordance: 'talk',
      key: 'F',
      prompt: 'Secret interaction prompt',
      position: { x: 0, y: 0, z: -3 },
    })

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      sessionId: 'session-1',
      npcId: 'room-npc',
      npcName: 'Secret NPC Object Name',
      dialogue: { persona: 'unknown-persona' },
      persona: 'unknown-persona',
      history: [],
      playerLine: undefined,
      roomContext: {
        focus: { type: 'corpse', direction: 'south' },
        features: [{ type: 'corpse', direction: 'south' }],
        affordances: ['talk'],
        npcCount: 1,
      },
    })
    const serializedRoomContext = JSON.stringify(
      (replies[0] as { roomContext?: unknown }).roomContext,
    )
    expect(serializedRoomContext).not.toContain('Secret Room Name')
    expect(serializedRoomContext).not.toContain('Secret NPC Object Name')
    expect(serializedRoomContext).not.toContain('Secret interaction prompt')
    expect(serializedRoomContext).not.toContain('Secret interaction title')
    expect(serializedRoomContext).not.toContain('Secret interaction body')
  })
})
