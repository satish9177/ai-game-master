import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RoomViewer } from './renderer/RoomViewer'
import type { CommittedInteractionEvents } from './renderer/RoomViewer'
import { StatusHud } from './renderer/ui/StatusHud'
import { SaveLoadBar } from './renderer/ui/SaveLoadBar'
import type { SaveLoadStatus } from './renderer/ui/SaveLoadBar'
import { UsageMeter } from './renderer/ui/UsageMeter'
import { QuestTracker } from './renderer/ui/QuestTracker'
import { JournalPanel } from './renderer/ui/JournalPanel'
import { RoomIntroPanel } from './renderer/ui/RoomIntroPanel'
import { MemoryFeedback } from './renderer/ui/MemoryFeedback'
import { RoomMemoryDebugPanel } from './renderer/ui/RoomMemoryDebugPanel'
import { projectPlayerHud } from './renderer/ui/playerHud'
import type { PlayerHudView } from './renderer/ui/playerHud'
import { evaluateQuest, type QuestView } from './domain/quests/evaluateQuest'
import type { QuestSpec } from './domain/quests/questSpec'
import { loadGeneratedQuestSaveState } from './domain/quests/generatedQuestSaveState'
import { loadGeneratedRoomCacheSaveState } from './domain/quests/generatedRoomCacheSaveState'
import { demoQuestSpec } from './domain/examples/demoQuest'
import type { JournalView } from './domain/journal/projectJournal'
import type { JournalSpec } from './domain/journal/journalSpec'
import type { GeneratedConsequenceJournalInput } from './domain/journal/generatedConsequenceJournal'
import { demoJournalSpec } from './domain/examples/demoJournal'
import type { WorldState } from './domain/world/worldState'
import { computeWorldClock, toPromptTimeContext } from './domain/world/worldClock'
import type { WorldClock } from './domain/world/worldClock'
import type { RoomSource } from './domain/ports/RoomSource'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { RoomRegistry } from './room/RoomRegistry'
import { SessionRoomCache } from './room/SessionRoomCache'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { FakeWorldBibleSeeder } from './generation/FakeWorldBibleSeeder'
import { readLlmConfig } from './app/llmConfig'
import { readDebugConfig } from './app/debugConfig'
import { selectRoomGenerator } from './app/selectRoomGenerator'
import { selectObjectiveGenerator } from './app/selectObjectiveGenerator'
import { selectGateGenerator } from './app/selectGateGenerator'
import { selectDialogueProvider } from './app/selectDialogueProvider'
import { evaluate, recordAttempt, initialUsageState, canAttemptOptional } from './domain/usage/usageGuard'
import type { UsageGuardConfig } from './domain/usage/usageGuard'
import { ErrorBoundary } from './app/ErrorBoundary'
import { AdjacentRoomPregenerator } from './app/AdjacentRoomPregenerator'
import { NavigationService } from './app/NavigationService'
import type { NavigationResult } from './app/NavigationService'
import { PromptBar } from './app/PromptBar'
import { buildRestoredPlay } from './app/buildRestoredPlay'
import { restoreGeneratedQuestPlay } from './app/restoreGeneratedQuestPlay'
import type { RestoredGeneratedQuestPlay } from './app/restoreGeneratedQuestPlay'
import { restoreGeneratedRoomCache } from './app/restoreGeneratedRoomCache'
import { computeDerivedViews } from './app/derivedViews'
import {
  loadEventConsequenceJournal,
  readEventConsequenceJournalEnabled,
} from './app/eventConsequenceJournalSeam'
import { navigateWithExitGate } from './app/gatedNavigation'
import { LocalStorageSaveSlotStore } from './app/saveSlotStore'
import { createConsoleLogger } from './platform/logger/consoleLogger'
import { SystemClock } from './platform/system/clock'
import { UuidGenerator } from './platform/system/idGenerator'
import { InMemoryWorldStore } from './world-session/InMemoryWorldStore'
import { WorldSession } from './world-session/WorldSession'
import type { WorldStateResult } from './world-session/WorldSession'
import { SaveGameService } from './world-session/saveGame'
import { InteractionService } from './interactions/InteractionService'
import { EncounterService } from './encounters/EncounterService'
import { InMemoryRoomMemoryStore } from './memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from './memory/RoomMemoryService'
import { createDisplayNameResolver } from './domain/memory/displayNames'
import { promoteInteractionMemories } from './app/promoteInteractionMemories'
import { recallRoomMemoryContext } from './app/recallRoomMemoryContext'
import type { RecalledRoomMemory } from './app/recallRoomMemoryContext'
import { buildVisibleRoomMemoryContext } from './app/buildVisibleRoomMemoryContext'
import { deriveAndLogDialogueSemanticEvents } from './app/deriveAndLogDialogueSemanticEvents'
import { deriveAndLogStructuredDialogueEffects } from './app/deriveAndLogStructuredDialogueEffects'
import { deriveAndReduceRelationship } from './app/deriveAndReduceRelationship'
import { neutralRelationship } from './domain/npcRelationship/neutral'
import type { NpcRelationshipState } from './domain/npcRelationship/contracts'
import { familiarityBucket } from './domain/npcRelationship/dialogueContext'
import { buildNpcRelationshipSaveJson } from './domain/npcRelationship/relationshipSaveState'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  type RelationshipJournalState,
} from './app/relationshipJournalRuntime'
import type { RoomMemoryDialogueContext } from './domain/dialogue/contracts'
import { loadRoomSpec, type LoadedRoom } from './domain/loadRoomSpec'
import { fallbackRoom as fallbackRoomSpec } from './domain/examples/fallbackRoom'
import { FALLBACK_NOTICE, shouldShowFallbackNotice } from './app/fallbackNotice'
import { buildRoomIntroView } from './app/roomIntro'
import type { WorldBibleSeed } from './domain/worldBible/worldBibleSeed'
import { worldBibleToAdjacentThemeSeed } from './domain/worldBible/worldBibleToSeed'
import { buildAdjacentRoomSeed } from './app/buildAdjacentRoomSeed'
import { deriveStoryThreadContext, storyThreadToSeedPhrase } from './domain/generatedStoryThread'
import type { GeneratedStoryThreadKind } from './domain/generatedStoryThread'
import { prepareGeneratedRoomSeed } from './app/worldBible'
import { buildPromptGeneratedRoomSource } from './app/buildPromptGeneratedRoomSource'
import {
  buildGeneratedObjectiveAttachment,
  type GeneratedObjectiveQuestAttachment,
} from './app/generatedObjective'
import {
  buildGeneratedGateAttachment,
  type ProviderGateStatus,
} from './app/generatedGate'
import type { GeneratedMechanicalGate } from './domain/generatedMechanicalGate'
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
  restoreNpcRelationshipsFromSlot,
  restoreRuntimeRoomMemoryFromSlot,
  selectTransientFeedbackMessage,
  shouldStartPerRoomObjectiveAttach,
  type MemoryFeedbackState,
  type PerRoomObjectiveMemo,
  type QuestHintState,
  type RelationshipFeedbackState,
} from './app/App.helpers'
import { EMPTY_PROMOTION_SUMMARY, MEMORY_FEEDBACK_AUTO_DISMISS_MS } from './app/memoryFeedback'
import {
  INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE,
  refreshRoomMemoryDebugViewer,
  toggleRoomMemoryDebugViewer,
} from './app/roomMemoryDebugViewer'
import { themeVocabulary } from './domain/generatedRoomThemeVocabulary'

import { NPCDialogueService } from './dialogue/NPCDialogueService'
import type { NpcDialogueResolvedEvent } from './renderer/RoomViewer'

