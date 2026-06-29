import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AppRoomEntryOverlay,
} from './App'
import {
  attachPerRoomObjectiveOnEnter,
  buildQuestStage,
  readPerRoomObjectiveMemo,
  resolvedObjectIdsForGeneratedPlay,
  resolvedObjectIdsForRoom,
  shouldStartPerRoomObjectiveAttach,
} from './app/App.helpers'
import { buildPromptGeneratedRoomSource } from './app/buildPromptGeneratedRoomSource'
import { buildGeneratedObjectiveAttachment, buildGeneratedObjectiveQuestSpec } from './app/generatedObjective'
import { FALLBACK_NOTICE } from './app/fallbackNotice'
import { buildRoomIntroView } from './app/roomIntro'
import { loadRoomSpec } from './domain/loadRoomSpec'
import type { LoadedRoom } from './domain/loadRoomSpec'
import { evaluateQuest } from './domain/quests/evaluateQuest'
import type { WorldState } from './domain/world/worldState'
import type { ObjectiveGenerator } from './domain/ports/ObjectiveGenerator'
import type { RoomGenerator } from './domain/ports/RoomGenerator'
import type { Logger } from './platform/logger/Logger'
import { computeDerivedViews } from './app/derivedViews'
import { QuestTracker } from './renderer/ui/QuestTracker'
import { FakeObjectiveGenerator } from './generation/FakeObjectiveGenerator'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { FakeWorldBibleSeeder } from './generation/FakeWorldBibleSeeder'
import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'
import { prepareGeneratedRoomSeed } from './app/worldBible'
import { themeVocabulary } from './domain/generatedRoomThemeVocabulary'
import { buildAdjacentRoomSeed } from './app/buildAdjacentRoomSeed'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { demoQuestSpec } from './domain/examples/demoQuest'

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function makeRoom(objects: unknown[], id = 'room-a', name = 'ruined investigation room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name,
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6] },
    objects,
  })
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'generated-room',
    player: { health: { current: 75, max: 100 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function renderOverlay(room: LoadedRoom | null, notice: string | null = null, entrySeq = 1) {
  return renderToStaticMarkup(
    <AppRoomEntryOverlay
      room={room}
      sessionId="session-1"
      entrySeq={entrySeq}
      notice={notice}
      onDismissNotice={() => undefined}
    />,
  )
}

describe('App room intro wiring', () => {
  it('renders RoomIntroPanel text for an active room with useful objects', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -4] },
      { type: 'table', position: [2, 0, 0] },
    ])
    const html = renderOverlay(room)
    expect(html).toContain('You enter the ruined investigation room.')
    expect(html).toContain('A corpse lies to the north')
    expect(html).toContain('role="status"')
  })

  it('does not render an intro panel when buildRoomSummary returns null', () => {
    const room = makeRoom([
      { type: 'prop', position: [0, 0, 0] },
      { type: 'pillar', position: [3, 0, 0] },
    ])
    expect(renderOverlay(room)).toBe('')
  })

  it('fallback/repaired notice renders independently from the room intro', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -4] },
    ])
    const html = renderOverlay(room, FALLBACK_NOTICE)
    expect(html).toContain('A corpse lies to the north')
    expect(html).toContain('safe one. Try another prompt.')
    expect(html).toContain('room-notice')
    expect(html).toContain('Dismiss notice')
    expect(html).toContain('Dismiss room introduction')
  })

  it('room intro key changes when entering a different room', () => {
    const first = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'room-a')
    const second = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'room-b')
    expect(buildRoomIntroView(first, 'session-1', 1).roomKey).toBe('session-1:room-a:1')
    expect(buildRoomIntroView(second, 'session-1', 2).roomKey).toBe('session-1:room-b:2')
  })

  it('room intro key changes for a new entry even when the room id repeats', () => {
    const room = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'generated-room')
    expect(buildRoomIntroView(room, 'session-1', 1).roomKey).toBe('session-1:generated-room:1')
    expect(buildRoomIntroView(room, 'session-1', 2).roomKey).toBe('session-1:generated-room:2')
  })

  it('does not leak object names or interaction bodies through App wiring', () => {
    const room = makeRoom([
      {
        type: 'npc',
        name: 'Secret Named NPC',
        position: [0, 0, -3],
        interaction: {
          key: 'F',
          prompt: 'Talk to the secret named NPC',
          body: 'Raw interaction body should not appear.',
        },
      },
    ])
    const html = renderOverlay(room)
    expect(html).toContain('A figure waits to the north')
    expect(html).not.toContain('Secret Named NPC')
    expect(html).not.toContain('Raw interaction body')
    expect(html).not.toContain('Talk to the secret')
  })
})

