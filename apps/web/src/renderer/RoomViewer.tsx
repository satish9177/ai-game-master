import { useCallback, useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import type { Interactable } from './engine/Engine'
import { loadRoomSpec } from '../roomspec/schema'
import { throneRoom } from '../roomspec/examples/throneRoom'
import { Hud } from './ui/Hud'
import { DialoguePanel } from './ui/DialoguePanel'

/**
 * Hosts the Three.js engine and the React UI overlay. The engine owns the
 * canvas inside `.room-viewer`; the HUD and dialogue panel are siblings layered
 * on top. The effect initializes once and disposes fully on cleanup, keeping it
 * safe under React StrictMode's dev double-mount.
 */
export function RoomViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [active, setActive] = useState<Interactable | null>(null)
  const [dialogue, setDialogue] = useState<Interactable | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const engine = new Engine(container)
    engineRef.current = engine
    engine.onActiveInteractionChange = setActive
    engine.onRequestOpenInteraction = (target) => {
      engine.setInteractionLock(true) // freeze movement/look while open
      setDialogue(target)
    }
    engine.setRoom(loadRoomSpec(throneRoom))

    return () => {
      engine.dispose()
      engineRef.current = null
      setActive(null)
      setDialogue(null)
    }
  }, [])

  const closeDialogue = useCallback(() => {
    engineRef.current?.setInteractionLock(false) // resume movement/look
    setDialogue(null)
  }, [])

  return (
    <div className="room-viewer-root">
      <div ref={containerRef} className="room-viewer" />
      {/* Hide the prompt while the panel is open. */}
      {!dialogue && <Hud active={active} />}
      {dialogue && <DialoguePanel target={dialogue} onClose={closeDialogue} />}
    </div>
  )
}
