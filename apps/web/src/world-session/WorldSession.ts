import type { Clock } from '../domain/ports/Clock'
import { z } from 'zod'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { WorldStore } from '../domain/ports/WorldStore'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import {
  isMeaningfulClueKnown,
  isMeaningfulObjectiveSatisfied,
  meaningfulObjectConsequenceFor,
  sameRequestedMeaningfulConsequences,
  validateMeaningfulObjectConsequenceCatalog,
} from '../domain/objectPurpose/meaningfulObjectConsequences'
import type {
  MeaningfulObjectConsequenceCatalog,
} from '../domain/objectPurpose/meaningfulObjectConsequences'
import {
  deriveMeaningfulObjectState,
  derivedTransition,
  meaningfulObjectFamily,
  sameInventoryItem,
  validatedSearchItem,
} from '../domain/objectPurpose/meaningfulObjectRuntime'
import { applyEvent } from '../domain/world/applyEvent'
import { WorldCommandSchema, WorldEventSchema } from '../domain/world/events'
import type { SerializedBelief, WorldCommand, WorldEvent } from '../domain/world/events'
import { CanonSeedSchema } from '../domain/world/worldState'
import type { InventoryItem, WorldState } from '../domain/world/worldState'
import { evaluateCondition } from '../domain/quests/evaluateQuest'
import type { QuestSpec } from '../domain/quests/questSpec'
import { planBeliefGatedNpcAction } from '../domain/npcBelief/planNpcAction'
import type { DefeasibleNpcActionBinding } from '../domain/npcBelief/defeasibleBindings'
import { evidencePresentationFor } from '../domain/npcBelief/defeasibleBindings'
import { deriveDefeasibleObservations } from '../domain/npcBelief/observationScopeV2'
import {
  classifyEvidencePresentations,
  evidenceHolderScopeFor,
} from '../domain/npcBelief/evidenceObservation'
import { foldConsequenceStatus } from '../domain/npcBelief/foldConsequenceStatus'
import { planDefeasibleNpcAction } from '../domain/npcBelief/planDefeasibleNpcAction'
import { planNpcActionRetraction } from '../domain/npcBelief/planNpcActionRetraction'
import type { Logger } from '../platform/logger/Logger'
import { serializeCommittedBelief } from './serializeCommittedBelief'

export type WorldSessionErrorCode =
  | 'not-found'
  | 'already-exists'
  | 'conflict'
  | 'invalid-command'
  | 'invalid-canon'

export type WorldSessionError = {
  code: WorldSessionErrorCode
  message: string
}

export type WorldStateResult =
  | { ok: true; state: WorldState }
  | { ok: false; error: WorldSessionError }

export type AppendEventResult =
  | { ok: true; state: WorldState; event: WorldEvent }
  | { ok: false; error: WorldSessionError }

export type EventLogResult =
  | { ok: true; events: WorldEvent[] }
  | { ok: false; error: WorldSessionError }

export type MeaningfulObjectContext = Readonly<{
  room: LoadedRoom
  generatedPlay: boolean
  consequenceCatalog?: MeaningfulObjectConsequenceCatalog
  questSpec?: QuestSpec
}>

export type NpcActionContext = Readonly<{ room: LoadedRoom }>
export type DefeasibleNpcActionContext = Readonly<{
  room: LoadedRoom
  binding: DefeasibleNpcActionBinding
}>

type AppliedMeaningfulConsequences = Readonly<{
  clueId?: string
  objective?: Readonly<{ questId: string; objectiveId: string; toStage: 1 }>
}>

type AppliedNpcActionProvenance = Readonly<{
  ruleId: string
  belief: SerializedBelief
  supportingEventIds: readonly string[]
}>

type AppliedNpcActionRetractionProvenance = Readonly<{
  ruleId: string
  defeatedPremiseId: Extract<WorldEvent, { type: 'npc-action-retracted' }>['payload']['defeatedPremiseId']
  evidenceId: string
  supersedesEventId: string
  supportingEventIds: readonly string[]
}>

export class WorldSession {
  private readonly store: WorldStore
  private readonly clock: Clock
  private readonly idGenerator: IdGenerator
  private readonly log: Logger

