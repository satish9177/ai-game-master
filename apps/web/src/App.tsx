import { RoomViewer } from './renderer/RoomViewer'
import { StaticRoomSource } from './room/StaticRoomSource'
import { ErrorBoundary } from './app/ErrorBoundary'
import { createConsoleLogger } from './platform/logger/consoleLogger'

// Composition root: pick the concrete room source and inject it. Constructed
// once at module scope so its identity is stable across renders (the host's
// effect depends on it). Swapping in a generated/fetched source later is a
// one-line change here — the host code does not move.
const roomSource = new StaticRoomSource()

// The boundary's logger is injected here, the one place wiring lives.
const logger = createConsoleLogger()

function App() {
  // The boundary is the backstop for unexpected render errors; the host handles
  // expected failures (WebGL/room-load) inline with a matching safe fallback.
  return (
    <ErrorBoundary logger={logger}>
      <RoomViewer roomSource={roomSource} />
    </ErrorBoundary>
  )
}

export default App