// Composition root: concrete adapters are constructed once and injected.
const logger = createConsoleLogger()
const debugConfig = readDebugConfig()
const roomMemoryDebugViewerEnabled = debugConfig.roomMemoryDebugViewerEnabled
// Consequence-journal-from-events v1 (D1): default-OFF feature flag, read only
// here in the composition layer. When OFF the existing authored/generated
// journal behavior is byte-identical; the event seam is never invoked.
const eventConsequenceJournalFromEventsEnabled = readEventConsequenceJournalEnabled()
// The PromptBar-generated room path uses the configured generator: the
// FakeRoomGenerator by default, or a real OpenAI-compatible provider when the
// env config is complete (real-room-generator-provider v0; ADR-0023). The
// returned `log` carries only safe selection metadata (provider enum, model id,
// numeric caps, or a fixed reason code) — never the key, prompt, or seed.
const llmConfig = readLlmConfig()
const { generator: promptGenerator, log: roomGeneratorSelectionLog } =
  selectRoomGenerator(llmConfig)
logger.info('room generator selected', roomGeneratorSelectionLog)
// Usage guardrail (cost-usage-guardrails v0): enabled only for real providers.
// The enabled flag is derived from the selection result, not the raw API key.
const guardEnabled = roomGeneratorSelectionLog.provider !== 'fake'
const guardCap = llmConfig.sessionCap
// Background adjacent pre-generation stays deterministic and offline: it always
// uses a FakeRoomGenerator, so warming never calls a real provider or spends.
const adjacentGenerator = new FakeRoomGenerator()
const { generator: objectiveGenerator, log: objectiveGeneratorSelectionLog } =
  selectObjectiveGenerator(llmConfig)
logger.info('objective generator selected', objectiveGeneratorSelectionLog)
const gateGeneratorSelection = selectGateGenerator(llmConfig)
logger.info('gate generator selected', gateGeneratorSelection.log)
const dialogueProviderSelection = selectDialogueProvider(llmConfig)
logger.info('dialogue provider selected', dialogueProviderSelection.log)
// Dialogue usage guardrail (dialogue-usage-guardrails v0): keyed on the dialogue
// provider selection, not room-generation's `guardEnabled`, so a future
// divergence between the two providers stays correct.
const dialogueGuardEnabled = dialogueProviderSelection.kind === 'real'
const worldBibleSeeder = new FakeWorldBibleSeeder()
const idGenerator = new UuidGenerator()
const worldStore = new InMemoryWorldStore()
const worldSession = new WorldSession(worldStore, new SystemClock(), idGenerator, logger)
const saveGameService = new SaveGameService(worldStore, logger)
const saveSlotStore = new LocalStorageSaveSlotStore()
const interactionService = new InteractionService(worldSession, logger)
const encounterService = new EncounterService(worldSession, logger)
const npcDialogueService = new NPCDialogueService(worldSession, dialogueProviderSelection.provider, logger)
// The trusted fallback room, validated once at startup. The assembly pipeline
// returns it (via GeneratedRoomSource) whenever generated content can't be
// loaded, validated, or repaired, so the renderer always gets a playable room.
const fallbackRoom = loadRoomSpec(fallbackRoomSpec)
const roomRegistry = new RoomRegistry()
const exampleRoomCache = new SessionRoomCache()
// The session's room-acquisition seam: it warms the rooms behind the current
// room's exits in the background and resolves rooms on demand at a door
// (cache → authored registry → generated). Generated adjacents go through
// GeneratedRoomSource → assembleRoom, so only valid rooms reach the cache. The
// generation seed is the structural room id only (never a user prompt), and
// GeneratedRoomSource logs its length, never its text.
const adjacentPregenerator = new AdjacentRoomPregenerator(
  exampleRoomCache,
  roomRegistry,
  (roomId) => new GeneratedRoomSource(adjacentGenerator, `adjacent:${roomId}`, logger, fallbackRoom),
  fallbackRoom,
  logger,
)
const exampleNavigation = new NavigationService(worldSession, adjacentPregenerator, logger)

const STARTING_ROOM_ID = 'throne-room'
const ROOM_UNAVAILABLE = 'This room could not be loaded.'

function createRoomMemoryRuntime() {
  const store = new InMemoryRoomMemoryStore()
  return {
    store,
    service: new RoomMemoryService(store, new SystemClock(), idGenerator, logger),
  }
}

type ActivePlay = {
  room: LoadedRoom
  roomSource: RoomSource
  sessionId: string
  roomCache: SessionRoomCache
  navigation?: NavigationService
  adjacentPregenerator?: AdjacentRoomPregenerator
  worldBible?: WorldBibleSeed
  initialPlayer: PlayerHudView
  questSpec?: QuestSpec
  journalSpec?: JournalSpec
  storyKind?: GeneratedStoryThreadKind
  objectivesPerRoom?: boolean
  entryResolvedObjectIds?: ReadonlySet<string>
  providerGateStatus?: ProviderGateStatus
  providerGate?: GeneratedMechanicalGate
}

type AppRoomIntroProps = {
  room: LoadedRoom
  sessionId: string
  entrySeq: number
}

export function AppRoomIntro({ room, sessionId, entrySeq }: AppRoomIntroProps) {
  const intro = useMemo(
    () => buildRoomIntroView(room, sessionId, entrySeq),
    [entrySeq, room, sessionId],
  )
  return <RoomIntroPanel summary={intro.summary} roomKey={intro.roomKey} />
}

type AppRoomEntryOverlayProps = {
  room: LoadedRoom | null
  sessionId: string
  entrySeq: number
  notice: string | null
  onDismissNotice: () => void
}