  constructor(store: WorldStore, clock: Clock, idGenerator: IdGenerator, logger: Logger) {
    this.store = store
    this.clock = clock
    this.idGenerator = idGenerator
    this.log = logger
  }

  async startSession(canon: unknown): Promise<WorldStateResult> {
    const parsedCanon = CanonSeedSchema.safeParse(canon)
    if (!parsedCanon.success) {
      this.log.warn('world session rejected canon', { code: 'invalid-canon' })
      return fail('invalid-canon')
    }

    const sessionId = this.idGenerator.newId()
    const event = WorldEventSchema.parse({
      schemaVersion: 1,
      eventId: this.idGenerator.newId(),
      sessionId,
      seq: 1,
      occurredAt: this.clock.now(),
      type: 'session-started',
      payload: { seed: parsedCanon.data },
    })
    if (event.type !== 'session-started') throw new Error('session event narrowing failed')
    const snapshot = applyEvent(null, event)
    const created = await this.store.createSession({
      sessionId,
      worldId: parsedCanon.data.worldId,
      firstEvent: event,
      snapshot,
    })
    if (!created.ok) {
      this.log.warn('world session create failed', { sessionId, code: created.error.code })
      return fail(created.error.code)
    }

    this.log.info('world session started', {
      worldId: snapshot.worldId,
      sessionId,
      seq: event.seq,
      revision: snapshot.revision,
    })
    return { ok: true, state: snapshot }
  }

  async appendEvent(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) {
      this.log.warn('world event append failed', { sessionId, code: 'not-found' })
      return fail('not-found')
    }
    if (snapshot.revision !== expectedRevision) {
      this.log.warn('world event append failed', { sessionId, code: 'conflict', expectedRevision })
      return fail('conflict')
    }

    const parsedCommand = WorldCommandSchema.safeParse(command)
    if (!parsedCommand.success || !isValidForState(snapshot, parsedCommand.data)) {
      this.log.warn('world event append failed', { sessionId, code: 'invalid-command' })
      return fail('invalid-command')
    }

