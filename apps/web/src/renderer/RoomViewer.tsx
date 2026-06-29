import { useCallback, useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import type { Interactable } from '../domain/ports/interaction'
import type { RoomSource } from '../domain/ports/RoomSource'
import { Hud } from './ui/Hud'
import { DialoguePanel } from './ui/DialoguePanel'
import { NPCDialoguePanel } from './ui/NPCDialoguePanel'
import { createConsoleLogger } from '../platform/logger/consoleLogger'
import { isWebGL2Available } from '../platform/browser/webglSupport'
import { buildRoomDialogueContext } from '../domain/dialogue/buildRoomDialogueContext'
import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import type { NPCDialogueTurn, QuestDialogueContext, RoomDialogueContext } from '../domain/dialogue/contracts'
import type { InteractionService } from '../interactions/InteractionService'
import type { EncounterService } from '../encounters/EncounterService'
import type { NPCDialogueService } from '../dialogue/NPCDialogueService'
import type { NavigationResult } from '../app/NavigationService'
import type { WorldState } from '../domain/world/worldState'
import { authoredPostUseInteractionBody } from '../app/authoredInteractionBody'
import { buildNPCDialogueReplyInput } from '../app/npcDialogueReplyInput'
import {
  buildInteractionEffectLookup,
  interactionResultMessage,
} from '../app/interactionEffects'
import type { InteractionEffectLookup } from '../app/interactionEffects'
import { buildEncounterLookup, encounterResultMessage } from '../app/encounters'
import type { EncounterLookup } from '../app/encounters'
import { buildExitLookup, navigationResultMessage } from '../app/exits'
import type { ExitLookup } from '../app/exits'
import { buildDialogueLookup, dialogueResultMessage } from '../app/dialogue'
import type { NPCDialogueLookup, NPCDialogueTarget } from '../app/dialogue'

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
  npcDialogueService: NPCDialogueService
  onNavigate: (toRoomId: string) => Promise<NavigationResult>
  onWorldStateChange?: (state: WorldState) => void
  questStage?: QuestDialogueContext
  resolvedObjectIds?: ReadonlySet<string>
}

