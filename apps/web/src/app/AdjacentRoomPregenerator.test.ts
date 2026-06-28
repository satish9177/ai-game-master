import { describe, expect, it } from 'vitest'
import type { RoomProvenance } from '../domain/assembleRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import { validateRoom } from '../domain/validateRoom'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import type { RoomLoadResult, RoomSource } from '../domain/ports/RoomSource'
import type { RoomRegistryResult } from '../room/RoomRegistry'
import { RoomRegistry } from '../room/RoomRegistry'
import { SessionRoomCache } from '../room/SessionRoomCache'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import { GeneratedRoomSource } from '../room/GeneratedRoomSource'
import { fallbackRoom as fallbackRoomSpec } from '../domain/examples/fallbackRoom'
import type { LogContext, Logger } from '../platform/logger/Logger'
import {
  AdjacentRoomPregenerator,
  withRoomId,
  type PregenRoomRegistry,
  type RoomSourceFactory,
} from './AdjacentRoomPregenerator'

const fallbackRoom = loadRoomSpec(fallbackRoomSpec)

/** A small, zero-fatal room with the given id/name (spawn centered, sane dims). */
function makeRoom(id: string, name = 'A room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name,
    shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    lighting: { ambient: { intensity: 1 } },
    objects: [],
  })
}

/** A room whose arches declare exits to the given room ids, in order. */
function roomWithExits(id: string, toRoomIds: string[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Hub',
    shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    lighting: { ambient: { intensity: 1 } },
    objects: toRoomIds.map((toRoomId, i) => ({
      type: 'arch',
      id: `door-${i}`,
      position: [0, 0, -3],
      interaction: { key: 'E', prompt: 'go', exit: { toRoomId } },
    })),
  })
}

type LogEntry = { message: string; context: LogContext }

function createLogger() {
  const logs: LogEntry[] = []
  const logger: Logger = {
    debug: (message, context = {}) => logs.push({ message, context }),
    info: (message, context = {}) => logs.push({ message, context }),
    warn: (message, context = {}) => logs.push({ message, context }),
    error: (message, context = {}) => logs.push({ message, context }),
    child: () => logger,
  }
  return { logs, logger }
}

/** A registry that knows no rooms (forces the generated path). */
const emptyRegistry: PregenRoomRegistry = {
  has: () => false,
  resolve: () => ({ ok: false, reason: 'unknown-room' }) as RoomRegistryResult,
}

