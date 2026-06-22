import { useCallback, useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import type { Interactable } from '../domain/ports/interaction'
import type { RoomSource } from '../domain/ports/RoomSource'
import { Hud } from './ui/Hud'
import { DialoguePanel } from './ui/DialoguePanel'
import { createConsoleLogger } from '../platform/logger/consoleLogger'
import { isWebGL2Available } from '../platform/browser/webglSupport'
import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import type { InteractionService } from '../interactions/InteractionService'
import type { EncounterService } from '../encounters/EncounterService'
import type { NavigationResult } from '../app/NavigationService'
import {
  buildInteractionEffectLookup,
  interactionResultMessage,
} from '../app/interactionEffects'
import type { InteractionEffectLookup } from '../app/interactionEffects'
import { buildEncounterLookup, encounterResultMessage } from '../app/encounters'
import type { EncounterLookup } from '../app/encounters'
import { buildExitLookup, navigationResultMessage } from '../app/exits'
import type { ExitLookup } from '../app/exits'

const ROOM_UNAVAILABLE = 'This room could not be loaded.'
const WEBGL2_UNAVAILABLE =
  'This app needs WebGL2, which is not available in this browser or device.'

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type RoomViewerProps = {
  roomSource: RoomSource
  sessionId: string
  interactionService: InteractionService
  encounterService: EncounterService
  onNavigate: (toRoomId: string) => Promise<NavigationResult>
}

export function RoomViewer({
  roomSource,
  sessionId,
  interactionService,
  encounterService,
  onNavigate,
}: RoomViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const effectLookupRef = useRef<InteractionEffectLookup>(new Map())
  const encounterLookupRef = useRef<EncounterLookup>(new Map())
  const exitLookupRef = useRef<ExitLookup>(new Map())
  const activeEncounterRef = useRef<{ encounter: EncounterSpec; ref: string | undefined } | null>(
    null,
  )
  const [active, setActive] = useState<Interactable | null>(null)
  const [dialogue, setDialogue] = useState<Interactable | null>(null)
  const [resultMessage, setResultMessage] = useState<string | undefined>()
  const [navigationMessage, setNavigationMessage] = useState<string | undefined>()
  const [choices, setChoices] = useState<{ id: string; label: string }[] | undefined>()
  const [webgl2Available] = useState(isWebGL2Available)
  const [fatalMessage, setFatalMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const logger = createConsoleLogger()
    if (!webgl2Available) {
      logger.error('webgl2 unavailable')
      return
    }

    let engine: Engine
    try {
      engine = new Engine(container, logger)
    } catch (err) {
      logger.error('engine construction failed', { error: describeError(err) })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFatalMessage(ROOM_UNAVAILABLE)
      return
    }

    engineRef.current = engine
    let cancelled = false
    engine.onActiveInteractionChange = (target) => {
      setActive(target)
      setNavigationMessage(undefined)
    }
    engine.onRequestOpenInteraction = (target) => {
      setResultMessage(undefined)
      setNavigationMessage(undefined)

      // Composition precedence is exit, then encounter, then effect.
      const exitTarget = target.id ? exitLookupRef.current.get(target.id) : undefined
      if (exitTarget) {
        engine.setInteractionLock(true)
        activeEncounterRef.current = null
        setDialogue(null)
        setChoices(undefined)
        void onNavigate(exitTarget.toRoomId).then((result) => {
          if (cancelled) return
          const message = navigationResultMessage(result)
          if (message) {
            engine.setInteractionLock(false)
            setNavigationMessage(message)
          }
        }).catch(() => {
          if (cancelled) return
          engine.setInteractionLock(false)
          logger.error('navigation threw', { code: 'navigation-failed' })
          setNavigationMessage('This room could not be entered.')
        })
        return
      }

      engine.setInteractionLock(true)
      const encounterTarget = encounterLookupRef.current.get(target.id)
      if (encounterTarget) {
        const encounter = encounterTarget.encounter
        activeEncounterRef.current = {
          encounter,
          ref: encounterTarget.ref ?? target.id,
        }
        setDialogue({
          ...target,
          title: encounter.title ?? target.title,
          body: encounter.description,
        })
        setChoices(encounter.choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
        })))
        return
      }

      activeEncounterRef.current = null
      setChoices(undefined)
      setDialogue(target)
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

    void roomSource.getRoom().then((result) => {
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
      exitLookupRef.current = buildExitLookup(result.room)
      encounterLookupRef.current = buildEncounterLookup(result.room)
      effectLookupRef.current = buildInteractionEffectLookup(result.room)
      try {
        engine.setRoom(result.room)
      } catch (err) {
        logger.error('engine.setRoom failed', { error: describeError(err) })
        engine.dispose()
        engineRef.current = null
        setFatalMessage(ROOM_UNAVAILABLE)
      }
    }).catch((err: unknown) => {
      if (cancelled) return
      logger.error('room source threw', { error: describeError(err) })
      setFatalMessage(ROOM_UNAVAILABLE)
    })

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
      effectLookupRef.current = new Map()
      encounterLookupRef.current = new Map()
      exitLookupRef.current = new Map()
      activeEncounterRef.current = null
      setActive(null)
      setDialogue(null)
      setResultMessage(undefined)
      setNavigationMessage(undefined)
      setChoices(undefined)
      setFatalMessage(null)
    }
  }, [
    encounterService,
    interactionService,
    onNavigate,
    roomSource,
    sessionId,
    webgl2Available,
  ])

  const handleChoose = useCallback(
    (choiceId: string) => {
      const current = activeEncounterRef.current
      if (!current) return
      setChoices(undefined)
      const chosen = current.encounter.choices.find((choice) => choice.id === choiceId)
      void encounterService.resolve({
        sessionId,
        encounter: current.encounter,
        choiceId,
        ref: current.ref,
      }).then((result) => {
        if (activeEncounterRef.current !== current) return
        const authored = result.status === 'applied' ? chosen?.outcome.resultText : undefined
        setResultMessage(authored ?? encounterResultMessage(result))
      }).catch(() => {
        if (activeEncounterRef.current !== current) return
        createConsoleLogger().error('encounter resolution threw', { code: 'encounter-failed' })
        setResultMessage('This encounter is unavailable.')
      })
    },
    [encounterService, sessionId],
  )

  const closeDialogue = useCallback(() => {
    engineRef.current?.setInteractionLock(false)
    activeEncounterRef.current = null
    setDialogue(null)
    setResultMessage(undefined)
    setChoices(undefined)
  }, [])

  const fallback = !webgl2Available ? WEBGL2_UNAVAILABLE : fatalMessage

  return (
    <div className="room-viewer-root">
      <div ref={containerRef} className="room-viewer" />
      {fallback && (
        <div className="room-message" role="alert">
          {fallback}
        </div>
      )}
      {!fallback && !dialogue && navigationMessage && (
        <div className="hud" role="status">{navigationMessage}</div>
      )}
      {!fallback && !dialogue && !navigationMessage && <Hud active={active} />}
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