describe('App generated room NPC request wiring', () => {
  const generatedRoom = JSON.stringify({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [{ type: 'pillar', position: [4, 0, -2] }],
  })

  it('classifies the raw prompt and passes only a boolean NPC request downstream', async () => {
    const calls: string[] = []
    const generator: RoomGenerator = {
      generate: (seed) => {
        calls.push(seed)
        return Promise.resolve(generatedRoom)
      },
    }
    const source = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'make a bunker with someone to talk to',
      generatorSeed: 'world-bible seed without the request phrase',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })

    const result = await source.getRoom()

    expect(calls).toEqual(['world-bible seed without the request phrase'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(true)
    }
  })

  it('does not request NPC insertion for a raw prompt without living NPC intent', async () => {
    const generator: RoomGenerator = {
      generate: () => Promise.resolve(generatedRoom),
    }
    const source = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'make an empty bunker with a barrel',
      generatorSeed: 'empty bunker seed',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })

    const result = await source.getRoom()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
    }
  })
})

describe('App generated objective prompt-path wiring', () => {
  const generatedQuestSpec = {
    questId: 'generated-room-objective',
    title: 'Generated title',
    anchorRoomId: 'generated-room-secret',
    objectives: [
      {
        id: 'generated-0',
        text: 'Generated objective text that must not leak',
        condition: {
          kind: 'room-flag' as const,
          roomId: 'generated-room-secret',
          flag: 'interaction:object-secret-target',
        },
      },
    ],
  }

  it('attaches a trusted QuestSpec when FakeObjectiveGenerator returns valid raw JSON', async () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read secret prompt', effect: { kind: 'inspect' } },
      },
    ], 'generated-room', 'Secret Generated Room')

    const spec = await buildGeneratedObjectiveQuestSpec(room, new FakeObjectiveGenerator())

    expect(spec).toMatchObject({
      questId: 'generated-room-objective',
      title: 'Secure the room',
      anchorRoomId: 'generated-room',
      objectives: [
        {
          id: 'generated-0',
          text: 'Investigate the marked feature.',
          condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'interaction:note-1' },
        },
      ],
    })
  })

  it('generated QuestSpec works with evaluateQuest when the referenced interaction flag is set', async () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ], 'generated-room')
    const spec = await buildGeneratedObjectiveQuestSpec(room, new FakeObjectiveGenerator())

    expect(spec).not.toBeNull()
    expect(evaluateQuest(spec!, makeState()).objectives[0]?.done).toBe(false)
    expect(
      evaluateQuest(
        spec!,
        makeState({
          roomStates: { 'generated-room': { visited: true, flags: { 'interaction:note-1': true } } },
        }),
      ).objectives[0]?.done,
    ).toBe(true)
  })

  it('keeps questSpec null for null, bad, or throwing objective results while preserving the room', async () => {
    const room = makeRoom([
      { type: 'crate', id: 'crate-1', position: [0, 0, -2] },
    ], 'generated-room')
    const before = JSON.stringify(room)
    const badGenerator: ObjectiveGenerator = { generate: async () => '{"bad"' }
    const throwingGenerator: ObjectiveGenerator = {
      generate: async () => {
        throw new Error('fixed-test-error')
      },
    }

    await expect(buildGeneratedObjectiveQuestSpec(room, new FakeObjectiveGenerator())).resolves.toBeNull()
    await expect(buildGeneratedObjectiveQuestSpec(room, badGenerator)).resolves.toBeNull()
    await expect(buildGeneratedObjectiveQuestSpec(room, throwingGenerator)).resolves.toBeNull()
    expect(JSON.stringify(room)).toBe(before)
  })

  it('does not leak room, object, prompt, or raw provider text into generated quest specs', async () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read secret prompt',
          body: 'Raw provider body should not appear.',
          effect: { kind: 'inspect' },
        },
      },
    ], 'generated-room', 'Secret Room Name')

    const spec = await buildGeneratedObjectiveQuestSpec(room, new FakeObjectiveGenerator())
    const dump = JSON.stringify(spec)

    expect(dump).not.toContain('Secret Room Name')
    expect(dump).not.toContain('Read secret prompt')
    expect(dump).not.toContain('Raw provider body')
    expect(dump).not.toContain('generated JSON')
  })

  it('renders a QuestTracker for a prompt-generated room and completes on interaction', async () => {
    // Mirror the App's prompt path: real generator → assembly pipeline → objective.
    const source = buildPromptGeneratedRoomSource({
      generator: new FakeRoomGenerator(),
      rawUserPrompt: 'a quiet archive',
      generatorSeed: 'a quiet archive',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })
    const result = await source.getRoom()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const attachment = await buildGeneratedObjectiveAttachment(result.room, new FakeObjectiveGenerator())
    expect(attachment).not.toBeNull()

    // The tracker renders (App gates `{quest && <QuestTracker/>}` on this view).
    const active = computeDerivedViews(
      makeState({ currentRoomId: result.room.id }),
      attachment!.questSpec,
      null,
    )
    expect(active.quest).not.toBeNull()
    const html = renderToStaticMarkup(<QuestTracker view={active.quest!} />)
    expect(html).toContain('Secure the room')
    expect(html).toContain('Investigate the marked feature.')

    // Interacting with the chosen object sets its flag and completes the objective.
    const condition = attachment!.questSpec.objectives[0]!.condition
    expect(condition.kind).toBe('room-flag')
    if (condition.kind !== 'room-flag') return
    const completed = computeDerivedViews(
      makeState({
        currentRoomId: result.room.id,
        roomStates: { [result.room.id]: { visited: true, flags: { [condition.flag]: true } } },
      }),
      attachment!.questSpec,
      null,
    )
    expect(completed.quest?.status).toBe('complete')
  })

  it('prompt-generated objective context can surface hint without demo quest copy', async () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ], 'generated-room')
    const attachment = await buildGeneratedObjectiveAttachment(room, new FakeObjectiveGenerator())
    expect(attachment).not.toBeNull()

    const provider = new FakeNPCDialogueProvider()
    const reply = await provider.reply({
      context: {
        roomId: 'generated-room',
        npcId: 'generated-npc',
        npcName: 'Generated NPC',
        persona: 'friendly-aide',
        quest: {
          activeObjectiveId: 'generated-0',
          status: 'active',
          hint: attachment!.hint,
          completionHint: attachment!.completionHint,
        },
        player: { health: { current: 75, max: 100 }, status: [], inventoryItemIds: [] },
        history: [],
      },
    })

    expect(reply.text).toBe(attachment!.hint)
    expect(reply.text).not.toContain('Steward')
    expect(reply.text).not.toContain('Malik')
    expect(reply.text).not.toContain('tribute coffer')
  })

  it('adds closed objective context to generated per-room questStage for active objectives', () => {
    const quest = evaluateQuest(generatedQuestSpec, makeState())
    const questStage = buildQuestStage({
      quest,
      questHints: {
        hint: 'Generated hint that must stay separate.',
        completionHint: 'Generated completion hint that must stay separate.',
      },
      questSpec: generatedQuestSpec,
    })

    expect(questStage).toEqual({
      activeObjectiveId: 'generated-0',
      status: 'active',
      hint: 'Generated hint that must stay separate.',
      completionHint: 'Generated completion hint that must stay separate.',
      objective: { status: 'active', kind: 'inspect' },
    })
  })

  it('omits objective context for authored/demo questStage when generated hints are absent', () => {
    const quest = evaluateQuest(demoQuestSpec, makeState({ currentRoomId: 'throne-room' }))
    const questStage = buildQuestStage({
      quest,
      questHints: null,
      questSpec: demoQuestSpec,
    })

    expect(questStage).toBeDefined()
    expect(questStage).not.toHaveProperty('objective')
  })

  it('omits objective context when the active objective cannot be found', () => {
    const quest = {
      ...evaluateQuest(generatedQuestSpec, makeState()),
      activeObjectiveId: 'missing-objective',
    }
    const questStage = buildQuestStage({
      quest,
      questHints: {
        hint: 'Generated hint that must stay separate.',
        completionHint: 'Generated completion hint that must stay separate.',
      },
      questSpec: generatedQuestSpec,
    })

    expect(questStage).toMatchObject({
      activeObjectiveId: 'missing-objective',
      status: 'active',
      hint: 'Generated hint that must stay separate.',
      completionHint: 'Generated completion hint that must stay separate.',
    })
    expect(questStage).not.toHaveProperty('objective')
  })

  it('marks generated objective context complete when the generated quest is complete', () => {
    const quest = evaluateQuest(generatedQuestSpec, makeState({
      roomStates: {
        'generated-room-secret': {
          visited: true,
          flags: { 'interaction:object-secret-target': true },
        },
      },
    }))
    const questStage = buildQuestStage({
      quest,
      questHints: {
        hint: 'Generated hint that must stay separate.',
        completionHint: 'Generated completion hint that must stay separate.',
      },
      questSpec: generatedQuestSpec,
    })

    expect(quest.status).toBe('complete')
    expect(questStage?.objective).toEqual({ status: 'complete', kind: 'inspect' })
  })

  it('does not leak generated objective details through serialized objective context', () => {
    const quest = evaluateQuest(generatedQuestSpec, makeState())
    const questStage = buildQuestStage({
      quest,
      questHints: {
        hint: 'Generated hint with provider output and user prompt text.',
        completionHint: 'Generated completion with object-secret-target.',
      },
      questSpec: generatedQuestSpec,
    })
    const serializedObjective = JSON.stringify(questStage?.objective)

    expect(serializedObjective).toBe('{"status":"active","kind":"inspect"}')
    expect(serializedObjective).not.toContain('object-secret-target')
    expect(serializedObjective).not.toContain('generated-room-secret')
    expect(serializedObjective).not.toContain('interaction:')
    expect(serializedObjective).not.toContain('Generated hint')
    expect(serializedObjective).not.toContain('Generated objective text')
    expect(serializedObjective).not.toContain('provider output')
    expect(serializedObjective).not.toContain('user prompt')
  })
})