function okSource(room: LoadedRoom, provenance: RoomProvenance = 'generated'): RoomSource {
  return { getRoom: async () => ({ ok: true, room, provenance }) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('withRoomId', () => {
  it('replaces only the id and preserves validity, without mutating the input', () => {
    const room = makeRoom('original', 'Keep me')
    const beforeValid = validateRoom(room).ok
    const normalized = withRoomId(room, 'renamed')

    expect(normalized.id).toBe('renamed')
    expect(room.id).toBe('original') // input untouched
    expect(normalized).not.toBe(room)
    // Only the id differs.
    expect({ ...normalized, id: 'original' }).toEqual(room)
    // Relabeling never changes playability (id is not a semantic input).
    expect(validateRoom(normalized).ok).toBe(beforeValid)
    expect(validateRoom(normalized).ok).toBe(true)
  })

  it('does not mutate the shared fallback room', () => {
    withRoomId(fallbackRoom, 'somewhere')
    expect(fallbackRoom.id).toBe('fallback-room')
  })
})

describe('AdjacentRoomPregenerator.resolveRoom', () => {
  it('returns a cache hit without consulting the registry or generator', async () => {
    const cache = new SessionRoomCache()
    const cached = makeRoom('here')
    cache.set('here', cached)
    const { logger } = createLogger()
    let factoryCalls = 0
    const factory: RoomSourceFactory = () => {
      factoryCalls += 1
      return okSource(makeRoom('x'))
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const result = await pregen.resolveRoom('here')

    expect(result).toEqual({ ok: true, room: cached, cacheHit: true, source: 'cache' })
    expect(factoryCalls).toBe(0)
  })

  it('resolves an authored room through the registry and cache hits without provenance', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    let factoryCalls = 0
    const factory: RoomSourceFactory = () => {
      factoryCalls += 1
      return okSource(makeRoom('x'))
    }
    const pregen = new AdjacentRoomPregenerator(
      cache,
      new RoomRegistry(),
      factory,
      fallbackRoom,
      logger,
    )

    const result = await pregen.resolveRoom('throne-room')
    const cached = await pregen.resolveRoom('throne-room')

    expect(result.ok && result.source).toBe('registry')
    expect(result.ok && result.room.id).toBe('throne-room')
    expect(result.ok && result.provenance).toBeUndefined()
    expect(cached.ok && cached.source).toBe('cache')
    expect(cached.ok && cached.cacheHit).toBe(true)
    expect(cached.ok && cached.provenance).toBeUndefined()
    expect(cache.get('throne-room')?.id).toBe('throne-room')
    expect(factoryCalls).toBe(0)
  })

  it('generates a non-authored room and normalizes its id to the cache key', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const generated = makeRoom('gen-abc123')
    const factory: RoomSourceFactory = () => okSource(generated)
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const result = await pregen.resolveRoom('crypt')

    expect(result.ok && result.source).toBe('generated')
    expect(result.ok && result.room.id).toBe('crypt')
    expect(result.ok && result.provenance).toBe('generated')
    expect(cache.get('crypt')?.id).toBe('crypt')
    // The original generated room is not mutated; the cache holds a normalized copy.
    expect(generated.id).toBe('gen-abc123')
    expect(cache.get('crypt')).not.toBe(generated)
  })

  it('retains repaired and fallback provenance from generated room assembly', async () => {
    const repairedPregen = new AdjacentRoomPregenerator(
      new SessionRoomCache(),
      emptyRegistry,
      () => okSource(makeRoom('repaired-source'), 'repaired'),
      fallbackRoom,
      createLogger().logger,
    )
    const fallbackPregen = new AdjacentRoomPregenerator(
      new SessionRoomCache(),
      emptyRegistry,
      () => okSource(makeRoom('fallback-source'), 'fallback'),
      fallbackRoom,
      createLogger().logger,
    )

    const repaired = await repairedPregen.resolveRoom('repaired-room')
    const fallback = await fallbackPregen.resolveRoom('fallback-room')

    expect(repaired.ok && repaired.provenance).toBe('repaired')
    expect(fallback.ok && fallback.provenance).toBe('fallback')
  })

  it('returns retained generated provenance on a cache hit', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    let factoryCalls = 0
    const factory: RoomSourceFactory = () => {
      factoryCalls += 1
      return okSource(makeRoom('gen-crypt'), 'repaired')
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const miss = await pregen.resolveRoom('crypt')
    const hit = await pregen.resolveRoom('crypt')

    expect(miss.ok && miss.cacheHit).toBe(false)
    expect(miss.ok && miss.provenance).toBe('repaired')
    expect(hit.ok && hit.cacheHit).toBe(true)
    expect(hit.ok && hit.source).toBe('cache')
    expect(hit.ok && hit.provenance).toBe('repaired')
    expect(factoryCalls).toBe(1)
  })

  it('joins an in-flight job instead of generating twice', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const d = deferred<RoomLoadResult>()
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      return { getRoom: () => d.promise }
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const p1 = pregen.resolveRoom('crypt')
    const p2 = pregen.resolveRoom('crypt')
    expect(factoryCalls).toEqual(['crypt']) // second call joined the first

    d.resolve({ ok: true, room: makeRoom('gen-x'), provenance: 'generated' })
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe(r2) // same shared result
    expect(r1.ok && r1.room.id).toBe('crypt')
    expect(factoryCalls).toEqual(['crypt'])
    expect(cache.get('crypt')?.id).toBe('crypt')
  })

  it('does not cache an unavailable generation and retries on the next call', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    let call = 0
    const factory: RoomSourceFactory = () => {
      call += 1
      return call === 1
        ? { getRoom: async (): Promise<RoomLoadResult> => ({ ok: false, error: { code: 'unavailable', message: 'x' } }) }
        : okSource(makeRoom('gen-ok'))
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const first = await pregen.resolveRoom('crypt')
    expect(first).toEqual({ ok: false, reason: 'unavailable' })
    expect(cache.has('crypt')).toBe(false)

    const second = await pregen.resolveRoom('crypt')
    expect(second.ok && second.room.id).toBe('crypt')
    expect(cache.get('crypt')?.id).toBe('crypt')
    expect(call).toBe(2)
  })

  it('maps a throwing source to unavailable without rejecting or caching', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factory: RoomSourceFactory = () => ({
      getRoom: async () => {
        throw new Error('boom')
      },
    })
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    const result = await pregen.resolveRoom('crypt')

    expect(result).toEqual({ ok: false, reason: 'unavailable' })
    expect(cache.has('crypt')).toBe(false)
  })

  it('does not recurse into a generated room\'s own exits', async () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      // The generated room itself has an onward exit; resolving must NOT warm it.
      return okSource(roomWithExits(`gen-${id}`, ['deeper-room']))
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    await pregen.resolveRoom('g1')

    expect(factoryCalls).toEqual(['g1'])
    expect(cache.has('deeper-room')).toBe(false)
  })

  it('is deterministic with the real generator and ends with id === toRoomId', async () => {
    const { logger } = createLogger()
    const realFactory: RoomSourceFactory = (id) =>
      new GeneratedRoomSource(new FakeRoomGenerator(), `adjacent:${id}`, logger, fallbackRoom)
    const a = new AdjacentRoomPregenerator(new SessionRoomCache(), emptyRegistry, realFactory, fallbackRoom, logger)
    const b = new AdjacentRoomPregenerator(new SessionRoomCache(), emptyRegistry, realFactory, fallbackRoom, logger)

    const ra = await a.resolveRoom('crypt-1')
    const rb = await b.resolveRoom('crypt-1')

    expect(ra.ok && ra.room.id).toBe('crypt-1')
    expect(rb.ok && rb.room.id).toBe('crypt-1')
    expect(JSON.stringify(ra.ok && ra.room)).toBe(JSON.stringify(rb.ok && rb.room))
  })

  it('keeps adjacent GeneratedRoomSource default requestsNpc false', async () => {
    const { logger } = createLogger()
    const rawRoom = JSON.stringify({
      schemaVersion: 1,
      id: 'generated-adjacent',
      name: 'Generated Adjacent',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'pillar', position: [4, 0, -2] }],
    })
    const generator: RoomGenerator = { generate: () => Promise.resolve(rawRoom) }
    const factory: RoomSourceFactory = (id) =>
      new GeneratedRoomSource(generator, `adjacent:${id}`, logger, fallbackRoom)
    const pregen = new AdjacentRoomPregenerator(new SessionRoomCache(), emptyRegistry, factory, fallbackRoom, logger)

    const result = await pregen.resolveRoom('someone-to-talk-to')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
    }
  })

  it('keeps logs free of room names, object names, and seed text', async () => {
    const cache = new SessionRoomCache()
    const { logs, logger } = createLogger()
    const secret = makeRoom('gen-secret', 'SECRET ROOM NAME')
    const factory: RoomSourceFactory = () => okSource(secret)
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger)

    await pregen.resolveRoom('crypt')

    const dump = JSON.stringify(logs)
    expect(dump).not.toContain('SECRET ROOM NAME')
    expect(dump).not.toContain('adjacent:')
  })
})

