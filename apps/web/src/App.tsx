import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomViewer } from './renderer/RoomViewer'
import type { RoomSource } from './domain/ports/RoomSource'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { RoomRegistry } from './room/RoomRegistry'
import { SessionRoomCache } from './room/SessionRoomCache'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { FakeWorldBibleSeeder } from './generation/FakeWorldBibleSeeder'
import { ErrorBoundary } from './app/ErrorBoundary'
import { AdjacentRoomPregenerator } from './app/AdjacentRoomPregenerator'
import { NavigationService } from './app/NavigationService'
import type { NavigationResult } from './app/NavigationService'
import { PromptBar } from './app/PromptBar'
import { createConsoleLogger } from './platform/logger/consoleLogger'
import { SystemClock } from './platform/system/clock'
import { UuidGenerator } from './platform/system/idGenerator'
import { InMemoryWorldStore } from './world-session/InMemoryWorldStore'
import { WorldSession } from './world-session/WorldSession'
import type { WorldStateResult } from './world-session/WorldSession'
import { InteractionService } from './interactions/InteractionService'
import { EncounterService } from './encounters/EncounterService'
import { loadRoomSpec, type LoadedRoom } from './domain/loadRoomSpec'
import { fallbackRoom as fallbackRoomSpec } from './domain/examples/fallbackRoom'
import { FALLBACK_NOTICE, shouldShowFallbackNotice } from './app/fallbackNotice'
import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'
import type { WorldBibleSeed } from './domain/worldBible/worldBibleSeed'
import { prepareGeneratedRoomSeed } from './app/worldBible'

import { NPCDialogueService } from './dialogue/NPCDialogueService'

// Composition root: concrete adapters are constructed once and injected.
const logger = createConsoleLogger()
const generator = new FakeRoomGenerator()
const worldBibleSeeder = new FakeWorldBibleSeeder()
const idGenerator = new UuidGenerator()
const worldStore = new InMemoryWorldStore()
const worldSession = new WorldSession(worldStore, new SystemClock(), idGenerator, logger)
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
  (roomId) => new GeneratedRoomSource(generator, `adjacent:${roomId}`, logger, fallbackRoom),
  fallbackRoom,
  logger,
)
const exampleNavigation = new NavigationService(worldSession, adjacentPregenerator, logger)

const STARTING_ROOM_ID = 'throne-room'
const ROOM_UNAVAILABLE = 'This room could not be loaded.'

type ActivePlay = {
  roomSource: RoomSource
  sessionId: string
  roomCache: SessionRoomCache
  navigation?: NavigationService
  worldBible?: WorldBibleSeed
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

let exampleBootstrap: Promise<ActivePlay | null> | undefined

function bootstrapExamplePlay(): Promise<ActivePlay | null> {
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
      roomSource: preloadedRoomSource(resolved.room),
      sessionId: started.state.sessionId,
      roomCache: exampleRoomCache,
      navigation: exampleNavigation,
    }
  })()
  return exampleBootstrap
}

function App() {
  const [activePlay, setActivePlay] = useState<ActivePlay | null>(null)
  const [fatalMessage, setFatalMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)

  useEffect(() => {
    const version = ++requestVersion.current
    void bootstrapExamplePlay().then((play) => {
      if (version !== requestVersion.current) return
      if (play) setActivePlay(play)
      else setFatalMessage(ROOM_UNAVAILABLE)
    })
    return () => {
      requestVersion.current += 1
    }
  }, [])

  const handlePrompt = useCallback((prompt: string) => {
    const version = ++requestVersion.current
    setActivePlay(null)
    setFatalMessage(null)
    setNotice(null)
    logger.info('prompt submitted', { promptLength: prompt.length })

    void (async () => {
      const prepared = await prepareGeneratedRoomSeed(prompt, worldBibleSeeder, logger)
      if (version !== requestVersion.current) return
      const source = new GeneratedRoomSource(
        generator,
        prepared.generatorSeed,
        logger,
        fallbackRoom,
      )
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
      setActivePlay({
        roomSource: preloadedRoomSource(result.room),
        sessionId: started.state.sessionId,
        roomCache: generatedCache,
        ...(prepared.worldBible ? { worldBible: prepared.worldBible } : {}),
      })
      // A repaired or fallback room couldn't be built exactly as asked — show the
      // static, prompt-free notice. A clean `generated` room shows nothing.
      if (shouldShowFallbackNotice(result.provenance)) setNotice(FALLBACK_NOTICE)
    })().catch(() => {
      if (version !== requestVersion.current) return
      logger.error('generated room source threw', { code: 'room-source-failed' })
      setFatalMessage(ROOM_UNAVAILABLE)
    })
  }, [])

  const handleNavigate = useCallback(async (toRoomId: string): Promise<NavigationResult> => {
    if (!activePlay?.navigation) return { status: 'rejected', reason: 'missing-exit' }
    const result = await activePlay.navigation.navigate({
      sessionId: activePlay.sessionId,
      toRoomId,
    })
    if (result.status === 'navigated') {
      setActivePlay((current) => current?.sessionId === activePlay.sessionId
        ? {
            roomSource: preloadedRoomSource(result.room),
            sessionId: activePlay.sessionId,
            roomCache: activePlay.roomCache,
            navigation: activePlay.navigation,
          }
        : current)
      // Warm the next frontier from the room we just entered.
      adjacentPregenerator.warmAdjacent(result.room)
    }
    return result
  }, [activePlay])

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
        />
      ) : (
        <div className="room-viewer-root">
          {fatalMessage && <div className="room-message" role="alert">{fatalMessage}</div>}
        </div>
      )}
      {notice && (
        <div className="room-notice" role="status">
          <span className="room-notice-text">{notice}</span>
          <button
            type="button"
            className="room-notice-close"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}
      <PromptBar onSubmit={handlePrompt} />
    </ErrorBoundary>
  )
}

export default App
