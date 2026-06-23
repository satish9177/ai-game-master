import { buildExitLookup } from './exits'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import { validateRoom } from '../domain/validateRoom'
import type { RoomLoadResult, RoomSource } from '../domain/ports/RoomSource'
import type { RoomRegistryResult } from '../room/RoomRegistry'
import { SessionRoomCache } from '../room/SessionRoomCache'
import type { Logger } from '../platform/logger/Logger'

/**
 * Adjacent-room pre-generation v0 (adjacent-room-pregeneration-v0; the
 * deterministic browser subset of ADR-0009). The session's single
 * room-acquisition seam, used by both the door and background frontier warming:
 *
 * - `resolveRoom(id)` — await-able, in-flight-aware, cache-first. Authored rooms
 *   resolve through the registry; non-authored/unknown rooms generate through the
 *   injected RoomSource (GeneratedRoomSource -> assembleRoom -> repair/fallback),
 *   then are normalized so `room.id === id`. ALWAYS returns safe data: a valid
 *   cached room, or a typed failure (it never throws).
 * - `warmAdjacent(room)` — fire-and-forget background warming of the current
 *   room's exits, capped at `maxJobs`, deduped against the cache and in-flight
 *   jobs. Pure cache warming: it never touches the renderer, world session, or
 *   world state.
 *
 * THE TRUST BOUNDARY holds: every generated room passes through the injected
 * source's `assembleRoom` pipeline before it can reach the cache, so only valid,
 * zero-fatal rooms are cached. The renderer still only ever consumes a cached
 * LoadedRoom. Logs carry ids/codes/counts/provenance only — never seed text, raw
 * JSON, story text, or object names (ADR-0003; FAILURE-MODES cases 4 / 4b).
 */

export type RoomResolveSource = 'cache' | 'registry' | 'generated'

export type ResolveRoomResult =
  | { ok: true; room: LoadedRoom; cacheHit: boolean; source: RoomResolveSource }
  | { ok: false; reason: 'invalid-room' | 'unavailable' }

/** The narrow abstraction NavigationService depends on (DIP). */
export interface RoomResolver {
  resolveRoom(roomId: string): Promise<ResolveRoomResult>
}

/** The registry capability the resolver needs. RoomRegistry satisfies it. */
export type PregenRoomRegistry = {
  has(roomId: string): boolean
  resolve(roomId: string): RoomRegistryResult | Promise<RoomRegistryResult>
}

/** Builds a RoomSource that generates the room for a non-authored id. */
export type RoomSourceFactory = (roomId: string) => RoomSource

/**
 * A trusted, semantics-preserving copy of a loaded room with its id replaced.
 * `id` is a plain string label that `validateRoom` never reads, so this only
 * narrows/relabels validated data and never invents content. Returns a fresh
 * object, so the shared fallback room is never mutated.
 */
export function withRoomId(room: LoadedRoom, id: string): LoadedRoom {
  return { ...room, id }
}

export class AdjacentRoomPregenerator implements RoomResolver {
  private readonly cache: SessionRoomCache
  private readonly registry: PregenRoomRegistry
  private readonly createSource: RoomSourceFactory
  private readonly fallbackRoom: LoadedRoom
  private readonly log: Logger
  private readonly maxJobs: number
  // One shared in-flight map for the door and warming, so a door request and a
  // background warm for the same id collapse to a single job.
  private readonly inFlight = new Map<string, Promise<ResolveRoomResult>>()

  constructor(
    cache: SessionRoomCache,
    registry: PregenRoomRegistry,
    createSource: RoomSourceFactory,
    fallbackRoom: LoadedRoom,
    logger: Logger,
    maxJobs = 3,
  ) {
    this.cache = cache
    this.registry = registry
    this.createSource = createSource
    this.fallbackRoom = fallbackRoom
    this.log = logger
    this.maxJobs = maxJobs
  }

