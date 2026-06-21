import { useRef } from 'react'

/**
 * Bare canvas host for the 3D room. The Three.js engine (scene, camera,
 * render loop, RoomSpec rendering) is wired up in later commits; for now this
 * only mounts the canvas element the renderer will eventually own.
 */
export function RoomViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  return <canvas ref={canvasRef} className="room-viewer" />
}
