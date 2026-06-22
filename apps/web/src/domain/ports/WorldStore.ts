import type { SessionStartedEvent, WorldEvent } from '../world/events'
import type { WorldState } from '../world/worldState'

export type WorldStoreErrorCode = 'not-found' | 'already-exists' | 'conflict'

export type WorldStoreWriteResult =
  | { ok: true }
  | { ok: false; error: { code: WorldStoreErrorCode } }

export type CreateSessionInput = {
  sessionId: string
  worldId: string
  firstEvent: SessionStartedEvent
  snapshot: WorldState
}

export type CommitWorldEventInput = {
  sessionId: string
  expectedRevision: number
  event: WorldEvent
  snapshot: WorldState
}

export type RestoreSessionInput = {
  sessionId: string
  log: readonly WorldEvent[]
  snapshot: WorldState
}

export interface WorldStore {
  createSession(input: CreateSessionInput): Promise<WorldStoreWriteResult>
  commit(input: CommitWorldEventInput): Promise<WorldStoreWriteResult>
  restoreSession(input: RestoreSessionInput): Promise<WorldStoreWriteResult>
  getSnapshot(sessionId: string): Promise<WorldState | null>
  listEvents(sessionId: string, options?: { sinceSeq?: number }): Promise<WorldEvent[]>
}