describe('App resolved object projection wiring', () => {
  function resolvedRoom() {
    return makeRoom([
      {
        type: 'scroll',
        id: 'case-file',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'crate',
        id: 'supply-crate',
        position: [2, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Take',
          effect: {
            kind: 'take-item',
            item: { itemId: 'battery', name: 'Battery', quantity: 1 },
          },
        },
      },
      {
        type: 'machine',
        id: 'repeatable-station',
        position: [-2, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Use',
          effect: { kind: 'use-item', itemId: 'battery', quantity: 1 },
        },
      },
    ], 'generated-room-b')
  }

  it('resolvedObjectIdsForRoom projects inspect and take one-shot flags', () => {
    const room = resolvedRoom()
    const projected = resolvedObjectIdsForRoom(makeState({
      currentRoomId: room.id,
      roomStates: {
        [room.id]: {
          visited: true,
          flags: {
            'interaction:case-file': true,
            'interaction:supply-crate': true,
          },
        },
      },
    }), room)

    expect([...projected].sort()).toEqual(['case-file', 'supply-crate'])
  })

  it('resolvedObjectIdsForRoom keeps use-item repeatable and handles missing room state', () => {
    const room = resolvedRoom()
    const projected = resolvedObjectIdsForRoom(makeState({
      currentRoomId: room.id,
      roomStates: {
        [room.id]: {
          visited: true,
          flags: { 'interaction:repeatable-station': true },
        },
      },
    }), room)

    expect([...projected]).toEqual([])
    expect([...resolvedObjectIdsForRoom(makeState({ currentRoomId: room.id }), room)]).toEqual([])
  })

  it('generated-play App gate returns resolved ids and authored/demo gate omits them', () => {
    const room = resolvedRoom()
    const state = makeState({
      currentRoomId: room.id,
      roomStates: {
        [room.id]: { visited: true, flags: { 'interaction:case-file': true } },
      },
    })

    expect([...(resolvedObjectIdsForGeneratedPlay({
      objectivesPerRoom: true,
      state,
      room,
    }) ?? [])]).toEqual(['case-file'])
    expect(resolvedObjectIdsForGeneratedPlay({
      objectivesPerRoom: false,
      state,
      room,
    })).toBeUndefined()
    expect(resolvedObjectIdsForGeneratedPlay({ state, room })).toBeUndefined()
  })

  it('projects a B-room object after A to B interaction, C travel, and return to B state shape', () => {
    const roomB = resolvedRoom()
    const returnedToBState = makeState({
      currentRoomId: roomB.id,
      roomStates: {
        'generated-room-a': { visited: true },
        [roomB.id]: {
          visited: true,
          flags: { 'interaction:case-file': true },
        },
        'generated-room-c': { visited: true },
      },
    })

    expect([...resolvedObjectIdsForRoom(returnedToBState, roomB)]).toEqual(['case-file'])
  })
})

