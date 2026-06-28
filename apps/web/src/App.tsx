import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RoomViewer } from './renderer/RoomViewer'
import { StatusHud } from './renderer/ui/StatusHud'
import { SaveLoadBar } from './renderer/ui/SaveLoadBar'
import type { SaveLoadStatus } from './renderer/ui/SaveLoadBar'
import { UsageMeter } from './renderer/ui/UsageMeter'
import { QuestTracker } from './renderer/ui/QuestTracker'
import { JournalPanel } from './renderer/ui/JournalPanel'
import { RoomIntroPanel } from './renderer/ui/RoomIntroPanel'
import { projectPlayerHud } from './renderer/ui/playerHud'
import type { PlayerHudView } from './renderer/ui/playerHud'
import type { QuestView } from './domain/quests/evaluateQuest'
import type { QuestSpec } from './domain/quests/questSpec'
import { demoQuestSpec } from './domain/examples/demoQuest'
import type { JournalView } from './domain/journal/projectJournal'
import type { JournalSpec } from './domain/journal/journalSpec'
import { demoJournalSpec } from './domain/examples/demoJournal'
import type { WorldState } from './domain/world/worldState'
import type { RoomSource } from './domain/ports/RoomSource'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { RoomRegistry } from './room/RoomRegistry'
import { SessionRoomCache } from './room/SessionRoomCache'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { FakeWorldBibleSeeder } from './generation/FakeWorldBibleSeeder'
import { readLlmConfig } from './app/llmConfig'
import { selectRoomGenerator } from './app/selectRoomGenerator'
import { evaluate, recordAttempt, initialUsageState } from './domain/usage/usageGuard'
import type { UsageGuardConfig } from './domain/usage/usageGuard'
import { ErrorBoundary } from './app/ErrorBoundary'
import { AdjacentRoomPregenerator } from './app/AdjacentRoomPregenerator'
import { NavigationService } from './app/NavigationService'
import type { NavigationResult } from './app/NavigationService'
import { PromptBar } from './app/PromptBar'
import { buildRestoredPlay } from './app/buildRestoredPlay'
import { computeDerivedViews } from './app/derivedViews'
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
import { loadRoomSpec, type LoadedRoom } from './domain/loadRoomSpec'
import { fallbackRoom as fallbackRoomSpec } from './domain/examples/fallbackRoom'
import { FALLBACK_NOTICE, shouldShowFallbackNotice } from './app/fallbackNotice'
import { buildRoomIntroView } from './app/roomIntro'
import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'
import type { WorldBibleSeed } from './domain/worldBible/worldBibleSeed'
import { worldBibleToAdjacentThemeSeed } from './domain/worldBible/worldBibleToSeed'
import { buildAdjacentRoomSeed } from './app/buildAdjacentRoomSeed'
import { prepareGeneratedRoomSeed } from './app/worldBible'
import { buildPromptGeneratedRoomSource } from './app/buildPromptGeneratedRoomSource'
import { themeVocabulary } from './domain/generatedRoomThemeVocabulary'

import { NPCDialogueService } from './dialogue/NPCDialogueService'

