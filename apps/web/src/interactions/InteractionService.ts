import type { InteractionEffect } from '../domain/interactions/effects'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import {
  meaningfulObjectConsequenceFor,
  validateMeaningfulObjectConsequenceCatalog,
} from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { QuestSpec } from '../domain/quests/questSpec'
import {
  deriveMeaningfulObjectState,
  deriveMeaningfulObjectView,
  validatedSearchItem,
} from '../domain/objectPurpose/meaningfulObjectRuntime'
import type {
  MeaningfulObjectAction,
  MeaningfulObjectView,
} from '../domain/objectPurpose/meaningfulObjectRuntime'
import { planInteraction } from '../domain/interactions/planInteraction'
import type {
  InteractionOutcome,
  InteractionRejectionReason,
} from '../domain/interactions/planInteraction'
import type { WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import { applyCommands } from '../world-session/applyCommands'
import type { WorldSession } from '../world-session/WorldSession'

export type InteractionSession = Pick<WorldSession, 'getWorldState' | 'appendEvent'> &
  Partial<Pick<WorldSession, 'applyMeaningfulObject'>>

export type InteractionResult =
  | { status: 'applied'; outcome: InteractionOutcome; state: WorldState; events: WorldEvent[] }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' }; state: WorldState }
  | { status: 'rejected'; reason: InteractionRejectionReason }
  | { status: 'failed'; reason: 'conflict' | 'not-found' | 'partial' }

export type ResolveInteractionInput = {
  sessionId: string
  effect?: InteractionEffect
  ref: string | undefined
}

export type MeaningfulObjectInteractionResult =
  | { status: 'observed'; state: WorldState }
  | { status: 'applied'; state: WorldState; event: WorldEvent; message: string }
  | { status: 'already-resolved'; state: WorldState; action: 'read' | 'search' }
  | { status: 'rejected' }
  | { status: 'failed'; reason: 'conflict' | 'not-found' }

export type MeaningfulObjectViewResult =
  | { status: 'available'; state: WorldState; view: MeaningfulObjectView }
  | { status: 'unavailable' }
  | { status: 'failed'; reason: 'not-found' }

export type MeaningfulObjectInput = Readonly<{
  sessionId: string
  room: LoadedRoom
  generatedPlay: boolean
  objectId: string
  action: MeaningfulObjectAction
}>

export type MeaningfulObjectTrustedContext = Readonly<{
  consequenceCatalog?: MeaningfulObjectConsequenceCatalog
  questSpec?: QuestSpec
}>

export type MeaningfulObjectTrustedContextProvider = (
  roomId: string,
) => MeaningfulObjectTrustedContext | undefined

export class InteractionService {
  private readonly session: InteractionSession
  private readonly log: Logger
  private readonly getTrustedContext: MeaningfulObjectTrustedContextProvider

  constructor(
    session: InteractionSession,
    logger: Logger,
    getTrustedContext: MeaningfulObjectTrustedContextProvider = () => undefined,
  ) {
    this.session = session
    this.log = logger
    this.getTrustedContext = getTrustedContext
  }

  async resolve(input: ResolveInteractionInput): Promise<InteractionResult> {
    const { sessionId, effect, ref } = input
    if (!effect) {
      const result = { status: 'rejected', reason: 'missing-effect' } as const
      this.logResult(sessionId, result.status, 0, result.reason)
      return result
    }

    const current = await this.session.getWorldState(sessionId)
    if (!current.ok) {
      const result = { status: 'failed', reason: 'not-found' } as const
      this.logResult(sessionId, result.status, 0, result.reason, effect.kind)
      return result
    }

    const plan = planInteraction({ effect, ref, state: current.state })
    if (plan.status === 'already-resolved') {
      const result = { ...plan, state: current.state }
      this.logResult(sessionId, result.status, 0, undefined, effect.kind)
      return result
    }
    if (plan.status === 'rejected') {
      this.logResult(sessionId, plan.status, 0, plan.reason, effect.kind)
      return plan
    }

    const applied = await applyCommands(this.session, sessionId, plan.commands, current.state)
    if (!applied.ok) {
      this.logResult(sessionId, 'failed', plan.commands.length, applied.reason, effect.kind)
      return { status: 'failed', reason: applied.reason }
    }

    const result = {
      status: 'applied',
      outcome: plan.outcome,
      state: applied.state,
      events: applied.events,
    } as const
    this.logResult(sessionId, result.status, plan.commands.length, undefined, effect.kind)
    return result
  }

  async getMeaningfulObjectView(input: Omit<MeaningfulObjectInput, 'action'>): Promise<MeaningfulObjectViewResult> {
    const current = await this.session.getWorldState(input.sessionId)
    if (!current.ok) return { status: 'failed', reason: 'not-found' }
    if (current.state.currentRoomId !== input.room.id) return { status: 'unavailable' }
    const object = uniqueObject(input.room, input.objectId)
    if (object === undefined) return { status: 'unavailable' }
    const view = deriveMeaningfulObjectView({
      object,
      roomState: current.state.roomStates[input.room.id],
      generatedPlay: input.generatedPlay,
    })
    return view === undefined
      ? { status: 'unavailable' }
      : { status: 'available', state: current.state, view }
  }

  async resolveMeaningfulObject(input: MeaningfulObjectInput): Promise<MeaningfulObjectInteractionResult> {
    const current = await this.getMeaningfulObjectView(input)
    if (current.status === 'failed') return current
    if (current.status === 'unavailable') return { status: 'rejected' }
    const object = uniqueObject(input.room, input.objectId)
    if (object === undefined) return { status: 'rejected' }

    if (input.action === 'inspect') {
      return current.view.choices.some((choice) => choice.id === 'inspect')
        ? { status: 'observed', state: current.state }
        : { status: 'rejected' }
    }

    if (!current.view.choices.some((choice) => choice.id === input.action)) {
      const state = deriveMeaningfulObjectState(
        object,
        current.state.roomStates[input.room.id],
        current.view.family,
      )
      if (input.action === 'read' && state === 'read') {
        return { status: 'already-resolved', state: current.state, action: 'read' }
      }
      if (input.action === 'search' && state === 'looted') {
        return { status: 'already-resolved', state: current.state, action: 'search' }
      }
      return { status: 'rejected' }
    }

    if (this.session.applyMeaningfulObject === undefined) return { status: 'rejected' }
    const item = input.action === 'search' ? validatedSearchItem(object) : undefined
    const trusted = this.getTrustedContext(input.room.id)
    const consequenceCatalog = trusted?.consequenceCatalog === undefined
      ? undefined
      : validateMeaningfulObjectConsequenceCatalog(trusted.consequenceCatalog, {
          room: input.room,
          ...(trusted.questSpec !== undefined ? { questSpec: trusted.questSpec } : {}),
        }) ?? undefined
    const consequence = meaningfulObjectConsequenceFor(
      consequenceCatalog,
      input.objectId,
      input.action,
    )
    const applied = await this.session.applyMeaningfulObject(
      input.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: input.room.id,
        objectId: input.objectId,
        family: current.view.family,
        action: input.action,
        ...(item !== undefined ? { item } : {}),
        ...(consequence?.clueId !== undefined ? { clueId: consequence.clueId } : {}),
        ...(consequence?.objective !== undefined ? { objective: consequence.objective } : {}),
      },
      current.state.revision,
      {
        room: input.room,
        generatedPlay: input.generatedPlay,
        ...(consequenceCatalog !== undefined ? { consequenceCatalog } : {}),
        ...(trusted?.questSpec !== undefined ? { questSpec: trusted.questSpec } : {}),
      },
    )
    if (!applied.ok) {
      return applied.error.code === 'conflict'
        ? { status: 'failed', reason: 'conflict' }
        : applied.error.code === 'not-found'
          ? { status: 'failed', reason: 'not-found' }
          : { status: 'rejected' }
    }
    return {
      status: 'applied',
      state: applied.state,
      event: applied.event,
      message: meaningfulObjectAppliedMessage(input.action, consequence, applied.event),
    }
  }

  private logResult(
    sessionId: string,
    status: InteractionResult['status'],
    commandCount: number,
    reason?: InteractionRejectionReason | 'conflict' | 'not-found' | 'partial',
    effectKind?: InteractionEffect['kind'],
  ): void {
    const context = {
      sessionId,
      status,
      commandCount,
      ...(reason ? { reason } : {}),
      ...(effectKind ? { effectKind } : {}),
    }
    if (status === 'failed') this.log.warn('interaction resolution failed', context)
    else this.log.info('interaction resolved', context)
  }
}

function meaningfulObjectAppliedMessage(
  action: Exclude<MeaningfulObjectAction, 'inspect'>,
  requested: ReturnType<typeof meaningfulObjectConsequenceFor>,
  event: WorldEvent,
): string {
  const messages = [
    action === 'read' ? 'You read it.' : action === 'open' ? 'You open it.' : 'You search it.',
  ]
  const applied = event.type === 'meaningful-object-applied' ? event.payload : undefined
  if (requested?.clueId !== undefined) {
    if (requested.discoveryText !== undefined) messages.push(requested.discoveryText)
    messages.push(applied?.clueId !== undefined
      ? 'You discovered a clue.'
      : 'You already knew this clue.')
  }
  if (requested?.objective !== undefined) {
    messages.push(applied?.objective !== undefined
      ? 'You advanced an objective.'
      : 'That objective was already satisfied.')
  }
  return messages.join(' ')
}

function uniqueObject(room: LoadedRoom, objectId: string) {
  const matches = room.objects.filter((object) => object.id === objectId)
  return matches.length === 1 ? matches[0] : undefined
}