describe('App generated-play adjacent room source wiring', () => {
  const markerlessGeneratedRoom = JSON.stringify({
    schemaVersion: 1,
    id: 'adjacent-room',
    name: 'Adjacent Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [
      {
        type: 'book',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', body: 'Some pages.' },
      },
    ],
  })

  it('enables objective-target enrichment for generated-play adjacent sources only', async () => {
    const generator: RoomGenerator = { generate: async () => markerlessGeneratedRoom }

    const generatedPlayAdjacentSource = new GeneratedRoomSource(
      generator,
      buildAdjacentRoomSeed('generated-adjacent', undefined),
      noopLogger,
      makeRoom([]),
      { enrichObjectiveTarget: true },
    )
    const exampleAdjacentSource = new GeneratedRoomSource(
      generator,
      'adjacent:example-adjacent',
      noopLogger,
      makeRoom([]),
    )

    const generatedPlayResult = await generatedPlayAdjacentSource.getRoom()
    const exampleResult = await exampleAdjacentSource.getRoom()

    expect(generatedPlayResult.ok).toBe(true)
    expect(exampleResult.ok).toBe(true)
    if (!generatedPlayResult.ok || !exampleResult.ok) return

    const target = generatedPlayResult.room.objects.find((object) => object.id === 'generated-objective-target')
    expect(target).toBeDefined()
    expect(target && 'interaction' in target ? target.interaction?.effect : undefined).toEqual({ kind: 'inspect' })

    const exampleBook = exampleResult.room.objects.find((object) => object.type === 'book')
    expect(exampleBook?.id).toBeUndefined()
    expect(exampleBook && 'interaction' in exampleBook ? exampleBook.interaction?.effect : undefined).toBeUndefined()
  })
})

