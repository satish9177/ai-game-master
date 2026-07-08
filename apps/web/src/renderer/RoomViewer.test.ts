import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIALOGUE_AT_CAP_MESSAGE } from '../app/dialogue'
import type { NPCDialogueTarget } from '../app/dialogue'
import { buildNPCDialogueReplyInput } from '../app/npcDialogueReplyInput'
import { buildRoomDialogueContext } from '../domain/dialogue/buildRoomDialogueContext'
import type { NPCDialogueTurn } from '../domain/dialogue/contracts'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { Interactable } from '../domain/ports/interaction'
import { RoomViewer } from './RoomViewer'

const mockState = vi.hoisted(() => ({
  refIndex: 0,
  stateIndex: 0,
  stateSetters: [] as Array<ReturnType<typeof vi.fn>>,
  callbacks: [] as unknown[],
  engineInstances: [] as Array<{
    onRequestOpenInteraction: ((target: Interactable) => void) | null
    onActiveInteractionChange: ((target: Interactable | null) => void) | null
    setRoom: ReturnType<typeof vi.fn>
    setInteractionLock: ReturnType<typeof vi.fn>
    setTalkingNpc: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    // Recorded in call order so tests can invoke handleNPCSay (index 0) directly;
    // it's only ever wired to a prop on a conditionally-rendered element otherwise.
    useCallback: (callback: unknown) => {
      mockState.callbacks.push(callback)
      return callback
    },
    useEffect: (callback: () => void | (() => void)) => {
      callback()
    },
    useRef: (initial: unknown) => {
      const index = mockState.refIndex
      mockState.refIndex += 1
      return { current: index === 0 ? { nodeType: 1 } : initial }
    },
    useState: (initial: unknown) => {
      const setter = vi.fn()
      mockState.stateSetters[mockState.stateIndex] = setter
      mockState.stateIndex += 1
      return [
        typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter,
      ]
    },
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
    setTalkingNpc = vi.fn()
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
          dialogue: {
            persona: 'unknown-persona',
            greeting: 'Secret greeting text',
            prompts: [{ id: 'ask-room', label: 'Ask about the room' }],
          },
        },
      },
      { type: 'corpse', position: [0, 0, 5] },
    ],
  })
}

