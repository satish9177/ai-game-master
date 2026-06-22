import { useCallback, useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import type { Interactable } from '../domain/ports/interaction'
import type { RoomSource } from '../domain/ports/RoomSource'
import { Hud } from './ui/Hud'
import { DialoguePanel } from './ui/DialoguePanel'
import { createConsoleLogger } from '../platform/logger/consoleLogger'
import { isWebGL2Available } from '../platform/browser/webglSupport'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import type { WorldStateResult } from '../world-session/WorldSession'
import type { InteractionService } from '../interactions/InteractionService'
import type { EncounterService } from '../encounters/EncounterService'
import {
  buildInteractionEffectLookup,
  interactionResultMessage,
} from '../app/interactionEffects'
import type { InteractionEffectLookup } from '../app/interactionEffects'
import { buildEncounterLookup, encounterResultMessage } from '../app/encounters'
import type { EncounterLookup } from '../app/encounters'

/** Safe, user-facing copy for a host failure — detail goes to the log, not here. */
const ROOM_UNAVAILABLE = 'This room could not be loaded.'
const WEBGL2_UNAVAILABLE =
  'This app needs WebGL2, which isn’t available in this browser or device.'

/** Extract a log-safe summary of an unknown thrown value. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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
type RoomViewerProps = {
  roomSource: RoomSource
  interactionService: InteractionService
  encounterService: EncounterService
  startRoomSession: (room: LoadedRoom) => Promise<WorldStateResult>
}

export function RoomViewer({
  roomSource,
  interactionService,
  encounterService,
  startRoomSession,
}: RoomViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const effectLookupRef = useRef<InteractionEffectLookup>(new Map())
  const encounterLookupRef = useRef<EncounterLookup>(new Map())
  // The encounter currently presented in the panel (if any), so a chosen choice
  // resolves against the right threat. Cleared on close/dispose; its identity
  // also guards against a resolution landing after a remount.
  const activeEncounterRef = useRef<{ encounter: EncounterSpec; ref: string | undefined } | null>(
    null,
  )
  const [active, setActive] = useState<Interactable | null>(null)
  const [dialogue, setDialogue] = useState<Interactable | null>(null)
  const [resultMessage, setResultMessage] = useState<string | undefined>()
  const [choices, setChoices] = useState<{ id: string; label: string }[] | undefined>()
  // FAILURE-MODES case 3: probe WebGL2 once as render-derived state (the check is
  // pure) so we never construct an engine that can't get a context, and never
  // call setState synchronously in the effect for it.
  const [webgl2Available] = useState(isWebGL2Available)
  // Async/exceptional safe-fallback message: an engine/render throw or a typed
  // room-load failure. Null = no such failure. Drives the `.room-message` screen.
  const [fatalMessage, setFatalMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const logger = createConsoleLogger()

    // No WebGL2 context: skip engine construction; the render shows the fallback.
    if (!webgl2Available) {
      logger.error('webgl2 unavailable')
      return
    }

    // Engine construction can throw unexpectedly (WebGL lost between the probe
    // and now, GPU OOM, …). Handle it here at the host boundary: log the detail
    // and set the same safe `.room-message` fallback — don't rethrow to the
    // ErrorBoundary (that's reserved for unexpected React render/lifecycle bugs).
    let engine: Engine
    try {
      engine = new Engine(container, logger)
    } catch (err) {
      logger.error('engine construction failed', { error: describeError(err) })
      // Imperative host-boundary failure state. This is the one place we must
      // setState synchronously in the effect — it only runs on a fatal init
      // error, so the single cascading render it triggers is intended.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFatalMessage(ROOM_UNAVAILABLE)
      return
    }

    engineRef.current = engine
    let cancelled = false
    engine.onActiveInteractionChange = setActive
    engine.onRequestOpenInteraction = (target) => {
      engine.setInteractionLock(true) // freeze movement/look while open
      setResultMessage(undefined)
      const sessionId = sessionIdRef.current

      // Encounter wins over any effect (ADR-0015 decision 3): present the threat
      // and its choices. Nothing is applied until the player picks one.
      const encounterTarget = encounterLookupRef.current.get(target.id)
      if (encounterTarget) {
        const enc = encounterTarget.encounter
        activeEncounterRef.current = { encounter: enc, ref: encounterTarget.ref ?? target.id }
        // The threat description rides through the neutral `body` view-model
        // field; the engine never learns about encounters.
        setDialogue({ ...target, title: enc.title ?? target.title, body: enc.description })
        if (!sessionId) {
          setChoices(undefined)
          setResultMessage('This interaction is unavailable.')
          return
        }
        setChoices(enc.choices.map((choice) => ({ id: choice.id, label: choice.label })))
        return
      }

      // No encounter: today's single-press effect path.
      activeEncounterRef.current = null
      setChoices(undefined)
      setDialogue(target)
      if (!sessionId) {
        setResultMessage('This interaction is unavailable.')
        return
      }
      const effectTarget = effectLookupRef.current.get(target.id)
      void interactionService.resolve({
        sessionId,
        effect: effectTarget?.effect,
        ref: effectTarget?.ref ?? target.id,
      }).then((result) => {
        if (cancelled) return
        setResultMessage(interactionResultMessage(result))
      }).catch(() => {
        if (cancelled) return
        logger.error('interaction resolution threw', { code: 'interaction-failed' })
        setResultMessage('This interaction is unavailable.')
      })
    }

    // Async seam: the source resolves to a typed result. Guard against a resolve
    // landing after StrictMode's dev unmount (or any remount) disposed engine.
    void roomSource
      .getRoom()
      .then(async (result) => {
        if (cancelled) return
        if (!result.ok) {
          logger.error('room load failed', { code: result.error.code })
          setFatalMessage(result.error.message)
          return
        }
        if (result.room.warnings.length > 0) {
          logger.warn('room loaded with skipped objects', {
            count: result.room.warnings.length,
          })
        }
        const session = await startRoomSession(result.room)
        if (cancelled) return
        if (!session.ok) {
          logger.error('world session start failed', { code: session.error.code })
          setFatalMessage(ROOM_UNAVAILABLE)
          return
        }
        sessionIdRef.current = session.state.sessionId
        effectLookupRef.current = buildInteractionEffectLookup(result.room)
        encounterLookupRef.current = buildEncounterLookup(result.room)
        // Building the scene can throw unexpectedly; fail safe and dispose.
        try {
          engine.setRoom(result.room)
        } catch (err) {
          logger.error('engine.setRoom failed', { error: describeError(err) })
          engine.dispose()
          engineRef.current = null
          setFatalMessage(ROOM_UNAVAILABLE)
        }
      })
      .catch((err: unknown) => {
        // The contract is to resolve a typed result, not reject — this is a bug
        // in the source. Treat it as an unexpected host failure.
        if (cancelled) return
        logger.error('room source threw', { error: describeError(err) })
        setFatalMessage(ROOM_UNAVAILABLE)
      })

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
      sessionIdRef.current = null
      effectLookupRef.current = new Map()
      encounterLookupRef.current = new Map()
      activeEncounterRef.current = null
      setActive(null)
      setDialogue(null)
      setResultMessage(undefined)
      setChoices(undefined)
      setFatalMessage(null)
    }
  }, [encounterService, interactionService, roomSource, startRoomSession, webgl2Available])

  // Resolve a picked encounter choice. Defined at component scope so the panel
  // can call it; guarded by the active-encounter identity so a resolution that
  // lands after a remount is ignored (mirrors the effect path's `cancelled`).
  const handleChoose = useCallback(
    (choiceId: string) => {
      const active = activeEncounterRef.current
      const sessionId = sessionIdRef.current
      if (!active || !sessionId) return
      setChoices(undefined) // one resolution per open: hide the buttons
      const chosen = active.encounter.choices.find((choice) => choice.id === choiceId)
      void encounterService
        .resolve({ sessionId, encounter: active.encounter, choiceId, ref: active.ref })
        .then((result) => {
          if (activeEncounterRef.current !== active) return
          // Prefer the choice's authored result text (display only, never
          // logged); fall back to the generic typed-result message.
          const authored = result.status === 'applied' ? chosen?.outcome.resultText : undefined
          setResultMessage(authored ?? encounterResultMessage(result))
        })
        .catch(() => {
          if (activeEncounterRef.current !== active) return
          createConsoleLogger().error('encounter resolution threw', { code: 'encounter-failed' })
          setResultMessage('This encounter is unavailable.')
        })
    },
    [encounterService],
  )

  const closeDialogue = useCallback(() => {
    engineRef.current?.setInteractionLock(false) // resume movement/look
    activeEncounterRef.current = null
    setDialogue(null)
    setResultMessage(undefined)
    setChoices(undefined)
  }, [])

  // A single safe-fallback string from any host failure (FAILURE-MODES). Null on
  // the happy path. WebGL2 is the render-derived case; the rest arrive as state.
  const fallback = !webgl2Available ? WEBGL2_UNAVAILABLE : fatalMessage

  return (
    <div className="room-viewer-root">
      <div ref={containerRef} className="room-viewer" />
      {/* Any host failure shows a calm fallback instead of the overlays. */}
      {fallback && (
        <div className="room-message" role="alert">
          {fallback}
        </div>
      )}
      {/* Hide the prompt while the panel is open. */}
      {!fallback && !dialogue && <Hud active={active} />}
      {!fallback && dialogue && (
        <DialoguePanel
          target={dialogue}
          resultMessage={resultMessage}
          choices={choices}
          onChoose={handleChoose}
          onClose={closeDialogue}
        />
      )}
    </div>
  )
}
