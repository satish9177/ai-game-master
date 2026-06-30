import appSource from './App.tsx?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AppRoomEntryOverlay,
} from './App'
import {
  attachPerRoomObjectiveOnEnter,
  buildGeneratedRoomCacheSaveJson,
  buildGeneratedQuestSaveJson,
  buildQuestStage,
  readPerRoomObjectiveMemo,
  resolvedObjectIdsForGeneratedPlay,
  resolvedObjectIdsForRoom,
  shouldStartPerRoomObjectiveAttach,
} from './app/App.helpers'
import { loadGeneratedRoomCacheSaveState } from './domain/quests/generatedRoomCacheSaveState'
import { loadGeneratedQuestSaveState } from './domain/quests/generatedQuestSaveState'
import { restoreGeneratedQuestPlay } from './app/restoreGeneratedQuestPlay'
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
import { JournalPanel } from './renderer/ui/JournalPanel'
import { FakeObjectiveGenerator } from './generation/FakeObjectiveGenerator'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { FakeWorldBibleSeeder } from './generation/FakeWorldBibleSeeder'
import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'
import { prepareGeneratedRoomSeed } from './app/worldBible'
import { themeVocabulary } from './domain/generatedRoomThemeVocabulary'
import { buildAdjacentRoomSeed } from './app/buildAdjacentRoomSeed'
import { deriveStoryThreadContext, storyThreadToSeedPhrase } from './domain/generatedStoryThread'
import type { WorldBibleSeed } from './domain/worldBible/worldBibleSeed'
import { worldBibleToAdjacentThemeSeed } from './domain/worldBible/worldBibleToSeed'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { demoQuestSpec } from './domain/examples/demoQuest'
import { demoJournalSpec } from './domain/examples/demoJournal'

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
const SECRET_RAW_PROMPT = 'SECRET RAW PROMPT TEXT'