    const event = buildEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      parsedCommand.data,
    )
    const next = applyEvent(snapshot, event)
    const committed = await this.store.commit({
      sessionId,
      expectedRevision,
      event,
      snapshot: next,
    })
    if (!committed.ok) {
      this.log.warn('world event append failed', { sessionId, code: committed.error.code })
      return fail(committed.error.code)
    }

    this.log.info('world event appended', {
      sessionId,
      eventId: event.eventId,
      eventType: event.type,
      seq: event.seq,
      revision: next.revision,
    })
    return { ok: true, state: next, event }
  }

  async applyMeaningfulObject(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
    context: MeaningfulObjectContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = WorldCommandSchema.safeParse(command)
    if (!parsed.success || parsed.data.type !== 'meaningful-object-applied') {
      return fail('invalid-command')
    }
    const validation = validateMeaningfulObjectCommand(snapshot, parsed.data, context)
    if (validation === null) return fail('invalid-command')

    const event = buildEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      parsed.data,
      validation,
    )
    const next = applyEvent(snapshot, event)
    const committed = await this.store.commit({
      sessionId,
      expectedRevision,
      event,
      snapshot: next,
    })
    if (!committed.ok) return fail(committed.error.code)
    this.log.info('world event appended', {
      sessionId,
      eventId: event.eventId,
      eventType: event.type,
      seq: event.seq,
      revision: next.revision,
    })
    return { ok: true, state: next, event }
  }

  async commitNpcAction(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
    context: NpcActionContext,
  ): Promise<AppendEventResult> {
    // Snapshot and log are separate reads; store.commit's compare-and-set remains
    // the safety boundary. Under a concurrent append, re-planning may return
    // invalid-command before the eventual compare-and-set conflict. That limits
    // the diagnostic code only and does not create an authority or safety hole.
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = WorldCommandSchema.safeParse(command)
    if (!parsed.success || parsed.data.type !== 'npc-action-committed') {
      return fail('invalid-command')
    }
    if (parsed.data.roomId !== snapshot.currentRoomId) return fail('invalid-command')
    if (context.room.id !== parsed.data.roomId) return fail('invalid-command')

    const log = await this.store.listEvents(sessionId)
    const plan = planBeliefGatedNpcAction({ room: context.room, state: snapshot, log })
    if (plan.status !== 'commit') return fail('invalid-command')
    if (
      plan.command.type !== 'npc-action-committed'
      || plan.command.npcId !== parsed.data.npcId
      || plan.command.action !== parsed.data.action
      || plan.command.targetObjectId !== parsed.data.targetObjectId
    ) return fail('invalid-command')

    const event = buildEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      parsed.data,
      {},
      {
        ruleId: plan.ruleId,
        belief: {
          predicate: plan.belief.predicate,
          itemId: plan.belief.itemId,
          roomId: plan.belief.roomId,
          confidence: plan.belief.confidence,
        },
        supportingEventIds: plan.belief.supportingEventIds,
      },
    )
    const next = applyEvent(snapshot, event)
    const committed = await this.store.commit({
      sessionId,
      expectedRevision,
      event,
      snapshot: next,
    })
    if (!committed.ok) return fail(committed.error.code)
    this.log.info('world event appended', {
      sessionId,
      eventId: event.eventId,
      eventType: event.type,
      seq: event.seq,
      revision: next.revision,
    })
    return { ok: true, state: next, event }
  }

  async commitOffstageTruth(
    sessionId: string,
    input: unknown,
    expectedRevision: number,
    context: DefeasibleNpcActionContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = OffstageTruthInputSchema.safeParse(input)
    if (!parsed.success) return fail('invalid-command')
    const { binding } = context
    if (
      parsed.data.roomId !== snapshot.currentRoomId
      || context.room.id !== parsed.data.roomId
      || binding.roomId !== parsed.data.roomId
      || binding.offstageTruth.triggerObjectId !== parsed.data.triggerObjectId
    ) return fail('invalid-command')

    const log = await this.store.listEvents(sessionId)
    if (log.some((event) => event.type === 'offstage-item-taken'
      && event.payload.roomId === binding.roomId
      && event.payload.containerId === binding.containerId
      && event.payload.itemId === binding.offstageTruth.itemId
      && event.payload.actorId === binding.offstageTruth.actorId
      && event.payload.ruleId === binding.offstageTruth.ruleId)) {
      return fail('invalid-command')
    }

    const event = buildAuthorityEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      'offstage-item-taken',
      {
        roomId: binding.roomId,
        containerId: binding.containerId,
        itemId: binding.offstageTruth.itemId,
        actorId: binding.offstageTruth.actorId,
        ruleId: binding.offstageTruth.ruleId,
        concealed: true,
      },
    )
    return this.commitAuthorityEvent(sessionId, expectedRevision, snapshot, event)
  }

  async commitEvidenceDiscovered(
    sessionId: string,
    input: unknown,
    expectedRevision: number,
    context: DefeasibleNpcActionContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = EvidenceDiscoveredInputSchema.safeParse(input)
    if (!parsed.success) return fail('invalid-command')
    const { binding } = context
    if (
      parsed.data.roomId !== snapshot.currentRoomId
      || context.room.id !== parsed.data.roomId
      || binding.roomId !== parsed.data.roomId
    ) return fail('invalid-command')
    const artifacts = binding.evidenceArtifacts.filter(
      (artifact) => artifact.sourceObjectId === parsed.data.sourceObjectId,
    )
    if (artifacts.length !== 1) return fail('invalid-command')
    const artifact = artifacts[0]!

    const log = await this.store.listEvents(sessionId)
    if (log.some((event) => event.type === 'evidence-discovered'
      && event.payload.evidenceId === artifact.evidenceId)) {
      return fail('invalid-command')
    }
    const event = buildAuthorityEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      'evidence-discovered',
      {
        roomId: binding.roomId,
        evidenceId: artifact.evidenceId,
        sourceObjectId: artifact.sourceObjectId,
      },
    )
    return this.commitAuthorityEvent(sessionId, expectedRevision, snapshot, event)
  }

  async commitEvidencePresented(
    sessionId: string,
    input: unknown,
    expectedRevision: number,
    context: DefeasibleNpcActionContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = EvidencePresentedInputSchema.safeParse(input)
    if (!parsed.success) return fail('invalid-command')
    const { binding } = context
    if (
      parsed.data.roomId !== snapshot.currentRoomId
      || context.room.id !== parsed.data.roomId
      || binding.roomId !== parsed.data.roomId
    ) return fail('invalid-command')
    const artifacts = binding.evidenceArtifacts.filter(
      (artifact) => evidencePresentationFor(artifact)?.objectId
        === parsed.data.presentationObjectId,
    )
    if (artifacts.length !== 1) return fail('invalid-command')
    const artifact = artifacts[0]!
    const presentation = evidencePresentationFor(artifact)
    if (presentation === undefined) return fail('invalid-command')
    const recipients = context.room.objects.filter(
      (object) => object.id === presentation.toNpcId && object.type === 'npc',
    )
    if (recipients.length !== 1 || presentation.toNpcId !== binding.npcId) {
      return fail('invalid-command')
    }

    const log = await this.store.listEvents(sessionId)
    const discoveries = log.filter(
      (event): event is Extract<WorldEvent, { type: 'evidence-discovered' }> =>
        event.type === 'evidence-discovered'
        && event.payload.roomId === binding.roomId
        && event.payload.evidenceId === artifact.evidenceId
        && event.payload.sourceObjectId === artifact.sourceObjectId,
    )
    if (discoveries.length !== 1) return fail('invalid-command')
    const discovery = discoveries[0]!
    const event = buildAuthorityEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      'evidence-presented',
      {
        roomId: binding.roomId,
        evidenceId: artifact.evidenceId,
        toNpcId: presentation.toNpcId,
        presentationObjectId: parsed.data.presentationObjectId,
        discoveryEventId: discovery.eventId,
      },
    )
    return this.commitAuthorityEvent(sessionId, expectedRevision, snapshot, event)
  }

  async commitDefeasibleNpcAction(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
    context: DefeasibleNpcActionContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = WorldCommandSchema.safeParse(command)
    if (!parsed.success || parsed.data.type !== 'npc-action-committed') {
      return fail('invalid-command')
    }
    if (
      parsed.data.roomId !== snapshot.currentRoomId
      || context.room.id !== parsed.data.roomId
      || context.binding.roomId !== parsed.data.roomId
    ) return fail('invalid-command')

    const log = await this.store.listEvents(sessionId)
    const observations = deriveDefeasibleObservations(log, {
      npcId: context.binding.npcId,
      npcRoomId: context.binding.roomId,
      itemId: context.binding.triggerItemId,
      containerId: context.binding.containerId,
      attentionObjectIds: context.binding.attentionObjectIds,
      initialContents: context.binding.initialContainerContents,
    })
    const presentedArtifacts = classifyEvidencePresentations(
      log,
      evidenceHolderScopeFor(context.binding),
    ).flatMap((classification) => classification.status === 'received'
      ? [classification.artifact]
      : [])
    const consequenceStatus = foldConsequenceStatus(log, context.binding)
    const plan = planDefeasibleNpcAction({
      room: context.room,
      observations,
      consequenceStatus,
      binding: context.binding,
      presentedArtifacts,
    })
    if (plan.status !== 'commit' || !sameNpcActionCommand(plan.command, parsed.data)) {
      return fail('invalid-command')
    }

    const event = buildEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      parsed.data,
      {},
      {
        ruleId: plan.ruleId,
        belief: serializeCommittedBelief(plan.belief),
        supportingEventIds: plan.belief.supportingEventIds,
      },
    )
    return this.commitAuthorityEvent(sessionId, expectedRevision, snapshot, event)
  }

  async commitNpcActionRetraction(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
    context: DefeasibleNpcActionContext,
  ): Promise<AppendEventResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) return fail('not-found')
    if (snapshot.revision !== expectedRevision) return fail('conflict')

    const parsed = WorldCommandSchema.safeParse(command)
    if (!parsed.success || parsed.data.type !== 'npc-action-retracted') {
      return fail('invalid-command')
    }
    if (
      parsed.data.roomId !== snapshot.currentRoomId
      || context.room.id !== parsed.data.roomId
      || context.binding.roomId !== parsed.data.roomId
    ) return fail('invalid-command')

    const log = await this.store.listEvents(sessionId)
    const plan = planNpcActionRetraction({
      room: context.room,
      log,
      binding: context.binding,
    })
    if (plan.status !== 'retract' || !sameNpcActionCommand(plan.command, parsed.data)) {
      return fail('invalid-command')
    }
    const supporting = plan.supportingEventIds.map(
      (eventId) => log.find((event) => event.eventId === eventId),
    )
    const presented = supporting[0]
    const discovered = supporting[1]
    if (
      supporting.some((event) => event === undefined)
      || presented?.type !== 'evidence-presented'
      || discovered?.type !== 'evidence-discovered'
      || presented.eventId !== plan.presentationEvent.eventId
      || discovered.eventId !== plan.discoveryEvent.eventId
      || presented.payload.discoveryEventId !== discovered.eventId
      || presented.payload.evidenceId !== discovered.payload.evidenceId
    ) return fail('invalid-command')

    const event = buildEvent(
      sessionId,
      expectedRevision + 1,
      this.idGenerator.newId(),
      this.clock.now(),
      parsed.data,
      {},
      undefined,
      {
        ruleId: plan.ruleId,
        defeatedPremiseId: plan.defeatedPremiseId,
        evidenceId: plan.evidenceId,
        supersedesEventId: plan.supersedesEventId,
        supportingEventIds: plan.supportingEventIds,
      },
    )
    return this.commitAuthorityEvent(sessionId, expectedRevision, snapshot, event)
  }

  private async commitAuthorityEvent(
    sessionId: string,
    expectedRevision: number,
    snapshot: WorldState,
    event: WorldEvent,
  ): Promise<AppendEventResult> {
    const next = applyEvent(snapshot, event)
    const committed = await this.store.commit({
      sessionId,
      expectedRevision,
      event,
      snapshot: next,
    })
    if (!committed.ok) return fail(committed.error.code)
    this.log.info('world event appended', {
      sessionId,
      eventId: event.eventId,
      eventType: event.type,
      seq: event.seq,
      revision: next.revision,
    })
    return { ok: true, state: next, event }
  }

  move(
    sessionId: string,
    toRoomId: string,
    expectedRevision: number,
    fromRoomId?: string,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'moved-to-room', toRoomId, ...(fromRoomId ? { fromRoomId } : {}) },
      expectedRevision,
    )
  }

  addItem(
    sessionId: string,
    item: InventoryItem,
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'item-added', item },
      expectedRevision,
    )
  }

  removeItem(
    sessionId: string,
    itemId: string,
    quantity: number,
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'item-removed', itemId, quantity },
      expectedRevision,
    )
  }

  changeHealth(
    sessionId: string,
    delta: number,
    expectedRevision: number,
    reason?: string,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      {
        schemaVersion: 1,
        type: 'health-changed',
        delta,
        ...(reason !== undefined ? { reason } : {}),
      },
      expectedRevision,
    )
  }

  setStatus(
    sessionId: string,
    status: string,
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'status-changed', status, op: 'add' },
      expectedRevision,
    )
  }

  clearStatus(
    sessionId: string,
    status: string,
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'status-changed', status, op: 'clear' },
      expectedRevision,
    )
  }

  setRoomState(
    sessionId: string,
    roomId: string,
    change: { visited?: boolean; flags?: Record<string, boolean> },
    expectedRevision: number,
  ): Promise<AppendEventResult> {
    return this.appendEvent(
      sessionId,
      { schemaVersion: 1, type: 'room-state-changed', roomId, ...change },
      expectedRevision,
    )
  }

  async getWorldState(sessionId: string): Promise<WorldStateResult> {
    const state = await this.store.getSnapshot(sessionId)
    return state ? { ok: true, state } : fail('not-found')
  }

  async getEventLog(
    sessionId: string,
    options: { sinceSeq?: number } = {},
  ): Promise<EventLogResult> {
    const state = await this.store.getSnapshot(sessionId)
    if (!state) return fail('not-found')
    return { ok: true, events: await this.store.listEvents(sessionId, options) }
  }
}