describe('App per-room objective memo state', () => {
  function createSafeLogger() {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = []
    const safeLogger: Pick<Logger, 'debug' | 'info'> = {
      debug: (message, context = {}) => logs.push({ message, context }),
      info: (message, context = {}) => logs.push({ message, context }),
    }
    return { logger: safeLogger, logs }
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  async function buildRoomOneAttachment() {
    const source = buildPromptGeneratedRoomSource({
      generator: new FakeRoomGenerator(),
      rawUserPrompt: 'a quiet archive',
      generatorSeed: 'a quiet archive',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })
    const result = await source.getRoom()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected generated room')
    const attachment = await buildGeneratedObjectiveAttachment(result.room, new FakeObjectiveGenerator())
    expect(attachment).not.toBeNull()
    return { room: result.room, attachment: attachment! }
  }

  it('seeds and restores the prompt-generated room #1 objective attachment', async () => {
    const { room, attachment } = await buildRoomOneAttachment()
    const memo = new Map([[room.id, attachment]])

    const restored = readPerRoomObjectiveMemo(memo, room.id)

    expect(restored.cached).toBe(true)
    expect(restored.questSpec).toBe(attachment.questSpec)
    expect(restored.questHints).toEqual({
      hint: attachment.hint,
      completionHint: attachment.completionHint,
    })
  })

  it('clears stale generated quest state for uncached rooms and restores room #1 when revisited', async () => {
    const { room, attachment } = await buildRoomOneAttachment()
    const memo = new Map([[room.id, attachment]])

    const uncached = readPerRoomObjectiveMemo(memo, 'generated-adjacent-room')
    const revisited = readPerRoomObjectiveMemo(memo, room.id)

    expect(uncached).toEqual({ cached: false, questSpec: null, questHints: null })
    expect(revisited.questSpec).toBe(attachment.questSpec)
    expect(revisited.questHints?.hint).toBe(attachment.hint)
  })

  it('treats cached null as a valid cleared objective result', () => {
    const memo = new Map([['generated-empty-room', null]])

    const restored = readPerRoomObjectiveMemo(memo, 'generated-empty-room')

    expect(restored).toEqual({ cached: true, questSpec: null, questHints: null })
  })

  it('leaves authored demo quest projection unchanged outside the per-room memo', () => {
    const state = makeState({ currentRoomId: 'throne-room' })
    const before = computeDerivedViews(state, demoQuestSpec, null)
    const memo = new Map([['throne-room', null]])
    const after = computeDerivedViews(state, demoQuestSpec, null)

    expect(readPerRoomObjectiveMemo(memo, 'throne-room').questSpec).toBeNull()
    expect(before.quest?.activeObjectiveId).toBe(after.quest?.activeObjectiveId)
    expect(after.quest?.status).toBe('active')
  })

  it('does not require an objective provider call to restore navigation memo state', async () => {
    const { room, attachment } = await buildRoomOneAttachment()
    let providerCalls = 0
    const provider: ObjectiveGenerator = {
      generate: async () => {
        providerCalls += 1
        return null
      },
    }
    const memo = new Map([[room.id, attachment]])

    const restored = readPerRoomObjectiveMemo(memo, room.id)

    expect(restored.questSpec).toBe(attachment.questSpec)
    expect(providerCalls).toBe(0)
    expect(provider).toBeDefined()
  })

  it('attaches an objective asynchronously for an uncached generated-provenance room', async () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ], 'generated-adjacent')
    const memo = new Map()
    const { logger: safeLogger, logs } = createSafeLogger()
    let providerCalls = 0
    let applied = false
    let refreshes = 0
    const provider: ObjectiveGenerator = {
      generate: async () => {
        providerCalls += 1
        return JSON.stringify({
          title: 'Secure the room',
          description: 'Inspect the marked feature.',
          hint: 'Look for the feature.',
          completionHint: 'The feature is handled.',
          condition: { kind: 'interact-object', objectId: 'note-1' },
        })
      },
    }

    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: true,
      provenance: 'generated',
      memo,
      roomId: room.id,
    })).toBe(true)

    await attachPerRoomObjectiveOnEnter({
      room,
      sessionId: SESSION_ID,
      memo,
      usageCount: 0,
      guardConfig: { enabled: false, cap: 3 },
      objectiveGenerator: provider,
      logger: safeLogger,
      getCurrentPlay: () => ({ room, sessionId: SESSION_ID }),
      applyAttachment: (attachment) => {
        applied = attachment != null
      },
      refreshAfterApply: async () => {
        refreshes += 1
      },
    })

    expect(providerCalls).toBe(1)
    expect(memo.get(room.id)).not.toBeNull()
    expect(applied).toBe(true)
    expect(refreshes).toBe(1)
    expect(logs).toContainEqual({
      message: 'optional objective generation allowed',
      context: { count: 0, cap: 3, roomId: room.id },
    })
    expect(logs).toContainEqual({
      message: 'per-room objective attached',
      context: { roomId: room.id, attached: true },
    })
  })

  it('skips provider calls for cached rooms and non-generated or authored/demo entries', async () => {
    const { room, attachment } = await buildRoomOneAttachment()
    const memo = new Map([[room.id, attachment]])
    let providerCalls = 0
    const provider: ObjectiveGenerator = {
      generate: async () => {
        providerCalls += 1
        return null
      },
    }

    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: true,
      provenance: 'generated',
      memo,
      roomId: room.id,
    })).toBe(false)
    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: true,
      provenance: 'repaired',
      memo: new Map(),
      roomId: 'repaired-room',
    })).toBe(false)
    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: false,
      provenance: 'generated',
      memo: new Map(),
      roomId: 'authored-room',
    })).toBe(false)

    await attachPerRoomObjectiveOnEnter({
      room,
      sessionId: SESSION_ID,
      memo,
      usageCount: 0,
      guardConfig: { enabled: false, cap: 3 },
      objectiveGenerator: provider,
      logger: createSafeLogger().logger,
      getCurrentPlay: () => ({ room, sessionId: SESSION_ID }),
      applyAttachment: () => undefined,
      refreshAfterApply: async () => undefined,
    })

    expect(providerCalls).toBe(0)
    const demoQuest = computeDerivedViews(makeState({ currentRoomId: 'throne-room' }), demoQuestSpec, null).quest
    expect(demoQuest?.status).toBe('active')
  })

  it('memoizes null on budget skip and leaves the room without a quest', async () => {
    const room = makeRoom([], 'generated-at-cap')
    const memo = new Map()
    const { logger: safeLogger, logs } = createSafeLogger()
    let providerCalls = 0
    let applied: unknown = 'not-called'
    const provider: ObjectiveGenerator = {
      generate: async () => {
        providerCalls += 1
        return '{}'
      },
    }

    await attachPerRoomObjectiveOnEnter({
      room,
      sessionId: SESSION_ID,
      memo,
      usageCount: 3,
      guardConfig: { enabled: true, cap: 3 },
      objectiveGenerator: provider,
      logger: safeLogger,
      getCurrentPlay: () => ({ room, sessionId: SESSION_ID }),
      applyAttachment: (attachment) => {
        applied = attachment
      },
      refreshAfterApply: async () => undefined,
    })

    expect(providerCalls).toBe(0)
    expect(memo.has(room.id)).toBe(true)
    expect(memo.get(room.id)).toBeNull()
    expect(applied).toBeNull()
    expect(logs).toContainEqual({
      message: 'optional objective generation skipped',
      context: { count: 3, cap: 3, roomId: room.id, reason: 'usage-cap' },
    })
  })

  it('memoizes null when the objective provider returns null', async () => {
    const room = makeRoom([], 'generated-no-objective')
    const memo = new Map()
    let applied: unknown = 'not-called'
    const provider: ObjectiveGenerator = { generate: async () => null }

    await attachPerRoomObjectiveOnEnter({
      room,
      sessionId: SESSION_ID,
      memo,
      usageCount: 0,
      guardConfig: { enabled: false, cap: 3 },
      objectiveGenerator: provider,
      logger: createSafeLogger().logger,
      getCurrentPlay: () => ({ room, sessionId: SESSION_ID }),
      applyAttachment: (attachment) => {
        applied = attachment
      },
      refreshAfterApply: async () => undefined,
    })

    expect(memo.has(room.id)).toBe(true)
    expect(memo.get(room.id)).toBeNull()
    expect(applied).toBeNull()
  })

  it('discards stale async objective results when the player has moved on', async () => {
    const { room, attachment } = await buildRoomOneAttachment()
    const nextRoom = makeRoom([], 'next-room')
    const memo = new Map()
    const pending = deferred<typeof attachment>()
    let applied = false
    let refreshes = 0
    let current = { room, sessionId: SESSION_ID }

    const attach = attachPerRoomObjectiveOnEnter({
      room,
      sessionId: SESSION_ID,
      memo,
      usageCount: 0,
      guardConfig: { enabled: false, cap: 3 },
      objectiveGenerator: { generate: async () => null },
      logger: createSafeLogger().logger,
      getCurrentPlay: () => current,
      applyAttachment: () => {
        applied = true
      },
      refreshAfterApply: async () => {
        refreshes += 1
      },
      buildAttachment: async () => pending.promise,
    })

    current = { room: nextRoom, sessionId: SESSION_ID }
    pending.resolve(attachment)
    await attach

    expect(memo.get(room.id)).toBe(attachment)
    expect(applied).toBe(false)
    expect(refreshes).toBe(0)
  })
})