describe('AdjacentRoomPregenerator.warmAdjacent', () => {
  it('warms eligible adjacent exits up to the job cap, in declaration order', () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      return okSource(makeRoom(`gen-${id}`))
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger, 3)

    pregen.warmAdjacent(roomWithExits('hub', ['g1', 'g2', 'g3', 'g4', 'g5']))

    expect(factoryCalls).toEqual(['g1', 'g2', 'g3'])
  })

  it('skips already-cached adjacents and dedupes repeated targets', () => {
    const cache = new SessionRoomCache()
    cache.set('g1', makeRoom('g1'))
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      return okSource(makeRoom(`gen-${id}`))
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger, 3)

    pregen.warmAdjacent(roomWithExits('hub', ['g1', 'g2', 'g2']))

    expect(factoryCalls).toEqual(['g2'])
  })

  it('does not start a second job for an id already in flight', () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const d = deferred<RoomLoadResult>()
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      return { getRoom: () => d.promise }
    }
    const pregen = new AdjacentRoomPregenerator(cache, emptyRegistry, factory, fallbackRoom, logger, 3)

    // A door request for g1 is in flight when warming runs.
    void pregen.resolveRoom('g1')
    pregen.warmAdjacent(roomWithExits('hub', ['g1', 'g2']))

    expect(factoryCalls).toEqual(['g1', 'g2'])
    d.resolve({ ok: true, room: makeRoom('gen-x'), provenance: 'generated' })
  })

  it('never fake-generates an authored adjacent room', () => {
    const cache = new SessionRoomCache()
    const { logger } = createLogger()
    const factoryCalls: string[] = []
    const factory: RoomSourceFactory = (id) => {
      factoryCalls.push(id)
      return okSource(makeRoom(`gen-${id}`))
    }
    const pregen = new AdjacentRoomPregenerator(
      cache,
      new RoomRegistry(),
      factory,
      fallbackRoom,
      logger,
      3,
    )

    pregen.warmAdjacent(roomWithExits('hub', ['throne-room', 'unknown-crypt']))

    // throne-room is authored (registry); only the unknown id is generated.
    expect(factoryCalls).toEqual(['unknown-crypt'])
  })
})
