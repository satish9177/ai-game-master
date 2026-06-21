import { useEffect, useRef } from 'react'
import { Engine } from './engine/Engine'
import { loadRoomSpec } from '../roomspec/schema'
import { throneRoom } from '../roomspec/examples/throneRoom'

/**
 * Hosts the Three.js engine. The engine creates and owns the canvas inside
 * this container; the effect initializes once and disposes fully on cleanup,
 * which keeps it safe under React StrictMode's dev double-mount.
 */
export function RoomViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const engine = new Engine(container)
    engineRef.current = engine
    engine.setRoom(loadRoomSpec(throneRoom))

    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="room-viewer" />
}