function isValidForState(state: WorldState, command: WorldCommand): boolean {
  if (command.type === 'meaningful-object-applied') return false
  if (command.type === 'npc-action-committed') return false
  if (command.type === 'npc-action-retracted') return false
  if (command.type === 'item-removed') {
    const held = state.inventory.find((item) => item.itemId === command.itemId)?.quantity ?? 0
    return command.quantity <= held
  }
  if (command.type === 'item-discovered') {
    return (
      command.roomId === state.currentRoomId
      && state.inventory.some((item) => item.itemId === command.itemId)
    )
  }
  if (command.type === 'moved-to-room' && command.fromRoomId !== undefined) {
    return command.fromRoomId === state.currentRoomId
  }
  return true
}

function validateMeaningfulObjectCommand(
  state: WorldState,
  command: Extract<WorldCommand, { type: 'meaningful-object-applied' }>,
  context: MeaningfulObjectContext,
): AppliedMeaningfulConsequences | null {
  if (!context.generatedPlay || command.roomId !== state.currentRoomId) return null
  if (context.room.id !== command.roomId) return null
  const matches = context.room.objects.filter((object) => object.id === command.objectId)
  if (matches.length !== 1) return null
  const object = matches[0]!
  const family = meaningfulObjectFamily(object)
  if (family !== command.family) return null
  const transition = derivedTransition(command.family, command.action)
  if (transition === undefined) return null

  const current = deriveMeaningfulObjectState(
    object,
    state.roomStates[command.roomId],
    command.family,
  )
  let validTransition = false
  if (command.family === 'document') validTransition = command.action === 'read' && current === 'closed'
  if (command.family === 'container') {
    validTransition = (command.action === 'open' && current === 'closed')
      || (command.action === 'search' && current === 'open')
  }
  if (command.family === 'remains') {
    validTransition = command.action === 'search' && current === 'unsearched'
  }
  if (!validTransition) return null

  const catalog = context.consequenceCatalog === undefined
    ? undefined
    : validateMeaningfulObjectConsequenceCatalog(context.consequenceCatalog, {
        room: context.room,
        ...(context.questSpec !== undefined ? { questSpec: context.questSpec } : {}),
      }) ?? undefined
  const attachment = meaningfulObjectConsequenceFor(
    catalog,
    command.objectId,
    command.action,
  )
  if (!sameRequestedMeaningfulConsequences(command, attachment)) return null

  let appliedClueId: string | undefined
  if (attachment?.clueId !== undefined && !isMeaningfulClueKnown(state, attachment.clueId)) {
    appliedClueId = attachment.clueId
  }

  let appliedObjective: AppliedMeaningfulConsequences['objective']
  if (attachment?.objective !== undefined) {
    const quest = context.questSpec
    if (quest === undefined || quest.anchorRoomId !== command.roomId) return null
    const objective = quest.objectives.find(
      (candidate) => candidate.id === attachment.objective!.objectiveId,
    )
    if (objective === undefined) return null
    const alreadySatisfied = evaluateCondition(objective.condition, state)
      || isMeaningfulObjectiveSatisfied(state, quest.questId, objective.id, command.roomId)
    if (!alreadySatisfied) {
      appliedObjective = { questId: quest.questId, objectiveId: objective.id, toStage: 1 }
    }
  }

  if (command.action === 'search') {
    if (!sameInventoryItem(command.item, validatedSearchItem(object))) return null
  } else if (command.item !== undefined) return null

  return {
    ...(appliedClueId !== undefined ? { clueId: appliedClueId } : {}),
    ...(appliedObjective !== undefined ? { objective: appliedObjective } : {}),
  }
}

