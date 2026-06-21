import { useCallback, useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import type { Interactable } from '../domain/ports/interaction'
import type { RoomSource, RoomLoadError } from '../domain/ports/RoomSource'
import { Hud } from './ui/Hud'
import { DialoguePanel } from './ui/DialoguePanel'
import { createConsoleLogger } from '../platform/logger/consoleLogger'

/**
 * Hosts the Three.js engine and the React UI overlay. The engine owns the
 * canvas inside `.room-viewer`; the HUD and dialogue panel are siblings layered
 * on top. The effect initializes once and disposes fully on cleanup, keeping it
 * safe under React StrictMode's dev double-mount.
 *
 * The room arrives through an injected `RoomSource` (the async, result-typed
 * seam), so this host is identical whether the room is static, generated, or
 * fetched. The engine is built synchronously (one canvas, no async gap there);
 * only the room contents arrive when the source resolves.
 */
export function RoomViewer({ roomSource }: { roomSource: RoomSource }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [active, setActive] = useState<Interactable | null>(null)
  const [dialogue, setDialogue] = useState<Interactable | null>(null)
  const [loadError, setLoadError] = useState<RoomLoadError | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const logger = createConsoleLogger()
    const engine = new Engine(container, logger)
    engineRef.current = engine
    engine.onActiveInteractionChange = setActive
    engine.onRequestOpenInteraction = (target) => {
      engine.setInteractionLock(true) // freeze movement/look while open
      setDialogue(target)
    }

    // Async seam: the source resolves to a typed result. Guard against a resolve
    // landing after StrictMode's dev unmount (or any remount) disposed engine.
    let cancelled = false
    void roomSource.getRoom().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        logger.error('room load failed', { code: result.error.code })
        setLoadError(result.error)
        return
      }
      if (result.room.warnings.length > 0) {
        logger.warn('room loaded with skipped objects', {
          count: result.room.warnings.length,
        })
      }
      engine.setRoom(result.room)
    })

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
      setActive(null)
      setDialogue(null)
      setLoadError(null)
    }
  }, [roomSource])

  const closeDialogue = useCallback(() => {
    engineRef.current?.setInteractionLock(false) // resume movement/look
    setDialogue(null)
  }, [])

  return (
    <div className="room-viewer-root">
      <div ref={containerRef} className="room-viewer" />
      {/* A failed load shows a calm fallback instead of the overlays (FAILURE-MODES case 1). */}
      {loadError && (
        <div className="room-message" role="alert">
          {loadError.message}
        </div>
      )}
      {/* Hide the prompt while the panel is open. */}
      {!loadError && !dialogue && <Hud active={active} />}
      {!loadError && dialogue && (
        <DialoguePanel target={dialogue} onClose={closeDialogue} />
      )}
    </div>
  )
}
