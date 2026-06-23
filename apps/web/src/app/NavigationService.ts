import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import type { RoomResolver } from './AdjacentRoomPregenerator'
import type { WorldSession } from '../world-session/WorldSession'

export type NavigationResult =
  | { status: 'navigated'; room: LoadedRoom; state: WorldState; cacheHit: boolean }
  | { status: 'rejected'; reason: 'missing-exit' | 'unknown-room' | 'already-here' }
  | {
      status: 'failed'
      reason: 'conflict' | 'not-found' | 'invalid-room' | 'unavailable'
    }

export type NavigationSession = Pick<WorldSession, 'getWorldState' | 'move'>

export class NavigationService {
  private readonly session: NavigationSession
  private readonly resolver: RoomResolver
  private readonly log: Logger

  constructor(session: NavigationSession, resolver: RoomResolver, logger: Logger) {
    this.session = session
    this.resolver = resolver
    this.log = logger
  }

  async navigate(input: { sessionId: string; toRoomId: string }): Promise<NavigationResult> {
    const { sessionId, toRoomId } = input

    // RESOLVE-BEFORE-APPEND: the shared resolver acquires the target room
    // (cache → authored registry → on-demand generation) before any move is
    // recorded, so the log never claims a move into an unrenderable room.
    const resolved = await this.resolver.resolveRoom(toRoomId)
    if (!resolved.ok) {
      const result: NavigationResult = { status: 'failed', reason: resolved.reason }
      this.logResult(sessionId, toRoomId, result)
      return result
    }

    const current = await this.session.getWorldState(sessionId)
    if (!current.ok) {
      const result = { status: 'failed', reason: 'not-found' } as const
      this.logResult(sessionId, toRoomId, result, resolved.cacheHit)
      return result
    }
    if (toRoomId === current.state.currentRoomId) {
      const result = { status: 'rejected', reason: 'already-here' } as const
      this.logResult(sessionId, toRoomId, result, resolved.cacheHit, current.state.revision)
      return result
    }

    const moved = await this.session.move(
      sessionId,
      toRoomId,
      current.state.revision,
      current.state.currentRoomId,
    )
    if (!moved.ok) {
      const reason = moved.error.code === 'not-found' ? 'not-found' : 'conflict'
      const result = { status: 'failed', reason } as const
      this.logResult(sessionId, toRoomId, result, resolved.cacheHit, current.state.revision)
      return result
    }

    const result = {
      status: 'navigated',
      room: resolved.room,
      state: moved.state,
      cacheHit: resolved.cacheHit,
    } as const
    this.logResult(sessionId, toRoomId, result, resolved.cacheHit, moved.state.revision)
    return result
  }

  private logResult(
    sessionId: string,
    toRoomId: string,
    result: NavigationResult,
    cacheHit?: boolean,
    revision?: number,
  ): void {
    const context = {
      sessionId,
      toRoomId,
      status: result.status,
      ...('reason' in result ? { reason: result.reason } : {}),
      ...(cacheHit !== undefined ? { cacheHit } : {}),
      ...(revision !== undefined ? { revision } : {}),
    }
    if (result.status === 'failed') this.log.warn('navigation failed', context)
    else this.log.info('navigation resolved', context)
  }
}
