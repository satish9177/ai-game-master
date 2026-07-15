import appSource from './App.tsx?raw'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AppRoomEntryOverlay,
} from './App'
import {
  attachPerRoomObjectiveOnEnter,
  buildRuntimeRoomMemorySaveJson,
  buildGeneratedRoomCacheSaveJson,
  buildGeneratedQuestSaveJson,
  buildQuestStage,
  INITIAL_MEMORY_FEEDBACK_STATE,
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  memoryFeedbackAfterPromotion,
  memoryFeedbackAfterRecall,
  memoryFeedbackOnRoomEntry,
  readPerRoomObjectiveMemo,
  relationshipFeedbackAfterReduction,
  relationshipFeedbackOnRoomEntry,
  resolvedObjectIdsForGeneratedPlay,
  resolvedObjectIdsForRoom,
  restoreNpcRelationshipsFromSlot,
  restoreRuntimeRoomMemoryFromSlot,
  selectTransientFeedbackMessage,
  shouldStartPerRoomObjectiveAttach,
  type MemoryFeedbackState,
  type RelationshipFeedbackState,
} from './app/App.helpers'
import {
  EMPTY_PROMOTION_SUMMARY,
  MEMORY_CREATED_MESSAGE,
  MEMORY_RECALLED_MESSAGE,
  type PromotionSummary,
} from './app/memoryFeedback'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from './app/relationshipFeedback'
import {
  GENERATED_ROOM_CACHE_MAX,
  loadGeneratedRoomCacheSaveState,
} from './domain/quests/generatedRoomCacheSaveState'
import { loadGeneratedQuestSaveState } from './domain/quests/generatedQuestSaveState'
import { selectDemoChaseOptInNpcIds } from './app/demoChaseOptIn'
import { selectNpcRoutineModes } from './app/npcRoutine'
import { isNpcRoutineNpcType, type NpcRoutineNpcType } from './domain/npcRoutinePresets'
import { restoreGeneratedQuestPlay } from './app/restoreGeneratedQuestPlay'
import { restoreGeneratedRoomCache } from './app/restoreGeneratedRoomCache'
import { AdjacentRoomPregenerator } from './app/AdjacentRoomPregenerator'
import { NavigationService } from './app/NavigationService'
import { navigateWithExitGate } from './app/gatedNavigation'
import { navigationResultMessage } from './app/exits'
import { buildPromptGeneratedRoomSource } from './app/buildPromptGeneratedRoomSource'
import {
  buildGeneratedObjectiveAttachment,
  buildGeneratedObjectiveQuestSpec,
  type GeneratedObjectiveQuestAttachment,
} from './app/generatedObjective'
import { FALLBACK_NOTICE } from './app/fallbackNotice'
import { buildRoomIntroView } from './app/roomIntro'
import { loadRoomSpec } from './domain/loadRoomSpec'
import type { LoadedRoom } from './domain/loadRoomSpec'
import type { Clock } from './domain/ports/Clock'
import type { IdGenerator } from './domain/ports/IdGenerator'
import { evaluateQuest } from './domain/quests/evaluateQuest'
import type { WorldState } from './domain/world/worldState'
import type { ObjectiveGenerator } from './domain/ports/ObjectiveGenerator'
import type { RoomGenerator } from './domain/ports/RoomGenerator'
import type { Logger } from './platform/logger/Logger'
import type { LogContext } from './platform/logger/Logger'
import { computeDerivedViews } from './app/derivedViews'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  toRelationshipJournalView,
} from './app/relationshipJournalRuntime'
import { QuestTracker } from './renderer/ui/QuestTracker'
import { JournalPanel, JournalPanelBody } from './renderer/ui/JournalPanel'
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
import { InteractionService } from './interactions/InteractionService'
import { InMemoryWorldStore } from './world-session/InMemoryWorldStore'
import { WorldSession } from './world-session/WorldSession'
import type { RoomResolver } from './app/AdjacentRoomPregenerator'
import { InMemoryRoomMemoryStore } from './memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from './memory/RoomMemoryService'
import { ROOM_MEMORY_SCHEMA_VERSION, type RoomMemoryRecord } from './domain/memory/roomContracts'
import { loadRoomMemorySaveState } from './domain/memory/roomMemorySaveState'
import { NPC_RELATIONSHIP_SCHEMA_VERSION, type NpcRelationshipState } from './domain/npcRelationship/contracts'
import {
  buildNpcRelationshipSaveJson,
  loadNpcRelationshipSaveState,
} from './domain/npcRelationship/relationshipSaveState'

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

