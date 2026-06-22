import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomViewer } from './renderer/RoomViewer'
import type { RoomSource } from './domain/ports/RoomSource'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { RoomRegistry } from './room/RoomRegistry'
import { SessionRoomCache } from './room/SessionRoomCache'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { ErrorBoundary } from './app/ErrorBoundary'
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
import type { LoadedRoom } from './domain/loadRoomSpec'
import { FakeNPCDialogueProvider } from './dialogue/FakeNPCDialogueProvider'
import { NPCDialogueService } from './dialogue/NPCDialogueService'

// Composition root: concrete adapters are constructed once and injected.
const logger = createConsoleLogger()
const generator = new FakeRoomGenerator()
const idGenerator = new UuidGenerator()
const worldStore = new InMemoryWorldStore()
const worldSession = new WorldSession(worldStore, new SystemClock(), idGenerator, logger)
const interactionService = new InteractionService(worldSession, logger)
const encounterService = new EncounterService(worldSession, logger)
const dialogueProvider = new FakeNPCDialogueProvider()
const npcDialogueService = new NPCDialogueService(worldSession, dialogueProvider, logger)
const roomRegistry = new RoomRegistry()
const exampleRoomCache = new SessionRoomCache()
const exampleNavigation = new NavigationService(
  worldSession,
  roomRegistry,
  exampleRoomCache,
  logger,
)

const STARTING_ROOM_ID = 'throne-room'
const ROOM_UNAVAILABLE = 'This room could not be loaded.'

type ActivePlay = {
  roomSource: RoomSource
  sessionId: string
  roomCache: SessionRoomCache
  navigation?: NavigationService
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
    const resolved = await exampleNavigation.resolveRoom(STARTING_ROOM_ID)
    if (!resolved.ok) {
      logger.error('starting room resolution failed', { code: resolved.reason })
      return null
    }
    const started = await startRoomSession(resolved.room)
    if (!started.ok) {
      logger.error('world session start failed', { code: started.error.code })
      return null
    }
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
    logger.info('prompt submitted', { promptLength: prompt.length })
    const source = new GeneratedRoomSource(generator, prompt, logger)

    void source.getRoom().then(async (result) => {
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
      })
    }).catch(() => {
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
      <PromptBar onSubmit={handlePrompt} />
    </ErrorBoundary>
  )
}

export default App