// Browser-equivalent smoke for the FAKE-provider prompt path. The earlier unit
// tests fed the raw prompt straight to a default FakeRoomGenerator, skipping the
// two live-only steps the App actually runs: world-bible seeding (which picks the
// themePack + a generator SEED that differs from the raw prompt) and the
// themePack vocabulary. This drives that exact orchestration so a future
// regression in the seed/themePack wiring is caught instead of slipping through.
//
// NOTE on the real-provider gap this codifies: when a REAL room generator is
// configured the live room has no `objective-document` marker, so the objective
// degrades to none by design. These tests pin the supported fake-provider path.
async function runFakePromptPath(prompt: string) {
  const prepared = await prepareGeneratedRoomSeed(prompt, new FakeWorldBibleSeeder(), noopLogger)
  // Mirror App.handlePrompt: themePack vocabulary + the world-bible generator seed
  // (NOT the raw prompt) feed the fake generator through the assembly pipeline.
  const vocabulary = themeVocabulary(prepared.worldBible?.themePack)
  const source = buildPromptGeneratedRoomSource({
    generator: new FakeRoomGenerator(vocabulary),
    rawUserPrompt: prompt,
    generatorSeed: prepared.generatorSeed,
    themePack: prepared.worldBible?.themePack,
    logger: noopLogger,
    fallbackRoom: makeRoom([]),
  })
  const result = await source.getRoom()
  if (!result.ok) throw new Error('expected a playable room')
  // App gates objective attachment on a clean `generated` room.
  const attachment = result.provenance === 'generated'
    ? await buildGeneratedObjectiveAttachment(result.room, new FakeObjectiveGenerator())
    : null
  return { result, attachment }
}