const secretWorldBible: WorldBibleSeed = {
  schemaVersion: 1,
  title: SECRET_RAW_PROMPT,
  themePack: 'fantasy-keep',
  tone: 'mysterious',
  premise: 'SECRET PREMISE TEXT',
  startingLocation: 'SECRET STARTING LOCATION',
  majorConflict: 'SECRET MAJOR CONFLICT',
  factions: ['SECRET FACTION'],
  npcs: [
    { name: 'SECRET NPC ONE', role: 'Secret role one', disposition: 'ally' },
    { name: 'SECRET NPC TWO', role: 'Secret role two', disposition: 'neutral' },
  ],
  locations: [
    { label: 'SECRET LOCATION ONE', kind: 'secret kind one' },
    { label: 'SECRET LOCATION TWO', kind: 'secret kind two' },
  ],
  generationHints: {
    allowedThemePack: 'fantasy-keep',
    keywords: ['ember', 'ward'],
  },
  canonNotes: ['SECRET CANON NOTE'],
  openingArc: {
    pattern: 'investigate',
    hook: 'SECRET ARC HOOK',
    firstObjective: 'SECRET ARC OBJECTIVE',
    pressure: 'SECRET ARC PRESSURE',
  },
}

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

  const anchorBiasRoom = JSON.stringify({
    schemaVersion: 1,
    id: 'anchor-bias-room',
    name: 'Anchor Bias Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [
      { type: 'throne', position: [0, 0, 0] },
      { type: 'book', position: [3, 0, 3] },
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

  it('uses a story phrase in adjacent seeds only when a WorldBible pattern exists', () => {
    const roomId = 'generated-room:exit:north'
    const adjacentThemeSeed = worldBibleToAdjacentThemeSeed(secretWorldBible)
    const storyContext = deriveStoryThreadContext(secretWorldBible.openingArc.pattern, roomId)
    const storyPhrase = storyContext ? storyThreadToSeedPhrase(storyContext) : undefined

    const seeded = buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase)
    const degraded = buildAdjacentRoomSeed(
      roomId,
      undefined,
      undefined,
    )

    expect(seeded).toBe(
      `${adjacentThemeSeed} | investigation | early clues | adjacent:${roomId}`,
    )
    expect(degraded).toBe(`adjacent:${roomId}`)
  })

  it('passes story kind to generated adjacent assembly while first prompt generation stays default', async () => {
    const roomId = 'generated-room:exit:north'
    const storyContext = deriveStoryThreadContext(secretWorldBible.openingArc.pattern, roomId)
    const storyPhrase = storyContext ? storyThreadToSeedPhrase(storyContext) : undefined
    const generator: RoomGenerator = { generate: async () => anchorBiasRoom }
    const adjacentSource = new GeneratedRoomSource(
      generator,
      buildAdjacentRoomSeed(
        roomId,
        worldBibleToAdjacentThemeSeed(secretWorldBible),
        storyPhrase,
      ),
      noopLogger,
      makeRoom([]),
      {
        themePack: secretWorldBible.themePack,
        enrichObjectiveTarget: true,
        storyKind: storyContext?.kind,
      },
    )
    const promptSource = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'investigate this room',
      generatorSeed: 'safe first-room seed',
      themePack: secretWorldBible.themePack,
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })

    const adjacentResult = await adjacentSource.getRoom()
    const promptResult = await promptSource.getRoom()

    expect(adjacentResult.ok).toBe(true)
    expect(promptResult.ok).toBe(true)
    if (!adjacentResult.ok || !promptResult.ok) return

    const adjacentBook = adjacentResult.room.objects.find((object) => object.type === 'book')
    const promptThrone = promptResult.room.objects.find((object) => object.type === 'throne')

    expect(adjacentBook?.position[0]).toBe(0)
    expect(adjacentBook?.position[2]).toBeLessThan(0)
    expect(promptThrone?.position[0]).toBe(0)
    expect(promptThrone?.position[2]).toBeLessThan(0)
  })

  it('keeps raw prompt and free-text WorldBible fields out of adjacent story seeds', () => {
    const roomId = 'generated-room:exit:north'
    const adjacentThemeSeed = worldBibleToAdjacentThemeSeed(secretWorldBible)
    const storyContext = deriveStoryThreadContext(secretWorldBible.openingArc.pattern, roomId)
    const storyPhrase = storyContext ? storyThreadToSeedPhrase(storyContext) : undefined
    const seed = buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase)

    expect(seed).toContain('investigation | early clues')
    expect(seed).not.toContain(SECRET_RAW_PROMPT)
    for (const secret of [
      secretWorldBible.title,
      secretWorldBible.premise,
      secretWorldBible.startingLocation,
      secretWorldBible.majorConflict,
      secretWorldBible.factions[0]!,
      secretWorldBible.npcs[0]!.name,
      secretWorldBible.npcs[0]!.role,
      secretWorldBible.locations[0]!.label,
      secretWorldBible.locations[0]!.kind,
      secretWorldBible.canonNotes[0]!,
      secretWorldBible.openingArc.hook,
      secretWorldBible.openingArc.firstObjective,
      secretWorldBible.openingArc.pressure,
    ]) {
      expect(seed).not.toContain(secret)
    }
  })

  it('App wiring reads only the closed openingArc pattern for story-thread context', () => {
    expect(appSource).toContain('prepared.worldBible?.openingArc.pattern')
    expect(appSource).toContain('deriveStoryThreadContext(storyKind, roomId)')
    expect(appSource).toContain('storyThreadToSeedPhrase(storyContext)')
    expect(appSource).toContain('buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase)')
    expect(appSource).toContain('storyKind: storyContext?.kind')
    expect(appSource).not.toContain('prepared.worldBible?.openingArc.hook')
    expect(appSource).not.toContain('prepared.worldBible?.openingArc.firstObjective')
    expect(appSource).not.toContain('prepared.worldBible?.openingArc.pressure')
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
  return { result, attachment, prepared }
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

describe('App generated consequence journal wiring', () => {
  it('renders the existing JournalPanel for a prompt-generated session', async () => {
    const { result, attachment, prepared } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    expect(prepared.worldBible).toBeDefined()

    const state = makeState({
      currentRoomId: result.room.id,
      roomStates: { [result.room.id]: { visited: true } },
    })
    const storyContext = deriveStoryThreadContext(
      prepared.worldBible?.openingArc.pattern,
      result.room.id,
    )
    const views = computeDerivedViews(
      state,
      attachment?.questSpec ?? null,
      null,
      { state, room: result.room, quest: null, storyContext },
    )

    expect(views.journal).not.toBeNull()
    expect(views.journal?.journalId).toBe('generated-consequence-journal')
    const html = renderToStaticMarkup(<JournalPanel view={views.journal!} />)
    expect(html).toContain('Journal (')
    expect(html).toContain('journal-panel')
  })

  it('authored bootstrap continues to use the authored journal only', () => {
    const state = makeState({
      currentRoomId: 'throne-room',
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })

    const views = computeDerivedViews(state, demoQuestSpec, null)
    const authoredJournal = computeDerivedViews(state, null, {
      journalId: 'authored-journal',
      title: 'Authored Journal',
      anchorRoomId: 'throne-room',
      entries: [{
        id: 'authored-entry',
        text: 'Authored entry text',
        condition: {
          kind: 'room-flag',
          roomId: 'throne-room',
          flag: 'interaction:offering-coffer',
        },
      }],
    }).journal

    expect(views.quest).not.toBeNull()
    expect(authoredJournal?.journalId).toBe('authored-journal')
    expect(authoredJournal?.entries).toEqual([{ id: 'authored-entry', text: 'Authored entry text' }])
  })

  it('generated and authored journal sources are not combined', async () => {
    const { result, prepared } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    const state = makeState({
      currentRoomId: result.room.id,
      roomStates: {
        [result.room.id]: { visited: true },
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const storyContext = deriveStoryThreadContext(
      prepared.worldBible?.openingArc.pattern,
      result.room.id,
    )

    const views = computeDerivedViews(
      state,
      null,
      demoJournalSpec,
      { state, room: result.room, quest: null, storyContext },
    )

    expect(views.journal?.journalId).toBe('generated-consequence-journal')
    expect(views.journal?.entries.some((entry) => entry.id === 'claimed-tribute-coin')).toBe(false)
  })

  it('generated journal view omits unsafe ids and text while preserving QuestTracker behavior', async () => {
    const { result, attachment, prepared } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    expect(attachment).not.toBeNull()
    const condition = attachment!.questSpec.objectives[0]!.condition
    expect(condition.kind).toBe('room-flag')
    if (condition.kind !== 'room-flag') return

    const state = makeState({
      currentRoomId: result.room.id,
      roomStates: {
        [result.room.id]: { visited: true, flags: { [condition.flag]: true } },
      },
    })
    const storyContext = deriveStoryThreadContext(
      prepared.worldBible?.openingArc.pattern,
      result.room.id,
    )
    const quest = evaluateQuest(attachment!.questSpec, state)
    const views = computeDerivedViews(
      state,
      attachment!.questSpec,
      null,
      { state, room: result.room, quest, storyContext },
    )

    expect(views.quest?.status).toBe('complete')
    expect(views.journal?.entries.some((entry) => entry.id === 'objective-resolved')).toBe(true)
    const serializedJournal = JSON.stringify(views.journal)
    expect(serializedJournal).not.toContain(result.room.name)
    expect(serializedJournal).not.toContain(condition.flag)
    expect(serializedJournal).not.toContain('interaction:')
    expect(serializedJournal).not.toContain(attachment!.questSpec.title)
    expect(serializedJournal).not.toContain(attachment!.questSpec.objectives[0]!.text)
    expect(serializedJournal).not.toContain(result.room.objects[0]?.id ?? 'unreachable-id')
  })

  it('generated journal updates after interaction and navigation through refreshed derived views', async () => {
    const { result, attachment, prepared } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    expect(attachment).not.toBeNull()
    const condition = attachment!.questSpec.objectives[0]!.condition
    expect(condition.kind).toBe('room-flag')
    if (condition.kind !== 'room-flag') return
    const storyContext = deriveStoryThreadContext(
      prepared.worldBible?.openingArc.pattern,
      result.room.id,
    )
    const beforeState = makeState({
      currentRoomId: result.room.id,
      roomStates: { [result.room.id]: { visited: true } },
    })
    const afterState = makeState({
      currentRoomId: result.room.id,
      roomStates: {
        [result.room.id]: { visited: true, flags: { [condition.flag]: true } },
        'generated-room:exit:north': { visited: true },
      },
    })

    const before = computeDerivedViews(
      beforeState,
      null,
      null,
      { state: beforeState, room: result.room, quest: null, storyContext },
    ).journal
    const after = computeDerivedViews(
      afterState,
      null,
      null,
      { state: afterState, room: result.room, quest: null, storyContext },
    ).journal

    expect(before?.entries.some((entry) => entry.id === 'objects-disturbed')).toBe(false)
    expect(after?.entries).toContainEqual({
      id: 'rooms-explored',
      text: 'You have explored 2 chamber(s).',
    })
    expect(after?.entries).toContainEqual({
      id: 'objects-disturbed',
      text: 'You disturbed 1 feature(s) here.',
    })
  })

  it('missing storyKind and missing quest degrade safely', async () => {
    const { result } = await runFakePromptPath('a quiet archive')
    if (!result.ok) throw new Error('expected a playable room')
    const state = makeState({ currentRoomId: result.room.id })

    const views = computeDerivedViews(
      state,
      null,
      null,
      { state, room: result.room, quest: null, storyContext: undefined },
    )

    expect(views.quest).toBeNull()
    expect(views.journal).toEqual({
      journalId: 'generated-consequence-journal',
      title: 'Consequences',
      entries: [],
    })
  })

  it('App source stores only storyKind and builds generated journal input at projection time', () => {
    expect(appSource).toContain('storyKind?: GeneratedStoryThreadKind')
    expect(appSource).toContain('storyKind: activePlay.storyKind')
    expect(appSource).toContain('buildGeneratedJournalInput(play, state, questSpecRef.current)')
    expect(appSource).toContain('deriveStoryThreadContext(play.storyKind, play.room.id)')
    expect(appSource).toContain('computeDerivedViews(')
    expect(appSource).toContain('generatedJournalInput')
    expect(appSource).not.toContain('openingArc.hook')
    expect(appSource).not.toContain('openingArc.firstObjective')
    expect(appSource).not.toContain('openingArc.pressure')
  })
})

describe('generated quest save parking — handleSave wiring (ADR-0059, slice 4)', () => {
  const genRoom = makeRoom(
    [
      {
        type: 'scroll',
        id: 'case-file',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read the case file', effect: { kind: 'inspect' } },
      },
    ],
    'generated-room',
    'Secret Generated Room',
  )

  const genQuestSpec = {
    questId: 'generated-room-objective',
    title: 'Generated title',
    anchorRoomId: 'generated-room',
    objectives: [
      {
        id: 'generated-0',
        text: 'Generated objective text',
        condition: {
          kind: 'room-flag' as const,
          roomId: 'generated-room',
          flag: 'interaction:case-file',
        },
      },
    ],
  }

  const genHints = { hint: 'Find the case file.', completionHint: 'You found it.' }

  it('generated play → returns a defined, non-empty generatedQuestJson string', () => {
    const json = buildGeneratedQuestSaveJson(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
    )
    expect(typeof json).toBe('string')
    expect(json).not.toBe('')
  })

  it('the parked string re-validates through loadGeneratedQuestSaveState', () => {
    const json = buildGeneratedQuestSaveJson(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
    )
    expect(json).toBeDefined()
    expect(loadGeneratedQuestSaveState(json!).ok).toBe(true)
  })

  it('parks enough safe restore data: schemaVersion, room (with object ids), objectivesPerRoom, questSpec, storyKind', () => {
    const json = buildGeneratedQuestSaveJson(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
    )!
    const parsed = JSON.parse(json) as {
      schemaVersion: number
      objectivesPerRoom: boolean
      room: { id: string; objects: { id: string }[] }
      questSpec: { questId: string }
      storyKind: string
    }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.objectivesPerRoom).toBe(true)
    expect(parsed.room.id).toBe('generated-room')
    // Object ids must survive so resolvedObjectIds can re-match the saved flags.
    expect(parsed.room.objects.map((o) => o.id)).toContain('case-file')
    expect(parsed.questSpec.questId).toBe('generated-room-objective')
    expect(parsed.storyKind).toBe('investigate')
  })

  it('omits questSpec, storyKind, and hints when not present', () => {
    const json = buildGeneratedQuestSaveJson({ room: genRoom, objectivesPerRoom: true }, null)!
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect('questSpec' in parsed).toBe(false)
    expect('storyKind' in parsed).toBe(false)
    expect('hints' in parsed).toBe(false)
    expect(parsed.objectivesPerRoom).toBe(true)
  })

  it('authored/demo play → returns undefined so no blob is parked', () => {
    expect(
      buildGeneratedQuestSaveJson({ room: genRoom, questSpec: demoQuestSpec }, null),
    ).toBeUndefined()
    expect(
      buildGeneratedQuestSaveJson({ room: genRoom, objectivesPerRoom: false }, null),
    ).toBeUndefined()
  })

  it('returns undefined when the schema guard yields null (save still succeeds without the blob)', () => {
    // An over-length hint (live path guarantees truncated hints; the schema caps
    // them at GENERATED_OBJECTIVE_TEXT_MAX_LENGTH) drives buildGeneratedQuestSaveState
    // to null, so the helper degrades to undefined and the main save proceeds.
    const overLongHints = { hint: 'x'.repeat(5000), completionHint: 'ok' }
    expect(
      buildGeneratedQuestSaveJson({ room: genRoom, objectivesPerRoom: true }, overLongHints),
    ).toBeUndefined()
  })

  it('does not include raw prompt, provider output, or world-bible free-text fields', () => {
    const json = buildGeneratedQuestSaveJson(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
    )!
    // The helper takes no worldBible/prompt input, so these are structurally
    // unreachable — asserted here as a regression sentinel.
    expect(json).not.toContain(SECRET_RAW_PROMPT)
    expect(json).not.toContain('SECRET PREMISE')
    expect(json).not.toContain('SECRET ARC HOOK')
    expect(json).not.toContain('openingArc')
    expect(json).not.toContain('worldBible')
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(
      ['hints', 'objectivesPerRoom', 'questSpec', 'room', 'schemaVersion', 'storyKind'].sort(),
    )
  })

  it('App source wires the blob into the save path', () => {
    // Save path: build only for generated play and pass it as the third write arg.
    expect(appSource).toContain('buildGeneratedQuestSaveJson(')
    expect(appSource).toContain('generatedQuestJson,')
  })
})

describe('generated room cache save parking — handleSave wiring (ADR-0060, slice 4)', () => {
  const currentRoom = makeRoom(
    [
      {
        type: 'scroll',
        id: 'current-object',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read current', effect: { kind: 'inspect' } },
      },
    ],
    'current-room',
    'Current Generated Room',
  )
  const visitedRoom = makeRoom(
    [
      {
        type: 'scroll',
        id: 'visited-object',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read visited', effect: { kind: 'inspect' } },
      },
    ],
    'visited-room',
    'Visited Generated Room',
  )
  const warmedRoom = makeRoom([], 'warmed-room', 'Warmed Generated Room')

  function cacheWorld(roomStates: WorldState['roomStates']): WorldState {
    return makeState({ currentRoomId: currentRoom.id, roomStates })
  }

  it('generated play → returns a defined generatedRoomCacheJson string', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [{ roomId: currentRoom.id, room: currentRoom, provenance: 'generated' }],
      worldState: cacheWorld({ [currentRoom.id]: { visited: true } }),
    })

    expect(typeof json).toBe('string')
    expect(json).not.toBe('')
  })

  it('the parked cache string re-validates through loadGeneratedRoomCacheSaveState', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [{ roomId: currentRoom.id, room: currentRoom, provenance: 'generated' }],
      worldState: cacheWorld({ [currentRoom.id]: { visited: true } }),
    })

    expect(json).toBeDefined()
    expect(loadGeneratedRoomCacheSaveState(json!).ok).toBe(true)
  })

  it('forces the current room first regardless of snapshot order', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'repaired' },
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.rooms.map((entry) => entry.room.id)).toEqual([
      currentRoom.id,
      visitedRoom.id,
    ])
  })

  it('includes visited cached rooms and excludes warmed unvisited rooms', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'fallback' },
        { roomId: warmedRoom.id, room: warmedRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
      themePack: 'post-apoc',
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.themePack).toBe('post-apoc')
    expect(loaded.state.rooms.map((entry) => entry.room.id)).toEqual([
      currentRoom.id,
      visitedRoom.id,
    ])
    expect(loaded.state.rooms.map((entry) => entry.provenance)).toEqual([
      'generated',
      'fallback',
    ])
  })

  it('preserves object ids internally for saved generated rooms', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [{ roomId: currentRoom.id, room: currentRoom, provenance: 'generated' }],
      worldState: cacheWorld({ [currentRoom.id]: { visited: true } }),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.rooms[0]?.room.objects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'current-object' })]),
    )
  })

  it('authored/non-generated play → returns undefined so no cache blob is parked', () => {
    expect(
      buildGeneratedRoomCacheSaveJson({
        room: currentRoom,
        cachedRooms: [{ roomId: currentRoom.id, room: currentRoom }],
        worldState: cacheWorld({ [currentRoom.id]: { visited: true } }),
      }),
    ).toBeUndefined()
    expect(
      buildGeneratedRoomCacheSaveJson({
        room: currentRoom,
        objectivesPerRoom: false,
        cachedRooms: [{ roomId: currentRoom.id, room: currentRoom }],
        worldState: cacheWorld({ [currentRoom.id]: { visited: true } }),
      }),
    ).toBeUndefined()
  })

  it('returns undefined when the schema guard yields null', () => {
    const invalidRoom = {
      ...currentRoom,
      shell: { dimensions: { width: 0, depth: 18, height: 4 }, exits: [] },
    } as unknown as LoadedRoom

    expect(
      buildGeneratedRoomCacheSaveJson({
        room: invalidRoom,
        objectivesPerRoom: true,
        cachedRooms: [{ roomId: invalidRoom.id, room: invalidRoom }],
        worldState: cacheWorld({ [invalidRoom.id]: { visited: true } }),
      }),
    ).toBeUndefined()
  })

  it('does not include prompt/provider/seed/worldBible strings supplied outside RoomSpec fields', () => {
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [{ roomId: currentRoom.id, room: currentRoom, provenance: 'generated' }],
      worldState: cacheWorld({
        [currentRoom.id]: {
          visited: true,
          flags: {
            SENTINEL_RAW_PROMPT: true,
            SENTINEL_PROVIDER_OUTPUT: true,
            SENTINEL_ADJACENT_THEME_SEED: true,
            SENTINEL_WORLDBIBLE_TEXT: true,
          },
        },
      }),
    })!

    expect(json).not.toContain('SENTINEL_RAW_PROMPT')
    expect(json).not.toContain('SENTINEL_PROVIDER_OUTPUT')
    expect(json).not.toContain('SENTINEL_ADJACENT_THEME_SEED')
    expect(json).not.toContain('SENTINEL_WORLDBIBLE_TEXT')
  })

  it('App source wires cache blob creation into save only', () => {
    const handleSave = appSource.slice(
      appSource.indexOf('const handleSave = useCallback('),
      appSource.indexOf('const handleLoad = useCallback('),
    )
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )

    expect(handleSave).toContain('buildGeneratedRoomCacheSaveJson(')
    expect(handleSave).toContain('snapshotCachedRooms()')
    expect(handleSave).toContain('worldSession.getWorldState(activePlay.sessionId)')
    expect(handleSave).toContain('generatedRoomCacheJson,')
    expect(handleLoad).not.toContain('generatedRoomCacheJson')
    expect(handleLoad).not.toContain('loadGeneratedRoomCacheSaveState')
    expect(handleLoad).not.toContain('restoreGeneratedRoomCache')
  })

  it('cache save path makes no provider, generator, or cost-meter call', () => {
    const handleSave = appSource.slice(
      appSource.indexOf('const handleSave = useCallback('),
      appSource.indexOf('const handleLoad = useCallback('),
    )

    expect(handleSave).not.toContain('recordAttempt')
    expect(handleSave).not.toContain('objectiveGenerator')
    expect(handleSave).not.toContain('buildGeneratedObjectiveAttachment')
    expect(handleSave).not.toContain('GeneratedRoomSource')
    expect(handleSave).not.toContain('FakeRoomGenerator')
    expect(handleSave).not.toContain('resolveRoom(')
    expect(handleSave).not.toContain('warmAdjacent(')
  })
})

