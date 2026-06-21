import { RoomViewer } from './renderer/RoomViewer'
import { StaticRoomSource } from './room/StaticRoomSource'

// Composition root: pick the concrete room source and inject it. Constructed
// once at module scope so its identity is stable across renders (the host's
// effect depends on it). Swapping in a generated/fetched source later is a
// one-line change here — the host code does not move.
const roomSource = new StaticRoomSource()

function App() {
  return <RoomViewer roomSource={roomSource} />
}

export default App