function buildEvent(
  sessionId: string,
  seq: number,
  eventId: string,
  occurredAt: string,
  command: WorldCommand,
  meaningfulConsequences: AppliedMeaningfulConsequences = {},
  npcActionProvenance?: AppliedNpcActionProvenance,
  npcActionRetractionProvenance?: AppliedNpcActionRetractionProvenance,
): WorldEvent {
  const envelope = { schemaVersion: 1 as const, eventId, sessionId, seq, occurredAt }
  let raw: unknown
  switch (command.type) {
    case 'moved-to-room':
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          toRoomId: command.toRoomId,
          ...(command.fromRoomId ? { fromRoomId: command.fromRoomId } : {}),
        },
      }
      break
    case 'item-added':
      raw = { ...envelope, type: command.type, payload: { item: command.item } }
      break
    case 'item-discovered':
      raw = {
        ...envelope,
        type: command.type,
        payload: { roomId: command.roomId, itemId: command.itemId },
      }
      break
    case 'item-removed':
      raw = {
        ...envelope,
        type: command.type,
        payload: { itemId: command.itemId, quantity: command.quantity },
      }
      break
    case 'health-changed':
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          delta: command.delta,
          ...(command.reason !== undefined ? { reason: command.reason } : {}),
        },
      }
      break
    case 'status-changed':
      raw = {
        ...envelope,
        type: command.type,
        payload: { status: command.status, op: command.op },
      }
      break
    case 'room-state-changed':
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          roomId: command.roomId,
          ...(command.visited !== undefined ? { visited: command.visited } : {}),
          ...(command.flags ? { flags: command.flags } : {}),
        },
      }
      break
    case 'meaningful-object-applied': {
      const state = derivedTransition(command.family, command.action)
      if (state === undefined) throw new Error('invalid meaningful object transition')
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          roomId: command.roomId,
          objectId: command.objectId,
          family: command.family,
          action: command.action,
          state,
          ...(command.item !== undefined ? { item: command.item } : {}),
          ...(meaningfulConsequences.clueId !== undefined
            ? { clueId: meaningfulConsequences.clueId }
            : {}),
          ...(meaningfulConsequences.objective !== undefined
            ? { objective: meaningfulConsequences.objective }
            : {}),
        },
      }
      break
    }
    case 'npc-action-committed': {
      if (npcActionProvenance === undefined) {
        throw new Error('missing NPC action provenance')
      }
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          npcId: command.npcId,
          roomId: command.roomId,
          action: command.action,
          targetObjectId: command.targetObjectId,
          ruleId: npcActionProvenance.ruleId,
          belief: npcActionProvenance.belief,
          supportingEventIds: [...npcActionProvenance.supportingEventIds],
        },
      }
      break
    }
    case 'npc-action-retracted': {
      if (npcActionRetractionProvenance === undefined) {
        throw new Error('missing NPC action retraction provenance')
      }
      raw = {
        ...envelope,
        type: command.type,
        payload: {
          npcId: command.npcId,
          roomId: command.roomId,
          action: command.action,
          targetObjectId: command.targetObjectId,
          ruleId: npcActionRetractionProvenance.ruleId,
          defeatedPremiseId: npcActionRetractionProvenance.defeatedPremiseId,
          evidenceId: npcActionRetractionProvenance.evidenceId,
          supersedesEventId: npcActionRetractionProvenance.supersedesEventId,
          supportingEventIds: [...npcActionRetractionProvenance.supportingEventIds],
        },
      }
      break
    }
    default:
      return assertNever(command)
  }
  return WorldEventSchema.parse(raw)
}