function makeRoomMemoryRecord(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'room-memory-1',
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    roomId: 'generated-room',
    kind: 'room_observation',
    text: 'safe remembered room detail',
    provenance: { source: 'game' },
    confidence: 'medium',
    seq: 1,
    createdAt: UPDATED_AT,
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
    expect(html).toContain('stable version')
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

  it('App wires the demo chase opt-in (ADR-0086) as a default-off, id-only, non-empty-only prop', () => {
    expect(appSource).toContain(
      "import { readDemoChaseEnabled, selectDemoChaseOptInNpcIds } from './app/demoChaseOptIn'",
    )
    expect(appSource).toContain('const demoChaseEnabled = readDemoChaseEnabled()')

    // Memoized on the active room only (dialogue-remount-fix): a fresh Set on
    // every render would change RoomViewer's chaseOptInNpcIds identity, and
    // RoomViewer's engine-building effect is keyed on that identity, so any
    // unrelated re-render (e.g. dialogue-turn/relationship feedback state)
    // would otherwise remount the engine mid-conversation.
    const memoStart = appSource.indexOf('const demoChaseOptInNpcIds = useMemo(() => {')
    expect(memoStart).toBeGreaterThan(-1)
    const memoEnd = appSource.indexOf('}, [activePlay?.room])', memoStart)
    expect(memoEnd).toBeGreaterThan(memoStart)

    const computed = appSource.slice(memoStart, memoEnd)
    expect(computed).toContain('const presentNpcIds = new Set<string>()')
    expect(computed).toContain("object.type === 'npc' && object.id !== undefined")
    expect(computed).toContain('presentNpcIds.add(object.id)')
    expect(computed).toContain('enabled: demoChaseEnabled')
    expect(computed).toContain('presentNpcIds,')
    // Id-only: the computed block never reads name, dialogue, or room/prompt text.
    expect(computed).not.toMatch(/\.name\b/)
    expect(computed).not.toContain('dialogue')
    expect(computed).not.toContain('roomContext')

    // The dependency array is exactly [activePlay?.room] — not any dialogue,
    // feedback, quest, or journal state that changes while a conversation is
    // in progress — so React only recomputes (and RoomViewer only remounts
    // its engine) when the active room itself changes.
    expect(appSource).toContain('}, [activePlay?.room])')

    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('/>', appSource.indexOf('<RoomViewer')),
    )
    expect(render).toContain(
      '{...(demoChaseOptInNpcIds.size > 0 ? { chaseOptInNpcIds: demoChaseOptInNpcIds } : {})}',
    )

    // Only the module-level gate read and the derived boolean/set are used —
    // no direct import.meta.env access and no raw env var name in the render.
    expect(render).not.toContain('import.meta.env')
    expect(render).not.toContain('VITE_AIGM_DEMO_CHASE')
  })

  it('demo chase opt-in Set identity is stable across calls given the same present ids (regression guard for the dialogue-remount fix)', () => {
    // Documents the causal chain the useMemo fix relies on: RoomViewer.tsx's
    // engine-building effect lists chaseOptInNpcIds in its dependency array, so
    // a new Set reference on every App render (the pre-fix behavior) would
    // remount the engine on every unrelated re-render. Wrapping the derivation
    // in useMemo([activePlay?.room]) means React reuses the same Set reference
    // across renders that don't change the active room — this asserts the
    // selector itself is a plain, side-effect-free function of its inputs (no
    // hidden per-call state), which is what makes memoizing it correct.
    const presentNpcIds = new Set(['herald-asha'])
    const first = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds })
    const second = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds })
    expect(Array.from(first)).toEqual(Array.from(second))
    expect(first).not.toBe(second) // selector alone doesn't memoize; useMemo must
  })

  it('demo chase opt-in selection matches App wiring: off by default, id-only, allowlist-gated', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'herald-asha',
        name: 'Asha',
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'herald' } },
      },
    ], 'throne-room')
    const npcPresentIds = (room: LoadedRoom) => {
      const ids = new Set<string>()
      for (const object of room.objects) {
        if (object.type === 'npc' && object.id !== undefined) ids.add(object.id)
      }
      return ids
    }

    // Gate off: no opt-in even though herald-asha is present (App's default state).
    expect(selectDemoChaseOptInNpcIds({ enabled: false, presentNpcIds: npcPresentIds(npcRoom) }).size).toBe(0)

    // Gate on + herald-asha present: opt-in contains herald-asha.
    expect([...selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds: npcPresentIds(npcRoom) })])
      .toEqual(['herald-asha'])

    // Gate on + herald-asha absent (no allowlisted npc in the room): no opt-in.
    const noNpcRoom = resolvedRoom()
    expect(selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds: npcPresentIds(noNpcRoom) }).size).toBe(0)
  })

  it('App wires the demo day/night routine opt-in (ADR-0087) as a default-off, id-only, non-empty-only prop', () => {
    expect(appSource).toContain(
      "import { readRoutineEnabled, selectNpcRoutineModes } from './app/npcRoutine'",
    )
    expect(appSource).toContain('const routineEnabled = readRoutineEnabled()')

    // Memoized on the active room and the resolved time bucket (not on every
    // render), for the same engine-remount-stability reason as
    // demoChaseOptInNpcIds: a fresh Map identity on an unrelated re-render
    // would otherwise remount the engine mid-conversation.
    const memoStart = appSource.indexOf('const npcRoutineModes = useMemo(() => {')
    expect(memoStart).toBeGreaterThan(-1)
    const memoEnd = appSource.indexOf(
      '}, [activePlay?.room, worldClock?.timeOfDay])',
      memoStart,
    )
    expect(memoEnd).toBeGreaterThan(memoStart)

    const computed = appSource.slice(memoStart, memoEnd)
    expect(computed).toContain('const presentNpcIds = new Set<string>()')
    expect(computed).toContain("object.type === 'npc' && object.id !== undefined")
    expect(computed).toContain('presentNpcIds.add(object.id)')
    expect(computed).toContain('enabled: routineEnabled')
    expect(computed).toContain('presentNpcIds,')
    expect(computed).toContain('timeOfDay: worldClock?.timeOfDay')
    // Id-only: the computed block never reads name, dialogue, or room/prompt text.
    expect(computed).not.toMatch(/\.name\b/)
    expect(computed).not.toContain('dialogue')
    expect(computed).not.toContain('roomContext')

    // The dependency array is exactly [activePlay?.room, worldClock?.timeOfDay] —
    // not any dialogue, feedback, quest, or journal state that changes while a
    // conversation is in progress.
    expect(appSource).toContain('}, [activePlay?.room, worldClock?.timeOfDay])')

    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('/>', appSource.indexOf('<RoomViewer')),
    )
    expect(render).toContain(
      '{...(npcRoutineModes.size > 0 ? { npcRoutineModes } : {})}',
    )

    // Only the module-level gate read and the derived map are used — no direct
    // import.meta.env access and no raw env var name in the render.
    expect(render).not.toContain('import.meta.env')
    expect(render).not.toContain('VITE_AIGM_DEMO_ROUTINE')
  })

  it('demo routine opt-in selection matches App wiring: off by default, id-only, config-gated, time-bucket-derived', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'herald-asha',
        name: 'Asha',
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'herald' } },
      },
    ], 'throne-room')
    const npcPresentIds = (room: LoadedRoom) => {
      const ids = new Set<string>()
      for (const object of room.objects) {
        if (object.type === 'npc' && object.id !== undefined) ids.add(object.id)
      }
      return ids
    }

    // Gate off: no routine map even though herald-asha is present and a time
    // bucket is known (App's default state).
    expect(
      selectNpcRoutineModes({
        enabled: false,
        presentNpcIds: npcPresentIds(npcRoom),
        timeOfDay: 'day',
      }).size,
    ).toBe(0)

    // Gate on + herald-asha present + known time bucket: routine map contains
    // herald-asha with the expected configured mode for that bucket.
    const dayResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: npcPresentIds(npcRoom),
      timeOfDay: 'day',
    })
    expect(dayResult.get('herald-asha')).toBe('patrol')

    const nightResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: npcPresentIds(npcRoom),
      timeOfDay: 'night',
    })
    expect(nightResult.get('herald-asha')).toBe('rest')

    // Gate on + no configured NPC present: no usable routine map.
    const noNpcRoom = resolvedRoom()
    expect(
      selectNpcRoutineModes({
        enabled: true,
        presentNpcIds: npcPresentIds(noNpcRoom),
        timeOfDay: 'day',
      }).size,
    ).toBe(0)

    // Gate on + herald-asha present + unknown/missing time bucket: no usable map.
    expect(
      selectNpcRoutineModes({
        enabled: true,
        presentNpcIds: npcPresentIds(npcRoom),
        timeOfDay: null,
      }).size,
    ).toBe(0)
  })

  // Coverage for generated-npc-routine-type-v0 (ADR-0090, Slice 3): App's
  // roomNpcTypeById derivation, a third, lowest-priority npcType source read
  // only from validated present NPC objects (never name/persona/dialogue/
  // interaction/room/prompt text). Mirrors the `npcRoom`/`npcPresentIds`
  // pattern of the routine test above, plus the equivalent derivation logic
  // App itself runs, to prove end-to-end behavior through the real schema
  // (`loadRoomSpec`) and the real selector.
  it('App wires roomNpcTypeById (ADR-0090) as an id + closed-enum-only source, derived only from validated present NPC objects', () => {
    expect(appSource).toContain(
      "import { isNpcRoutineNpcType, type NpcRoutineNpcType } from './domain/npcRoutinePresets'",
    )

    const memoStart = appSource.indexOf('const npcRoutineModes = useMemo(() => {')
    expect(memoStart).toBeGreaterThan(-1)
    const memoEnd = appSource.indexOf(
      '}, [activePlay?.room, worldClock?.timeOfDay])',
      memoStart,
    )
    expect(memoEnd).toBeGreaterThan(memoStart)
    const computed = appSource.slice(memoStart, memoEnd)

    expect(computed).toContain('const roomNpcTypeById = new Map<string, NpcRoutineNpcType>()')
    expect(computed).toContain("object.type === 'npc' && object.id !== undefined")
    expect(computed).toContain('isNpcRoutineNpcType(object.npcType)')
    expect(computed).toContain('roomNpcTypeById.set(object.id, object.npcType)')
    expect(computed).toContain('roomNpcTypeById,')

    // Still id + closed-enum only: never reads name, persona, dialogue,
    // interaction text, or room/prompt text for npcType derivation.
    expect(computed).not.toMatch(/\.name\b/)
    expect(computed).not.toContain('persona')
    expect(computed).not.toContain('dialogue')
    expect(computed).not.toContain('interaction')
    expect(computed).not.toContain('roomContext')

    // The dependency array is unchanged by this feature.
    expect(appSource).toContain('}, [activePlay?.room, worldClock?.timeOfDay])')
  })

  function deriveRoomNpcTypeById(room: LoadedRoom): {
    presentNpcIds: Set<string>
    roomNpcTypeById: Map<string, NpcRoutineNpcType>
  } {
    // The exact derivation App.tsx runs inside its npcRoutineModes useMemo.
    const presentNpcIds = new Set<string>()
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>()
    for (const object of room.objects) {
      if (object.type === 'npc' && object.id !== undefined) {
        presentNpcIds.add(object.id)
        if (isNpcRoutineNpcType(object.npcType)) {
          roomNpcTypeById.set(object.id, object.npcType)
        }
      }
    }
    return { presentNpcIds, roomNpcTypeById }
  }

  it('a generated npc with a valid npcType and no authored config/type mapping resolves a routine mode by timeOfDay', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'generated-npc',
        name: 'Nara',
        npcType: 'guard',
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], 'generated-room')

    const { presentNpcIds, roomNpcTypeById } = deriveRoomNpcTypeById(npcRoom)
    expect(roomNpcTypeById.get('generated-npc')).toBe('guard')

    const dayResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      roomNpcTypeById,
    })
    expect(dayResult.get('generated-npc')).toBe('patrol') // guard's day_patrol_night_rest preset

    const nightResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'night',
      roomNpcTypeById,
    })
    expect(nightResult.get('generated-npc')).toBe('rest')
  })

  it('a generated npc without npcType gets no routine, even when the gate is on and time is known', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'generated-npc',
        name: 'Nara',
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], 'generated-room')

    const { presentNpcIds, roomNpcTypeById } = deriveRoomNpcTypeById(npcRoom)
    expect(roomNpcTypeById.size).toBe(0)

    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      roomNpcTypeById,
    })
    expect(result.size).toBe(0)
  })

  it('a generated npc with an invalid npcType is already dropped to undefined by the schema, so it gets no routine', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'generated-npc',
        name: 'Nara',
        npcType: 'bandit leader', // not in the closed enum -> dropped at parse time
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], 'generated-room')

    const npc = npcRoom.objects[0]
    expect(npc?.type === 'npc' && npc.npcType).toBeUndefined()

    const { presentNpcIds, roomNpcTypeById } = deriveRoomNpcTypeById(npcRoom)
    expect(roomNpcTypeById.size).toBe(0)

    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      roomNpcTypeById,
    })
    expect(result.size).toBe(0)
  })

  it('roomNpcTypeById ignores npc objects without an id, even when npcType is valid', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        name: 'Nameless',
        npcType: 'guard', // no id -- must be ignored
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], 'generated-room')

    const { presentNpcIds, roomNpcTypeById } = deriveRoomNpcTypeById(npcRoom)
    expect(presentNpcIds.size).toBe(0)
    expect(roomNpcTypeById.size).toBe(0)
  })

  it('herald-asha keeps its unchanged explicit-config behavior even when a same-id room npcType disagrees, and authored NPC_TYPE_BY_ID wins over the room field for the same id', () => {
    const npcRoom = makeRoom([
      {
        type: 'npc',
        id: 'herald-asha',
        name: 'Asha',
        npcType: 'wanderer', // disagrees with both the explicit schedule and the authored type
        position: [0, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], 'throne-room')

    const { presentNpcIds, roomNpcTypeById } = deriveRoomNpcTypeById(npcRoom)
    expect(roomNpcTypeById.get('herald-asha')).toBe('wanderer')

    // App always calls selectNpcRoutineModes with its default `config`/
    // `typeConfig` (NPC_ROUTINE_CONFIG / NPC_TYPE_BY_ID) -- omitted here to
    // exercise those real defaults, exactly as App does.
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      roomNpcTypeById,
    })
    // herald-asha's explicit NPC_ROUTINE_CONFIG schedule resolves day ->
    // patrol -- never wanderer's wander_day_rest_night preset (day -> passive).
    expect(result.get('herald-asha')).toBe('patrol')
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
    expect(exampleBook?.id).toBe('generated-inspect-book-0')
    expect(exampleBook && 'interaction' in exampleBook ? exampleBook.interaction?.effect : undefined).toEqual({ kind: 'inspect' })
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

describe('App event-consequence-journal seam wiring (Slice 2)', () => {
  it('reads the feature flag only through the app-layer reader, never raw env', () => {
    expect(appSource).toContain('readEventConsequenceJournalEnabled()')
    // The flag env var name must never appear inline in App — it is read only
    // inside the seam module (like debugConfig/llmConfig).
    expect(appSource).not.toContain('VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS')
    expect(appSource).not.toContain('import.meta.env')
  })

  it('uses the smallest read-only async seam: getEventLog -> projector -> journal slot', () => {
    expect(appSource).toContain('loadEventConsequenceJournal({')
    expect(appSource).toContain('getEventLog: (id) => worldSession.getEventLog(id)')
    // OFF short-circuit keeps the existing journal behavior byte-identical.
    expect(appSource).toContain('if (!eventConsequenceJournalFromEventsEnabled) return')
    // Stale async results are discarded so a newer refresh always wins.
    expect(appSource).toContain('eventJournalRequestRef')
  })

  it('reuses the existing JournalPanel for the authored/generated journal slot, unchanged', () => {
    expect(appSource).toContain('{journal && <JournalPanel view={journal} />}')
    // The only other `<JournalPanel` usage is the relationship journal panel
    // added by relationship-journal-runtime-v0 (Slice 3); this slot's own
    // render call stays byte-identical.
    expect(appSource.match(/<JournalPanel/g)?.length).toBe(2)
  })

  it('adds no polling, no subscriptions, and no event-log writes', () => {
    expect(appSource).not.toContain('setInterval')
    expect(appSource).not.toContain('.subscribe(')
    expect(appSource).not.toContain('appendEvent')
  })

  it('wires the seam at the session-start / load / room-entry flows', () => {
    expect(appSource).toContain('applyEventJournalFromSession(initialState.sessionId)')
    expect(appSource).toContain('applyEventJournalFromSession(started.state.sessionId)')
    expect(appSource).toContain('applyEventJournalFromSession(stateResult.state.sessionId)')
    expect(appSource).toContain('applyEventJournalFromSession(result.state.sessionId)')
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

  function objectiveFor(room: LoadedRoom, objectId: string) {
    return {
      questSpec: {
        questId: `${room.id}-objective`,
        title: 'Secure the room',
        anchorRoomId: room.id,
        objectives: [
          {
            id: 'generated-0',
            text: 'Inspect the marked feature.',
            condition: {
              kind: 'room-flag' as const,
              roomId: room.id,
              flag: `interaction:${objectId}`,
            },
          },
        ],
      },
      hint: 'Look for the marked feature.',
      completionHint: 'The feature is resolved.',
    }
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

  it('includes an objective for a non-current visited cached room with a memo attachment', () => {
    const objective = objectiveFor(visitedRoom, 'visited-object')
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
      objectives: new Map([[visitedRoom.id, objective]]),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.rooms.find((entry) => entry.room.id === visitedRoom.id)?.objective)
      .toEqual(objective)
  })

  it('does not include an objective for the current room even when the memo has one', () => {
    const currentObjective = objectiveFor(currentRoom, 'current-object')
    const visitedObjective = objectiveFor(visitedRoom, 'visited-object')
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
      objectives: new Map([
        [currentRoom.id, currentObjective],
        [visitedRoom.id, visitedObjective],
      ]),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.rooms[0]?.room.id).toBe(currentRoom.id)
    expect(loaded.state.rooms[0]?.objective).toBeUndefined()
    expect(loaded.state.rooms.find((entry) => entry.room.id === visitedRoom.id)?.objective)
      .toEqual(visitedObjective)
  })

  it('omits invalid or semantically mismatched cached objectives', () => {
    const mismatched = objectiveFor(visitedRoom, 'visited-object')
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
      objectives: new Map([
        [
          visitedRoom.id,
          {
            ...mismatched,
            questSpec: { ...mismatched.questSpec, anchorRoomId: currentRoom.id },
          },
        ],
      ]),
    })
    const invalidJson = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'generated' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
      objectives: new Map([[visitedRoom.id, { ...mismatched, hint: '' }]]),
    })

    for (const saved of [json, invalidJson]) {
      const loaded = loadGeneratedRoomCacheSaveState(saved!)
      expect(loaded.ok).toBe(true)
      if (loaded.ok) {
        expect(loaded.state.rooms.find((entry) => entry.room.id === visitedRoom.id)?.objective)
          .toBeUndefined()
      }
    }
  })

  it('cap and eviction drop non-current cached objectives with their rooms', () => {
    const visitedRooms = Array.from({ length: GENERATED_ROOM_CACHE_MAX }, (_, index) => {
      const room = makeRoom(
        [
          {
            type: 'scroll',
            id: `visited-object-${index}`,
            position: [0, 0, -2],
            interaction: { key: 'E', prompt: 'Read visited', effect: { kind: 'inspect' } },
          },
        ],
        `visited-room-${index}`,
        `Visited Generated Room ${index}`,
      )
      return room
    })
    const objectives = new Map(
      visitedRooms.map((room, index) => [room.id, objectiveFor(room, `visited-object-${index}`)]),
    )
    const evictedRoom = visitedRooms[GENERATED_ROOM_CACHE_MAX - 1]!
    const json = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        ...visitedRooms.map((room) => ({ roomId: room.id, room, provenance: 'generated' as const })),
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        ...Object.fromEntries(visitedRooms.map((room) => [room.id, { visited: true }])),
      }),
      objectives,
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.rooms).toHaveLength(GENERATED_ROOM_CACHE_MAX)
    expect(loaded.state.rooms.some((entry) => entry.room.id === evictedRoom.id)).toBe(false)
    expect(JSON.stringify(loaded.state)).not.toContain(`${evictedRoom.id}-objective`)
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

  it('preserves restored visited cached rooms across a repeated save/load/save-style projection', () => {
    const firstJson = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: currentRoom.id, room: currentRoom, provenance: 'generated' },
        { roomId: visitedRoom.id, room: visitedRoom, provenance: 'fallback' },
      ],
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
    })
    expect(firstJson).toBeDefined()
    const loaded = loadGeneratedRoomCacheSaveState(firstJson!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const restored = restoreGeneratedRoomCache(loaded.state, currentRoom)
    let sourceCalls = 0
    const pregenerator = new AdjacentRoomPregenerator(
      restored.cache,
      { has: () => false, resolve: () => ({ ok: false, reason: 'unknown-room' }) },
      () => {
        sourceCalls += 1
        return { getRoom: async () => ({ ok: true, room: warmedRoom }) }
      },
      warmedRoom,
      noopLogger,
    )
    pregenerator.restoreProvenance(restored.provenance)

    const secondJson = buildGeneratedRoomCacheSaveJson({
      room: currentRoom,
      objectivesPerRoom: true,
      cachedRooms: pregenerator.snapshotCachedRooms(),
      worldState: cacheWorld({
        [currentRoom.id]: { visited: true },
        [visitedRoom.id]: { visited: true },
      }),
    })
    expect(sourceCalls).toBe(0)
    expect(secondJson).toBeDefined()
    const reloaded = loadGeneratedRoomCacheSaveState(secondJson!)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return

    expect(reloaded.state.rooms.map((entry) => entry.room.id)).toEqual([
      currentRoom.id,
      visitedRoom.id,
    ])
    expect(reloaded.state.rooms.map((entry) => entry.provenance)).toEqual([
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

  it('App source keeps cache blob creation in save and cache blob reading in load', () => {
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
    expect(handleSave).toContain('objectives: perRoomObjectiveMemoRef.current')
    expect(handleSave).toContain('generatedRoomCacheJson,')
    expect(handleLoad).toContain('slotResult.generatedRoomCacheJson')
    expect(appSource).toContain('loadGeneratedRoomCacheSaveState(generatedRoomCacheJson)')
    expect(appSource).toContain('restoreGeneratedRoomCache(loaded.state, currentRoom, currentQuestSpec)')
    expect(appSource).toContain('restoredConsequenceCatalogs: restored.consequenceCatalogs')
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

describe('App generated mechanical gate runtime wiring', () => {
  const GENERATED_ROOM_ID = 'generated-room'
  const CONTROL_OBJECT_ID = 'control-panel'
  const GOVERNED_ROOM_ID = 'north-room'
  const SIDE_ROOM_ID = 'side-room'
  const UNLOCK_FLAG = `interaction:${CONTROL_OBJECT_ID}`

  function generatedGateRoom(): LoadedRoom {
    return makeRoom([
      {
        type: 'machine',
        id: CONTROL_OBJECT_ID,
        name: 'SECRET CONTROL PANEL NAME',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Inspect the secret control panel',
          body: 'SECRET GENERATED DESCRIPTION',
          effect: { kind: 'inspect' },
        },
      },
      {
        type: 'arch',
        id: 'north-arch',
        name: 'SECRET NORTH ARCH NAME',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave north', exit: { toRoomId: GOVERNED_ROOM_ID } },
      },
      {
        type: 'arch',
        id: 'side-arch',
        name: 'SECRET SIDE ARCH NAME',
        position: [5, 0, 0],
        interaction: { key: 'E', prompt: 'Leave sideways', exit: { toRoomId: SIDE_ROOM_ID } },
      },
    ], GENERATED_ROOM_ID, 'SECRET GENERATED ROOM NAME')
  }

  function targetRoom(id: string): LoadedRoom {
    return makeRoom([], id, `Target ${id}`)
  }

  function createGateHarness(room: LoadedRoom = generatedGateRoom()) {
    const store = new InMemoryWorldStore()
    let id = 3
    const ids: IdGenerator = {
      newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
    }
    let tick = 0
    const clock: Clock = {
      now: () => `2026-07-01T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    }
    const logs: Array<{ message: string; context: LogContext }> = []
    const logger: Logger = {
      debug: (message, context = {}) => logs.push({ message, context }),
      info: (message, context = {}) => logs.push({ message, context }),
      warn: (message, context = {}) => logs.push({ message, context }),
      error: (message, context = {}) => logs.push({ message, context }),
      child: () => logger,
    }
    const worldSession = new WorldSession(store, clock, ids, logger)
    const resolver: RoomResolver = {
      resolveRoom: async (roomId) => ({
        ok: true,
        room: targetRoom(roomId),
        cacheHit: false,
        source: 'generated',
        provenance: 'generated',
      }),
    }
    const navigation = new NavigationService(worldSession, resolver, logger)
    const interaction = new InteractionService(worldSession, logger)
    const canon = {
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'SECRET WORLD NAME',
      startingRoomId: room.id,
      initialPlayer: { health: { current: 75, max: 100 }, status: [], inventory: [] },
    }
    return { logs, worldSession, navigation, interaction, room, canon }
  }

  async function startGeneratedHarness(harness: ReturnType<typeof createGateHarness>) {
    const started = await harness.worldSession.startSession(harness.canon)
    if (!started.ok) throw new Error(started.error.code)
    harness.logs.length = 0
    return started.state
  }

  function appStyleNavigate(
    harness: ReturnType<typeof createGateHarness>,
    sessionId: string,
    toRoomId: string,
  ) {
    return navigateWithExitGate({
      sessionId,
      fromRoomId: harness.room.id,
      toRoomId,
      demoQuestEnabled: false,
      getWorldState: (id) => harness.worldSession.getWorldState(id),
      navigate: () => harness.navigation.navigate({ sessionId, toRoomId }),
      generatedGateEnabled: true,
      currentRoom: harness.room,
    })
  }

  it('App source passes generated gate options only for generated play', () => {
    const handleNavigate = appSource.slice(
      appSource.indexOf('const handleNavigate = useCallback('),
      appSource.indexOf('if (result.status === \'navigated\')'),
    )

    expect(handleNavigate).toContain('demoQuestEnabled: activePlay.questSpec != null')
    expect(handleNavigate).toContain('activePlay.objectivesPerRoom === true')
    expect(handleNavigate).toContain('generatedGateEnabled: true')
    expect(handleNavigate).toContain('currentRoom: activePlay.room')
  })

  it('blocks a generated governed exit before interaction and uses a safe message', async () => {
    const harness = createGateHarness()
    const state = await startGeneratedHarness(harness)

    const result = await appStyleNavigate(harness, state.sessionId, GOVERNED_ROOM_ID)

    expect(result).toEqual({ status: 'rejected', reason: 'gate-locked' })
    const message = navigationResultMessage(result)
    expect(message).toBe('This way remains sealed.')
    const unsafeDump = JSON.stringify({ message, logs: harness.logs })
    expect(unsafeDump).not.toContain(GENERATED_ROOM_ID)
    expect(unsafeDump).not.toContain(CONTROL_OBJECT_ID)
    expect(unsafeDump).not.toContain(UNLOCK_FLAG)
    expect(unsafeDump).not.toContain(GOVERNED_ROOM_ID)
    expect(unsafeDump).not.toContain('mechanical-gate')
    expect(unsafeDump).not.toContain('locked-exit')
    expect(unsafeDump).not.toContain('SECRET GENERATED')
    expect(unsafeDump).not.toContain(SECRET_RAW_PROMPT)
  })

  it('interaction sets the existing room flag and the governed exit succeeds afterward', async () => {
    const harness = createGateHarness()
    const state = await startGeneratedHarness(harness)

    await expect(appStyleNavigate(harness, state.sessionId, GOVERNED_ROOM_ID))
      .resolves.toEqual({ status: 'rejected', reason: 'gate-locked' })

    const interaction = await harness.interaction.resolve({
      sessionId: state.sessionId,
      effect: { kind: 'inspect' },
      ref: CONTROL_OBJECT_ID,
    })
    expect(interaction.status).toBe('applied')
    if (interaction.status !== 'applied') throw new Error('expected applied interaction')
    expect(interaction.state.roomStates[GENERATED_ROOM_ID]?.flags?.[UNLOCK_FLAG]).toBe(true)

    const result = await appStyleNavigate(harness, state.sessionId, GOVERNED_ROOM_ID)

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') throw new Error('expected navigation')
    expect(result.room.id).toBe(GOVERNED_ROOM_ID)
    expect(result.state.currentRoomId).toBe(GOVERNED_ROOM_ID)
  })

  it('leaves non-governed generated exits open', async () => {
    const harness = createGateHarness()
    const state = await startGeneratedHarness(harness)

    const result = await appStyleNavigate(harness, state.sessionId, SIDE_ROOM_ID)

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') throw new Error('expected navigation')
    expect(result.room.id).toBe(SIDE_ROOM_ID)
  })

  it('fails open when the generated room has no satisfiable gate', async () => {
    const ungatedRoom = makeRoom([
      { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
      {
        type: 'arch',
        id: 'north-arch',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave north', exit: { toRoomId: GOVERNED_ROOM_ID } },
      },
    ], GENERATED_ROOM_ID, 'Ungated generated room')
    const harness = createGateHarness(ungatedRoom)
    const state = await startGeneratedHarness(harness)

    const result = await appStyleNavigate(harness, state.sessionId, GOVERNED_ROOM_ID)

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') throw new Error('expected navigation')
    expect(result.room.id).toBe(GOVERNED_ROOM_ID)
  })

  it('fails open when getWorldState is unavailable in the gate seam', async () => {
    const harness = createGateHarness()
    const state = await startGeneratedHarness(harness)

    const result = await navigateWithExitGate({
      sessionId: state.sessionId,
      fromRoomId: harness.room.id,
      toRoomId: GOVERNED_ROOM_ID,
      demoQuestEnabled: false,
      getWorldState: async () => ({
        ok: false,
        error: { code: 'not-found', message: 'Session not found.' },
      }),
      navigate: () => harness.navigation.navigate({ sessionId: state.sessionId, toRoomId: GOVERNED_ROOM_ID }),
      generatedGateEnabled: true,
      currentRoom: harness.room,
    })

    expect(result.status).toBe('navigated')
  })

  it('keeps authored Malik demo gate behavior unchanged', async () => {
    const harness = createGateHarness()
    const started = await harness.worldSession.startSession({
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'SECRET WORLD NAME',
      startingRoomId: 'throne-room',
      initialPlayer: { health: { current: 75, max: 100 }, status: [], inventory: [] },
    })
    if (!started.ok) throw new Error(started.error.code)

    const result = await navigateWithExitGate({
      sessionId: started.state.sessionId,
      fromRoomId: 'throne-room',
      toRoomId: 'ruined-safehouse',
      demoQuestEnabled: true,
      getWorldState: (id) => harness.worldSession.getWorldState(id),
      navigate: () => harness.navigation.navigate({ sessionId: started.state.sessionId, toRoomId: 'ruined-safehouse' }),
    })

    expect(result).toEqual({ status: 'rejected', reason: 'blocked' })
    expect(navigationResultMessage(result)).toBe('The north arch is barred until you deal with Steward Malik.')
  })

  it('handleNavigate source does not add provider, cost, save/load, or cache mutation work', () => {
    const handleNavigateStart = appSource.indexOf('const handleNavigate = useCallback(')
    const handleNavigate = appSource.slice(
      handleNavigateStart,
      appSource.indexOf('return result', handleNavigateStart),
    )

    expect(handleNavigate).not.toContain('recordAttempt')
    expect(handleNavigate).not.toContain('objectiveGenerator.generate')
    expect(handleNavigate).not.toContain('FakeRoomGenerator')
    expect(handleNavigate).not.toContain('GeneratedRoomSource')
    expect(handleNavigate).not.toContain('saveGameService')
    expect(handleNavigate).not.toContain('buildGeneratedRoomCacheSaveJson')
    expect(handleNavigate).not.toContain('snapshotCachedRooms')
  })
})

describe('generated quest restore — handleLoad wiring (ADR-0059, slice 5)', () => {
  const ROOM_ID = 'generated-room'
  const OBJECT_ID = 'case-file'
  const FLAG = `interaction:${OBJECT_ID}`
  const GATE_ROOM_ID = 'gate-restore-room'
  const GATE_OBJECT_ID = 'gate-control-panel'
  const GATE_TO_ROOM_ID = 'gate-north-room'
  const GATE_SIDE_ROOM_ID = 'gate-side-room'
  const GATE_FLAG = `interaction:${GATE_OBJECT_ID}`

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

  function cachedObjectiveFor(room: LoadedRoom, objectId: string): GeneratedObjectiveQuestAttachment {
    return {
      questSpec: {
        questId: `${room.id}-objective`,
        title: 'Secure the cached room',
        anchorRoomId: room.id,
        objectives: [
          {
            id: 'generated-0',
            text: 'Inspect the cached feature.',
            condition: {
              kind: 'room-flag' as const,
              roomId: room.id,
              flag: `interaction:${objectId}`,
            },
          },
        ],
      },
      hint: 'Check the cached feature.',
      completionHint: 'The cached feature is resolved.',
    }
  }

  function seedMemoLikeApp(input: {
    restoredRoomIds: string[]
    restoredObjectives: ReadonlyMap<string, GeneratedObjectiveQuestAttachment>
  }) {
    const memo = new Map<string, GeneratedObjectiveQuestAttachment | null>([
      [ROOM_ID, { questSpec: genQuestSpec, ...genHints }],
    ])
    for (const roomId of input.restoredRoomIds) {
      if (roomId !== ROOM_ID) memo.set(roomId, input.restoredObjectives.get(roomId) ?? null)
    }
    return memo
  }

  const gateRoom = makeRoom(
    [
      {
        type: 'machine',
        id: GATE_OBJECT_ID,
        name: 'SECRET RESTORED GATE CONTROL NAME',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Inspect the secret restored gate control',
          body: 'SECRET RESTORED GATE DESCRIPTION',
          effect: { kind: 'inspect' },
        },
      },
      {
        type: 'arch',
        id: 'gate-north-arch',
        name: 'SECRET RESTORED GATE ARCH NAME',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave through the sealed arch', exit: { toRoomId: GATE_TO_ROOM_ID } },
      },
      {
        type: 'arch',
        id: 'gate-side-arch',
        name: 'SECRET RESTORED SIDE ARCH NAME',
        position: [5, 0, 0],
        interaction: { key: 'E', prompt: 'Leave sideways', exit: { toRoomId: GATE_SIDE_ROOM_ID } },
      },
    ],
    GATE_ROOM_ID,
    'SECRET RESTORED GATE ROOM NAME',
  )

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

  function restoredGatePlay(world: WorldState) {
    return restoreFromSavedBlob({ room: gateRoom, objectivesPerRoom: true }, null, world)
  }

  function restoredGateNavigate(input: {
    room: LoadedRoom
    world: WorldState
    toRoomId?: string
  }) {
    const toRoomId = input.toRoomId ?? GATE_TO_ROOM_ID
    return navigateWithExitGate({
      sessionId: input.world.sessionId,
      fromRoomId: input.room.id,
      toRoomId,
      demoQuestEnabled: false,
      getWorldState: async () => ({ ok: true, state: input.world }),
      navigate: async () => ({
        status: 'navigated',
        room: makeRoom([], toRoomId, `Target ${toRoomId}`),
        state: { ...input.world, currentRoomId: toRoomId },
        cacheHit: false,
        provenance: 'generated',
      }),
      generatedGateEnabled: true,
      currentRoom: input.room,
    })
  }

  async function worldAfterGateInteraction(): Promise<WorldState> {
    const store = new InMemoryWorldStore()
    let id = 30
    const ids: IdGenerator = {
      newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
    }
    let tick = 0
    const clock: Clock = {
      now: () => `2026-07-01T01:00:${String(tick++).padStart(2, '0')}.000Z`,
    }
    const worldSession = new WorldSession(store, clock, ids, noopLogger)
    const interaction = new InteractionService(worldSession, noopLogger)
    const started = await worldSession.startSession({
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'Gate restore world',
      startingRoomId: GATE_ROOM_ID,
      initialPlayer: { health: { current: 75, max: 100 }, status: [], inventory: [] },
    })
    if (!started.ok) throw new Error(started.error.code)
    const applied = await interaction.resolve({
      sessionId: started.state.sessionId,
      effect: { kind: 'inspect' },
      ref: GATE_OBJECT_ID,
    })
    expect(applied.status).toBe('applied')
    if (applied.status !== 'applied') throw new Error('expected gate interaction to apply')
    expect(applied.state.roomStates[GATE_ROOM_ID]?.flags?.[GATE_FLAG]).toBe(true)
    return applied.state
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

  it('save before interaction restores the generated gate as locked by re-deriving from the room', async () => {
    const lockedWorld = makeState({
      currentRoomId: GATE_ROOM_ID,
      roomStates: { [GATE_ROOM_ID]: { visited: true } },
    })
    const play = restoredGatePlay(lockedWorld)

    const result = await restoredGateNavigate({ room: play.room, world: lockedWorld })

    expect(result).toEqual({ status: 'rejected', reason: 'gate-locked' })
    const message = navigationResultMessage(result)
    expect(message).toBe('This way remains sealed.')
    const unsafeDump = JSON.stringify({ message, logs: [] })
    expect(unsafeDump).not.toContain(GATE_ROOM_ID)
    expect(unsafeDump).not.toContain(GATE_OBJECT_ID)
    expect(unsafeDump).not.toContain(GATE_FLAG)
    expect(unsafeDump).not.toContain(GATE_TO_ROOM_ID)
    expect(unsafeDump).not.toContain('mechanical-gate')
    expect(unsafeDump).not.toContain('locked-exit')
    expect(unsafeDump).not.toContain('unlock-exit')
    expect(unsafeDump).not.toContain(SECRET_RAW_PROMPT)
    expect(unsafeDump).not.toContain('SECRET RESTORED')
  })

  it('interact before save restores the generated gate as unlocked from WorldState flags', async () => {
    const unlockedWorld = await worldAfterGateInteraction()
    const play = restoredGatePlay(unlockedWorld)

    const result = await restoredGateNavigate({ room: play.room, world: unlockedWorld })

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') throw new Error('expected restored gate to be unlocked')
    expect(result.room.id).toBe(GATE_TO_ROOM_ID)
    expect(result.state.currentRoomId).toBe(GATE_TO_ROOM_ID)
  })

  it('does not persist generated gate data in generated save blobs', () => {
    const json = buildGeneratedQuestSaveJson({ room: gateRoom, objectivesPerRoom: true }, null)

    expect(json).toBeDefined()
    expect(json).not.toContain('mechanicalGate')
    expect(json).not.toContain('mechanical-gate')
    expect(json).not.toContain('GeneratedMechanicalGate')
    expect(json).not.toContain('locked-exit')
    expect(json).not.toContain('unlock-exit')
    expect(json).not.toContain('"gate"')
    expect(json).not.toContain('"gates"')
    expect(json).not.toContain('"gateId"')
    expect(json).not.toContain('providerGateStatus')
    expect(json).not.toContain('providerGate')
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

  it('restores cached generated rooms and returns cached backtracking without generation', async () => {
    const previousRoom = makeRoom(
      [
        {
          type: 'scroll',
          id: 'previous-object',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
        },
      ],
      'generated-previous',
      'Generated Previous Room',
    )
    const world = makeState({
      currentRoomId: ROOM_ID,
      roomStates: {
        [ROOM_ID]: { visited: true },
        [previousRoom.id]: { visited: true },
      },
    })
    const json = buildGeneratedRoomCacheSaveJson({
      room: genRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: genRoom.id, room: genRoom, provenance: 'generated' },
        { roomId: previousRoom.id, room: previousRoom, provenance: 'generated' },
      ],
      worldState: world,
      themePack: 'fantasy-keep',
    })
    expect(json).toBeDefined()
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('expected valid generated room cache')

    const restored = restoreGeneratedRoomCache(loaded.state, genRoom)
    let sourceCalls = 0
    const pregenerator = new AdjacentRoomPregenerator(
      restored.cache,
      { has: () => false, resolve: () => ({ ok: false, reason: 'unknown-room' }) },
      () => ({
        getRoom: async () => {
          sourceCalls += 1
          return { ok: true, room: makeRoom([], 'unexpected-generated') }
        },
      }),
      makeRoom([], 'fallback-room'),
      noopLogger,
    )
    pregenerator.restoreProvenance(restored.provenance)

    const resolved = await pregenerator.resolveRoom(previousRoom.id)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected restored cache hit')
    expect(resolved.cacheHit).toBe(true)
    expect(resolved.source).toBe('cache')
    expect(resolved.provenance).toBe('generated')
    expect(resolved.room.objects.some((object) => object.id === 'previous-object')).toBe(true)
    expect(sourceCalls).toBe(0)
  })

  it('restored non-current cached room gets objective memo re-seeded for backtracking', async () => {
    const previousRoom = makeRoom(
      [
        {
          type: 'scroll',
          id: 'previous-objective-object',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Read previous', effect: { kind: 'inspect' } },
        },
      ],
      'generated-previous-objective',
      'Generated Previous Objective Room',
    )
    const previousObjective = cachedObjectiveFor(previousRoom, 'previous-objective-object')
    const world = makeState({
      currentRoomId: ROOM_ID,
      roomStates: {
        [ROOM_ID]: { visited: true },
        [previousRoom.id]: { visited: true },
      },
    })
    const json = buildGeneratedRoomCacheSaveJson({
      room: genRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: genRoom.id, room: genRoom, provenance: 'generated' },
        { roomId: previousRoom.id, room: previousRoom, provenance: 'generated' },
      ],
      worldState: world,
      objectives: new Map([[previousRoom.id, previousObjective]]),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('expected valid generated room cache')
    const restored = restoreGeneratedRoomCache(loaded.state, genRoom)
    expect(restored.objectives.has(ROOM_ID)).toBe(false)
    const memo = seedMemoLikeApp({
      restoredRoomIds: restored.restoredRoomIds,
      restoredObjectives: restored.objectives,
    })

    const pregenerator = new AdjacentRoomPregenerator(
      restored.cache,
      { has: () => false, resolve: () => ({ ok: false, reason: 'unknown-room' }) },
      () => ({ getRoom: async () => ({ ok: true, room: makeRoom([], 'unexpected-generated') }) }),
      makeRoom([], 'fallback-room'),
      noopLogger,
    )
    pregenerator.restoreProvenance(restored.provenance)
    const resolved = await pregenerator.resolveRoom(previousRoom.id)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected restored cache hit')

    const restoredObjective = readPerRoomObjectiveMemo(memo, previousRoom.id)
    expect(restoredObjective.cached).toBe(true)
    expect(restoredObjective.questSpec).toEqual(previousObjective.questSpec)
    expect(restoredObjective.questHints).toEqual({
      hint: previousObjective.hint,
      completionHint: previousObjective.completionHint,
    })
  })

  it('current-room objective comes from generatedQuestJson and tampered cache objective is ignored', () => {
    const tamperedCurrentObjective = {
      ...cachedObjectiveFor(genRoom, OBJECT_ID),
      questSpec: {
        ...cachedObjectiveFor(genRoom, OBJECT_ID).questSpec,
        questId: 'tampered-current-cache-objective',
        title: 'Tampered cache objective',
      },
    }
    const state = {
      schemaVersion: 1,
      rooms: [
        {
          room: {
            schemaVersion: genRoom.schemaVersion,
            id: genRoom.id,
            name: genRoom.name,
            shell: genRoom.shell,
            spawn: genRoom.spawn,
            lighting: genRoom.lighting,
            objects: genRoom.objects,
          },
          provenance: 'generated',
          objective: tamperedCurrentObjective,
        },
      ],
    }
    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify(state))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('expected valid generated room cache')
    const restored = restoreGeneratedRoomCache(loaded.state, genRoom)
    const memo = seedMemoLikeApp({
      restoredRoomIds: restored.restoredRoomIds,
      restoredObjectives: restored.objectives,
    })

    const current = readPerRoomObjectiveMemo(memo, ROOM_ID)
    expect(current.questSpec).toEqual(genQuestSpec)
    expect(current.questSpec?.questId).not.toBe('tampered-current-cache-objective')
  })

  it('malformed or semantically mismatched cached objective restores room but seeds null', () => {
    const previousRoom = makeRoom(
      [
        {
          type: 'scroll',
          id: 'previous-object',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Read previous', effect: { kind: 'inspect' } },
        },
      ],
      'generated-previous-null-objective',
      'Generated Previous Null Objective Room',
    )
    const baseState = {
      schemaVersion: 1,
      rooms: [
        {
          room: {
            schemaVersion: previousRoom.schemaVersion,
            id: previousRoom.id,
            name: previousRoom.name,
            shell: previousRoom.shell,
            spawn: previousRoom.spawn,
            lighting: previousRoom.lighting,
            objects: previousRoom.objects,
          },
          provenance: 'generated',
        },
      ],
    }
    const mismatched = {
      ...cachedObjectiveFor(previousRoom, 'previous-object'),
      questSpec: {
        ...cachedObjectiveFor(previousRoom, 'previous-object').questSpec,
        anchorRoomId: ROOM_ID,
      },
    }

    for (const objective of [{ questSpec: 'bad' }, mismatched]) {
      const loaded = loadGeneratedRoomCacheSaveState(
        JSON.stringify({
          ...baseState,
          rooms: [{ ...baseState.rooms[0], objective }],
        }),
      )
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) throw new Error('expected valid generated room cache')
      const restored = restoreGeneratedRoomCache(loaded.state, genRoom)
      const memo = seedMemoLikeApp({
        restoredRoomIds: restored.restoredRoomIds,
        restoredObjectives: restored.objectives,
      })

      expect(restored.cache.get(previousRoom.id)?.id).toBe(previousRoom.id)
      expect(readPerRoomObjectiveMemo(memo, previousRoom.id)).toEqual({
        cached: true,
        questSpec: null,
        questHints: null,
      })
    }
  })

  it('cached objective completion is re-derived from restored WorldState flags', () => {
    const previousRoom = makeRoom(
      [
        {
          type: 'scroll',
          id: 'previous-complete-object',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Read previous', effect: { kind: 'inspect' } },
        },
      ],
      'generated-previous-complete',
      'Generated Previous Complete Room',
    )
    const previousObjective = cachedObjectiveFor(previousRoom, 'previous-complete-object')
    const world = makeState({
      currentRoomId: ROOM_ID,
      roomStates: {
        [ROOM_ID]: { visited: true },
        [previousRoom.id]: {
          visited: true,
          flags: { 'interaction:previous-complete-object': true },
        },
      },
    })
    const json = buildGeneratedRoomCacheSaveJson({
      room: genRoom,
      objectivesPerRoom: true,
      cachedRooms: [
        { roomId: genRoom.id, room: genRoom, provenance: 'generated' },
        { roomId: previousRoom.id, room: previousRoom, provenance: 'generated' },
      ],
      worldState: world,
      objectives: new Map([[previousRoom.id, previousObjective]]),
    })
    const loaded = loadGeneratedRoomCacheSaveState(json!)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('expected valid generated room cache')
    const restored = restoreGeneratedRoomCache(loaded.state, genRoom)
    const memo = seedMemoLikeApp({
      restoredRoomIds: restored.restoredRoomIds,
      restoredObjectives: restored.objectives,
    })
    const restoredObjective = readPerRoomObjectiveMemo(memo, previousRoom.id)

    expect(JSON.stringify(restoredObjective)).not.toContain('"done"')
    expect(evaluateQuest(restoredObjective.questSpec!, world).status).toBe('complete')
  })

  it('corrupt generatedRoomCacheJson does not block current-room generated quest restore', () => {
    const world = makeState({ currentRoomId: ROOM_ID, roomStates: { [ROOM_ID]: { visited: true } } })
    const play = restoreFromSavedBlob(
      { room: genRoom, objectivesPerRoom: true, questSpec: genQuestSpec },
      genHints,
      world,
    )

    expect(loadGeneratedRoomCacheSaveState('not json at all').ok).toBe(false)
    expect(play.room.id).toBe(ROOM_ID)
    expect(play.questSpec).toEqual(genQuestSpec)
  })

  it('corrupt generatedRoomCacheJson does not break current-room generated gate behavior', async () => {
    const lockedWorld = makeState({
      currentRoomId: GATE_ROOM_ID,
      roomStates: { [GATE_ROOM_ID]: { visited: true } },
    })
    const play = restoredGatePlay(lockedWorld)

    expect(loadGeneratedRoomCacheSaveState('not json at all').ok).toBe(false)
    await expect(restoredGateNavigate({ room: play.room, world: lockedWorld }))
      .resolves.toEqual({ status: 'rejected', reason: 'gate-locked' })
  })

  it('restored generated rooms with no valid gate remain open', async () => {
    const ungatedRoom = makeRoom(
      [
        { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
        {
          type: 'arch',
          id: 'ungated-north-arch',
          position: [0, 0, -8],
          interaction: { key: 'E', prompt: 'Leave north', exit: { toRoomId: GATE_TO_ROOM_ID } },
        },
      ],
      GATE_ROOM_ID,
      'Ungated restored generated room',
    )
    const world = makeState({
      currentRoomId: GATE_ROOM_ID,
      roomStates: { [GATE_ROOM_ID]: { visited: true } },
    })
    const play = restoreFromSavedBlob({ room: ungatedRoom, objectivesPerRoom: true }, null, world)

    const result = await restoredGateNavigate({ room: play.room, world })

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') throw new Error('expected invalid/no gate to fail open')
    expect(result.room.id).toBe(GATE_TO_ROOM_ID)
  })

  it('seeds current quest memo even when hints are absent and non-current cached rooms as null', () => {
    const currentMemo = new Map([[ROOM_ID, { questSpec: genQuestSpec, hint: '', completionHint: '' }]])
    const current = readPerRoomObjectiveMemo(currentMemo, ROOM_ID)

    expect(current.cached).toBe(true)
    expect(current.questSpec).toEqual(genQuestSpec)
    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: true,
      provenance: 'generated',
      memo: currentMemo,
      roomId: ROOM_ID,
    })).toBe(false)

    const nonCurrentMemo = new Map([[ROOM_ID, { questSpec: genQuestSpec, hint: '', completionHint: '' }], ['generated-previous', null]])
    const previous = readPerRoomObjectiveMemo(nonCurrentMemo, 'generated-previous')

    expect(previous.cached).toBe(true)
    expect(previous.questSpec).toBeNull()
    expect(previous.questHints).toBeNull()
    expect(shouldStartPerRoomObjectiveAttach({
      objectivesPerRoom: true,
      provenance: 'generated',
      memo: nonCurrentMemo,
      roomId: 'generated-previous',
    })).toBe(false)
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
    expect(appSource).toContain('restoreGeneratedRoomCacheFromSlot(')
    expect(appSource).toContain('loadGeneratedRoomCacheSaveState(generatedRoomCacheJson)')
    expect(appSource).toContain('restoreGeneratedRoomCache(loaded.state, currentRoom, currentQuestSpec)')
    expect(appSource).toContain('consequenceCatalogs: restoredCache.restoredConsequenceCatalogs')
    expect(appSource).toContain('slotResult.generatedRoomCacheJson')
    expect(appSource).toContain('restoreProvenance(restored.provenance)')
    expect(appSource).toContain('restoredObjectives: restored.objectives')
    expect(appSource).toContain('restoredCache?.restoredObjectives')
    expect(appSource).toContain('restoredObjectives.get(roomId) ?? null')
    expect(appSource).toContain('if (roomId !== restoredPlay.room.id)')
    // Restored quest spec and hints are routed through the existing view seams.
    expect(appSource).toContain('setQuestSpecForView(generatedPlayFields.questSpec ?? null)')
    expect(appSource).toContain('setQuestHintsForView(hints ?? null)')
  })

  it('runs generated restore before authored current-room resolution', () => {
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )

    expect(handleLoad.indexOf('restoreGeneratedPlayFromSlot(')).toBeGreaterThanOrEqual(0)
    expect(handleLoad.indexOf('restoreGeneratedPlayFromSlot('))
      .toBeLessThan(handleLoad.indexOf('adjacentPregenerator.resolveRoom(stateResult.state.currentRoomId)'))
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
    // Restoring cached rooms is data-only. handleLoad itself never records a
    // usage attempt or invokes objective generation, and the generated branch
    // does not warm rooms while entering the restored play state.
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )
    const generatedBranch = handleLoad.slice(
      handleLoad.indexOf('if (restoredGeneratedPlay != null) {'),
      handleLoad.indexOf('} else {'),
    )
    expect(handleLoad).not.toContain('recordAttempt')
    expect(handleLoad).not.toContain('objectiveGenerator')
    expect(handleLoad).not.toContain('buildGeneratedObjectiveAttachment')
    expect(handleLoad).not.toContain('FakeRoomGenerator')
    expect(handleLoad).not.toContain('GeneratedRoomSource')
    expect(generatedBranch).not.toContain('warmAdjacent')
    expect(handleLoad).toContain('restoreGeneratedPlayFromSlot(')
  })

  it('wires NPC dialogue provider through the selector instead of hardcoded fake construction', () => {
    expect(appSource).toContain("import { selectDialogueProvider } from './app/selectDialogueProvider'")
    expect(appSource).toContain('const dialogueProviderSelection = selectDialogueProvider(llmConfig)')
    expect(appSource).toContain("logger.info('dialogue provider selected', dialogueProviderSelection.log)")
    expect(appSource).toContain(
      'const npcDialogueService = new NPCDialogueService(worldSession, dialogueProviderSelection.provider, logger)',
    )
    expect(appSource).not.toContain("import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'")
    expect(appSource).not.toContain('const dialogueProvider = new FakeNPCDialogueProvider()')
  })

  it('keys the dialogue usage gate on the dialogue provider selection, not the room-generation guard', () => {
    expect(appSource).toContain("const dialogueGuardEnabled = dialogueProviderSelection.kind === 'real'")
    // Room generation's guardEnabled is derived from a different selection
    // (roomGeneratorSelectionLog); dialogueGuardEnabled must not reuse it.
    expect(appSource).not.toContain('const dialogueGuardEnabled = guardEnabled')
  })

  it('gates real NPC dialogue calls through requestDialogueAttempt, sharing the session usage meter', () => {
    const requestDialogueAttempt = appSource.slice(
      appSource.indexOf('const requestDialogueAttempt = useCallback('),
      appSource.indexOf('const enterActivePlay = useCallback('),
    )

    // Fake dialogue provider: always allowed, never counted (return before any
    // read/record against the shared meter).
    expect(requestDialogueAttempt).toContain('if (!dialogueGuardEnabled) return true')
    expect(requestDialogueAttempt.indexOf('if (!dialogueGuardEnabled) return true'))
      .toBeLessThan(requestDialogueAttempt.indexOf('canAttemptOptional('))

    // Real provider, below cap: allowed, and increments the same session meter
    // used by room/objective/gate generation (usageCountRef / setUsageCount / guardCap).
    expect(requestDialogueAttempt).toContain('canAttemptOptional({ count: usageCountRef.current }, config)')
    expect(requestDialogueAttempt).toContain('const next = recordAttempt({ count: usageCountRef.current })')
    expect(requestDialogueAttempt).toContain('usageCountRef.current = next.count')
    expect(requestDialogueAttempt).toContain('setUsageCount(next.count)')
    expect(requestDialogueAttempt).toContain('cap: guardCap')

    // Real provider, at cap: blocks and returns before recordAttempt/setUsageCount
    // ever run, so usage stays unchanged.
    const blockedBranch = requestDialogueAttempt.slice(
      requestDialogueAttempt.indexOf('if (!canAttemptOptional('),
      requestDialogueAttempt.indexOf('return false'),
    )
    expect(blockedBranch).not.toContain('recordAttempt')
    expect(blockedBranch).not.toContain('setUsageCount')

    // No new/separate usage ref, state, or cap was introduced for dialogue.
    expect(appSource).not.toMatch(/dialogueUsageCount|dialogueGuardCap|dialogueUsageState/)

    // Logging stays counts/enums-only (no provider text, key, prompt, or dialogue text).
    expect(requestDialogueAttempt).toContain("logger.info('dialogue attempt blocked'")
    expect(requestDialogueAttempt).toContain("logger.info('dialogue attempt'")

    expect(appSource).toContain('requestDialogueAttempt={requestDialogueAttempt}')
  })

  it('wires generated gate provider only in the first generated-room prompt path', () => {
    const handlePrompt = appSource.slice(
      appSource.indexOf('const handlePrompt = useCallback('),
      appSource.indexOf('const handleGenerateAnyway = useCallback('),
    )

    expect(appSource).toContain("import { selectGateGenerator } from './app/selectGateGenerator'")
    expect(appSource).toContain('const gateGeneratorSelection = selectGateGenerator(llmConfig)')
    expect(appSource).toContain("logger.info('gate generator selected', gateGeneratorSelection.log)")
    expect(handlePrompt).toContain("if (result.provenance === 'generated') {")
    expect(handlePrompt).toContain('const objectiveAllowed = canAttemptOptional(')
    expect(handlePrompt).toContain("objectiveAllowed && gateGeneratorSelection.kind === 'real'")
    expect(handlePrompt).toContain('await buildGeneratedGateAttachment(result.room, gateGeneratorSelection.generator)')
    expect(handlePrompt).toContain('providerGateStatus = attachment.status')
    expect(handlePrompt).toContain("attachment.status === 'accepted' ? attachment.gate : undefined")
    expect(handlePrompt).toContain("providerGateStatus = 'not-attempted'")
  })

  it('parks provider gate fields transiently and passes them only while navigating the current room', () => {
    const handlePrompt = appSource.slice(
      appSource.indexOf('const handlePrompt = useCallback('),
      appSource.indexOf('const handleGenerateAnyway = useCallback('),
    )
    const handleNavigate = appSource.slice(
      appSource.indexOf('const handleNavigate = useCallback('),
      appSource.indexOf('return (', appSource.indexOf('const handleNavigate = useCallback(')),
    )
    const nextPlayBlock = handleNavigate.slice(
      handleNavigate.indexOf('const nextPlay: ActivePlay = {'),
      handleNavigate.indexOf('activePlayRef.current = nextPlay'),
    )

    expect(appSource).toContain('providerGateStatus?: ProviderGateStatus')
    expect(appSource).toContain('providerGate?: GeneratedMechanicalGate')
    expect(handlePrompt).toContain('...(providerGateStatus !== undefined ? { providerGateStatus } : {})')
    expect(handlePrompt).toContain('...(providerGate !== undefined ? { providerGate } : {})')
    expect(handleNavigate).toContain('providerGateStatus: activePlay.providerGateStatus')
    expect(handleNavigate).toContain('providerGate: activePlay.providerGate')
    expect(nextPlayBlock).not.toContain('providerGateStatus')
    expect(nextPlayBlock).not.toContain('providerGate')
  })

  it('does not call the gate provider from load, save, or adjacent pregeneration paths', () => {
    const gateAttachmentCallCount = appSource.match(/buildGeneratedGateAttachment\(/g)?.length ?? 0
    const handlePrompt = appSource.slice(
      appSource.indexOf('const handlePrompt = useCallback('),
      appSource.indexOf('const handleGenerateAnyway = useCallback('),
    )
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )
    const handleSave = appSource.slice(
      appSource.indexOf('const handleSave = useCallback('),
      appSource.indexOf('const handleLoad = useCallback('),
    )
    const generatedPregeneratorSetup = handlePrompt.slice(
      handlePrompt.indexOf('const generatedPregenerator = new AdjacentRoomPregenerator('),
      handlePrompt.indexOf('const generatedNavigation = new NavigationService('),
    )

    expect(gateAttachmentCallCount).toBe(1)
    expect(handlePrompt).toContain('await buildGeneratedGateAttachment(result.room, gateGeneratorSelection.generator)')
    expect(handleLoad).not.toContain('buildGeneratedGateAttachment')
    expect(handleLoad).not.toContain('gateGeneratorSelection')
    expect(handleLoad).not.toContain('providerGateStatus')
    expect(handleLoad).not.toContain('providerGate')
    expect(handleSave).not.toContain('providerGateStatus')
    expect(handleSave).not.toContain('providerGate')
    expect(generatedPregeneratorSetup).toContain('new GeneratedRoomSource(')
    expect(generatedPregeneratorSetup).not.toContain('gateGeneratorSelection')
    expect(generatedPregeneratorSetup).not.toContain('buildGeneratedGateAttachment')
  })

  it('never logs the parked blob and restores only with a safe enum diagnostic', () => {
    const restoreHelper = appSource.slice(
      appSource.indexOf('function restoreGeneratedPlayFromSlot('),
      appSource.indexOf('function restoreGeneratedRoomCacheFromSlot('),
    )
    // The restore helper must not log at all (the blob is content-bearing data).
    expect(restoreHelper).not.toContain('logger')
    // The restored-session log line carries only safe fields: a session id and a
    // fixed enum — never the blob, room name, quest text, hints, ids, or flags.
    expect(appSource).toContain('restored: restoredKind')
    // The blob is only ever read for re-validation, never passed to the logger.
    expect(appSource).not.toContain('logger.info("world session restored", { generatedQuestJson')
    expect(appSource).not.toContain('logger.info("world session restored", { generatedRoomCacheJson')
    expect(appSource).not.toContain('logger.warn("generated room cache')
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

describe('runtime room memory save/load parking - Slice 5', () => {
  const scope = { worldId: WORLD_ID, sessionId: SESSION_ID }

  function roomMemoryJson(records: RoomMemoryRecord[]): string {
    return JSON.stringify({ schemaVersion: 1, records })
  }

  it('save with runtime memories includes roomMemoryJson that re-validates', () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([makeRoomMemoryRecord()])

    const json = buildRuntimeRoomMemorySaveJson(store, scope)

    expect(typeof json).toBe('string')
    expect(json).not.toBe('')
    expect(loadRoomMemorySaveState(json!).ok).toBe(true)
  })

  it('save with no runtime memories omits roomMemoryJson', () => {
    const store = new InMemoryRoomMemoryStore()

    expect(buildRuntimeRoomMemorySaveJson(store, scope)).toBeUndefined()
  })

  it('load valid roomMemoryJson restores memory and existing recall can see it', async () => {
    const store = new InMemoryRoomMemoryStore()
    const record = makeRoomMemoryRecord({ roomId: 'room-not-cross-checked' })
    const summary = restoreRuntimeRoomMemoryFromSlot({
      store,
      roomMemoryJson: roomMemoryJson([record]),
      scope,
    })

    expect(summary.status).toBe('restored')
    expect(summary.restoredCount).toBe(1)
    await expect(store.listForRoom({ ...scope, roomId: record.roomId }, { limit: 10 }))
      .resolves.toHaveLength(1)

    const service = new RoomMemoryService(
      store,
      { now: () => UPDATED_AT },
      { newId: () => 'unused-id' },
      noopLogger,
    )
    const recalled = await service.recall({ ...scope, roomId: record.roomId })
    expect(recalled.memories.map((memory) => memory.memoryId)).toEqual([record.memoryId])
  })

  it('load invalid roomMemoryJson succeeds and leaves memory empty', () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([makeRoomMemoryRecord({ memoryId: 'stale-before-invalid' })])

    const summary = restoreRuntimeRoomMemoryFromSlot({
      store,
      roomMemoryJson: 'NOT VALID JSON{{{',
      scope,
    })

    expect(summary).toEqual({
      status: 'invalid',
      reason: 'invalid-json',
      restoredCount: 0,
      droppedCount: 0,
      droppedByScope: 0,
      droppedBySource: 0,
      droppedByText: 0,
      droppedByCap: 0,
    })
    expect(store.snapshotAll()).toEqual([])
  })

  it('load mismatched worldId/sessionId drops records', () => {
    const store = new InMemoryRoomMemoryStore()
    const keep = makeRoomMemoryRecord({ memoryId: 'keep' })
    const wrongWorld = makeRoomMemoryRecord({ memoryId: 'wrong-world', worldId: 'other-world' })
    const wrongSession = makeRoomMemoryRecord({ memoryId: 'wrong-session', sessionId: 'other-session' })

    const summary = restoreRuntimeRoomMemoryFromSlot({
      store,
      roomMemoryJson: roomMemoryJson([keep, wrongWorld, wrongSession]),
      scope,
    })

    expect(summary.restoredCount).toBe(1)
    expect(summary.droppedByScope).toBe(2)
    expect(store.snapshotAll().map((memory) => memory.memoryId)).toEqual(['keep'])
  })

  it('load source llm and unsafe text records drops them', () => {
    const store = new InMemoryRoomMemoryStore()
    const safe = makeRoomMemoryRecord({ memoryId: 'safe' })
    const llm = makeRoomMemoryRecord({
      memoryId: 'llm',
      provenance: { source: 'llm' },
      text: 'secret llm memory text',
    })
    const unsafe = makeRoomMemoryRecord({
      memoryId: 'unsafe',
      text: 'unsafe memory\nSECRET CURRENT ROOM',
    })

    const summary = restoreRuntimeRoomMemoryFromSlot({
      store,
      roomMemoryJson: roomMemoryJson([safe, llm, unsafe]),
      scope,
    })

    expect(summary.restoredCount).toBe(1)
    expect(summary.droppedBySource).toBe(1)
    expect(summary.droppedByText).toBe(1)
    expect(store.snapshotAll().map((memory) => memory.memoryId)).toEqual(['safe'])
  })

  it('load without roomMemoryJson clears stale previous memory', () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([makeRoomMemoryRecord({ memoryId: 'stale-before-missing' })])

    const summary = restoreRuntimeRoomMemoryFromSlot({ store, scope })

    expect(summary.status).toBe('missing')
    expect(summary.reason).toBe('missing')
    expect(store.snapshotAll()).toEqual([])
  })

  it('save/load round-trip preserves dedupe behavior through restoreAll', async () => {
    const source = new InMemoryRoomMemoryStore()
    source.restoreAll([makeRoomMemoryRecord({ memoryId: 'deduped', dedupeKey: 'interaction:orb' })])
    const json = buildRuntimeRoomMemorySaveJson(source, scope)
    expect(json).toBeDefined()

    const restored = new InMemoryRoomMemoryStore()
    restoreRuntimeRoomMemoryFromSlot({ store: restored, roomMemoryJson: json, scope })
    const write = await restored.record({
      schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
      memoryId: 'new-memory',
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: 'generated-room',
      kind: 'room_observation',
      text: 'same dedupe key should return existing memory',
      provenance: { source: 'game' },
      confidence: 'medium',
      dedupeKey: 'interaction:orb',
      createdAt: UPDATED_AT,
    })

    expect(write.ok).toBe(true)
    if (write.ok) {
      expect(write.deduplicated).toBe(true)
      expect(write.record.memoryId).toBe('deduped')
    }
  })

  it('restore summary contains only safe counts/reason codes', () => {
    const store = new InMemoryRoomMemoryStore()
    const secret = 'SECRET ROOM MEMORY TEXT'
    const json = roomMemoryJson([
      makeRoomMemoryRecord({ memoryId: 'safe', text: 'safe text' }),
      makeRoomMemoryRecord({ memoryId: 'llm', provenance: { source: 'llm' }, text: secret }),
    ])

    const summary = restoreRuntimeRoomMemoryFromSlot({ store, roomMemoryJson: json, scope })
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(json)
    expect(summary.droppedBySource).toBe(1)
  })

  it('App source wires roomMemoryJson into save and load before derived recall refresh', () => {
    const handleSave = appSource.slice(
      appSource.indexOf('const handleSave = useCallback('),
      appSource.indexOf('const handleLoad = useCallback('),
    )
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )

    expect(appSource).toContain('roomMemoryRuntimeRef.current.store')
    expect(handleSave).toContain('const stateForSidecars = await worldSession.getWorldState(activePlay.sessionId)')
    expect(handleSave).toContain('buildRuntimeRoomMemorySaveJson(')
    expect(handleSave).toContain('roomMemoryJson,')
    expect(handleLoad).toContain('restoreRuntimeRoomMemoryFromSlot({')
    expect(handleLoad).toContain('slotResult.roomMemoryJson')
    expect(handleLoad.indexOf('restoreRuntimeRoomMemoryFromSlot({')).toBeLessThan(
      handleLoad.indexOf('restoreGeneratedPlayFromSlot('),
    )
    expect(handleLoad.indexOf('restoreRuntimeRoomMemoryFromSlot({')).toBeLessThan(
      handleLoad.indexOf('refreshDerivedViews(stateResult.state)'),
    )
    expect(appSource).not.toContain('logger.info("world session restored", { roomMemoryJson')
  })
})

describe('memory feedback state wiring - Slice 4', () => {
  const ZERO_SUMMARY: PromotionSummary = { recorded: 0, deduplicated: 0, rejected: 0, failed: 0 }

  function summary(overrides: Partial<PromotionSummary> = {}): PromotionSummary {
    return { ...ZERO_SUMMARY, ...overrides }
  }

  it('shows created feedback after a recorded promotion', () => {
    const next = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
      promotionSummary: summary({ recorded: 1 }),
      roomEntrySeq: 1,
    })

    expect(next).toEqual({ message: MEMORY_CREATED_MESSAGE, shownForRoomEntrySeq: 1 })
  })

  it('does not show feedback for deduplicated-, rejected-, or failed-only promotions', () => {
    for (const overrides of [{ deduplicated: 1 }, { rejected: 1 }, { failed: 1 }]) {
      const next = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
        promotionSummary: summary(overrides),
        roomEntrySeq: 1,
      })
      expect(next).toEqual(INITIAL_MEMORY_FEEDBACK_STATE)
    }
  })

  it('a wholesale-rejected promotion (EMPTY_PROMOTION_SUMMARY) shows nothing and never throws', () => {
    expect(() => {
      const next = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
        promotionSummary: EMPTY_PROMOTION_SUMMARY,
        roomEntrySeq: 1,
      })
      expect(next).toEqual(INITIAL_MEMORY_FEEDBACK_STATE)
    }).not.toThrow()
  })

  it('shows recalled feedback when memory exists and none has been shown for this room entry', () => {
    const next = memoryFeedbackAfterRecall(INITIAL_MEMORY_FEEDBACK_STATE, {
      hasRecalledMemory: true,
      roomEntrySeq: 2,
    })

    expect(next).toEqual({ message: MEMORY_RECALLED_MESSAGE, shownForRoomEntrySeq: 2 })
  })

  it('does not show recalled feedback when no memory was recalled', () => {
    const next = memoryFeedbackAfterRecall(INITIAL_MEMORY_FEEDBACK_STATE, {
      hasRecalledMemory: false,
      roomEntrySeq: 2,
    })

    expect(next).toEqual(INITIAL_MEMORY_FEEDBACK_STATE)
  })

  it('creation feedback suppresses a later recall refresh in the same room entry', () => {
    const roomEntrySeq = 5
    const afterCreation = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
      promotionSummary: summary({ recorded: 1 }),
      roomEntrySeq,
    })
    expect(afterCreation.message).toBe(MEMORY_CREATED_MESSAGE)

    const afterRecall = memoryFeedbackAfterRecall(afterCreation, {
      hasRecalledMemory: true,
      roomEntrySeq,
    })

    expect(afterRecall).toEqual(afterCreation)
    expect(afterRecall.message).toBe(MEMORY_CREATED_MESSAGE)
  })

  it('a new room entry clears the visible message but allows feedback again', () => {
    const roomEntrySeq = 5
    const shown = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
      promotionSummary: summary({ recorded: 1 }),
      roomEntrySeq,
    })

    const clearedOnEntry = memoryFeedbackOnRoomEntry(shown)
    expect(clearedOnEntry.message).toBeNull()

    const nextRoomEntrySeq = roomEntrySeq + 1
    const recalledAgain = memoryFeedbackAfterRecall(clearedOnEntry, {
      hasRecalledMemory: true,
      roomEntrySeq: nextRoomEntrySeq,
    })

    expect(recalledAgain).toEqual({ message: MEMORY_RECALLED_MESSAGE, shownForRoomEntrySeq: nextRoomEntrySeq })
  })

  it('clearing on room entry is a no-op when nothing is showing (stable reference)', () => {
    expect(memoryFeedbackOnRoomEntry(INITIAL_MEMORY_FEEDBACK_STATE)).toBe(INITIAL_MEMORY_FEEDBACK_STATE)
  })

  it('never derives a message other than the two closed constants or null', () => {
    const state: MemoryFeedbackState[] = [
      memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
        promotionSummary: summary({ recorded: 1 }),
        roomEntrySeq: 1,
      }),
      memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
        promotionSummary: summary({ deduplicated: 1, rejected: 1, failed: 1 }),
        roomEntrySeq: 1,
      }),
      memoryFeedbackAfterRecall(INITIAL_MEMORY_FEEDBACK_STATE, { hasRecalledMemory: true, roomEntrySeq: 1 }),
      memoryFeedbackAfterRecall(INITIAL_MEMORY_FEEDBACK_STATE, { hasRecalledMemory: false, roomEntrySeq: 1 }),
    ]

    for (const entry of state) {
      expect([null, MEMORY_CREATED_MESSAGE, MEMORY_RECALLED_MESSAGE]).toContain(entry.message)
    }
  })

  it('App wires creation feedback from the PromotionSummary, falling back to EMPTY_PROMOTION_SUMMARY on rejection', () => {
    const handleCommittedInteractionEvents = appSource.slice(
      appSource.indexOf('const handleCommittedInteractionEvents = useCallback('),
      appSource.indexOf('useEffect(() => {\n    if (memoryFeedbackState.message === null) return'),
    )

    expect(handleCommittedInteractionEvents).toContain('promoteInteractionMemories(')
    expect(handleCommittedInteractionEvents).toContain('.catch(() => EMPTY_PROMOTION_SUMMARY)')
    expect(handleCommittedInteractionEvents).toContain('memoryFeedbackAfterPromotion(current, { promotionSummary, roomEntrySeq })')
    expect(handleCommittedInteractionEvents).toContain('refreshRoomMemoryContext(input.state)')
  })

  it('App wires recall feedback from the pre-visibility recalled record count, preserving stale-request protection', () => {
    const refreshRoomMemoryContext = appSource.slice(
      appSource.indexOf('const refreshRoomMemoryContext = useCallback('),
      appSource.indexOf('const enterActivePlay = useCallback('),
    )

    expect(refreshRoomMemoryContext).toContain('if (roomMemoryRequestRef.current !== requestId) return')
    expect(refreshRoomMemoryContext).toContain('memoryFeedbackAfterRecall(current, {')
    expect(refreshRoomMemoryContext).toContain('hasRecalledMemory: recalled.records.length > 0')
  })

  it('App builds per-NPC visible room memory context and omits empty visible results', () => {
    const memoryContextCallback = appSource.slice(
      appSource.indexOf('const getRoomMemoryContextForNpc = useCallback('),
      appSource.indexOf('// Usage guardrail state'),
    )
    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('{...(activePlay.objectivesPerRoom === true'),
    )

    expect(memoryContextCallback).toContain('buildVisibleRoomMemoryContext(recalledRoomMemory, npcId)')
    expect(memoryContextCallback).toContain('context.entries.length > 0 ? context : undefined')
    expect(render).toContain('getRoomMemoryContextForNpc={getRoomMemoryContextForNpc}')
    expect(render).not.toContain('roomMemoryContext={')
  })

  it('App exposes the ephemeral relationship projection to dialogue context read-only, for the active npc only', () => {
    const relationshipContextCallback = appSource.slice(
      appSource.indexOf('const getRelationshipContextForNpc = useCallback('),
      appSource.indexOf('const handleNpcDialogueResolved = useCallback('),
    )
    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('{...(activePlay.objectivesPerRoom === true'),
    )

    expect(appSource).toContain("import type { NpcRelationshipState } from './domain/npcRelationship/contracts'")
    expect(relationshipContextCallback).toContain('return relationshipsRef.current.get(npcId)')
    expect(render).toContain('getRelationshipContextForNpc={getRelationshipContextForNpc}')

    // Read-only: the callback only reads from the ref, it never calls
    // relationshipsRef.current.set(...) or any React state setter.
    expect(relationshipContextCallback).not.toContain('relationshipsRef.current.set')
    expect(relationshipContextCallback).not.toMatch(/\bset[A-Z]\w*\(/)
    expect(relationshipContextCallback).not.toContain('appendEvent')
    expect(relationshipContextCallback).not.toContain('WorldCommand')
  })

  it('App projects worldClock through toPromptTimeContext before passing time to RoomViewer', () => {
    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('{...(activePlay.objectivesPerRoom === true'),
    )

    expect(appSource).toContain("import { computeWorldClock, toPromptTimeContext } from './domain/world/worldClock'")
    expect(render).toContain('timeContext={worldClock ? toPromptTimeContext(worldClock) : null}')
    expect(render).not.toContain('timeContext={worldClock}')
  })

  it('App wires inert dialogue semantic events and an ephemeral npc relationship projection from structural RoomViewer callback data only', () => {
    const handler = appSource.slice(
      appSource.indexOf('const handleNpcDialogueResolved = useCallback('),
      appSource.indexOf('// Usage guardrail state'),
    )
    const render = appSource.slice(
      appSource.indexOf('<RoomViewer'),
      appSource.indexOf('{...(activePlay.objectivesPerRoom === true'),
    )

    expect(appSource).toContain("import { deriveAndLogDialogueSemanticEvents } from './app/deriveAndLogDialogueSemanticEvents'")
    expect(appSource).toContain(
      "import { deriveAndLogStructuredDialogueEffects } from './app/deriveAndLogStructuredDialogueEffects'",
    )
    expect(appSource).toContain("import { deriveAndReduceRelationship } from './app/deriveAndReduceRelationship'")
    expect(appSource).toContain("import { neutralRelationship } from './domain/npcRelationship/neutral'")
    expect(appSource).toContain("import type { NpcRelationshipState } from './domain/npcRelationship/contracts'")
    expect(appSource).toContain("import type { NpcDialogueResolvedEvent } from './renderer/RoomViewer'")
    expect(appSource).toContain('const currentWorldStateRef = useRef<WorldState | null>(null)')
    expect(appSource).toContain('currentWorldStateRef.current = state')
    expect(appSource).toContain('const relationshipsRef = useRef<Map<string, NpcRelationshipState>>(new Map())')
    expect(handler).toContain('const state = currentWorldStateRef.current')
    expect(handler).toContain('const play = activePlayRef.current')
    expect(handler).toContain('const dialogueSemanticEvents = deriveAndLogDialogueSemanticEvents({')
    expect(handler).toContain('worldId: state.worldId')
    expect(handler).toContain('sessionId: state.sessionId')
    expect(handler).toContain('roomId: play?.room.id ?? state.currentRoomId')
    expect(handler).toContain('npcId: event.npcId')
    expect(handler).toContain('promptId: event.promptId')
    expect(handler).toContain('turnIndex: event.turnIndex')
    expect(handler).toContain('hasNpcReply: event.hasNpcReply')
    expect(handler).toContain('makeEventId: (kind, indexInTurn) =>')
    expect(handler).toContain('const structuredEffects = deriveAndLogStructuredDialogueEffects({')
    expect(handler).toContain('events: dialogueSemanticEvents')
    expect(handler).toContain('makeEffectId: (sourceEvent, indexInTurn) =>')
    expect(handler).toContain('structured-dialogue-effect:${sourceEvent.kind}:${indexInTurn}:${idGenerator.newId()}')
    expect(handler).toContain('logger,')
    expect(render).toContain('onNpcDialogueResolved={handleNpcDialogueResolved}')

    // Relationship reduction seam: consumes only the already-validated
    // structured effects derived above, holds the result in the ephemeral
    // relationshipsRef map keyed by npcId -- no WorldState/world-session/save
    // path is touched.
    expect(handler).toContain(
      'const relationshipScope = { worldId: state.worldId, sessionId: state.sessionId, npcId: event.npcId }',
    )
    expect(handler).toContain(
      'const priorRelationship = relationshipsRef.current.get(event.npcId) ?? neutralRelationship(relationshipScope)',
    )
    expect(handler).toContain('const relationshipResult = deriveAndReduceRelationship({')
    expect(handler).toContain('effects: structuredEffects')
    expect(handler).toContain('prior: priorRelationship')
    expect(handler).toContain('ctx: relationshipScope')
    expect(handler).toContain('relationshipsRef.current.set(event.npcId, relationshipResult.state)')

    // Relationship-visible-feedback wiring (relationship-visible-feedback-v0,
    // Slice 3): the crossing is derived from the same prior/next relationship
    // state already computed above, via the closed-enum bucket helper only --
    // never raw axis numbers passed anywhere else.
    expect(handler).toContain('const prevBucket = familiarityBucket(priorRelationship.axes.familiarity)')
    expect(handler).toContain(
      'const nextBucket = familiarityBucket(relationshipResult.state.axes.familiarity)',
    )
    expect(handler).toContain('setRelationshipFeedbackState((current) =>')
    expect(handler).toContain('relationshipFeedbackAfterReduction(current, { prevBucket, nextBucket })')

    // The only React state setters this handler calls are the relationship
    // feedback slot (relationship-visible-feedback-v0, Slice 3) and the
    // relationship journal accumulation slot (relationship-journal-runtime-v0,
    // Slice 2); Map.set on the ephemeral ref is fine, but no other `setXxx(`
    // React state setter is.
    expect(handler).not.toMatch(
      /\bset(?!RelationshipFeedbackState\b)(?!RelationshipJournal\b)[A-Z]\w*\(/,
    )
    expect(handler).not.toContain('useState')
    expect(handler).not.toContain('worldSession.')
    expect(handler).not.toContain('roomMemoryRuntimeRef')
    expect(handler).not.toContain('appendEvent')
    expect(handler).not.toContain('WorldCommand')
    expect(handler).not.toContain('save')
    expect(handler).not.toContain('persistence')
    expect(handler).not.toContain('provider')
    expect(handler).not.toContain('playerLine')
    expect(handler).not.toContain('npcText')
    expect(handler).not.toContain('providerText')

    // Relationship journal runtime wiring (relationship-journal-runtime-v0,
    // Slice 2): a second, pure accumulation call fed from the exact same
    // prevBucket/nextBucket values already computed above -- no new
    // relationship read, no raw score/name/dialogue/effect/provider text.
    expect(appSource).toContain("from './app/relationshipJournalRuntime'")
    expect(appSource).toContain('accumulateRelationshipJournal,')
    expect(appSource).toContain('INITIAL_RELATIONSHIP_JOURNAL_STATE,')
    expect(handler).toContain('setRelationshipJournal((current) =>')
    expect(handler).toContain('accumulateRelationshipJournal(current, {')
    expect(handler).toContain('worldId: state.worldId')
    expect(handler).toContain('sessionId: state.sessionId')
    expect(handler).toContain('npcId: event.npcId')
    expect(handler).toContain('prevBucket,')
    expect(handler).toContain('nextBucket,')
  })

  it('resets the ephemeral npc relationship projection alongside perRoomObjectiveMemoRef on new prompt and load', () => {
    const firstResetIndex = appSource.indexOf('perRoomObjectiveMemoRef.current = new Map()')
    const secondResetIndex = appSource.indexOf('perRoomObjectiveMemoRef.current = new Map()', firstResetIndex + 1)

    expect(firstResetIndex).toBeGreaterThan(-1)
    expect(secondResetIndex).toBeGreaterThan(firstResetIndex)

    const promptReset = appSource.slice(firstResetIndex, firstResetIndex + 300)
    const loadReset = appSource.slice(secondResetIndex, secondResetIndex + 300)

    expect(promptReset).toContain('relationshipsRef.current = new Map()')
    expect(loadReset).toContain('relationshipsRef.current = new Map()')

    // relationship-visible-feedback-v0 (Slice 3): clear the visible
    // relationship feedback line at the same two reset points where the
    // ephemeral relationship projection itself is reset, so a stale message
    // can never linger into a fresh prompt/load session.
    expect(promptReset).toContain('setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)')
    expect(loadReset).toContain('setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)')

    // relationship-journal-runtime-v0 (Slice 2): the ephemeral relationship
    // journal resets at exactly these two session-boundary sites, mirroring
    // relationshipsRef -- never at enterActivePlay/handleNavigate room entry.
    expect(promptReset).toContain('setRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE)')
    expect(loadReset).toContain('setRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE)')

    const journalResetMatches = appSource.match(/setRelationshipJournal\(INITIAL_RELATIONSHIP_JOURNAL_STATE\)/g) ?? []
    expect(journalResetMatches).toHaveLength(2)
  })

  it('does not reset the relationship journal on room entry (enterActivePlay and handleNavigate)', () => {
    const enterActivePlay = appSource.slice(
      appSource.indexOf('const enterActivePlay = useCallback('),
      appSource.indexOf('const setQuestSpecForView = useCallback('),
    )
    expect(enterActivePlay).not.toContain('setRelationshipJournal')

    const handleNavigateSetters = appSource.slice(
      appSource.indexOf('activePlayRef.current = nextPlay'),
      appSource.indexOf('activePlay.adjacentPregenerator?.warmAdjacent(result.room)'),
    )
    expect(handleNavigateSetters).not.toContain('setRelationshipJournal')
  })

  it('does not re-seed or replay the relationship journal from the restored npc relationship sidecar on load', () => {
    const restoreBlock = appSource.slice(
      appSource.indexOf('re-seed the ephemeral'),
      appSource.indexOf('const relationshipRestore = restoreNpcRelationshipsFromSlot('),
    )
    expect(restoreBlock.length).toBeGreaterThan(0)
    expect(restoreBlock).not.toContain('setRelationshipJournal')
    expect(restoreBlock).not.toContain('accumulateRelationshipJournal')
  })
})

describe('App relationship journal runtime panel rendering (relationship-journal-runtime-v0, Slice 3)', () => {
  it('reads the relationshipJournal state value instead of discarding it', () => {
    expect(appSource).toContain('const [relationshipJournal, setRelationshipJournal] =')
    expect(appSource).toContain('useState<RelationshipJournalState>(INITIAL_RELATIONSHIP_JOURNAL_STATE)')
    expect(appSource).not.toContain('const [, setRelationshipJournal] =')
  })

  it('imports toRelationshipJournalView and renders a second JournalPanel titled Relationships only when entries exist', () => {
    expect(appSource).toContain("from './app/relationshipJournalRuntime'")
    expect(appSource).toContain('toRelationshipJournalView,')
    expect(appSource).toContain('type RelationshipJournalState,')
    const render = appSource.slice(
      appSource.indexOf('{journal && <JournalPanel view={journal} />}'),
      appSource.indexOf('<AppRoomEntryOverlay'),
    )
    expect(render).toContain('{relationshipJournal.entries.length > 0 && (')
    expect(render).toContain('view={toRelationshipJournalView(relationshipJournal)}')
    expect(render).toContain('label="Relationships"')
    expect(render).toContain('className="relationship-journal-panel"')
  })

  it('does not enable aria-live on the relationship journal panel, so it never double-announces over the transient feedback line', () => {
    const render = appSource.slice(
      appSource.indexOf('{relationshipJournal.entries.length > 0 && ('),
      appSource.indexOf('<AppRoomEntryOverlay'),
    )
    expect(render).toContain('live={false}')
  })

  it('never calls setJournal/refreshDerivedViews from the relationship journal render or its accumulation seam', () => {
    const render = appSource.slice(
      appSource.indexOf('{relationshipJournal.entries.length > 0 && ('),
      appSource.indexOf('<AppRoomEntryOverlay'),
    )
    expect(render).not.toContain('setJournal')
    expect(render).not.toContain('refreshDerivedViews')
  })

  it('renders the Relationships panel with the frozen safe entry once an entry accumulates, and renders nothing when empty', () => {
    const empty = INITIAL_RELATIONSHIP_JOURNAL_STATE
    expect(empty.entries.length > 0).toBe(false)

    const withEntry = accumulateRelationshipJournal(empty, {
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      npcId: 'npc-relationship-panel',
      prevBucket: 'none',
      nextBucket: 'low',
    })
    expect(withEntry.entries.length > 0).toBe(true)

    const view = toRelationshipJournalView(withEntry)
    expect(view.title).toBe('Relationships')
    expect(view.entries).toEqual([
      { id: view.entries[0]?.id, text: 'Someone here seems more familiar with you.' },
    ])

    const html = renderToStaticMarkup(<JournalPanelBody view={view} />)
    expect(html).toContain('Someone here seems more familiar with you.')
    expect(html).not.toContain('npc-relationship-panel')
    expect(html).not.toContain(WORLD_ID)
    expect(html).not.toContain(SESSION_ID)
    expect(html).not.toMatch(/none|low|medium|high/i)
  })

  it('App clears memory and relationship feedback on every new room entry (enterActivePlay and handleNavigate)', () => {
    const enterActivePlay = appSource.slice(
      appSource.indexOf('const enterActivePlay = useCallback('),
      appSource.indexOf('const setQuestSpecForView = useCallback('),
    )
    expect(enterActivePlay).toContain('setMemoryFeedbackState(memoryFeedbackOnRoomEntry)')
    expect(enterActivePlay).toContain('setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)')

    const handleNavigateSetters = appSource.slice(
      appSource.indexOf('activePlayRef.current = nextPlay'),
      appSource.indexOf('activePlay.adjacentPregenerator?.warmAdjacent(result.room)'),
    )
    expect(handleNavigateSetters).toContain('setMemoryFeedbackState(memoryFeedbackOnRoomEntry)')
    expect(handleNavigateSetters).toContain('setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)')
  })

  it('App auto-dismisses feedback on a timer and cleans it up on message change/unmount', () => {
    const autoDismissEffect = appSource.slice(
      appSource.indexOf('if (memoryFeedbackState.message === null) return'),
      appSource.indexOf("}, [memoryFeedbackState.message])"),
    )

    expect(autoDismissEffect).toContain(`window.setTimeout(() => {`)
    expect(autoDismissEffect).toContain('MEMORY_FEEDBACK_AUTO_DISMISS_MS')
    expect(autoDismissEffect).toContain('return () => window.clearTimeout(timeoutId)')
  })

  it('App auto-dismisses relationship feedback on the same timer idiom, keyed to its own message', () => {
    const autoDismissEffect = appSource.slice(
      appSource.indexOf('if (relationshipFeedbackState.message === null) return'),
      appSource.indexOf("}, [relationshipFeedbackState.message])"),
    )

    expect(autoDismissEffect).toContain(`window.setTimeout(() => {`)
    expect(autoDismissEffect).toContain('MEMORY_FEEDBACK_AUTO_DISMISS_MS')
    expect(autoDismissEffect).toContain('return () => window.clearTimeout(timeoutId)')
    expect(autoDismissEffect).toContain('setRelationshipFeedbackState((current) =>')
  })

  it('App renders a single shared feedback slot, precedence-selected, never memory record or relationship data directly', () => {
    expect(appSource).toContain(
      'message={selectTransientFeedbackMessage(memoryFeedbackState.message, relationshipFeedbackState.message)}',
    )
    expect(appSource).not.toContain('<MemoryFeedback message={memoryFeedbackState.message} />')
    expect(appSource).not.toContain('MemoryFeedback message={roomMemoryContext')

    // Only one `<MemoryFeedback` element is ever rendered -- no second stacked
    // toast for relationship feedback.
    const matches = appSource.match(/<MemoryFeedback\b/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

describe('relationship journal runtime safety - Slice 4', () => {
  it('the relationship journal accumulate call site touches no provider/prompt/LLM/network identifier', () => {
    const callSite = appSource.slice(
      appSource.indexOf('setRelationshipJournal((current) =>'),
      appSource.indexOf('}, [])', appSource.indexOf('setRelationshipJournal((current) =>')),
    )
    expect(callSite.length).toBeGreaterThan(0) // guard against a vacuous pass

    for (const forbidden of [
      'Provider',
      'prompt',
      'Prompt',
      'fetch(',
      'llmDialoguePrompt',
      'NPCDialogueProvider',
      'OpenAI',
      'generation/',
    ]) {
      expect(callSite).not.toContain(forbidden)
    }
  })

  it('the relationship journal render block touches no provider/prompt/LLM/network identifier', () => {
    const renderBlock = appSource.slice(
      appSource.indexOf('{relationshipJournal.entries.length > 0 && ('),
      appSource.indexOf('<AppRoomEntryOverlay'),
    )
    for (const forbidden of ['Provider', 'prompt', 'Prompt', 'fetch(', 'llmDialoguePrompt', 'OpenAI']) {
      expect(renderBlock).not.toContain(forbidden)
    }
  })

  it('the relationship journal accumulate call passes only worldId/sessionId/npcId/prevBucket/nextBucket -- no effects/dialogue/provider payload', () => {
    const callSite = appSource.slice(
      appSource.indexOf('setRelationshipJournal((current) =>'),
      appSource.indexOf('}, [])', appSource.indexOf('setRelationshipJournal((current) =>')),
    )
    expect(callSite).toContain('worldId: state.worldId')
    expect(callSite).toContain('sessionId: state.sessionId')
    expect(callSite).toContain('npcId: event.npcId')
    expect(callSite).toContain('prevBucket,')
    expect(callSite).toContain('nextBucket,')
    for (const forbidden of ['structuredEffects', 'dialogueSemanticEvents', 'event.text', 'event.reply']) {
      expect(callSite).not.toContain(forbidden)
    }
  })
})

describe('relationship feedback state wiring - Slice 3', () => {
  it('selectTransientFeedbackMessage keeps memory-created and memory-recalled ahead of relationship familiarity', () => {
    expect(
      selectTransientFeedbackMessage(MEMORY_CREATED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_CREATED_MESSAGE)
    expect(
      selectTransientFeedbackMessage(MEMORY_RECALLED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_RECALLED_MESSAGE)
    expect(selectTransientFeedbackMessage(null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)).toBe(
      RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE,
    )
    expect(selectTransientFeedbackMessage(null, null)).toBeNull()
  })

  it('relationshipFeedbackAfterReduction fires only on an upward bucket crossing and resets to null on room entry', () => {
    const afterFirstInteraction = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
      prevBucket: 'none',
      nextBucket: 'low',
    })
    expect(afterFirstInteraction).toEqual({ message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE })

    const unchanged: RelationshipFeedbackState = relationshipFeedbackAfterReduction(afterFirstInteraction, {
      prevBucket: 'low',
      nextBucket: 'low',
    })
    expect(unchanged).toBe(afterFirstInteraction)

    expect(relationshipFeedbackOnRoomEntry(afterFirstInteraction)).toEqual({ message: null })
  })
})

describe('room memory debug viewer App seam - Slice 3', () => {
  it('uses the central dev gate and renders no panel when the gate is false', () => {
    expect(appSource).toContain("import { readDebugConfig } from './app/debugConfig'")
    expect(appSource).toContain('const debugConfig = readDebugConfig()')
    expect(appSource).toContain(
      'const roomMemoryDebugViewerEnabled = debugConfig.roomMemoryDebugViewerEnabled',
    )
    expect(appSource).toContain('roomMemoryDebugViewerEnabled && (')
    expect(appSource).toContain('<RoomMemoryDebugPanel')
    expect(appSource).not.toContain('import.meta.env.VITE_ROOM_MEMORY_DEBUG_VIEWER')
  })

  it('opens from the runtime store snapshot source and refreshes only from the explicit callback', () => {
    const seam = appSource.slice(
      appSource.indexOf('const [roomMemoryDebugViewer, setRoomMemoryDebugViewer] = useState('),
      appSource.indexOf('// Bounded, non-authoritative room-memory recall context'),
    )

    expect(seam).toContain('INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE')
    expect(seam).toContain('toggleRoomMemoryDebugViewer(current, roomMemoryRuntimeRef.current.store)')
    expect(seam).toContain('refreshRoomMemoryDebugViewer(current, roomMemoryRuntimeRef.current.store)')
    expect(seam).not.toContain('setInterval')
    expect(seam).not.toContain('addEventListener')
    expect(seam).not.toContain('logger')
    expect(seam).not.toContain('remember(')
    expect(seam).not.toContain('record(')
    expect(seam).not.toContain('restoreAll(')
  })

  it('passes only projected rows and active room id into the presentational panel', () => {
    const render = appSource.slice(
      appSource.indexOf('{roomMemoryDebugViewerEnabled && ('),
      appSource.indexOf('<PromptBar onSubmit={handlePrompt} disabled={inFlight} />'),
    )

    expect(render).toContain('rows={roomMemoryDebugViewer.rows}')
    expect(render).toContain('currentRoomId={activePlay?.room.id ?? null}')
    expect(render).toContain('open={roomMemoryDebugViewer.open}')
    expect(render).toContain('onToggle={handleToggleRoomMemoryDebugViewer}')
    expect(render).toContain('onRefresh={handleRefreshRoomMemoryDebugViewer}')
    expect(render).not.toContain('snapshotAll')
    expect(render).not.toContain('recalledRoomMemory')
    expect(render).not.toContain('JournalPanel')
  })
})

describe('npc relationship persistence v0 — handleSave/handleLoad wiring (ADR-0081, Slice 4)', () => {
  const scope = { worldId: WORLD_ID, sessionId: SESSION_ID }

  function makeRelationshipRecord(overrides: Partial<NpcRelationshipState> = {}): NpcRelationshipState {
    return {
      schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
      scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'npc-1' },
      subject: 'npc',
      object: 'player',
      axes: { trust: 10, respect: 5, fear: 0, familiarity: 20 },
      interactionCount: 3,
      ...overrides,
    }
  }

  it('manual save includes npcRelationshipJson when relationshipsRef has scoped records', () => {
    const record = makeRelationshipRecord()
    const json = buildNpcRelationshipSaveJson([record], scope)

    expect(typeof json).toBe('string')
    expect(json).not.toBe('')
    expect(loadNpcRelationshipSaveState(json!).ok).toBe(true)
  })

  it('manual save omits sidecar when no relationship records exist', () => {
    expect(buildNpcRelationshipSaveJson([], scope)).toBeNull()
  })

  it('load restores scoped relationship records keyed by npcId, mirroring the App.tsx seeding loop', () => {
    const a = makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'npc-a' } })
    const b = makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'npc-b' } })
    const json = buildNpcRelationshipSaveJson([a, b], scope)!

    const result = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })

    const relationshipsRef = new Map<string, NpcRelationshipState>()
    for (const record of result.records) {
      relationshipsRef.set(record.scope.npcId, record)
    }

    expect(relationshipsRef.size).toBe(2)
    expect(relationshipsRef.get('npc-a')).toEqual(a)
    expect(relationshipsRef.get('npc-b')).toEqual(b)
  })

  it('load drops records whose worldId/sessionId does not match the restored session', () => {
    const keep = makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'keep' } })
    const wrongWorld = makeRelationshipRecord({
      scope: { worldId: 'other-world', sessionId: SESSION_ID, npcId: 'wrong-world' },
    })
    const json = JSON.stringify({ schemaVersion: 1, records: [keep, wrongWorld] })

    const result = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })

    expect(result.records.map((record) => record.scope.npcId)).toEqual(['keep'])
    expect(result.diagnostics.droppedByScope).toBe(1)
  })

  it('corrupt/unsupported/missing sidecar does not crash load and yields an empty relationship map', () => {
    const corrupt = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: 'NOT VALID JSON{{{', scope })
    expect(corrupt.records).toEqual([])
    expect(corrupt.diagnostics.status).toBe('invalid')

    const unsupported = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: JSON.stringify({ schemaVersion: 999, records: [] }),
      scope,
    })
    expect(unsupported.records).toEqual([])
    expect(unsupported.diagnostics.status).toBe('invalid')

    const missing = restoreNpcRelationshipsFromSlot({ scope })
    expect(missing.records).toEqual([])
    expect(missing.diagnostics.status).toBe('missing')
  })

  it('save payload contains only ids/literals/integers -- no dialogue/prompt/provider/effect/feedback text', () => {
    const record = makeRelationshipRecord()
    const json = buildNpcRelationshipSaveJson([record], scope)!

    expect(json).not.toContain('SECRET')
    const parsed = JSON.parse(json) as { records: Record<string, unknown>[] }
    expect(Object.keys(parsed.records[0]!).sort()).toEqual(
      ['schemaVersion', 'scope', 'subject', 'object', 'axes', 'interactionCount'].sort(),
    )
  })

  it('App.tsx wires the sidecar into the manual save point only (no autosave/per-turn write)', () => {
    const handleSave = appSource.slice(
      appSource.indexOf('const handleSave = useCallback('),
      appSource.indexOf('const handleLoad = useCallback('),
    )

    expect(appSource).toContain(
      "import { buildNpcRelationshipSaveJson } from './domain/npcRelationship/relationshipSaveState'",
    )
    expect(handleSave).toContain('const stateForSidecars = await worldSession.getWorldState(activePlay.sessionId)')
    expect(handleSave).toContain('npcRelationshipJson = buildNpcRelationshipSaveJson(')
    expect(handleSave).toContain('Array.from(relationshipsRef.current.values())')
    expect(handleSave).toContain('npcRelationshipJson,')

    // buildNpcRelationshipSaveJson is invoked nowhere outside handleSave -- no
    // autosave/per-turn write path exists.
    const outsideHandleSave = appSource.replace(handleSave, '')
    expect(outsideHandleSave).not.toContain('buildNpcRelationshipSaveJson(')
  })

  it('App.tsx restores after authoritative WorldState is known, keyed by npcId, before the generated-play branch', () => {
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )

    expect(appSource).toContain('restoreNpcRelationshipsFromSlot,')
    expect(handleLoad).toContain('const relationshipRestore = restoreNpcRelationshipsFromSlot({')
    expect(handleLoad).toContain('npcRelationshipJson: slotResult.npcRelationshipJson')
    expect(handleLoad).toContain('relationshipsRef.current.set(record.scope.npcId, record)')

    // Restore runs strictly after stateResult (authoritative worldId/sessionId) is available.
    expect(
      handleLoad.indexOf('const stateResult = await worldSession.getWorldState(loadResult.sessionId)'),
    ).toBeLessThan(handleLoad.indexOf('const relationshipRestore = restoreNpcRelationshipsFromSlot({'))

    // Restore happens before the generated-play restore branch and before derived views refresh.
    expect(handleLoad.indexOf('const relationshipRestore = restoreNpcRelationshipsFromSlot({')).toBeLessThan(
      handleLoad.indexOf('restoreGeneratedPlayFromSlot('),
    )
    expect(handleLoad.indexOf('const relationshipRestore = restoreNpcRelationshipsFromSlot({')).toBeLessThan(
      handleLoad.indexOf('refreshDerivedViews(stateResult.state)'),
    )

    // Respects the existing requestVersion race guard: seeding is gated on it.
    const restoreBlock = handleLoad.slice(
      handleLoad.indexOf('const relationshipRestore = restoreNpcRelationshipsFromSlot({'),
      handleLoad.indexOf("if (relationshipRestore.diagnostics.status === 'invalid')"),
    )
    expect(restoreBlock).toContain('if (version === requestVersion.current) {')
  })

  it('hydration never calls the reducer or feedback derivation, and touches no memory/fact/event/world-command path', () => {
    const handleLoad = appSource.slice(
      appSource.indexOf('const handleLoad = useCallback('),
      appSource.indexOf('const handleNavigate = useCallback('),
    )
    const restoreBlock = handleLoad.slice(
      handleLoad.indexOf('// NPC relationship persistence v0 (Slice 4)'),
      handleLoad.indexOf('// Generated-play restore (ADR-0059)'),
    )

    expect(restoreBlock.length).toBeGreaterThan(0)
    expect(restoreBlock).not.toContain('deriveAndReduceRelationship')
    expect(restoreBlock).not.toContain('applyRelationshipEffects')
    expect(restoreBlock).not.toContain('relationshipFeedbackAfterReduction')
    expect(restoreBlock).not.toContain('decideRelationshipFeedback')
    expect(restoreBlock).not.toContain('setRelationshipFeedbackState')
    expect(restoreBlock).not.toContain('WorldEvent')
    expect(restoreBlock).not.toContain('WorldCommand')
    expect(restoreBlock).not.toContain('appendEvent')
    expect(restoreBlock).not.toContain('memory')
    expect(restoreBlock).not.toContain('fact')
  })

  it('post-load dialogue context still reads relationshipsRef through the unchanged bucketed/tone-only projection', () => {
    // getRelationshipContextForNpc is untouched by Slice 4: it still only
    // reads from the same ref this feature re-seeds, and dialogue context
    // still projects familiarity through familiarityBucket, never raw scores.
    const relationshipContextCallback = appSource.slice(
      appSource.indexOf('const getRelationshipContextForNpc = useCallback('),
      appSource.indexOf('const handleNpcDialogueResolved = useCallback('),
    )
    expect(relationshipContextCallback).toContain('return relationshipsRef.current.get(npcId)')
    expect(appSource).toContain('familiarityBucket(')
  })
})
