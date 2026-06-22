import type {
  CommitWorldEventInput,
  CreateSessionInput,
  RestoreSessionInput,
  WorldStore,
  WorldStoreWriteResult,
} from '../domain/ports/WorldStore'
import type { WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'

type StoredSession = {
  log: WorldEvent[]
  snapshot: WorldState
}

export class InMemoryWorldStore implements WorldStore {
  private readonly sessions = new Map<string, StoredSession>()

  async createSession(input: CreateSessionInput): Promise<WorldStoreWriteResult> {
    if (this.sessions.has(input.sessionId)) return failure('already-exists')
    assertInitialCommit(input)
    this.sessions.set(input.sessionId, {
      log: [clone(input.firstEvent)],
      snapshot: clone(input.snapshot),
    })
    return { ok: true }
  }

  async commit(input: CommitWorldEventInput): Promise<WorldStoreWriteResult> {
    const stored = this.sessions.get(input.sessionId)
    if (!stored) return failure('not-found')
    if (stored.snapshot.revision !== input.expectedRevision) return failure('conflict')
    assertCommit(input)

    stored.log.push(clone(input.event))
    stored.snapshot = clone(input.snapshot)
    return { ok: true }
  }

  async restoreSession(input: RestoreSessionInput): Promise<WorldStoreWriteResult> {
    if (this.sessions.has(input.sessionId)) return failure('already-exists')
    if (input.log.length === 0 || input.snapshot.sessionId !== input.sessionId) {
      throw new Error('restoreSession requires a validated, non-empty session')
    }
    this.sessions.set(input.sessionId, {
      log: input.log.map((event) => clone(event)),
      snapshot: clone(input.snapshot),
    })
    return { ok: true }
  }

  async getSnapshot(sessionId: string): Promise<WorldState | null> {
    const snapshot = this.sessions.get(sessionId)?.snapshot
    return snapshot ? clone(snapshot) : null
  }

  async listEvents(
    sessionId: string,
    options: { sinceSeq?: number } = {},
  ): Promise<WorldEvent[]> {
    const events = this.sessions.get(sessionId)?.log ?? []
    return events
      .filter((event) => options.sinceSeq === undefined || event.seq > options.sinceSeq)
      .map((event) => clone(event))
  }
}

function assertInitialCommit(input: CreateSessionInput): void {
  if (
    input.firstEvent.type !== 'session-started' ||
    input.firstEvent.seq !== 1 ||
    input.firstEvent.sessionId !== input.sessionId ||
    input.firstEvent.payload.seed.worldId !== input.worldId ||
    input.snapshot.sessionId !== input.sessionId ||
    input.snapshot.worldId !== input.worldId ||
    input.snapshot.revision !== 1
  ) {
    throw new Error('createSession received an inconsistent initial commit')
  }
}

function assertCommit(input: CommitWorldEventInput): void {
  const nextRevision = input.expectedRevision + 1
  if (
    input.event.type === 'session-started' ||
    input.event.sessionId !== input.sessionId ||
    input.event.seq !== nextRevision ||
    input.snapshot.sessionId !== input.sessionId ||
    input.snapshot.revision !== nextRevision
  ) {
    throw new Error('commit received an inconsistent event/snapshot pair')
  }
}

function failure(code: 'not-found' | 'already-exists' | 'conflict'): WorldStoreWriteResult {
  return { ok: false, error: { code } }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
