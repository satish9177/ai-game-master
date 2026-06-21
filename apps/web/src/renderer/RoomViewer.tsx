import { useEffect, useRef } from 'react'
import { loadRoomSpec } from '../roomspec/schema'
import { throneRoom } from '../roomspec/examples/throneRoom'

/**
 * Bare canvas host for the 3D room. The Three.js engine (scene, camera,
 * render loop, RoomSpec rendering) is wired up in later commits; for now this
 * only mounts the canvas element the renderer will eventually own.
 */
export function RoomViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // TEMP (commit 2): verify the RoomSpec loads and validates. Removed once the
  // engine consumes the loaded room directly.
  useEffect(() => {
    const room = loadRoomSpec(throneRoom)
    console.log('[RoomViewer] loaded room:', room)
    console.log(`[RoomViewer] warnings: ${room.warnings.length}`, room.warnings)
  }, [])

  return <canvas ref={canvasRef} className="room-viewer" />
}