describe('RoomViewer NPC dialogue room context wiring', () => {
  beforeEach(() => {
    mockState.refIndex = 0
    mockState.stateIndex = 0
    mockState.stateSetters.length = 0
    mockState.callbacks.length = 0
    mockState.engineInstances.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockState.refIndex = 0
    mockState.stateIndex = 0
    mockState.stateSetters.length = 0
    mockState.callbacks.length = 0
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

  it('passes loaded roomContext into NPCDialogueService.reply on the first Continue click after opening NPC dialogue', async () => {
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

    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

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

  it('does not call npcDialogueService.reply and shows only the static greeting when opening NPC dialogue', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'Should not be requested.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    await Promise.resolve()

    expect(replies).toHaveLength(0)
    const setNPCDialogueTurns = mockState.stateSetters[5]
    const setNPCDialoguePending = mockState.stateSetters[7]
    expect(setNPCDialogueTurns).toHaveBeenCalledWith([
      { speaker: 'npc', text: 'Secret greeting text' },
    ])
    expect(setNPCDialoguePending).not.toHaveBeenCalledWith(true)
  })

  it('marks the opened NPC as talking after the reset clear', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    engine?.onRequestOpenInteraction?.({
      id: 'room-npc',
      type: 'npc',
      label: 'Secret NPC Object Name',
      affordance: 'talk',
      key: 'F',
      prompt: 'Secret interaction prompt',
      position: { x: 0, y: 0, z: -3 },
    })

    expect(engine?.setTalkingNpc).toHaveBeenNthCalledWith(1, null)
    expect(engine?.setTalkingNpc).toHaveBeenNthCalledWith(2, 'room-npc')
  })

  it('clears the talking NPC when NPC dialogue closes', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    engine?.onRequestOpenInteraction?.({
      id: 'room-npc',
      type: 'npc',
      label: 'Secret NPC Object Name',
      affordance: 'talk',
      key: 'F',
      prompt: 'Secret interaction prompt',
      position: { x: 0, y: 0, z: -3 },
    })

    const closeNPCDialogue = mockState.callbacks[1] as () => void
    closeNPCDialogue()

    expect(engine?.setTalkingNpc).toHaveBeenLastCalledWith(null)
  })

  it('sends prompt button id separately from the displayed player label', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'Prompt-triggered line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)
    const setNPCDialogueTurns = mockState.stateSetters[5]!
    setNPCDialogueTurns.mockClear()

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      promptId: 'ask-room',
      playerLine: 'Ask about the room',
      history: [],
    })
    expect(setNPCDialogueTurns).toHaveBeenCalledWith([
      { speaker: 'player', text: 'Ask about the room' },
    ])
  })

  it('emits structural dialogue resolution data for a successful NPC reply', async () => {
    const resolvedEvents: unknown[] = []
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'SECRET NPC TEXT' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      onNpcDialogueResolved: (event: unknown) => resolvedEvents.push(event),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()

    expect(resolvedEvents).toEqual([
      {
        npcId: 'room-npc',
        promptId: 'ask-room',
        hasNpcReply: true,
        turnIndex: 0,
      },
    ])
    expect(JSON.stringify(resolvedEvents)).not.toContain('SECRET NPC TEXT')
    expect(JSON.stringify(resolvedEvents)).not.toContain('Ask about the room')
  })

  it('emits structural dialogue resolution data for a failed NPC reply result', async () => {
    const resolvedEvents: unknown[] = []
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'failed', reason: 'provider-error' }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      onNpcDialogueResolved: (event: unknown) => resolvedEvents.push(event),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()

    expect(resolvedEvents).toEqual([
      {
        npcId: 'room-npc',
        promptId: 'ask-room',
        hasNpcReply: false,
        turnIndex: 0,
      },
    ])
  })

  it('emits known prompt resolution even when the provider promise rejects', async () => {
    const resolvedEvents: unknown[] = []
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => {
          throw new Error('SECRET PROVIDER TEXT')
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      onNpcDialogueResolved: (event: unknown) => resolvedEvents.push(event),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()
    await Promise.resolve()

    expect(resolvedEvents).toEqual([
      {
        npcId: 'room-npc',
        promptId: 'ask-room',
        hasNpcReply: false,
        turnIndex: 0,
      },
    ])
    expect(JSON.stringify(resolvedEvents)).not.toContain('SECRET PROVIDER TEXT')
  })

  it('does not emit dialogue resolution data for stale superseded replies', async () => {
    const resolvedEvents: unknown[] = []
    const room = loadedRoom()
    let resolveReply: ((value: { status: 'replied'; turn: NPCDialogueTurn }) => void) | undefined
    const reply = new Promise<{ status: 'replied'; turn: NPCDialogueTurn }>((resolve) => {
      resolveReply = resolve
    })

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: { reply: async () => reply },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      onNpcDialogueResolved: (event: unknown) => resolvedEvents.push(event),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')
    const closeNPCDialogue = mockState.callbacks[1] as () => void
    closeNPCDialogue()

    resolveReply?.({ status: 'replied', turn: { speaker: 'npc', text: 'SECRET STALE NPC TEXT' } })
    await Promise.resolve()
    await Promise.resolve()

    expect(resolvedEvents).toEqual([])
  })

  it('sends normalized typed text without a prompt id or duplicated current turn', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'Typed-text line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    const setNPCDialogueTurns = mockState.stateSetters[5]!
    setNPCDialogueTurns.mockClear()

    const handleNPCSay = mockState.callbacks[0] as (
      promptId: string | undefined,
      playerLine?: string,
    ) => void
    handleNPCSay(undefined, '  Look\tat \n the   altar  ')

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      promptId: undefined,
      playerLine: 'Look at the altar',
      history: [],
    })
    expect(setNPCDialogueTurns).toHaveBeenCalledWith([
      { speaker: 'player', text: 'Look at the altar' },
    ])
  })

  it('ignores empty typed text before the usage gate', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const requestDialogueAttempt = vi.fn(() => true)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Should not be requested.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      requestDialogueAttempt,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (
      promptId: string | undefined,
      playerLine?: string,
    ) => void
    handleNPCSay(undefined, '   \n\t   ')

    await Promise.resolve()

    expect(requestDialogueAttempt).not.toHaveBeenCalled()
    expect(replies).toHaveLength(0)
  })

  it('calls requestDialogueAttempt before reply and proceeds when it returns true', async () => {
    const callOrder: string[] = []
    const replies: unknown[] = []
    const room = loadedRoom()
    const requestDialogueAttempt = vi.fn(() => {
      callOrder.push('requestDialogueAttempt')
      return true
    })

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          callOrder.push('reply')
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Allowed line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      requestDialogueAttempt,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()

    expect(requestDialogueAttempt).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['requestDialogueAttempt', 'reply'])
    expect(replies).toHaveLength(1)
  })

  it('blocks reply and shows the at-cap message when requestDialogueAttempt returns false', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const requestDialogueAttempt = vi.fn(() => false)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Should not be requested.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      requestDialogueAttempt,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const setNPCDialogueMessage = mockState.stateSetters[6]!
    const setNPCDialoguePending = mockState.stateSetters[7]!
    const setNPCDialogueTurns = mockState.stateSetters[5]!
    setNPCDialogueMessage.mockClear()
    setNPCDialoguePending.mockClear()
    setNPCDialogueTurns.mockClear()

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay('ask-room')

    await Promise.resolve()

    expect(requestDialogueAttempt).toHaveBeenCalledTimes(1)
    expect(replies).toHaveLength(0)
    expect(setNPCDialogueMessage).toHaveBeenCalledWith(DIALOGUE_AT_CAP_MESSAGE)
    expect(setNPCDialogueTurns).not.toHaveBeenCalled()
    expect(setNPCDialoguePending).not.toHaveBeenCalledWith(true)
  })

  it('blocks typed text without appending it when requestDialogueAttempt returns false', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const requestDialogueAttempt = vi.fn(() => false)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Should not be requested.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      requestDialogueAttempt,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const setNPCDialogueMessage = mockState.stateSetters[6]!
    const setNPCDialoguePending = mockState.stateSetters[7]!
    const setNPCDialogueTurns = mockState.stateSetters[5]!
    setNPCDialogueMessage.mockClear()
    setNPCDialoguePending.mockClear()
    setNPCDialogueTurns.mockClear()

    const handleNPCSay = mockState.callbacks[0] as (
      promptId: string | undefined,
      playerLine?: string,
    ) => void
    handleNPCSay(undefined, 'Can you help?')

    await Promise.resolve()

    expect(requestDialogueAttempt).toHaveBeenCalledTimes(1)
    expect(replies).toHaveLength(0)
    expect(setNPCDialogueMessage).toHaveBeenCalledWith(DIALOGUE_AT_CAP_MESSAGE)
    expect(setNPCDialogueTurns).not.toHaveBeenCalled()
    expect(setNPCDialoguePending).not.toHaveBeenCalledWith(true)
  })

  it('proceeds with the existing reply flow when requestDialogueAttempt is not provided', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'Unguarded line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
  })

  it('gates the Continue path (handleNPCSay with no promptId) the same as prompt clicks', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const requestDialogueAttempt = vi.fn(() => false)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Should not be requested.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      requestDialogueAttempt,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(requestDialogueAttempt).toHaveBeenCalledTimes(1)
    expect(replies).toHaveLength(0)
  })

  it('passes resolvedObjectIds through to engine.setRoom when provided', async () => {
    const room = loadedRoom()
    const resolvedObjectIds = new Set(['room-npc'])

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      resolvedObjectIds,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room, { resolvedObjectIds })
  })

  it('omits chaseOptInNpcIds from engine.setRoom when the prop is absent', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room)
  })

  it('omits chaseOptInNpcIds from engine.setRoom when the prop is an empty set', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      chaseOptInNpcIds: new Set<string>(),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room)
  })

  it('passes a non-empty chaseOptInNpcIds through to engine.setRoom', async () => {
    const room = loadedRoom()
    const chaseOptInNpcIds = new Set(['room-npc'])

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      chaseOptInNpcIds,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room, { chaseOptInNpcIds })
  })

  it('passes both resolvedObjectIds and a non-empty chaseOptInNpcIds together in the same SetRoomOptions', async () => {
    const room = loadedRoom()
    const resolvedObjectIds = new Set(['room-npc'])
    const chaseOptInNpcIds = new Set(['room-npc'])

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      resolvedObjectIds,
      chaseOptInNpcIds,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room, { resolvedObjectIds, chaseOptInNpcIds })
  })

  it('omits npcRoutineModes from engine.setRoom when the prop is absent', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room)
  })

  it('omits npcRoutineModes from engine.setRoom when the prop is an empty map', async () => {
    const room = loadedRoom()

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      npcRoutineModes: new Map<string, string>(),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room)
  })

  it('passes a non-empty npcRoutineModes through to engine.setRoom', async () => {
    const room = loadedRoom()
    const npcRoutineModes = new Map([['room-npc', 'patrol']])

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      npcRoutineModes,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room, { npcRoutineModes })
  })

  it('passes resolvedObjectIds, chaseOptInNpcIds, and npcRoutineModes together in the same SetRoomOptions', async () => {
    const room = loadedRoom()
    const resolvedObjectIds = new Set(['room-npc'])
    const chaseOptInNpcIds = new Set(['room-npc'])
    const npcRoutineModes = new Map([['room-npc', 'patrol']])

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      resolvedObjectIds,
      chaseOptInNpcIds,
      npcRoutineModes,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    expect(engine?.setRoom).toHaveBeenCalledWith(room, {
      resolvedObjectIds,
      chaseOptInNpcIds,
      npcRoutineModes,
    })
  })

  it('passes the current quest stage into NPCDialogueService.reply on the first Continue click after opening NPC dialogue', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'Quest-aware line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      questStage: { activeObjectiveId: 'get-past-steward-malik', status: 'active' },
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      history: [],
      playerLine: undefined,
      quest: { activeObjectiveId: 'get-past-steward-malik', status: 'active' },
    })
  })

  it('omits the quest stage when none is provided, on the first Continue click after opening NPC dialogue', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).not.toHaveProperty('quest')
  })

  it('gets room memory context with the real target npcId and passes it into NPCDialogueService.reply', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const getRoomMemoryContextForNpc = vi.fn(() => ({
      entries: [{ text: 'The east door is locked.', kind: 'room_observation' }],
    }))

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'Memory-aware line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      getRoomMemoryContextForNpc,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(getRoomMemoryContextForNpc).toHaveBeenCalledWith('room-npc')
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      history: [],
      playerLine: undefined,
      memoryContext: { entries: [{ text: 'The east door is locked.', kind: 'room_observation' }] },
    })
  })

  it('omits roomMemoryContext when the callback returns undefined, on the first Continue click after opening NPC dialogue', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const getRoomMemoryContextForNpc = vi.fn(() => undefined)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      getRoomMemoryContextForNpc,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(getRoomMemoryContextForNpc).toHaveBeenCalledWith('room-npc')
    expect(replies[0]).not.toHaveProperty('memoryContext')
  })

  it('omits roomMemoryContext when no callback is provided, on the first Continue click after opening NPC dialogue', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).not.toHaveProperty('memoryContext')
  })

  it('gets relationship context with the real target npcId and passes it into NPCDialogueService.reply', async () => {
    const replies: unknown[] = []
    const room = loadedRoom()
    const relationshipState = {
      schemaVersion: 1,
      scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'room-npc' },
      subject: 'npc',
      object: 'player',
      axes: { trust: 0, respect: 0, fear: 0, familiarity: 50 },
      interactionCount: 3,
    }
    const getRelationshipContextForNpc = vi.fn(() => relationshipState)

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: { resolve: async () => ({ status: 'rejected', reason: 'missing-effect' }) },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async (input: unknown) => {
          replies.push(input)
          return { status: 'replied', turn: { speaker: 'npc', text: 'A familiar line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      getRelationshipContextForNpc,
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(getRelationshipContextForNpc).toHaveBeenCalledWith('room-npc')
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      relationshipState,
    })
  })

  it('passes prompt time context into NPCDialogueService.reply', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'A time-aware line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
      timeContext: { timeOfDay: 'dusk' },
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      npcId: 'room-npc',
      timeContext: { timeOfDay: 'dusk' },
    })
  })

  it('omits relationshipState when no callback is provided, on the first Continue click after opening NPC dialogue', async () => {
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
          return { status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }
        },
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
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
    expect(replies).toHaveLength(0)

    const handleNPCSay = mockState.callbacks[0] as (promptId: string | undefined) => void
    handleNPCSay(undefined)

    await Promise.resolve()

    expect(replies).toHaveLength(1)
    expect(replies[0]).not.toHaveProperty('relationshipState')
  })

  it('uses authored post-use body for an already-resolved offering coffer', async () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'throne-room',
      name: 'Throne Room',
      shell: { dimensions: { width: 14, depth: 20, height: 6 } },
      spawn: { position: [0, 1.7, 8] },
      objects: [{
        type: 'crate',
        id: 'offering-coffer',
        position: [3, 0, 4],
        interaction: {
          key: 'E',
          prompt: 'Press E to open the offering coffer',
          body: 'A coffer of tribute left for the court. A single gold coin remains.',
          effect: {
            kind: 'take-item',
            item: { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 },
          },
        },
      }],
    })
    const state = {
      schemaVersion: 1,
      worldId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      currentRoomId: 'throne-room',
      player: { health: { current: 10, max: 10 }, status: [] },
      inventory: [],
      roomStates: {
        'throne-room': {
          visited: true,
          flags: { 'interaction:offering-coffer': true },
        },
      },
      revision: 1,
      updatedAt: '2026-06-28T00:00:00.000Z',
    }

    const props = {
      roomSource: { getRoom: async () => ({ ok: true, room }) },
      sessionId: 'session-1',
      interactionService: {
        resolve: async () => ({ status: 'already-resolved', outcome: { kind: 'nothing' }, state }),
      },
      encounterService: { resolve: async () => ({ status: 'failed', reason: 'not-found' }) },
      npcDialogueService: {
        reply: async () => ({ status: 'replied', turn: { speaker: 'npc', text: 'A line.' } }),
      },
      onNavigate: async () => ({ status: 'failed', reason: 'not-found' }),
    } as unknown as Parameters<typeof RoomViewer>[0]
    RoomViewer(props)

    await Promise.resolve()
    await Promise.resolve()

    const engine = mockState.engineInstances[0]
    engine?.onRequestOpenInteraction?.({
      id: 'offering-coffer',
      type: 'crate',
      label: 'Offering coffer',
      affordance: 'take',
      key: 'E',
      prompt: 'Press E to open the offering coffer',
      body: 'A coffer of tribute left for the court. A single gold coin remains.',
      position: { x: 3, y: 0, z: 4 },
    })

    await Promise.resolve()

    const setDialogue = mockState.stateSetters[1]
    expect(setDialogue).toHaveBeenCalledWith(expect.objectContaining({
      id: 'offering-coffer',
      body: 'A coffer of tribute left for the court. A single gold coin remains.',
    }))
    expect(setDialogue).toHaveBeenCalledWith(expect.objectContaining({
      id: 'offering-coffer',
      body: 'The coffer lies open and empty - the coin is gone.',
    }))
  })
})