  /**
   * Resolve a room id to a cached, valid LoadedRoom. Cache-first; joins an
   * in-flight job for the same id; otherwise resolves authored rooms through the
   * registry and generates non-authored ones. Never throws.
   */
  async resolveRoom(roomId: string): Promise<ResolveRoomResult> {
    const cached = this.cache.get(roomId)
    if (cached) return { ok: true, room: cached, cacheHit: true, source: 'cache' }

    const joined = this.inFlight.get(roomId)
    if (joined) return joined

    const job = this.runResolve(roomId)
    this.inFlight.set(roomId, job)
    try {
      return await job
    } finally {
      this.inFlight.delete(roomId)
    }
  }

  /**
   * Speculatively warm the cache for the current room's adjacent exits, in
   * declaration order, capped at `maxJobs`. Fire-and-forget: it never blocks the
   * caller and never throws. Skips already-cached and in-flight ids. The cap
   * bounds only speculative background work — an explicit `resolveRoom` at a door
   * is never blocked by it.
   */
  warmAdjacent(room: LoadedRoom): void {
    const adjacent = this.adjacentRoomIds(room)
    let started = 0
    for (const roomId of adjacent) {
      if (started >= this.maxJobs) break
      if (this.cache.has(roomId) || this.inFlight.has(roomId)) continue
      started += 1
      void this.resolveRoom(roomId)
    }
    this.log.debug('adjacent warm requested', {
      adjacentCount: adjacent.length,
      started,
    })
  }

  /** Distinct adjacent room ids from the room's exits, in declaration order. */
  private adjacentRoomIds(room: LoadedRoom): string[] {
    const ids: string[] = []
    for (const { toRoomId } of buildExitLookup(room).values()) {
      if (!ids.includes(toRoomId)) ids.push(toRoomId)
    }
    return ids
  }

  /** The actual resolution work behind the in-flight guard. Never throws. */
  private async runResolve(roomId: string): Promise<ResolveRoomResult> {
    try {
      if (this.registry.has(roomId)) return await this.resolveAuthored(roomId)
      return await this.resolveGenerated(roomId)
    } catch {
      // A genuinely unexpected fault (e.g. a throwing registry/factory) maps to
      // the retry path; nothing is cached.
      return { ok: false, reason: 'unavailable' }
    }
  }

  /** Resolve an authored room through the registry. Authored rooms are never generated. */
  private async resolveAuthored(roomId: string): Promise<ResolveRoomResult> {
    const resolved = await this.registry.resolve(roomId)
    if (!resolved.ok) {
      // `has` was true, so this is an invalid authored spec, not a missing id.
      this.log.warn('room resolve failed', { roomId, source: 'registry', code: 'invalid-room' })
      return { ok: false, reason: 'invalid-room' }
    }
    this.cache.set(roomId, resolved.room)
    this.log.debug('room resolved', { roomId, source: 'registry', cacheHit: false })
    return { ok: true, room: resolved.room, cacheHit: false, source: 'registry' }
  }

  /** Generate a non-authored room through the safe assembly pipeline. */
  private async resolveGenerated(roomId: string): Promise<ResolveRoomResult> {
    const result: RoomLoadResult = await this.createSource(roomId).getRoom()
    if (!result.ok) {
      // Bad content is `ok:true` (repaired/fallback); only an infrastructure
      // failure reaches here. Nothing is cached; the next attempt retries.
      this.log.warn('room resolve failed', { roomId, source: 'generated', code: result.error.code })
      return { ok: false, reason: result.error.code }
    }
    const room = this.normalize(roomId, result.room)
    this.cache.set(roomId, room)
    this.log.debug('room resolved', {
      roomId,
      source: 'generated',
      cacheHit: false,
      provenance: result.provenance,
    })
    return { ok: true, room, cacheHit: false, source: 'generated' }
  }

  /**
   * Give a generated room the navigation id, so the cache key and `room.id`
   * agree. A defensive re-validate guards the (provably unreachable) case where
   * relabeling could matter: if it ever failed, the trusted fallback room takes
   * its place under the same id, keeping the resolver total.
   */
  private normalize(roomId: string, room: LoadedRoom): LoadedRoom {
    const normalized = withRoomId(room, roomId)
    if (validateRoom(normalized).ok) return normalized
    this.log.warn('normalized room failed revalidation', { roomId })
    return withRoomId(this.fallbackRoom, roomId)
  }
}