// Composition root: concrete adapters are constructed once and injected.
const logger = createConsoleLogger()
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
const worldBibleSeeder = new FakeWorldBibleSeeder()
const idGenerator = new UuidGenerator()
const worldStore = new InMemoryWorldStore()
const worldSession = new WorldSession(worldStore, new SystemClock(), idGenerator, logger)
const saveGameService = new SaveGameService(worldStore, logger)
const saveSlotStore = new LocalStorageSaveSlotStore()
const interactionService = new InteractionService(worldSession, logger)
const encounterService = new EncounterService(worldSession, logger)
const dialogueProvider = new FakeNPCDialogueProvider()
const npcDialogueService = new NPCDialogueService(worldSession, dialogueProvider, logger)
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
  const [roomEntrySeq, setRoomEntrySeq] = useState(0)
  const [playerHud, setPlayerHud] = useState<PlayerHudView | null>(null)
  const [quest, setQuest] = useState<QuestView | null>(null)
  const [journal, setJournal] = useState<JournalView | null>(null)
  const [fatalMessage, setFatalMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const questSpecRef = useRef<QuestSpec | null>(null)
  const journalSpecRef = useRef<JournalSpec | null>(null)
  // Usage guardrail state (real provider only; fake path stays inert).
  // Refs hold the live values for reading inside stable useCallback closures;
  // the parallel state values trigger re-renders for the UsageMeter display.
  const usageCountRef = useRef(initialUsageState().count)
  const [usageCount, setUsageCount] = useState(0)
  const inFlightRef = useRef(false)
  const [inFlight, setInFlight] = useState(false)
  const confirmGrantedRef = useRef(false)
  const pendingPromptRef = useRef<string | null>(null)
  const guardConfig: UsageGuardConfig = { cap: guardCap, enabled: guardEnabled }
  const usageStatus = evaluate({ count: usageCount }, guardConfig)

  const enterActivePlay = useCallback((play: ActivePlay) => {
    setActivePlay(play)
    setRoomEntrySeq((seq) => seq + 1)
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
    const views = computeDerivedViews(state, questSpecRef.current, journalSpecRef.current)
    setPlayerHud(views.playerHud)
    setQuest(views.quest)
    setJournal(views.journal)
  }, [])

  useEffect(() => {
    const version = ++requestVersion.current
    void bootstrapExamplePlay().then((result) => {
      if (version !== requestVersion.current) return
      if (result) {
        const { initialState, ...play } = result
        questSpecRef.current = result.questSpec ?? null
        journalSpecRef.current = result.journalSpec ?? null
        enterActivePlay(play)
        refreshDerivedViews(initialState)
      } else setFatalMessage(ROOM_UNAVAILABLE)
    })
    return () => {
      requestVersion.current += 1
    }
  }, [enterActivePlay, refreshDerivedViews])

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
    setActivePlay(null)
    setPlayerHud(null)
    setQuest(null)
    setJournal(null)
    questSpecRef.current = null
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
        const generatedAdjacentGenerator = new FakeRoomGenerator(vocabulary)
        const generatedPregenerator = new AdjacentRoomPregenerator(
          generatedCache,
          roomRegistry,
          (roomId) =>
            new GeneratedRoomSource(
              generatedAdjacentGenerator,
              buildAdjacentRoomSeed(roomId, adjacentThemeSeed),
              logger,
              fallbackRoom,
              { themePack: prepared.worldBible?.themePack },
            ),
          fallbackRoom,
          logger,
        )
        const generatedNavigation = new NavigationService(worldSession, generatedPregenerator, logger)
        generatedPregenerator.warmAdjacent(result.room)
        const initialPlayer = projectPlayerHud(started.state)
        enterActivePlay({
          room: result.room,
          roomSource: preloadedRoomSource(result.room),
          sessionId: started.state.sessionId,
          roomCache: generatedCache,
          navigation: generatedNavigation,
          adjacentPregenerator: generatedPregenerator,
          ...(prepared.worldBible ? { worldBible: prepared.worldBible } : {}),
          initialPlayer,
        })
        setPlayerHud(initialPlayer)
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
  }, [enterActivePlay])

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
      const writeResult = saveSlotStore.write(saveResult.json, {
        savedAt: new Date().toISOString(),
        label: 'Save',
      })
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

      const resolved = await adjacentPregenerator.resolveRoom(stateResult.state.currentRoomId)
      if (version !== requestVersion.current) return

      const { play, degraded } = buildRestoredPlay(stateResult.state, resolved, fallbackRoom)

      if (resolved.ok) adjacentPregenerator.warmAdjacent(resolved.room)

      // Gate demo quest + journal to the authored example world: only restore
      // them when the anchor room is present in the saved session's roomStates.
      const isAuthoredWorld = stateResult.state.roomStates['throne-room'] != null
      const restoredQuestSpec = isAuthoredWorld ? demoQuestSpec : undefined
      const restoredJournalSpec = isAuthoredWorld ? demoJournalSpec : undefined
      questSpecRef.current = restoredQuestSpec ?? null
      journalSpecRef.current = restoredJournalSpec ?? null

      enterActivePlay({
        ...play,
        navigation: exampleNavigation,
        adjacentPregenerator,
        questSpec: restoredQuestSpec,
        journalSpec: restoredJournalSpec,
      })
      refreshDerivedViews(stateResult.state)
      setFatalMessage(null)
      setNotice(degraded ? FALLBACK_NOTICE : null)
      setSaveLoadStatus('idle')
      logger.info('world session restored', {
        sessionId: play.sessionId,
        restored: degraded ? 'degraded' : 'authored',
      })
    })().catch(() => {
      if (version !== requestVersion.current) return
      setSaveLoadStatus('error')
      setSaveLoadError('This save could not be loaded.')
    })
  }, [enterActivePlay, refreshDerivedViews])

  const handleNavigate = useCallback(async (toRoomId: string): Promise<NavigationResult> => {
    if (!activePlay?.navigation) return { status: 'rejected', reason: 'missing-exit' }
    const navigation = activePlay.navigation
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
    })
    if (result.status === 'navigated') {
      setActivePlay((current) => current?.sessionId === activePlay.sessionId
        ? {
            room: result.room,
            roomSource: preloadedRoomSource(result.room),
            sessionId: activePlay.sessionId,
            roomCache: activePlay.roomCache,
            navigation: activePlay.navigation,
            adjacentPregenerator: activePlay.adjacentPregenerator,
            worldBible: activePlay.worldBible,
            initialPlayer: activePlay.initialPlayer,
            questSpec: activePlay.questSpec,
            journalSpec: activePlay.journalSpec,
          }
        : current)
      setRoomEntrySeq((seq) => seq + 1)
      // Warm the next frontier from the room we just entered.
      activePlay.adjacentPregenerator?.warmAdjacent(result.room)
      // Re-project derived views from the post-move WorldState so objective 3
      // (ruined-safehouse visited) flips done immediately on entering the room.
      refreshDerivedViews(result.state)
    }
    return result
  }, [activePlay, refreshDerivedViews])

  return (
    <ErrorBoundary logger={logger}>
      {activePlay ? (
        <RoomViewer
          roomSource={activePlay.roomSource}
          sessionId={activePlay.sessionId}
          interactionService={interactionService}
          encounterService={encounterService}
          npcDialogueService={npcDialogueService}
          onNavigate={handleNavigate}
          onWorldStateChange={refreshDerivedViews}
          questStage={quest ? { activeObjectiveId: quest.activeObjectiveId, status: quest.status } : undefined}
        />
      ) : (
        <div className="room-viewer-root">
          {fatalMessage && <div className="room-message" role="alert">{fatalMessage}</div>}
        </div>
      )}
      {playerHud && <StatusHud view={playerHud} />}
      {quest && <QuestTracker view={quest} />}
      {journal && <JournalPanel view={journal} />}
      <AppRoomEntryOverlay
        room={activePlay?.room ?? null}
        sessionId={activePlay?.sessionId ?? ''}
        entrySeq={roomEntrySeq}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />
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
