import type { RoomMemoryInsert, RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import { ROOM_MEMORY_SCHEMA_VERSION } from '../domain/memory/roomContracts'
import {
  DEFAULT_ROOM_RECALL_LIMIT,
  DEFAULT_ROOM_RECALL_MAX_CHARS,
  filterRoomMemoriesForScope,
  selectRecallRoomMemories,
  validateRoomMemoryDraft,
} from '../domain/memory/roomFirewall'
import type { RoomMemoryDraftInput, RoomMemoryRejectReason } from '../domain/memory/roomFirewall'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { RoomMemoryStore, RoomMemoryStoreErrorCode } from '../domain/ports/RoomMemoryStore'
import type { Logger } from '../platform/logger/Logger'

/**
 * Headless room memory application service (living-world-room-memory-v0).
 *
 * Constructor-injected `RoomMemoryStore`, `Clock`, `IdGenerator`, `Logger`. It
 * has NO `WorldSession`/`WorldStore` parameter and no append path — that is the
 * structural firewall: a recorded room memory can never become room truth. The
 * service is the only logger here, and it logs ids/enums/counts/codes only —
 * never memory `text`, room/NPC names, or player lines.
 */

export type RememberRoomMemoryResult =
  | { status: 'recorded'; record: RoomMemoryRecord }
  | { status: 'deduplicated'; record: RoomMemoryRecord } // store found a prior dedupeKey match
  | { status: 'rejected'; reason: RoomMemoryRejectReason } // firewall
  | { status: 'failed'; reason: RoomMemoryStoreErrorCode } // store

export type RecallRoomMemoryResult = { status: 'recalled'; memories: RoomMemoryRecord[] }

export type RecallRoomMemoryOptions = { limit?: number; maxChars?: number }

export class RoomMemoryService {
  private readonly store: RoomMemoryStore
  private readonly clock: Clock
  private readonly idGenerator: IdGenerator
  private readonly log: Logger

  constructor(store: RoomMemoryStore, clock: Clock, idGenerator: IdGenerator, logger: Logger) {
    this.store = store
    this.clock = clock
    this.idGenerator = idGenerator
    this.log = logger
  }

  async remember(input: RoomMemoryDraftInput): Promise<RememberRoomMemoryResult> {
    const validated = validateRoomMemoryDraft(input)
    if (!validated.ok) {
      this.log.info('room memory rejected', {
        kind: input.kind,
        source: input.source,
        reason: validated.reason,
      })
      return { status: 'rejected', reason: validated.reason }
    }

    const { draft } = validated
    const insert: RoomMemoryInsert = {
      schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
      memoryId: this.idGenerator.newId(),
      worldId: draft.scope.worldId,
      sessionId: draft.scope.sessionId,
      roomId: draft.scope.roomId,
      kind: draft.kind,
      text: draft.text,
      provenance: draft.provenance,
      confidence: draft.confidence,
      ...(draft.importance !== undefined ? { importance: draft.importance } : {}),
      ...(draft.dedupeKey !== undefined ? { dedupeKey: draft.dedupeKey } : {}),
      ...(draft.entitySnapshots !== undefined ? { entitySnapshots: draft.entitySnapshots } : {}),
      createdAt: this.clock.now(),
    }

    const written = await this.store.record(insert)
    if (!written.ok) {
      this.log.warn('room memory failed', {
        memoryId: insert.memoryId,
        worldId: insert.worldId,
        sessionId: insert.sessionId,
        roomId: insert.roomId,
        kind: insert.kind,
        source: insert.provenance.source,
        reason: written.error.code,
      })
      return { status: 'failed', reason: written.error.code }
    }

    const { record } = written
    if (written.deduplicated === true) {
      this.log.info('room memory deduplicated', {
        memoryId: record.memoryId,
        worldId: record.worldId,
        sessionId: record.sessionId,
        roomId: record.roomId,
        kind: record.kind,
        seq: record.seq,
      })
      return { status: 'deduplicated', record }
    }

    this.log.info('room memory recorded', {
      memoryId: record.memoryId,
      worldId: record.worldId,
      sessionId: record.sessionId,
      roomId: record.roomId,
      kind: record.kind,
      source: record.provenance.source,
      confidence: record.confidence,
      seq: record.seq,
    })
    return { status: 'recorded', record }
  }

  async recall(
    scope: RoomMemoryScope,
    options?: RecallRoomMemoryOptions,
  ): Promise<RecallRoomMemoryResult> {
    const limit = options?.limit ?? DEFAULT_ROOM_RECALL_LIMIT
    const maxChars = options?.maxChars ?? DEFAULT_ROOM_RECALL_MAX_CHARS

    const raw = await this.store.listForRoom(scope, { limit })
    const scoped = filterRoomMemoriesForScope(raw, scope)
    const memories = selectRecallRoomMemories(scoped, { limit, maxChars })

    this.log.info('room memory recalled', {
      worldId: scope.worldId,
      sessionId: scope.sessionId,
      roomId: scope.roomId,
      count: memories.length,
    })
    return { status: 'recalled', memories }
  }
}
