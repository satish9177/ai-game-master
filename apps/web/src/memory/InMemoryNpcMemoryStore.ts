import type { MemoryScope, NpcMemoryInsert, NpcMemoryRecord } from '../domain/memory/contracts'
import type { NpcMemoryStore, NpcMemoryWriteResult } from '../domain/ports/NpcMemoryStore'

/**
 * Pure in-memory `NpcMemoryStore` adapter (mirrors `InMemoryWorldStore`). It
 * assigns `seq = max(seq for (sessionId, npcId)) + 1`, stores immutable copies,
 * and returns freshly-copied, scope-filtered, seq-desc, limited records so no
 * caller can alias internal state. It does NOT enforce the session FK —
 * `session-not-found` is exercised against the SQLite adapter — so `record`
 * here never returns a failure. Silent: it never logs (the service is the only
 * logger).
 */
export class InMemoryNpcMemoryStore implements NpcMemoryStore {
  private readonly records: NpcMemoryRecord[] = []

  async record(input: NpcMemoryInsert): Promise<NpcMemoryWriteResult> {
    const seq = this.nextSeq(input.sessionId, input.npcId)
    const record: NpcMemoryRecord = clone({ ...input, seq })
    this.records.push(record)
    return { ok: true, record: clone(record) }
  }

  async listForNpc(scope: MemoryScope, options?: { limit?: number }): Promise<NpcMemoryRecord[]> {
    const matched = this.records
      .filter(
        (record) =>
          record.worldId === scope.worldId &&
          record.sessionId === scope.sessionId &&
          record.npcId === scope.npcId,
      )
      .sort((a, b) => (a.seq !== b.seq ? b.seq - a.seq : compareIds(a.memoryId, b.memoryId)))

    const limited = options?.limit !== undefined ? matched.slice(0, Math.max(0, options.limit)) : matched
    return limited.map((record) => clone(record))
  }

  private nextSeq(sessionId: string, npcId: string): number {
    let max = 0
    for (const record of this.records) {
      if (record.sessionId === sessionId && record.npcId === npcId && record.seq > max) {
        max = record.seq
      }
    }
    return max + 1
  }
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
