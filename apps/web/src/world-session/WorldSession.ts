import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { WorldStore } from '../domain/ports/WorldStore'
import { applyEvent } from '../domain/world/applyEvent'
import { WorldCommandSchema, WorldEventSchema } from '../domain/world/events'
import type { WorldCommand, WorldEvent } from '../domain/world/events'
import { CanonSeedSchema } from '../domain/world/worldState'
import type { InventoryItem, WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'

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
  if (command.type === 'item-removed') {
    const held = state.inventory.find((item) => item.itemId === command.itemId)?.quantity ?? 0
    return command.quantity <= held
  }
  if (command.type === 'moved-to-room' && command.fromRoomId !== undefined) {
    return command.fromRoomId === state.currentRoomId
  }
  return true
}

function buildEvent(
  sessionId: string,
  seq: number,
  eventId: string,
  occurredAt: string,
  command: WorldCommand,
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
    default:
      return assertNever(command)
  }
  return WorldEventSchema.parse(raw)
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
