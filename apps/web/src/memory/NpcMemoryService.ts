import type { MemoryScope, NpcMemoryInsert, NpcMemoryRecord } from '../domain/memory/contracts'
import { NPC_MEMORY_SCHEMA_VERSION } from '../domain/memory/contracts'
import {
  DEFAULT_RECALL_LIMIT,
  DEFAULT_RECALL_MAX_CHARS,
  filterMemoriesForScope,
  selectRecallMemories,
  validateMemoryDraft,
} from '../domain/memory/firewall'
import type { MemoryDraftInput, MemoryRejectReason } from '../domain/memory/firewall'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { NpcMemoryStore, NpcMemoryStoreErrorCode } from '../domain/ports/NpcMemoryStore'
import type { Logger } from '../platform/logger/Logger'

/**
 * Headless NPC memory application service (npc-memory-persistence-v0).
 *
 * Constructor-injected `NpcMemoryStore`, `Clock`, `IdGenerator`, `Logger`. It has
 * NO `WorldSession`/`WorldStore` parameter and no append path — that is the
 * structural firewall: a recorded memory can never become world truth. The
 * service is the only logger here, and it logs ids/enums/counts/codes only —
 * never memory `text`, names, or player lines.
 */

export type RememberResult =
  | { status: 'recorded'; record: NpcMemoryRecord }
  | { status: 'rejected'; reason: MemoryRejectReason } // firewall
  | { status: 'failed'; reason: NpcMemoryStoreErrorCode } // store

export type RecallResult = { status: 'recalled'; memories: NpcMemoryRecord[] }

export type RecallOptions = { limit?: number; maxChars?: number }

export class NpcMemoryService {
  private readonly store: NpcMemoryStore
  private readonly clock: Clock
  private readonly idGenerator: IdGenerator
  private readonly log: Logger

  constructor(store: NpcMemoryStore, clock: Clock, idGenerator: IdGenerator, logger: Logger) {
    this.store = store
    this.clock = clock
    this.idGenerator = idGenerator
    this.log = logger
  }

  async remember(input: MemoryDraftInput): Promise<RememberResult> {
    const validated = validateMemoryDraft(input)
    if (!validated.ok) {
      this.log.info('npc memory rejected', { kind: input.kind, source: input.source, reason: validated.reason })
      return { status: 'rejected', reason: validated.reason }
    }

    const { draft } = validated
    const insert: NpcMemoryInsert = {
      schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
      memoryId: this.idGenerator.newId(),
      worldId: draft.scope.worldId,
      sessionId: draft.scope.sessionId,
      npcId: draft.scope.npcId,
      kind: draft.kind,
      text: draft.text,
      provenance: draft.provenance,
      confidence: draft.confidence,
      createdAt: this.clock.now(),
    }

    const written = await this.store.record(insert)
    if (!written.ok) {
      this.log.warn('npc memory failed', {
        memoryId: insert.memoryId,
        worldId: insert.worldId,
        sessionId: insert.sessionId,
        npcId: insert.npcId,
        kind: insert.kind,
        source: insert.provenance.source,
        reason: written.error.code,
      })
      return { status: 'failed', reason: written.error.code }
    }

    const { record } = written
    this.log.info('npc memory recorded', {
      memoryId: record.memoryId,
      worldId: record.worldId,
      sessionId: record.sessionId,
      npcId: record.npcId,
      kind: record.kind,
      source: record.provenance.source,
      confidence: record.confidence,
      seq: record.seq,
    })
    return { status: 'recorded', record }
  }

  async recall(scope: MemoryScope, options?: RecallOptions): Promise<RecallResult> {
    const limit = options?.limit ?? DEFAULT_RECALL_LIMIT
    const maxChars = options?.maxChars ?? DEFAULT_RECALL_MAX_CHARS

    const raw = await this.store.listForNpc(scope, { limit })
    const scoped = filterMemoriesForScope(raw, scope)
    const memories = selectRecallMemories(scoped, { limit, maxChars })

    this.log.info('npc memory recalled', {
      worldId: scope.worldId,
      sessionId: scope.sessionId,
      npcId: scope.npcId,
      count: memories.length,
    })
    return { status: 'recalled', memories }
  }
}