const OffstageTruthInputSchema = z.object({
  roomId: z.string().min(1),
  triggerObjectId: z.string().min(1),
}).strict()

const EvidenceDiscoveredInputSchema = z.object({
  roomId: z.string().min(1),
  sourceObjectId: z.string().min(1),
}).strict()

const EvidencePresentedInputSchema = z.object({
  roomId: z.string().min(1),
  presentationObjectId: z.string().min(1),
}).strict()

function sameNpcActionCommand(
  planned: WorldCommand,
  submitted: WorldCommand,
): boolean {
  return planned.type === submitted.type
    && (planned.type === 'npc-action-committed' || planned.type === 'npc-action-retracted')
    && (submitted.type === 'npc-action-committed' || submitted.type === 'npc-action-retracted')
    && planned.schemaVersion === submitted.schemaVersion
    && planned.npcId === submitted.npcId
    && planned.roomId === submitted.roomId
    && planned.action === submitted.action
    && planned.targetObjectId === submitted.targetObjectId
}

function buildAuthorityEvent(
  sessionId: string,
  seq: number,
  eventId: string,
  occurredAt: string,
  type: 'offstage-item-taken' | 'evidence-discovered' | 'evidence-presented',
  payload: unknown,
): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId,
    sessionId,
    seq,
    occurredAt,
    type,
    payload,
  })
}

function fail(code: WorldSessionErrorCode): { ok: false; error: WorldSessionError } {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } }
}

const ERROR_MESSAGES: Record<WorldSessionErrorCode, string> = {
  'not-found': 'World session was not found.',
  'already-exists': 'World session already exists.',
  conflict: 'World session changed before the operation could be committed.',
  'invalid-command': 'World command is invalid for the current state.',
  'invalid-canon': 'World canon is invalid.',
}

function assertNever(value: never): never {
  throw new Error(`unhandled world command: ${String(value)}`)
}
