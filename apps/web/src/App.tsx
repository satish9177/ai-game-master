import { useCallback, useState } from 'react'
import { RoomViewer } from './renderer/RoomViewer'
import type { RoomSource } from './domain/ports/RoomSource'
import { StaticRoomSource } from './room/StaticRoomSource'
import { GeneratedRoomSource } from './room/GeneratedRoomSource'
import { FakeRoomGenerator } from './generation/FakeRoomGenerator'
import { ErrorBoundary } from './app/ErrorBoundary'
import { PromptBar } from './app/PromptBar'
import { createConsoleLogger } from './platform/logger/consoleLogger'

// Composition root: the one place concrete implementations are chosen and wired.
// Constructed once at module scope so their identity is stable across renders.
// The boundary's logger is injected here, the one place wiring lives. The
// deterministic fake generator stands in for a real LLM client later — swapping
// it is a one-line change here, and nothing downstream moves.
const logger = createConsoleLogger()
const generator = new FakeRoomGenerator()

// First paint shows the existing static throne room. Its identity is stable so
// the host doesn't reload it on re-render; a prompt submission swaps it out.
const initialRoomSource = new StaticRoomSource()

function App() {
  // The active room source is state. Submitting a prompt swaps in a new
  // GeneratedRoomSource; its new identity is what makes the host (RoomViewer)
  // re-run getRoom() and rebuild the scene. RoomViewer stays unaware of prompts
  // and generation — it only ever sees a RoomSource.
  const [roomSource, setRoomSource] = useState<RoomSource>(initialRoomSource)

  const handlePrompt = useCallback((prompt: string) => {
    // Log the length only — never the prompt text (it is user content; ADR-0003).
    logger.info('prompt submitted', { promptLength: prompt.length })
    // A fresh instance each submit: even the same prompt re-triggers a load, and
    // the generator is deterministic, so the same prompt yields the same room.
    setRoomSource(new GeneratedRoomSource(generator, prompt, logger))
  }, [])

  return (
    // The boundary is the backstop for unexpected render errors; the host handles
    // expected failures (WebGL/room-load) inline with a matching safe fallback.
    <ErrorBoundary logger={logger}>
      <RoomViewer roomSource={roomSource} />
      <PromptBar onSubmit={handlePrompt} />
    </ErrorBoundary>
  )
}

export default App