export function RoomViewer({
  roomSource,
  sessionId,
  interactionService,
  encounterService,
  npcDialogueService,
  onNavigate,
  onWorldStateChange,
  questStage,
  resolvedObjectIds,
}: RoomViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const effectLookupRef = useRef<InteractionEffectLookup>(new Map())
  const encounterLookupRef = useRef<EncounterLookup>(new Map())
  const exitLookupRef = useRef<ExitLookup>(new Map())
  const npcDialogueLookupRef = useRef<NPCDialogueLookup>(new Map())
  const roomDialogueContextRef = useRef<RoomDialogueContext | undefined>(undefined)
  // Keep current quest stage readable by the engine's keydown-driven open/say
  // callbacks without re-creating the engine on each quest change.
  const questStageRef = useRef<QuestDialogueContext | undefined>(undefined)
  useEffect(() => {
    questStageRef.current = questStage
  }, [questStage])
  const activeEncounterRef = useRef<{ encounter: EncounterSpec; ref: string | undefined } | null>(
    null,
  )
  const activeNPCDialogueRef = useRef<NPCDialogueTarget | null>(null)
  const npcDialogueRequestRef = useRef(0)
  const npcDialoguePendingRef = useRef(false)
  const [active, setActive] = useState<Interactable | null>(null)
  const [dialogue, setDialogue] = useState<Interactable | null>(null)
  const [resultMessage, setResultMessage] = useState<string | undefined>()
  const [navigationMessage, setNavigationMessage] = useState<string | undefined>()
  const [npcDialogueTarget, setNPCDialogueTarget] = useState<NPCDialogueTarget | null>(null)
  const [npcDialogueTurns, setNPCDialogueTurns] = useState<NPCDialogueTurn[]>([])
  const [npcDialogueMessage, setNPCDialogueMessage] = useState<string | undefined>()
  const [npcDialoguePending, setNPCDialoguePending] = useState(false)
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

    const resetNPCDialogue = () => {
      npcDialogueRequestRef.current += 1
      npcDialoguePendingRef.current = false
      activeNPCDialogueRef.current = null
      setNPCDialogueTarget(null)
      setNPCDialogueTurns([])
      setNPCDialogueMessage(undefined)
      setNPCDialoguePending(false)
    }

    engine.onActiveInteractionChange = (target) => {
      setActive(target)
      setNavigationMessage(undefined)
    }

    engine.onRequestOpenInteraction = (target) => {
      setResultMessage(undefined)
      setNavigationMessage(undefined)
      resetNPCDialogue()

      // Composition precedence: exit, then encounter, dialogue, then effect.
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

      const dialogueTarget = target.id
        ? npcDialogueLookupRef.current.get(target.id)
        : undefined
      if (dialogueTarget) {
        activeEncounterRef.current = null
        setDialogue(null)
        setChoices(undefined)
        activeNPCDialogueRef.current = dialogueTarget
        setNPCDialogueTarget(dialogueTarget)
        const seed: NPCDialogueTurn[] = dialogueTarget.dialogue.greeting
          ? [{ speaker: 'npc', text: dialogueTarget.dialogue.greeting }]
          : []
        setNPCDialogueTurns(seed)
        npcDialoguePendingRef.current = true
        setNPCDialoguePending(true)
        const requestId = npcDialogueRequestRef.current

        void npcDialogueService.reply(buildNPCDialogueReplyInput({
          sessionId,
          target: dialogueTarget,
          history: [],
          playerLine: undefined,
          roomContext: roomDialogueContextRef.current,
          questStage: questStageRef.current,
        })).then((result) => {
          if (cancelled || npcDialogueRequestRef.current !== requestId) return
          npcDialoguePendingRef.current = false
          setNPCDialoguePending(false)
          if (result.status === 'replied') {
            setNPCDialogueTurns((current) => [...current, result.turn])
          } else {
            setNPCDialogueMessage(dialogueResultMessage(result))
          }
        }).catch(() => {
          if (cancelled || npcDialogueRequestRef.current !== requestId) return
          npcDialoguePendingRef.current = false
          setNPCDialoguePending(false)
          logger.error('npc dialogue resolution threw', { code: 'dialogue-failed' })
          setNPCDialogueMessage('They have nothing to say right now.')
        })
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
        if (result.status === 'applied' || result.status === 'already-resolved') {
          onWorldStateChange?.(result.state)
        }
        if (result.status === 'already-resolved') {
          const body = authoredPostUseInteractionBody({ objectId: target.id, state: result.state })
          if (body) setDialogue({ ...target, body })
        }
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
      npcDialogueLookupRef.current = buildDialogueLookup(result.room)
      roomDialogueContextRef.current = buildRoomDialogueContext(result.room)
      effectLookupRef.current = buildInteractionEffectLookup(result.room)
      try {
        if (resolvedObjectIds !== undefined) {
          engine.setRoom(result.room, { resolvedObjectIds })
        } else {
          engine.setRoom(result.room)
        }
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
      npcDialogueLookupRef.current = new Map()
      roomDialogueContextRef.current = undefined
      activeEncounterRef.current = null
      activeNPCDialogueRef.current = null
      npcDialogueRequestRef.current += 1
      npcDialoguePendingRef.current = false
      setActive(null)
      setDialogue(null)
      setResultMessage(undefined)
      setNavigationMessage(undefined)
      setNPCDialogueTarget(null)
      setNPCDialogueTurns([])
      setNPCDialogueMessage(undefined)
      setNPCDialoguePending(false)
      setChoices(undefined)
      setFatalMessage(null)
    }
  }, [
    encounterService,
    interactionService,
    npcDialogueService,
    onNavigate,
    onWorldStateChange,
    resolvedObjectIds,
    roomSource,
    sessionId,
    webgl2Available,
  ])

  const handleNPCSay = useCallback(
    (promptId: string | undefined) => {
      const target = activeNPCDialogueRef.current
      if (!target || npcDialoguePendingRef.current) return
      const prompt = promptId
        ? target.dialogue.prompts?.find((candidate) => candidate.id === promptId)
        : undefined
      if (promptId && !prompt) return

      const playerTurn: NPCDialogueTurn | undefined = prompt
        ? { speaker: 'player', text: prompt.label }
        : undefined
      const history = playerTurn
        ? [...npcDialogueTurns, playerTurn]
        : [...npcDialogueTurns]
      setNPCDialogueTurns(history)
      setNPCDialogueMessage(undefined)
      npcDialoguePendingRef.current = true
      setNPCDialoguePending(true)
      const requestId = npcDialogueRequestRef.current

      void npcDialogueService.reply(buildNPCDialogueReplyInput({
        sessionId,
        target,
        history,
        playerLine: prompt?.id,
        roomContext: roomDialogueContextRef.current,
        questStage: questStageRef.current,
      })).then((result) => {
        if (
          activeNPCDialogueRef.current !== target
          || npcDialogueRequestRef.current !== requestId
        ) return
        npcDialoguePendingRef.current = false
        setNPCDialoguePending(false)
        if (result.status === 'replied') {
          setNPCDialogueTurns((current) => [...current, result.turn])
        } else {
          setNPCDialogueMessage(dialogueResultMessage(result))
        }
      }).catch(() => {
        if (
          activeNPCDialogueRef.current !== target
          || npcDialogueRequestRef.current !== requestId
        ) return
        npcDialoguePendingRef.current = false
        setNPCDialoguePending(false)
        createConsoleLogger().error('npc dialogue resolution threw', {
          code: 'dialogue-failed',
        })
        setNPCDialogueMessage('They have nothing to say right now.')
      })
    },
    [npcDialogueService, npcDialogueTurns, sessionId],
  )

  const closeNPCDialogue = useCallback(() => {
    engineRef.current?.setInteractionLock(false)
    npcDialogueRequestRef.current += 1
    npcDialoguePendingRef.current = false
    activeNPCDialogueRef.current = null
    setNPCDialogueTarget(null)
    setNPCDialogueTurns([])
    setNPCDialogueMessage(undefined)
    setNPCDialoguePending(false)
  }, [])

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
        if (result.status === 'applied' || result.status === 'already-resolved') {
          onWorldStateChange?.(result.state)
        }
        const authored = result.status === 'applied' ? chosen?.outcome.resultText : undefined
        setResultMessage(authored ?? encounterResultMessage(result))
      }).catch(() => {
        if (activeEncounterRef.current !== current) return
        createConsoleLogger().error('encounter resolution threw', { code: 'encounter-failed' })
        setResultMessage('This encounter is unavailable.')
      })
    },
    [encounterService, onWorldStateChange, sessionId],
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
      {!fallback && !dialogue && !npcDialogueTarget && navigationMessage && (
        <div className="hud" role="status">{navigationMessage}</div>
      )}
      {!fallback && !dialogue && !npcDialogueTarget && !navigationMessage && (
        <Hud active={active} />
      )}
      {!fallback && npcDialogueTarget && (
        <NPCDialoguePanel
          npcName={npcDialogueTarget.npcName}
          turns={npcDialogueTurns}
          prompts={npcDialogueTarget.dialogue.prompts}
          message={npcDialogueMessage}
          busy={npcDialoguePending}
          onSay={handleNPCSay}
          onClose={closeNPCDialogue}
        />
      )}
      {!fallback && !npcDialogueTarget && dialogue && (
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