describe('generated quest restore — handleLoad wiring (ADR-0059, slice 5)', () => {
  const ROOM_ID = 'generated-room'
  const OBJECT_ID = 'case-file'
  const FLAG = `interaction:${OBJECT_ID}`

  const genRoom = makeRoom(
    [
      {
        type: 'scroll',
        id: OBJECT_ID,
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read the case file', effect: { kind: 'inspect' } },
      },
    ],
    ROOM_ID,
    'Secret Generated Room',
  )

  const genQuestSpec = {
    questId: 'generated-room-objective',
    title: 'Secure the room',
    anchorRoomId: ROOM_ID,
    objectives: [
      {
        id: 'generated-0',
        text: 'Investigate the marked feature.',
        condition: { kind: 'room-flag' as const, roomId: ROOM_ID, flag: FLAG },
      },
    ],
  }

  const genHints = { hint: 'Find the case file.', completionHint: 'You found it.' }

  type SaveInput = Parameters<typeof buildGeneratedQuestSaveJson>[0]
  type Hints = { hint: string; completionHint: string } | null

  // Mirror the App's handleLoad composition exactly: the save path builds the
  // parked blob (slice 4), then the load path re-validates it with
  // loadGeneratedQuestSaveState and rebuilds the generated-play fields with
  // restoreGeneratedQuestPlay against the already-restored WorldState.
  function restoreFromSavedBlob(save: SaveInput, hints: Hints, world: WorldState) {
    const json = buildGeneratedQuestSaveJson(save, hints)
    expect(json).toBeDefined()
    const loaded = loadGeneratedQuestSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('expected a valid parked blob')
    const restored = restoreGeneratedQuestPlay(loaded.state, world)
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error('expected a successful restore')
    return restored.play
  }

  // App.refreshDerivedViews builds the generated journal input for restored
  // generated play (objectivesPerRoom === true) from the restored room + storyKind.
  function restoredViews(play: ReturnType<typeof restoreFromSavedBlob>, world: WorldState) {
    const storyContext = play.storyKind !== undefined
      ? deriveStoryThreadContext(play.storyKind, play.room.id)
      : undefined
    const quest = play.questSpec ? evaluateQuest(play.questSpec, world) : null
    return computeDerivedViews(world, play.questSpec ?? null, null, {
      state: world,
      room: play.room,
      quest,
      storyContext,
    })
  }

  it('restores objective visibility so the quest tracker renders after load', () => {
    const world = makeState({ currentRoomId: ROOM_ID, roomStates: { [ROOM_ID]: { visited: true } } })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
      world,
    )

    const views = restoredViews(play, world)
    expect(views.quest).not.toBeNull()
    const html = renderToStaticMarkup(<QuestTracker view={views.quest!} />)
    expect(html).toContain('Secure the room')
    expect(html).toContain('Investigate the marked feature.')
  })

  it('keeps a completed generated objective complete after load (driven by WorldState flags)', () => {
    const completedWorld = makeState({
      currentRoomId: ROOM_ID,
      roomStates: { [ROOM_ID]: { visited: true, flags: { [FLAG]: true } } },
    })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
      completedWorld,
    )

    expect(evaluateQuest(play.questSpec!, completedWorld).status).toBe('complete')
    expect(restoredViews(play, completedWorld).quest?.status).toBe('complete')
  })

  it('restores the resolved-object ring set from the restored room + restored flags', () => {
    const resolvedWorld = makeState({
      currentRoomId: ROOM_ID,
      roomStates: { [ROOM_ID]: { visited: true, flags: { [FLAG]: true } } },
    })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec },
      genHints,
      resolvedWorld,
    )

    expect(play.objectivesPerRoom).toBe(true)
    expect([...(play.entryResolvedObjectIds ?? [])]).toEqual([OBJECT_ID])
  })

  it('re-projects the generated consequence journal after load', () => {
    const world = makeState({
      currentRoomId: ROOM_ID,
      roomStates: { [ROOM_ID]: { visited: true, flags: { [FLAG]: true } } },
    })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
      world,
    )

    const views = restoredViews(play, world)
    expect(views.journal?.journalId).toBe('generated-consequence-journal')
    expect(views.journal?.entries).toContainEqual({
      id: 'objective-resolved',
      text: "You resolved this chamber's objective.",
    })
    expect(views.journal?.entries).toContainEqual({
      id: 'objects-disturbed',
      text: 'You disturbed 1 feature(s) here.',
    })
  })

  it('restores storyKind so the journal carries its story-context entry', () => {
    const world = makeState({ currentRoomId: ROOM_ID, roomStates: { [ROOM_ID]: { visited: true } } })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
      world,
    )

    expect(play.storyKind).toBe('investigate')
    expect(restoredViews(play, world).journal?.entries.some((entry) => entry.id === 'story-context')).toBe(true)
  })

  it('restores quest hints when present in the parked blob', () => {
    const world = makeState({ currentRoomId: ROOM_ID, roomStates: { [ROOM_ID]: { visited: true } } })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec },
      genHints,
      world,
    )

    expect(play.hints).toEqual(genHints)
  })

  it('degrades safely with no throw for an invalid parked blob (falls through to authored gate)', () => {
    // The App guards each step: a corrupt or schema-invalid blob makes
    // loadGeneratedQuestSaveState return { ok: false }, so the restore is skipped
    // and the load continues on the authored-world path with no error.
    expect(loadGeneratedQuestSaveState('not json at all').ok).toBe(false)
    expect(loadGeneratedQuestSaveState(JSON.stringify({ schemaVersion: 9 })).ok).toBe(false)
    expect(() => loadGeneratedQuestSaveState('{"room":')).not.toThrow()
  })

  it('App source reads, re-validates, and restores the parked blob via the slice helpers', () => {
    expect(appSource).toContain('restoreGeneratedPlayFromSlot(')
    expect(appSource).toContain('loadGeneratedQuestSaveState(generatedQuestJson)')
    expect(appSource).toContain('restoreGeneratedQuestPlay(loaded.state, worldState)')
    expect(appSource).toContain('slotResult.generatedQuestJson')
    // Restored quest spec and hints are routed through the existing view seams.
    expect(appSource).toContain('setQuestSpecForView(generatedPlayFields.questSpec ?? null)')
    expect(appSource).toContain('setQuestHintsForView(hints ?? null)')
  })

  it('keeps the authored-world fallback gate intact for missing/invalid blobs and authored saves', () => {
    // A missing blob returns null from the helper guard; the else branch is the
    // pre-feature authored-world path, unchanged.
    expect(appSource).toContain('if (generatedQuestJson == null) return null')
    expect(appSource).toContain("stateResult.state.roomStates['throne-room'] != null")
    expect(appSource).toContain('isAuthoredWorld ? demoQuestSpec : undefined')
    expect(appSource).toContain('isAuthoredWorld ? demoJournalSpec : undefined')
  })

  it('makes no generator, objective provider, or cost-meter call on the load path', () => {
    // The only new room-reconstruction call is restoreGeneratedQuestPlay, which is
    // proven generator-free by its own suite. handleLoad itself never records a
    // usage attempt or invokes the objective generator.
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )
    expect(handleLoad).not.toContain('recordAttempt')
    expect(handleLoad).not.toContain('objectiveGenerator')
    expect(handleLoad).not.toContain('buildGeneratedObjectiveAttachment')
    expect(handleLoad).toContain('restoreGeneratedPlayFromSlot(')
  })

  it('never logs the parked blob and restores only with a safe enum diagnostic', () => {
    const restoreHelper = appSource.slice(
      appSource.indexOf('function restoreGeneratedPlayFromSlot('),
      appSource.indexOf('type ExampleBootstrapResult'),
    )
    // The restore helper must not log at all (the blob is content-bearing data).
    expect(restoreHelper).not.toContain('logger')
    // The restored-session log line carries only safe fields: a session id and a
    // fixed enum — never the blob, room name, quest text, hints, ids, or flags.
    expect(appSource).toContain('restored: restoredGeneratedPlay != null')
    // The blob is only ever read for re-validation, never passed to the logger.
    expect(appSource).not.toContain('logger.info("world session restored", { generatedQuestJson')
  })

  it('does not surface unsafe parked content through the restored quest/journal views', () => {
    const world = makeState({
      currentRoomId: ROOM_ID,
      roomStates: { [ROOM_ID]: { visited: true, flags: { [FLAG]: true } } },
    })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec, storyKind: 'investigate' },
      genHints,
      world,
    )
    const views = restoredViews(play, world)
    const serialized = JSON.stringify({ quest: views.quest, journal: views.journal })

    expect(serialized).not.toContain('Secret Generated Room')
    expect(serialized).not.toContain(FLAG)
    expect(serialized).not.toContain('interaction:')
    expect(serialized).not.toContain(OBJECT_ID)
    expect(serialized).not.toContain('Find the case file.')
  })
})