export function AppRoomEntryOverlay({
  room,
  sessionId,
  entrySeq,
  notice,
  onDismissNotice,
}: AppRoomEntryOverlayProps) {
  return (
    <>
      {room && <AppRoomIntro room={room} sessionId={sessionId} entrySeq={entrySeq} />}
      {notice && (
        <div className="room-notice" role="status">
          <span className="room-notice-text">{notice}</span>
          <button
            type="button"
            className="room-notice-close"
            onClick={onDismissNotice}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}

function preloadedRoomSource(room: LoadedRoom): RoomSource {
  return { getRoom: async () => ({ ok: true, room }) }
}

function startRoomSession(room: LoadedRoom): Promise<WorldStateResult> {
  return worldSession.startSession({
    schemaVersion: 1,
    worldId: idGenerator.newId(),
    name: room.name,
    startingRoomId: room.id,
    initialPlayer: {
      health: { current: 75, max: 100 },
      status: [],
      inventory: [],
    },
  })
}

function buildGeneratedJournalInput(
  play: ActivePlay,
  state: WorldState,
  questSpec: QuestSpec | null,
): GeneratedConsequenceJournalInput {
  const questForJournal = questSpec ? evaluateQuest(questSpec, state) : null
  const storyContext = play.storyKind !== undefined
    ? deriveStoryThreadContext(play.storyKind, play.room.id)
    : undefined
  return { state, room: play.room, quest: questForJournal, storyContext }
}

/**
 * Generated-play restore (generated quest save/load v0; ADR-0059). Re-validates
 * the optional parked blob and rebuilds the generated room/quest view fields
 * from the already-restored authoritative `WorldState`. Returns `null` when the
 * blob is absent, fails re-validation, or its parked room fails to reload — the
 * caller then degrades to the authored-world gate with no error surfaced.
 *
 * Pure projection: it makes no generator/provider/LLM call, never touches the
 * usage meter, and never mutates `WorldState`. The blob is never logged.
 */
function restoreGeneratedPlayFromSlot(
  generatedQuestJson: string | undefined,
  worldState: WorldState,
): RestoredGeneratedQuestPlay | null {
  if (generatedQuestJson == null) return null
  const loaded = loadGeneratedQuestSaveState(generatedQuestJson)
  if (!loaded.ok) return null
  const restored = restoreGeneratedQuestPlay(loaded.state, worldState)
  return restored.ok ? restored.play : null
}

function restoreGeneratedRoomCacheFromSlot(
  generatedRoomCacheJson: string | undefined,
  currentRoom: LoadedRoom,
  storyKind: GeneratedStoryThreadKind | undefined,
): {
  roomCache: SessionRoomCache
  navigation: NavigationService
  adjacentPregenerator: AdjacentRoomPregenerator
  restoredObjectives: ReadonlyMap<string, GeneratedObjectiveQuestAttachment>
  restoredRoomIds: string[]
} | null {
  if (generatedRoomCacheJson == null) return null
  const loaded = loadGeneratedRoomCacheSaveState(generatedRoomCacheJson)
  if (!loaded.ok) return null

  const restored = restoreGeneratedRoomCache(loaded.state, currentRoom)
  const vocabulary = themeVocabulary(loaded.state.themePack)
  const generatedAdjacentGenerator = new FakeRoomGenerator(vocabulary)
  const restoredPregenerator = new AdjacentRoomPregenerator(
    restored.cache,
    roomRegistry,
    (roomId) => {
      const storyContext = deriveStoryThreadContext(storyKind, roomId)
      const storyPhrase = storyContext ? storyThreadToSeedPhrase(storyContext) : undefined
      return new GeneratedRoomSource(
        generatedAdjacentGenerator,
        buildAdjacentRoomSeed(roomId, undefined, storyPhrase),
        logger,
        fallbackRoom,
        {
          themePack: loaded.state.themePack,
          enrichObjectiveTarget: true,
          storyKind: storyContext?.kind,
        },
      )
    },
    fallbackRoom,
    logger,
    3,
    { ensureReturnExits: true },
  )
  restoredPregenerator.restoreProvenance(restored.provenance)

  return {
    roomCache: restored.cache,
    navigation: new NavigationService(worldSession, restoredPregenerator, logger),
    adjacentPregenerator: restoredPregenerator,
    restoredObjectives: restored.objectives,
    restoredRoomIds: restored.restoredRoomIds,
  }
}

function seedRestoredGeneratedObjectiveMemo(
  memo: PerRoomObjectiveMemo,
  restoredPlay: RestoredGeneratedQuestPlay,
  restoredRoomIds: string[],
  restoredObjectives: ReadonlyMap<string, GeneratedObjectiveQuestAttachment> = new Map(),
): void {
  const currentAttachment: GeneratedObjectiveQuestAttachment | null =
    restoredPlay.questSpec !== undefined
      ? {
          questSpec: restoredPlay.questSpec,
          hint: restoredPlay.hints?.hint ?? '',
          completionHint: restoredPlay.hints?.completionHint ?? '',
        }
      : null
  memo.set(restoredPlay.room.id, currentAttachment)

  for (const roomId of restoredRoomIds) {
    if (roomId !== restoredPlay.room.id) {
      memo.set(roomId, restoredObjectives.get(roomId) ?? null)
    }
  }
}

type ExampleBootstrapResult = ActivePlay & { initialState: WorldState }

let exampleBootstrap: Promise<ExampleBootstrapResult | null> | undefined

function bootstrapExamplePlay(): Promise<ExampleBootstrapResult | null> {
  exampleBootstrap ??= (async () => {
    const resolved = await adjacentPregenerator.resolveRoom(STARTING_ROOM_ID)
    if (!resolved.ok) {
      logger.error('starting room resolution failed', { code: resolved.reason })
      return null
    }
    const started = await startRoomSession(resolved.room)
    if (!started.ok) {
      logger.error('world session start failed', { code: started.error.code })
      return null
    }
    // Warm the rooms behind the starting room's exits so the first transition is
    // instant (or safely generated on demand if warming hasn't finished).
    adjacentPregenerator.warmAdjacent(resolved.room)
    return {
      room: resolved.room,
      roomSource: preloadedRoomSource(resolved.room),
      sessionId: started.state.sessionId,
      roomCache: exampleRoomCache,
      navigation: exampleNavigation,
      adjacentPregenerator,
      initialPlayer: projectPlayerHud(started.state),
      questSpec: demoQuestSpec,
      journalSpec: demoJournalSpec,
      initialState: started.state,
    }
  })()
  return exampleBootstrap
}

function App() {
  const [activePlay, setActivePlay] = useState<ActivePlay | null>(null)
  const activePlayRef = useRef<ActivePlay | null>(null)
  const currentWorldStateRef = useRef<WorldState | null>(null)
  const [roomEntrySeq, setRoomEntrySeq] = useState(0)
  // Mirrors `roomEntrySeq` synchronously (room-memory-visible-feedback-v0,
  // Slice 4): the memory-feedback callbacks below fire inside the same tick
  // that advances the room entry (before React flushes the `roomEntrySeq`
  // state update), so they read this ref rather than the possibly-stale
  // closed-over state value. Same pattern as `activePlayRef`/`questSpecRef`.
  const roomEntrySeqRef = useRef(0)
  const [playerHud, setPlayerHud] = useState<PlayerHudView | null>(null)
  const [worldClock, setWorldClock] = useState<WorldClock | null>(null)
  const [quest, setQuest] = useState<QuestView | null>(null)
  const [questHints, setQuestHints] = useState<QuestHintState | null>(null)
  const [journal, setJournal] = useState<JournalView | null>(null)
  const [fatalMessage, setFatalMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const questSpecRef = useRef<QuestSpec | null>(null)
  // Mirror the live quest hints into a ref so the stable handleSave closure can
  // read the current value without a stale-state capture (same pattern as
  // questSpecRef). Used by the generated-quest save blob (ADR-0059).
  const questHintsRef = useRef<QuestHintState | null>(null)
  const [questSpecSnapshot, setQuestSpecSnapshot] = useState<QuestSpec | null>(null)
  const journalSpecRef = useRef<JournalSpec | null>(null)
  const perRoomObjectiveMemoRef = useRef<PerRoomObjectiveMemo>(new Map())
  // Ephemeral, non-authoritative NPC relationship projection
  // (npc-relationship-state-v0, Slice 2). Keyed by npcId, held only for the
  // life of this component/session -- never WorldState, never persisted,
  // never read by dialogue context yet. Reset alongside
  // `perRoomObjectiveMemoRef` on every new prompt/load.
  const relationshipsRef = useRef<Map<string, NpcRelationshipState>>(new Map())
  // Room memory composition (memory-event-promotion-v0 wiring slice). Held in
  // a single ref (not module scope) so the store survives re-renders for the
  // life of this component without being reconstructed on every render; it is
  // still headless/in-memory only — no backend/API wiring. Built together in
  // one ref (rather than one ref reading another) so render never accesses an
  // existing ref's `.current` (react-hooks/refs).
  const roomMemoryRuntimeRef = useRef(createRoomMemoryRuntime())
  const [roomMemoryDebugViewer, setRoomMemoryDebugViewer] = useState(
    INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE,
  )
  const handleToggleRoomMemoryDebugViewer = useCallback(() => {
    setRoomMemoryDebugViewer((current) =>
      toggleRoomMemoryDebugViewer(current, roomMemoryRuntimeRef.current.store),
    )
  }, [])
  const handleRefreshRoomMemoryDebugViewer = useCallback(() => {
    setRoomMemoryDebugViewer((current) =>
      refreshRoomMemoryDebugViewer(current, roomMemoryRuntimeRef.current.store),
    )
  }, [])
  // Bounded, non-authoritative room-memory recall context for NPC dialogue
  // (room-memory-recall-context-v0, Slice F). A monotonic request id discards a
  // stale recall so a previous room's memories can never linger while a newer
  // recall is pending: `refreshRoomMemoryContext` clears the value immediately
  // on every call, then applies its own result only if still the latest.
  const [recalledRoomMemory, setRecalledRoomMemory] = useState<RecalledRoomMemory | undefined>(
    undefined,
  )
  const roomMemoryRequestRef = useRef(0)
  // Single memory-feedback slot (room-memory-visible-feedback-v0, Slice 4).
  // `memoryFeedbackAfterPromotion`/`memoryFeedbackAfterRecall` wrap the pure
  // `decideMemoryFeedback` gate so precedence/anti-spam logic lives in one
  // tested place; this state only tracks what the UI currently shows and
  // which room entry has already surfaced feedback.
  const [memoryFeedbackState, setMemoryFeedbackState] =
    useState<MemoryFeedbackState>(INITIAL_MEMORY_FEEDBACK_STATE)
  // Single relationship-feedback slot (relationship-visible-feedback-v0,
  // Slice 3). Mirrors `memoryFeedbackState`; folded into the shared transient
  // slot via `selectTransientFeedbackMessage` at render time.
  const [relationshipFeedbackState, setRelationshipFeedbackState] =
    useState<RelationshipFeedbackState>(INITIAL_RELATIONSHIP_FEEDBACK_STATE)
  // Ephemeral, session-scoped relationship journal accumulation
  // (relationship-journal-runtime-v0, Slice 2). Reset only at handlePrompt and
  // handleLoad, mirroring relationshipsRef -- never on room entry, so it
  // accumulates across rooms within a session. No UI renders it yet (Slice 3
  // wires the read value into a panel), so only the setter is bound here.
  const [, setRelationshipJournal] =
    useState<RelationshipJournalState>(INITIAL_RELATIONSHIP_JOURNAL_STATE)
  const refreshRoomMemoryContext = useCallback((state: WorldState) => {
    const requestId = ++roomMemoryRequestRef.current
    setRecalledRoomMemory(undefined)
    void recallRoomMemoryContext(
      { worldId: state.worldId, sessionId: state.sessionId, roomId: state.currentRoomId },
      roomMemoryRuntimeRef.current.service,
      logger,
    ).then((recalled) => {
      if (roomMemoryRequestRef.current !== requestId) return
      setRecalledRoomMemory(recalled)
      setMemoryFeedbackState((current) =>
        memoryFeedbackAfterRecall(current, {
          hasRecalledMemory: recalled.records.length > 0,
          roomEntrySeq: roomEntrySeqRef.current,
        }),
      )
    })
  }, [])
  const getRoomMemoryContextForNpc = useCallback((npcId: string): RoomMemoryDialogueContext | undefined => {
    if (recalledRoomMemory === undefined) return undefined
    const context = buildVisibleRoomMemoryContext(recalledRoomMemory, npcId)
    return context !== undefined && context.entries.length > 0 ? context : undefined
  }, [recalledRoomMemory])
  // Read-only relationship-context lookup for the active dialogue NPC only
  // (npc-relationship-state-v0, Slice 3). Reads the same ephemeral
  // relationshipsRef map handleNpcDialogueResolved writes to; never mutates
  // it, never reaches across npcId keys, and returns undefined (which
  // buildDialogueContext degrades to neutral) for an NPC with no held
  // projection yet.
  const getRelationshipContextForNpc = useCallback((npcId: string): NpcRelationshipState | undefined => {
    return relationshipsRef.current.get(npcId)
  }, [])
  const handleNpcDialogueResolved = useCallback((event: NpcDialogueResolvedEvent): void => {
    const state = currentWorldStateRef.current
    if (state === null) return
    const play = activePlayRef.current
    const dialogueSemanticEvents = deriveAndLogDialogueSemanticEvents({
      scope: {
        worldId: state.worldId,
        sessionId: state.sessionId,
        roomId: play?.room.id ?? state.currentRoomId,
        npcId: event.npcId,
      },
      promptId: event.promptId,
      turnIndex: event.turnIndex,
      hasNpcReply: event.hasNpcReply,
      makeEventId: (kind, indexInTurn) => `dialogue-semantic-event:${kind}:${indexInTurn}:${idGenerator.newId()}`,
      logger,
    })
    const structuredEffects = deriveAndLogStructuredDialogueEffects({
      events: dialogueSemanticEvents,
      makeEffectId: (sourceEvent, indexInTurn) =>
        `structured-dialogue-effect:${sourceEvent.kind}:${indexInTurn}:${idGenerator.newId()}`,
      logger,
    })
    const relationshipScope = { worldId: state.worldId, sessionId: state.sessionId, npcId: event.npcId }
    const priorRelationship = relationshipsRef.current.get(event.npcId) ?? neutralRelationship(relationshipScope)
    const relationshipResult = deriveAndReduceRelationship({
      effects: structuredEffects,
      prior: priorRelationship,
      ctx: relationshipScope,
      logger,
    })
    relationshipsRef.current.set(event.npcId, relationshipResult.state)
    const prevBucket = familiarityBucket(priorRelationship.axes.familiarity)
    const nextBucket = familiarityBucket(relationshipResult.state.axes.familiarity)
    setRelationshipFeedbackState((current) =>
      relationshipFeedbackAfterReduction(current, { prevBucket, nextBucket }),
    )
    setRelationshipJournal((current) =>
      accumulateRelationshipJournal(current, {
        worldId: state.worldId,
        sessionId: state.sessionId,
        npcId: event.npcId,
        prevBucket,
        nextBucket,
      }),
    )
  }, [])
  // Usage guardrail state (real provider only; fake path stays inert).
  // Refs hold the live values for reading inside stable useCallback closures;
  // the parallel state values trigger re-renders for the UsageMeter display.
  const usageCountRef = useRef(initialUsageState().count)
  const [usageCount, setUsageCount] = useState(0)
  const inFlightRef = useRef(false)
  const [inFlight, setInFlight] = useState(false)
  const confirmGrantedRef = useRef(false)
  const pendingPromptRef = useRef<string | null>(null)
  const guardConfig: UsageGuardConfig = useMemo(
    () => ({ cap: guardCap, enabled: guardEnabled }),
    [],
  )
  const usageStatus = evaluate({ count: usageCount }, guardConfig)
  // Dialogue attempt gate (dialogue-usage-guardrails v0, Slice 3): shares the
  // same session usage meter as room/objective/gate generation. Fake-provider
  // dialogue is always allowed and never counted.
  const requestDialogueAttempt = useCallback((): boolean => {
    if (!dialogueGuardEnabled) return true
    const config: UsageGuardConfig = { cap: guardCap, enabled: true }
    if (!canAttemptOptional({ count: usageCountRef.current }, config)) {
      logger.info('dialogue attempt blocked', {
        count: usageCountRef.current,
        cap: guardCap,
        status: evaluate({ count: usageCountRef.current }, config),
      })
      return false
    }
    const next = recordAttempt({ count: usageCountRef.current })
    usageCountRef.current = next.count
    setUsageCount(next.count)
    logger.info('dialogue attempt', { count: next.count, cap: guardCap })
    return true
  }, [])

  const enterActivePlay = useCallback((play: ActivePlay) => {
    activePlayRef.current = play
    setActivePlay(play)
    roomEntrySeqRef.current += 1
    setRoomEntrySeq(roomEntrySeqRef.current)
    setMemoryFeedbackState(memoryFeedbackOnRoomEntry)
    setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)
  }, [])
  const setQuestSpecForView = useCallback((questSpec: QuestSpec | null) => {
    questSpecRef.current = questSpec
    setQuestSpecSnapshot(questSpec)
  }, [])
  const setQuestHintsForView = useCallback((hints: QuestHintState | null) => {
    questHintsRef.current = hints
    setQuestHints(hints)
  }, [])
  const [saveLoadStatus, setSaveLoadStatus] = useState<SaveLoadStatus>('idle')
  const [saveLoadError, setSaveLoadError] = useState<string | null>(null)
  const [hasSave, setHasSave] = useState(() => saveSlotStore.has())

  // The single derived-view refresh seam: re-project the read-only player HUD,
  // quest tracker, and journal from a fresh authoritative WorldState. Called
  // everywhere the App obtains new state (bootstrap, load, navigation,
  // interaction/encounter resolve) so the projection logic can never drift
  // between sites. Stable (no deps).
  const refreshDerivedViews = useCallback((state: WorldState) => {
    currentWorldStateRef.current = state
    const play = activePlayRef.current
    const generatedJournalInput =
      play != null && (play.objectivesPerRoom === true || play.storyKind !== undefined)
        ? buildGeneratedJournalInput(play, state, questSpecRef.current)
        : undefined
    const views = computeDerivedViews(
      state,
      questSpecRef.current,
      journalSpecRef.current,
      generatedJournalInput,
    )
    setPlayerHud(views.playerHud)
    setQuest(views.quest)
    setJournal(views.journal)
    refreshRoomMemoryContext(state)
  }, [refreshRoomMemoryContext])

  // Event-derived consequence journal seam (consequence-journal-from-events v1,
  // Slice 2 / D2). Runs only at the session-start / load / room-entry flows,
  // AFTER refreshDerivedViews has already set the existing authored/generated
  // journal. When the flag is ON and the projection succeeds it overrides that
  // slot with the event-derived view; on flag OFF, a failed/not-found log read,
  // or a projection throw it leaves the existing journal untouched (D1). A
  // monotonic request id discards a stale async result so a newer refresh always
  // wins. Read-only: the only call is the in-memory getEventLog; no polling, no
  // subscriptions, no event writes.
  const eventJournalRequestRef = useRef(0)
  const applyEventJournalFromSession = useCallback((sessionId: string) => {
    if (!eventConsequenceJournalFromEventsEnabled) return
    const requestId = ++eventJournalRequestRef.current
    void loadEventConsequenceJournal({
      enabled: eventConsequenceJournalFromEventsEnabled,
      sessionId,
      getEventLog: (id) => worldSession.getEventLog(id),
    }).then((view) => {
      if (eventJournalRequestRef.current !== requestId) return
      if (view === null) return
      setJournal(view)
    })
  }, [])

  // World Clock v0 read-only projection seam. Mirrors the journal seam above:
  // the only call is the in-memory getEventLog; it derives the pure clock from
  // the persisted moved-to-room events, never appends or mutates truth, and a
  // monotonic request id drops a stale async result so a newer refresh wins. On
  // a not-found / failed read it leaves the last clock untouched.
  const worldClockRequestRef = useRef(0)
  const applyWorldClockFromSession = useCallback((sessionId: string) => {
    const requestId = ++worldClockRequestRef.current
    void worldSession.getEventLog(sessionId).then((result) => {
      if (worldClockRequestRef.current !== requestId) return
      if (!result.ok) return
      setWorldClock(computeWorldClock(result.events))
    })
  }, [])

  // Memory promotion seam (memory-event-promotion-v0 wiring slice). Runs only
  // after RoomViewer's interaction commit already succeeded — it never appends
  // events and a promotion failure never surfaces here (promoteInteractionMemories
  // already swallows/logs it). RoomViewer stays decoupled from the memory layer:
  // it hands back only the committed events plus the raw name hints it already
  // has on hand; this composition root builds the DisplayNameResolver (only when
  // BOTH a room name and an item name are known) and owns RoomMemoryService.
  const handleCommittedInteractionEvents = useCallback((input: CommittedInteractionEvents) => {
    const displayNames =
      input.roomName !== undefined && input.item !== undefined
        ? createDisplayNameResolver({
            room: { [input.state.currentRoomId]: input.roomName },
            item: { [input.item.itemId]: input.item.name },
          })
        : undefined
    const roomEntrySeq = roomEntrySeqRef.current
    // Promotion may write a new room memory after the room-load/navigation
    // recall already ran (`refreshDerivedViews` -> `refreshRoomMemoryContext`),
    // so re-recall once promotion settles — success or failure — to pick up
    // anything just promoted. A promotion failure is already swallowed/logged
    // by `promoteInteractionMemories`/the store; it never blocks gameplay. A
    // wholesale rejection of the promotion promise itself (not a per-event
    // `remember` failure, which `promoteInteractionMemories` already catches)
    // falls back to `EMPTY_PROMOTION_SUMMARY` so creation feedback never throws.
    void promoteInteractionMemories(
      input.events,
      input.state.worldId,
      roomMemoryRuntimeRef.current.service,
      logger,
      displayNames,
    )
      .catch(() => EMPTY_PROMOTION_SUMMARY)
      .then((promotionSummary) => {
        setMemoryFeedbackState((current) =>
          memoryFeedbackAfterPromotion(current, { promotionSummary, roomEntrySeq }),
        )
      })
      .finally(() => {
        refreshRoomMemoryContext(input.state)
      })
  }, [refreshRoomMemoryContext])

  // Auto-dismiss the visible memory feedback line after a fixed delay (same
  // effect-cleanup idiom as `QuestTracker`'s recently-completed timer): the
  // timer resets whenever the message changes and is always cleared on
  // unmount or before the next timer starts.
  useEffect(() => {
    if (memoryFeedbackState.message === null) return
    const timeoutId = window.setTimeout(() => {
      setMemoryFeedbackState((current) =>
        current.message === null ? current : { ...current, message: null },
      )
    }, MEMORY_FEEDBACK_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timeoutId)
  }, [memoryFeedbackState.message])

  // Auto-dismiss the visible relationship feedback line on the same timer
  // idiom (relationship-visible-feedback-v0, Slice 3).
  useEffect(() => {
    if (relationshipFeedbackState.message === null) return
    const timeoutId = window.setTimeout(() => {
      setRelationshipFeedbackState((current) =>
        current.message === null ? current : { ...current, message: null },
      )
    }, MEMORY_FEEDBACK_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timeoutId)
  }, [relationshipFeedbackState.message])

  useEffect(() => {
    const version = ++requestVersion.current
    void bootstrapExamplePlay().then((result) => {
      if (version !== requestVersion.current) return
      if (result) {
        const { initialState, ...play } = result
        setQuestSpecForView(result.questSpec ?? null)
        setQuestHintsForView(null)
        journalSpecRef.current = result.journalSpec ?? null
        enterActivePlay(play)
        refreshDerivedViews(initialState)
        applyEventJournalFromSession(initialState.sessionId)
        applyWorldClockFromSession(initialState.sessionId)
      } else setFatalMessage(ROOM_UNAVAILABLE)
    })
    return () => {
      requestVersion.current += 1
    }
  }, [applyEventJournalFromSession, applyWorldClockFromSession, enterActivePlay, refreshDerivedViews, setQuestHintsForView, setQuestSpecForView])

  const handlePrompt = useCallback((prompt: string) => {
    // In-flight lock: prevent a second call while one is pending.
    if (inFlightRef.current) return

    // At-cap gate (real provider only): block and store the prompt until the
    // user explicitly confirms via "Generate anyway".
    if (guardEnabled) {
      const status = evaluate({ count: usageCountRef.current }, { cap: guardCap, enabled: true })
      if (status === 'at-cap' && !confirmGrantedRef.current) {
        pendingPromptRef.current = prompt
        return
      }
      // Record the attempt before the async call so failures/fallbacks still count.
      confirmGrantedRef.current = false
      const next = recordAttempt({ count: usageCountRef.current })
      usageCountRef.current = next.count
      setUsageCount(next.count)
      inFlightRef.current = true
      setInFlight(true)
      logger.info('usage attempt', { count: next.count, cap: guardCap, status })
    }

    const version = ++requestVersion.current
    perRoomObjectiveMemoRef.current = new Map()
    relationshipsRef.current = new Map()
    setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)
    setRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE)
    activePlayRef.current = null
    setActivePlay(null)
    setPlayerHud(null)
    setQuest(null)
    setQuestHintsForView(null)
    setJournal(null)
    setQuestSpecForView(null)
    journalSpecRef.current = null
    setFatalMessage(null)
    setNotice(null)
    logger.info('prompt submitted', { promptLength: prompt.length })

    void (async () => {
      try {
        const prepared = await prepareGeneratedRoomSeed(prompt, worldBibleSeeder, logger)
        if (version !== requestVersion.current) return
        const vocabulary = themeVocabulary(prepared.worldBible?.themePack)
        const generatedPromptGenerator = roomGeneratorSelectionLog.provider === 'fake'
          ? new FakeRoomGenerator(vocabulary)
          : promptGenerator
        const source = buildPromptGeneratedRoomSource({
          generator: generatedPromptGenerator,
          rawUserPrompt: prompt,
          generatorSeed: prepared.generatorSeed,
          themePack: prepared.worldBible?.themePack,
          logger,
          fallbackRoom,
        })
        const result = await source.getRoom()
        if (version !== requestVersion.current) return
        if (!result.ok) {
          logger.error('generated room load failed', { code: result.error.code })
          setFatalMessage(result.error.message)
          return
        }
        const started = await startRoomSession(result.room)
        if (version !== requestVersion.current) return
        if (!started.ok) {
          logger.error('world session start failed', { code: started.error.code })
          setFatalMessage(ROOM_UNAVAILABLE)
          return
        }
        const generatedCache = new SessionRoomCache()
        generatedCache.set(result.room.id, result.room)
        const adjacentThemeSeed = prepared.worldBible
          ? worldBibleToAdjacentThemeSeed(prepared.worldBible)
          : undefined
        const storyKind = prepared.worldBible?.openingArc.pattern
        const generatedAdjacentGenerator = new FakeRoomGenerator(vocabulary)
        const generatedPregenerator = new AdjacentRoomPregenerator(
          generatedCache,
          roomRegistry,
          (roomId) => {
            const storyContext = deriveStoryThreadContext(storyKind, roomId)
            const storyPhrase = storyContext
              ? storyThreadToSeedPhrase(storyContext)
              : undefined
            return new GeneratedRoomSource(
              generatedAdjacentGenerator,
              buildAdjacentRoomSeed(roomId, adjacentThemeSeed, storyPhrase),
              logger,
              fallbackRoom,
              {
                themePack: prepared.worldBible?.themePack,
                enrichObjectiveTarget: true,
                storyKind: storyContext?.kind,
              },
            )
          },
          fallbackRoom,
          logger,
          3,
          { ensureReturnExits: true },
        )
        const generatedNavigation = new NavigationService(worldSession, generatedPregenerator, logger)
        generatedPregenerator.warmAdjacent(result.room)
        const initialPlayer = projectPlayerHud(started.state)
        let generatedObjective: Awaited<ReturnType<typeof buildGeneratedObjectiveAttachment>> = null
        let providerGateStatus: ProviderGateStatus | undefined
        let providerGate: GeneratedMechanicalGate | undefined
        if (result.provenance === 'generated') {
          const objectiveAllowed = canAttemptOptional(
            { count: usageCountRef.current },
            { cap: guardCap, enabled: guardEnabled },
          )
          if (objectiveAllowed && gateGeneratorSelection.kind === 'real') {
            const attachment = await buildGeneratedGateAttachment(result.room, gateGeneratorSelection.generator)
            providerGateStatus = attachment.status
            providerGate = attachment.status === 'accepted' ? attachment.gate : undefined
          } else if (gateGeneratorSelection.kind === 'real') {
            providerGateStatus = 'not-attempted'
          }
          if (objectiveAllowed) {
            logger.info('optional objective generation allowed', { count: usageCountRef.current, cap: guardCap })
            generatedObjective = await buildGeneratedObjectiveAttachment(result.room, objectiveGenerator)
          } else {
            logger.info('optional objective generation skipped', { count: usageCountRef.current, cap: guardCap, reason: 'usage-cap' })
          }
        }
        if (version !== requestVersion.current) return
        perRoomObjectiveMemoRef.current.set(result.room.id, generatedObjective)
        setQuestSpecForView(generatedObjective?.questSpec ?? null)
        setQuestHintsForView(generatedObjective
          ? { hint: generatedObjective.hint, completionHint: generatedObjective.completionHint }
          : null)
        enterActivePlay({
          room: result.room,
          roomSource: preloadedRoomSource(result.room),
          sessionId: started.state.sessionId,
          roomCache: generatedCache,
          navigation: generatedNavigation,
          adjacentPregenerator: generatedPregenerator,
          ...(prepared.worldBible ? { worldBible: prepared.worldBible } : {}),
          ...(storyKind ? { storyKind } : {}),
          initialPlayer,
          ...(generatedObjective ? { questSpec: generatedObjective.questSpec } : {}),
          objectivesPerRoom: true,
          ...(providerGateStatus !== undefined ? { providerGateStatus } : {}),
          ...(providerGate !== undefined ? { providerGate } : {}),
          entryResolvedObjectIds: resolvedObjectIdsForGeneratedPlay({
            objectivesPerRoom: true,
            state: started.state,
            room: result.room,
          }),
        })
        refreshDerivedViews(started.state)
        applyEventJournalFromSession(started.state.sessionId)
        applyWorldClockFromSession(started.state.sessionId)
        // A repaired or fallback room couldn't be built exactly as asked — show the
        // static, prompt-free notice. A clean `generated` room shows nothing.
        if (shouldShowFallbackNotice(result.provenance)) setNotice(FALLBACK_NOTICE)
      } finally {
        if (guardEnabled) {
          inFlightRef.current = false
          setInFlight(false)
        }
      }
    })().catch(() => {
      if (version !== requestVersion.current) return
      logger.error('generated room source threw', { code: 'room-source-failed' })
      setFatalMessage(ROOM_UNAVAILABLE)
    })
  }, [applyEventJournalFromSession, applyWorldClockFromSession, enterActivePlay, refreshDerivedViews, setQuestHintsForView, setQuestSpecForView])

  const handleGenerateAnyway = useCallback(() => {
    confirmGrantedRef.current = true
    const pending = pendingPromptRef.current
    pendingPromptRef.current = null
    if (pending !== null) handlePrompt(pending)
  }, [handlePrompt])

  const handleResetUsage = useCallback(() => {
    usageCountRef.current = 0
    setUsageCount(0)
    confirmGrantedRef.current = false
    pendingPromptRef.current = null
  }, [])

  const handleSave = useCallback(() => {
    if (!activePlay) return
    setSaveLoadStatus('saving')
    setSaveLoadError(null)
    void (async () => {
      const saveResult = await saveGameService.saveSession(activePlay.sessionId)
      if (!saveResult.ok) {
        setSaveLoadStatus('error')
        setSaveLoadError("Couldn't save your game.")
        return
      }
      // Generated play only: park the restore-model blob alongside the
      // authoritative save (ADR-0059). `questSpecRef.current` is the canonical
      // current quest spec (kept in sync by setQuestSpecForView and read by
      // refreshDerivedViews); `activePlay.questSpec` can lag for navigated
      // generated rooms whose objective was attached asynchronously. Authored
      // play yields `undefined`, so the slot wrapper stays byte-identical.
      const generatedQuestJson = buildGeneratedQuestSaveJson(
        {
          room: activePlay.room,
          objectivesPerRoom: activePlay.objectivesPerRoom,
          questSpec: questSpecRef.current ?? undefined,
          storyKind: activePlay.storyKind,
        },
        questHintsRef.current,
      )
      const stateForSidecars = await worldSession.getWorldState(activePlay.sessionId)
      let generatedRoomCacheJson: string | undefined
      let roomMemoryJson: string | undefined
      let npcRelationshipJson: string | undefined
      if (stateForSidecars.ok) {
        roomMemoryJson = buildRuntimeRoomMemorySaveJson(
          roomMemoryRuntimeRef.current.store,
          {
            worldId: stateForSidecars.state.worldId,
            sessionId: stateForSidecars.state.sessionId,
          },
        )
        // NPC relationship persistence v0 (Slice 4): snapshot the ephemeral
        // relationshipsRef map only at this existing manual-save point (no
        // autosave), scoped to the same authoritative worldId/sessionId as the
        // room-memory sidecar above.
        npcRelationshipJson = buildNpcRelationshipSaveJson(
          Array.from(relationshipsRef.current.values()),
          {
            worldId: stateForSidecars.state.worldId,
            sessionId: stateForSidecars.state.sessionId,
          },
        ) ?? undefined
        if (activePlay.objectivesPerRoom === true && activePlay.adjacentPregenerator != null) {
          generatedRoomCacheJson = buildGeneratedRoomCacheSaveJson({
            room: activePlay.room,
            objectivesPerRoom: activePlay.objectivesPerRoom,
            cachedRooms: activePlay.adjacentPregenerator.snapshotCachedRooms(),
            worldState: stateForSidecars.state,
            objectives: perRoomObjectiveMemoRef.current,
            ...(activePlay.worldBible?.themePack !== undefined
              ? { themePack: activePlay.worldBible.themePack }
              : {}),
          })
        }
      }
      const writeResult = saveSlotStore.write(
        saveResult.json,
        {
          savedAt: new Date().toISOString(),
          label: 'Save',
        },
        generatedQuestJson,
        generatedRoomCacheJson,
        roomMemoryJson,
        npcRelationshipJson,
      )
      if (!writeResult.ok) {
        setSaveLoadStatus('error')
        setSaveLoadError("Couldn't save your game.")
        return
      }
      setHasSave(true)
      setSaveLoadStatus('saved')
    })()
  }, [activePlay])

  const handleLoad = useCallback(() => {
    const version = ++requestVersion.current
    perRoomObjectiveMemoRef.current = new Map()
    relationshipsRef.current = new Map()
    setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)
    setRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE)
    activePlayRef.current = null
    setSaveLoadStatus('loading')
    setSaveLoadError(null)
    void (async () => {
      const slotResult = saveSlotStore.read()
      if (!slotResult.ok) {
        if (version !== requestVersion.current) return
        setSaveLoadStatus('error')
        setSaveLoadError('This save could not be loaded.')
        return
      }

      const loadResult = await saveGameService.loadSession(slotResult.saveGameJson)
      if (!loadResult.ok) {
        if (version !== requestVersion.current) return
        setSaveLoadStatus('error')
        setSaveLoadError(
          loadResult.error.code === 'already-exists'
            ? 'This session is already loaded.'
            : 'This save could not be loaded.',
        )
        return
      }

      const stateResult = await worldSession.getWorldState(loadResult.sessionId)
      if (!stateResult.ok) {
        if (version !== requestVersion.current) return
        setSaveLoadStatus('error')
        setSaveLoadError('This save could not be loaded.')
        return
      }

      const roomMemoryRestore = restoreRuntimeRoomMemoryFromSlot({
        store: roomMemoryRuntimeRef.current.store,
        roomMemoryJson: slotResult.roomMemoryJson,
        scope: {
          worldId: stateResult.state.worldId,
          sessionId: stateResult.state.sessionId,
        },
      })
      if (roomMemoryRestore.status === 'invalid') {
        logger.warn('room memory save sidecar skipped', {
          reason: roomMemoryRestore.reason,
          restoredCount: roomMemoryRestore.restoredCount,
          droppedCount: roomMemoryRestore.droppedCount,
        })
      } else {
        logger.info('room memory save sidecar restored', {
          status: roomMemoryRestore.status,
          restoredCount: roomMemoryRestore.restoredCount,
          droppedCount: roomMemoryRestore.droppedCount,
          droppedByScope: roomMemoryRestore.droppedByScope,
          droppedBySource: roomMemoryRestore.droppedBySource,
          droppedByText: roomMemoryRestore.droppedByText,
          droppedByCap: roomMemoryRestore.droppedByCap,
        })
      }

      // NPC relationship persistence v0 (Slice 4): re-seed the ephemeral
      // relationshipsRef map (already cleared at load start) directly from the
      // restored records, keyed by record.scope.npcId. Never routes through the
      // reducer or feedback derivation, so hydration stays feedback-silent; the
      // existing relationshipFeedbackOnRoomEntry reset above is untouched.
      const relationshipRestore = restoreNpcRelationshipsFromSlot({
        npcRelationshipJson: slotResult.npcRelationshipJson,
        scope: {
          worldId: stateResult.state.worldId,
          sessionId: stateResult.state.sessionId,
        },
      })
      if (version === requestVersion.current) {
        for (const record of relationshipRestore.records) {
          relationshipsRef.current.set(record.scope.npcId, record)
        }
      }
      if (relationshipRestore.diagnostics.status === 'invalid') {
        logger.warn('npc relationship save sidecar skipped', {
          reason: relationshipRestore.diagnostics.reason,
          restoredCount: relationshipRestore.diagnostics.restoredCount,
          droppedCount: relationshipRestore.diagnostics.droppedCount,
        })
      } else {
        logger.info('npc relationship save sidecar restored', {
          status: relationshipRestore.diagnostics.status,
          restoredCount: relationshipRestore.diagnostics.restoredCount,
          droppedCount: relationshipRestore.diagnostics.droppedCount,
          droppedByScope: relationshipRestore.diagnostics.droppedByScope,
          droppedByCap: relationshipRestore.diagnostics.droppedByCap,
        })
      }

      // Generated-play restore (ADR-0059): re-validate the optional parked blob
      // and rebuild the generated room/quest view state from the already-restored
      // authoritative WorldState. Missing or invalid blob → `null` → fall through
      // to the authored-world gate below with no error surfaced. Onward
      // navigation still uses the authored fallback wiring (v0 known limitation).
      const restoredGeneratedPlay = restoreGeneratedPlayFromSlot(
        slotResult.generatedQuestJson,
        stateResult.state,
      )
      let restoredKind: 'generated' | 'degraded' | 'authored'

      if (restoredGeneratedPlay != null) {
        restoredKind = 'generated'
        const { hints, ...generatedPlayFields } = restoredGeneratedPlay
        const restoredCache = restoreGeneratedRoomCacheFromSlot(
          slotResult.generatedRoomCacheJson,
          restoredGeneratedPlay.room,
          restoredGeneratedPlay.storyKind,
        )
        seedRestoredGeneratedObjectiveMemo(
          perRoomObjectiveMemoRef.current,
          restoredGeneratedPlay,
          restoredCache?.restoredRoomIds ?? [restoredGeneratedPlay.room.id],
          restoredCache?.restoredObjectives,
        )
        setQuestSpecForView(generatedPlayFields.questSpec ?? null)
        setQuestHintsForView(hints ?? null)
        journalSpecRef.current = null
        enterActivePlay({
          ...generatedPlayFields,
          sessionId: loadResult.sessionId,
          ...(restoredCache !== null
            ? {
                roomCache: restoredCache.roomCache,
                navigation: restoredCache.navigation,
                adjacentPregenerator: restoredCache.adjacentPregenerator,
              }
            : {
                navigation: exampleNavigation,
                adjacentPregenerator,
              }),
        })
        setNotice(null)
      } else {
        const resolved = await adjacentPregenerator.resolveRoom(stateResult.state.currentRoomId)
        if (version !== requestVersion.current) return

        const { play, degraded } = buildRestoredPlay(stateResult.state, resolved, fallbackRoom)

        if (resolved.ok) adjacentPregenerator.warmAdjacent(resolved.room)

        // Gate demo quest + journal to the authored example world: only restore
        // them when the anchor room is present in the saved session's roomStates.
        const isAuthoredWorld = stateResult.state.roomStates['throne-room'] != null
        const restoredQuestSpec = isAuthoredWorld ? demoQuestSpec : undefined
        const restoredJournalSpec = isAuthoredWorld ? demoJournalSpec : undefined
        setQuestSpecForView(restoredQuestSpec ?? null)
        setQuestHintsForView(null)
        journalSpecRef.current = restoredJournalSpec ?? null

        enterActivePlay({
          ...play,
          navigation: exampleNavigation,
          adjacentPregenerator,
          questSpec: restoredQuestSpec,
          journalSpec: restoredJournalSpec,
        })
        restoredKind = degraded ? 'degraded' : 'authored'
        setNotice(degraded ? FALLBACK_NOTICE : null)
      }
      refreshDerivedViews(stateResult.state)
      applyEventJournalFromSession(stateResult.state.sessionId)
      applyWorldClockFromSession(stateResult.state.sessionId)
      setFatalMessage(null)
      setSaveLoadStatus('idle')
      logger.info('world session restored', {
        sessionId: loadResult.sessionId,
        restored: restoredKind,
      })
    })().catch(() => {
      if (version !== requestVersion.current) return
      setSaveLoadStatus('error')
      setSaveLoadError('This save could not be loaded.')
    })
  }, [applyEventJournalFromSession, applyWorldClockFromSession, enterActivePlay, refreshDerivedViews, setQuestHintsForView, setQuestSpecForView])

  const handleNavigate = useCallback(async (toRoomId: string): Promise<NavigationResult> => {
    if (!activePlay?.navigation) return { status: 'rejected', reason: 'missing-exit' }
    const navigation = activePlay.navigation
    const generatedGateOptions = activePlay.objectivesPerRoom === true
      ? {
          generatedGateEnabled: true as const,
          currentRoom: activePlay.room,
          providerGateStatus: activePlay.providerGateStatus,
          providerGate: activePlay.providerGate,
        }
      : { generatedGateEnabled: false as const }
    const result = await navigateWithExitGate({
      sessionId: activePlay.sessionId,
      fromRoomId: activePlay.room.id,
      toRoomId,
      demoQuestEnabled: activePlay.questSpec != null,
      getWorldState: (sessionId) => worldSession.getWorldState(sessionId),
      navigate: () => navigation.navigate({
        sessionId: activePlay.sessionId,
        toRoomId,
      }),
      ...generatedGateOptions,
    })
    if (result.status === 'navigated') {
      const shouldAttachObjective = shouldStartPerRoomObjectiveAttach({
        objectivesPerRoom: activePlay.objectivesPerRoom,
        provenance: result.provenance,
        memo: perRoomObjectiveMemoRef.current,
        roomId: result.room.id,
      })
      let nextQuestSpec = activePlay.questSpec
      if (activePlay.objectivesPerRoom === true) {
        const perRoomObjective = readPerRoomObjectiveMemo(perRoomObjectiveMemoRef.current, result.room.id)
        nextQuestSpec = perRoomObjective.questSpec ?? undefined
        setQuestSpecForView(perRoomObjective.questSpec)
        setQuestHintsForView(perRoomObjective.questHints)
      } else {
        setQuestSpecForView(activePlay.questSpec ?? null)
        setQuestHintsForView(null)
      }
      const nextPlay: ActivePlay = {
        room: result.room,
        roomSource: preloadedRoomSource(result.room),
        sessionId: activePlay.sessionId,
        roomCache: activePlay.roomCache,
        navigation: activePlay.navigation,
        adjacentPregenerator: activePlay.adjacentPregenerator,
        ...(activePlay.worldBible ? { worldBible: activePlay.worldBible } : {}),
        ...(activePlay.storyKind ? { storyKind: activePlay.storyKind } : {}),
        initialPlayer: activePlay.initialPlayer,
        ...(nextQuestSpec ? { questSpec: nextQuestSpec } : {}),
        ...(activePlay.journalSpec ? { journalSpec: activePlay.journalSpec } : {}),
        ...(activePlay.objectivesPerRoom === true
          ? {
              objectivesPerRoom: true,
              entryResolvedObjectIds: resolvedObjectIdsForGeneratedPlay({
                objectivesPerRoom: true,
                state: result.state,
                room: result.room,
              }),
            }
          : {}),
      }
      activePlayRef.current = nextPlay
      setActivePlay((current) => current?.sessionId === activePlay.sessionId ? nextPlay : current)
      roomEntrySeqRef.current += 1
      setRoomEntrySeq(roomEntrySeqRef.current)
      setMemoryFeedbackState(memoryFeedbackOnRoomEntry)
      setRelationshipFeedbackState(relationshipFeedbackOnRoomEntry)
      // Warm the next frontier from the room we just entered.
      activePlay.adjacentPregenerator?.warmAdjacent(result.room)
      // Re-project derived views from the post-move WorldState so objective 3
      // (ruined-safehouse visited) flips done immediately on entering the room.
      refreshDerivedViews(result.state)
      applyEventJournalFromSession(result.state.sessionId)
      applyWorldClockFromSession(result.state.sessionId)
      if (shouldAttachObjective) {
        const destinationRoom = result.room
        const destinationSessionId = activePlay.sessionId
        void attachPerRoomObjectiveOnEnter({
          room: destinationRoom,
          sessionId: destinationSessionId,
          memo: perRoomObjectiveMemoRef.current,
          usageCount: usageCountRef.current,
          guardConfig,
          objectiveGenerator,
          logger,
          getCurrentPlay: () => activePlayRef.current,
          applyAttachment: (attachment) => {
            setQuestSpecForView(attachment?.questSpec ?? null)
            setQuestHintsForView(attachment
              ? { hint: attachment.hint, completionHint: attachment.completionHint }
              : null)
          },
          refreshAfterApply: async () => {
            const stateResult = await worldSession.getWorldState(destinationSessionId)
            if (stateResult.ok) refreshDerivedViews(stateResult.state)
          },
        })
      }
    }
    return result
  }, [activePlay, applyEventJournalFromSession, applyWorldClockFromSession, guardConfig, refreshDerivedViews, setQuestHintsForView, setQuestSpecForView])

  return (
    <ErrorBoundary logger={logger}>
      {activePlay ? (
        <RoomViewer
          roomSource={activePlay.roomSource}
          sessionId={activePlay.sessionId}
          interactionService={interactionService}
          encounterService={encounterService}
          npcDialogueService={npcDialogueService}
          requestDialogueAttempt={requestDialogueAttempt}
          onNavigate={handleNavigate}
          onWorldStateChange={refreshDerivedViews}
          onCommittedInteractionEvents={handleCommittedInteractionEvents}
          onNpcDialogueResolved={handleNpcDialogueResolved}
          questStage={buildQuestStage({ quest, questHints, questSpec: questSpecSnapshot })}
          getRoomMemoryContextForNpc={getRoomMemoryContextForNpc}
          getRelationshipContextForNpc={getRelationshipContextForNpc}
          timeContext={worldClock ? toPromptTimeContext(worldClock) : null}
          {...(activePlay.objectivesPerRoom === true
            ? { resolvedObjectIds: activePlay.entryResolvedObjectIds }
            : {})}
        />
      ) : (
        <div className="room-viewer-root">
          {fatalMessage && <div className="room-message" role="alert">{fatalMessage}</div>}
        </div>
      )}
      {playerHud && <StatusHud view={playerHud} clock={worldClock} />}
      {quest && <QuestTracker view={quest} />}
      {journal && <JournalPanel view={journal} />}
      <AppRoomEntryOverlay
        room={activePlay?.room ?? null}
        sessionId={activePlay?.sessionId ?? ''}
        entrySeq={roomEntrySeq}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />
      <MemoryFeedback
        message={selectTransientFeedbackMessage(memoryFeedbackState.message, relationshipFeedbackState.message)}
      />
      {roomMemoryDebugViewerEnabled && (
        <RoomMemoryDebugPanel
          rows={roomMemoryDebugViewer.rows}
          currentRoomId={activePlay?.room.id ?? null}
          open={roomMemoryDebugViewer.open}
          onToggle={handleToggleRoomMemoryDebugViewer}
          onRefresh={handleRefreshRoomMemoryDebugViewer}
        />
      )}
      <PromptBar onSubmit={handlePrompt} disabled={inFlight} />
      {guardEnabled && (
        <UsageMeter
          count={usageCount}
          cap={guardCap}
          status={usageStatus}
          onGenerateAnyway={handleGenerateAnyway}
          onReset={handleResetUsage}
        />
      )}
      <SaveLoadBar
        canSave={activePlay != null}
        hasSave={hasSave}
        status={saveLoadStatus}
        errorMessage={saveLoadError}
        onSave={handleSave}
        onContinue={handleLoad}
      />
    </ErrorBoundary>
  )
}

export default App