describe('App fake-provider prompt path renders a generated QuestTracker', () => {
  // Includes a post-apoc ("survivor") prompt: the one from the failing smoke,
  // which routes through a different themePack/seed than the fantasy prompts.
  const PROMPTS = [
    'Create a quiet archive room with one survivor NPC, one readable document, one crate, and one exit.',
    'a quiet archive',
    'a haunted hall',
    'a dripping crypt',
  ]

  it.each(PROMPTS)('attaches a satisfiable objective and renders the tracker for %j', async (prompt) => {
    const { result, attachment } = await runFakePromptPath(prompt)

    if (!result.ok) throw new Error('expected a playable room')
    expect(result.provenance).toBe('generated')
    expect(attachment, `no objective attached for prompt ${JSON.stringify(prompt)}`).not.toBeNull()

    // questSpecRef.current → computeDerivedViews → a non-null quest view is what
    // gates `{quest && <QuestTracker/>}` in the App.
    const views = computeDerivedViews(
      makeState({ currentRoomId: result.room.id }),
      attachment!.questSpec,
      null,
    )
    expect(views.quest).not.toBeNull()

    const html = renderToStaticMarkup(<QuestTracker view={views.quest!} />)
    expect(html).toContain('Secure the room')
    expect(html).toContain('Investigate the marked feature.')
  })

  it('provider consumes a questStage carrying the generated hint', async () => {
    const { result, attachment } = await runFakePromptPath(
      'Create a quiet archive room with one survivor NPC, one readable document, one crate, and one exit.',
    )
    if (!result.ok) throw new Error('expected a playable room')
    expect(attachment).not.toBeNull()

    const views = computeDerivedViews(
      makeState({ currentRoomId: result.room.id }),
      attachment!.questSpec,
      null,
    )
    expect(views.quest).not.toBeNull()

    // Build the RoomViewer `questStage` exactly as App.tsx does (quest view +
    // the separate sanitized hint state), then confirm the NPC surfaces the hint.
    const questStage = {
      activeObjectiveId: views.quest!.activeObjectiveId,
      status: views.quest!.status,
      hint: attachment!.hint,
      completionHint: attachment!.completionHint,
    }
    const reply = await new FakeNPCDialogueProvider().reply({
      context: {
        roomId: result.room.id,
        npcId: 'generated-npc',
        npcName: 'Generated NPC',
        persona: 'friendly-aide',
        quest: questStage,
        player: { health: { current: 75, max: 100 }, status: [], inventoryItemIds: [] },
        history: [],
      },
    })

    expect(reply.text).toBe(attachment!.hint)
  })

  it('interacting with the referenced target completes the generated objective', async () => {
    const { result, attachment } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    expect(attachment).not.toBeNull()

    const condition = attachment!.questSpec.objectives[0]!.condition
    expect(condition.kind).toBe('room-flag')
    if (condition.kind !== 'room-flag') return

    const completed = computeDerivedViews(
      makeState({
        currentRoomId: result.room.id,
        roomStates: { [result.room.id]: { visited: true, flags: { [condition.flag]: true } } },
      }),
      attachment!.questSpec,
      null,
    )
    expect(completed.quest?.status).toBe('complete')
  })

  it('a marker-less prompt-generated room (real-provider shape) gets an objective target', async () => {
    const generator: RoomGenerator = {
      generate: async () => JSON.stringify({
        schemaVersion: 1,
        id: 'generated-room',
        name: 'Generated Room',
        shell: {
          dimensions: { width: 18, depth: 18, height: 4 },
          exits: [{ side: 'north', width: 3 }],
        },
        spawn: { position: [0, 1.7, 5] },
        objects: [
          {
            type: 'book',
            position: [0, 0, -2],
            interaction: { key: 'E', prompt: 'Read', body: 'Some pages.' },
          },
          { type: 'crate', position: [2, 0, 0] },
        ],
      }),
    }
    const source = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'a room with a readable clue',
      generatorSeed: 'safe generated seed',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })
    const result = await source.getRoom()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const attachment = await buildGeneratedObjectiveAttachment(result.room, new FakeObjectiveGenerator())
    expect(attachment).not.toBeNull()

    const views = computeDerivedViews(makeState({ currentRoomId: result.room.id }), attachment!.questSpec, null)
    expect(views.quest).not.toBeNull()
  })

  it('a direct marker-less room without prompt-path enrichment degrades to no quest without crashing', async () => {
    // A room with interactions but NO stable id + inspect effect — the shape a
    // real provider produces. The objective must degrade to none, not throw.
    const room = makeRoom([
      {
        type: 'book',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', body: 'Some pages.' },
      },
      { type: 'crate', position: [2, 0, 0] },
    ])
    const attachment = await buildGeneratedObjectiveAttachment(room, new FakeObjectiveGenerator())
    expect(attachment).toBeNull()

    const views = computeDerivedViews(makeState({ currentRoomId: room.id }), null, null)
    expect(views.quest).toBeNull()
  })
})
