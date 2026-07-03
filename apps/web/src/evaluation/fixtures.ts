import type { NPCDialogueContext, NPCDialogueRequest } from '../domain/dialogue/contracts'
import type { MemoryDraftInput } from '../domain/memory/firewall'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import type { WorldEvent } from '../domain/world/events'
import { WORLD_SCHEMA_VERSION } from '../domain/world/worldState'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { InMemoryNpcMemoryStore } from '../memory/InMemoryNpcMemoryStore'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { NpcMemoryService, type RememberResult as RememberNpcMemoryResult } from '../memory/NpcMemoryService'
import { RoomMemoryService, type RememberRoomMemoryResult } from '../memory/RoomMemoryService'
import type { LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { SaveGameService } from '../world-session/saveGame'
import { WorldSession } from '../world-session/WorldSession'
import { createSpyLogger, expectNoForbiddenMarkers } from '../redteam/fixtures'
import { expect } from 'vitest'

/**
 * Deterministic, test-only fixtures for the long-session-memory-evaluation-v0
 * suite (sibling of `../redteam/fixtures.ts`). Only `createSpyLogger` and
 * `expectNoForbiddenMarkers` are reused from redteam — no hostile attack
 * fixtures/marker payloads are imported. Everything here writes through the
 * real `remember` path (firewall stays in the loop) or builds plain typed
 * `WorldEvent` literals for the pure promotion mapper; no I/O, no
 * `Date.now`/`Math.random`, no network/provider calls.
 */

export { createSpyLogger, expectNoForbiddenMarkers }

export const EVAL_WORLD_ID = 'eval-world'
export const EVAL_SESSION_ID = 'eval-session'
export const EVAL_ROOM_ID = 'eval-room'
export const EVAL_NPC_ID = 'eval-npc'

/** Near the 280-char `MAX_ROOM_MEMORY_CHARS`/`MAX_MEMORY_CHARS` bound (see Gate A, §5). */
export const EVAL_FIXTURE_TEXT_LENGTH = 260

export type LogEntry = { level: LogLevel; message: string; context: LogContext }

/** A fixed base timestamp advanced by a pure counter — never wall-clock time. */
export function createFixedClock(baseIso = '2026-07-03T00:00:00.000Z'): Clock {
  const base = Date.parse(baseIso)
  let tick = 0
  return {
    now: () => new Date(base + tick++).toISOString(),
  }
}

/** Sequential, zero-padded ids — never random. */
export function createSequentialIdGenerator(prefix: string): IdGenerator {
  let next = 1
  return {
    newId: () => `${prefix}-${String(next++).padStart(5, '0')}`,
  }
}

/**
 * Zero-padded counter text padded to a constant byte length. Recall's
 * `seq`-desc tie-break selects different records at different N, so
 * fixed-width text (not variable-width digits) is what makes cross-N prompt
 * length comparisons meaningful instead of spuriously digit-count-sensitive.
 * The constant-width guarantee assumes `index < 10000` (4-digit padding);
 * `padStart(4, ...)` widens beyond 4 chars for larger indices, which would
 * break the fixed-width assumption. Suite indices top out at N=1000.
 */
export function fixedWidthMemoryText(index: number, length: number = EVAL_FIXTURE_TEXT_LENGTH): string {
  const prefix = `memory text ${String(index).padStart(4, '0')} `
  if (prefix.length >= length) return prefix.slice(0, length)
  return prefix + 'x'.repeat(length - prefix.length)
}

export type LongSessionMemoryFixtureOptions = {
  count: number
  worldId?: string
  sessionId?: string
  roomId?: string
  textLength?: number
}

export type LongSessionMemoryFixture = {
  store: InMemoryRoomMemoryStore
  service: RoomMemoryService
  logEntries: LogEntry[]
  results: RememberRoomMemoryResult[]
}

/**
 * Records `count` in-scope room memories via the real `RoomMemoryService.remember`
 * path (the firewall stays in the loop). Each record gets a unique `dedupeKey`
 * so all `count` writes land distinct records — flood/dedupe fixtures build
 * their own colliding `dedupeKey`s directly rather than through this helper.
 */
export async function longSessionMemoryFixture(
  options: LongSessionMemoryFixtureOptions,
): Promise<LongSessionMemoryFixture> {
  const store = new InMemoryRoomMemoryStore()
  const clock = createFixedClock()
  const ids = createSequentialIdGenerator('eval-room-mem')
  const logEntries: LogEntry[] = []
  const service = new RoomMemoryService(store, clock, ids, createSpyLogger(logEntries))

  const worldId = options.worldId ?? EVAL_WORLD_ID
  const sessionId = options.sessionId ?? EVAL_SESSION_ID
  const roomId = options.roomId ?? EVAL_ROOM_ID
  const textLength = options.textLength ?? EVAL_FIXTURE_TEXT_LENGTH

  const results: RememberRoomMemoryResult[] = []
  for (let index = 0; index < options.count; index += 1) {
    const draft: RoomMemoryDraftInput = {
      worldId,
      sessionId,
      roomId,
      kind: 'room_observation',
      source: 'game',
      text: fixedWidthMemoryText(index, textLength),
      confidence: 'medium',
      dedupeKey: `eval-room-dedupe-${index}`,
    }
    results.push(await service.remember(draft))
  }

  return { store, service, logEntries, results }
}

export type LongSessionNpcMemoryFixtureOptions = {
  count: number
  worldId?: string
  sessionId?: string
  npcId?: string
  textLength?: number
}

export type LongSessionNpcMemoryFixture = {
  store: InMemoryNpcMemoryStore
  service: NpcMemoryService
  logEntries: LogEntry[]
  results: RememberNpcMemoryResult[]
}

/** NPC-memory equivalent of `longSessionMemoryFixture` (Gate A's headless secondary case). */
export async function longSessionNpcMemoryFixture(
  options: LongSessionNpcMemoryFixtureOptions,
): Promise<LongSessionNpcMemoryFixture> {
  const store = new InMemoryNpcMemoryStore()
  const clock = createFixedClock()
  const ids = createSequentialIdGenerator('eval-npc-mem')
  const logEntries: LogEntry[] = []
  const service = new NpcMemoryService(store, clock, ids, createSpyLogger(logEntries))

  const worldId = options.worldId ?? EVAL_WORLD_ID
  const sessionId = options.sessionId ?? EVAL_SESSION_ID
  const npcId = options.npcId ?? EVAL_NPC_ID
  const textLength = options.textLength ?? EVAL_FIXTURE_TEXT_LENGTH

  const results: RememberNpcMemoryResult[] = []
  for (let index = 0; index < options.count; index += 1) {
    const draft: MemoryDraftInput = {
      worldId,
      sessionId,
      npcId,
      kind: 'npc_observation',
      source: 'game',
      text: fixedWidthMemoryText(index, textLength),
      confidence: 'medium',
      dedupeKey: `eval-npc-dedupe-${index}`,
    }
    results.push(await service.remember(draft))
  }

  return { store, service, logEntries, results }
}

/** Minimal, non-hostile `NPCDialogueRequest` builder for prompt-budget gates. */
export function evalDialogueRequest(overrides: Partial<NPCDialogueContext> = {}): NPCDialogueRequest {
  const context: NPCDialogueContext = {
    roomId: EVAL_ROOM_ID,
    npcId: EVAL_NPC_ID,
    npcName: 'Eval Guide',
    persona: 'eval-persona',
    player: { health: { current: 10, max: 10 }, status: [], inventoryItemIds: [] },
    history: [],
    ...overrides,
  }
  return { context }
}

export type SyntheticEventStreamOptions = {
  roomId?: string
  sessionId?: string
  /** Leading events with no distinct dedupe identity — all share one `eventId`. */
  repeatedGroupSize?: number
  /** Leading events below the importance floor (bare `visited`, no `flags`). */
  belowFloorCount?: number
}

/** The prompt's MEMORY section header, unchanged from `generation/llmDialoguePrompt.ts`. */
export const EVAL_MEMORY_SECTION_HEADER = 'BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE'
/** Hedge prefix for `room_observation` entries, the only kind these fixtures produce. */
export const EVAL_OBSERVATION_HEDGE_PREFIX = 'Previously observed: '

/** Non-empty lines following the MEMORY section header in a composed prompt string. */
export function memorySectionLines(promptText: string): string[] {
  const headerIndex = promptText.indexOf(EVAL_MEMORY_SECTION_HEADER)
  if (headerIndex === -1) return []
  const after = promptText.slice(headerIndex + EVAL_MEMORY_SECTION_HEADER.length)
  return after.split('\n').filter((line) => line.trim().length > 0)
}

/**
 * Diagnostics/logs check (count-only sweep): fixture memory text always
 * starts with the literal `memory text `, so no captured log entry's message
 * or context values may contain it. This is a lightweight, self-contained
 * check (not the full Gate E marker sweep, which lands in a later slice).
 */
export function expectNoRawMemoryTextInLogs(entries: readonly LogEntry[]): void {
  const marker = 'memory text '
  for (const entry of entries) {
    expect(entry.message).not.toContain(marker)
    for (const value of Object.values(entry.context)) {
      if (typeof value === 'string') expect(value).not.toContain(marker)
    }
  }
}

/**
 * Deterministic `WorldEvent[]` for the promotion gates. Layout: the first
 * `belowFloorCount` events are bare-`visited` (importance 1, never promotable
 * at the default floor of 3); the next `repeatedGroupSize` events share one
 * `eventId` (and therefore one `promotionDedupeKey`) to exercise promotion
 * dedupe; the remainder each carry a unique flag key and `eventId` so they
 * promote to distinct memories.
 */
export function syntheticEventStream(count: number, options: SyntheticEventStreamOptions = {}): WorldEvent[] {
  const roomId = options.roomId ?? EVAL_ROOM_ID
  const sessionId = options.sessionId ?? EVAL_SESSION_ID
  const belowFloorCount = Math.max(0, options.belowFloorCount ?? 0)
  const repeatedGroupSize = Math.max(0, options.repeatedGroupSize ?? 0)

  const events: WorldEvent[] = []
  for (let i = 0; i < count; i += 1) {
    const isBelowFloor = i < belowFloorCount
    const isRepeated = !isBelowFloor && i < belowFloorCount + repeatedGroupSize
    const identityIndex = isRepeated ? belowFloorCount : i

    events.push({
      schemaVersion: WORLD_SCHEMA_VERSION,
      eventId: `eval-event-${String(identityIndex).padStart(6, '0')}`,
      sessionId,
      seq: i + 1,
      occurredAt: new Date(Date.parse('2026-07-03T00:00:00.000Z') + i).toISOString(),
      type: 'room-state-changed',
      payload: isBelowFloor
        ? { roomId, visited: true }
        : { roomId, flags: { [`eval-flag-${identityIndex}`]: true } },
    })
  }
  return events
}

/* ------------------------------------------------------------------------- *
 * Slice 3/4 shared fixtures (Gates B, D, E, F).
 * ------------------------------------------------------------------------- */

/** Three in-scope rooms for the scope-stability gate (Gate D crosses ≥3 rooms). */
export const EVAL_ROOM_A_ID = 'eval-room-a'
export const EVAL_ROOM_B_ID = 'eval-room-b'
export const EVAL_ROOM_C_ID = 'eval-room-c'
export const EVAL_ROOM_IDS = [EVAL_ROOM_A_ID, EVAL_ROOM_B_ID, EVAL_ROOM_C_ID] as const

/** Decoy scopes (a different world / session / room) that must never leak (Gate D). */
export const EVAL_OTHER_WORLD_ID = 'eval-other-world'
export const EVAL_OTHER_SESSION_ID = 'eval-other-session'
export const EVAL_DECOY_ROOM_ID = 'eval-decoy-room'

/**
 * A UUID `worldId` for the world-session-backed gates (Gate D save/load, Gate F
 * side effects). `CanonSeed.worldId`/`WorldState.worldId`/`sessionId` are
 * `UuidSchema`-constrained, so these gates cannot reuse the plain `EVAL_WORLD_ID`.
 * Room-memory scope `roomId` stays a plain string (it is not FK'd / not a UUID).
 */
export const EVAL_CANON_WORLD_ID = '00000000-0000-4000-8000-0000000ea100'

/**
 * Unique forbidden markers embedded in fixture memory text / player-like inputs /
 * provider-looking strings (Gate E). Distinct from the redteam `markers` payloads
 * (which this suite deliberately does not import) and distinct from any id/enum a
 * memory service is allowed to log — so any appearance in captured logs is a leak.
 */
export const evalMarkers = {
  memoryText: 'XEVAL-MEMORY-TEXT-1M',
  plantedText: 'XEVAL-PLANTED-TEXT-2P',
  playerLine: 'XEVAL-PLAYER-LINE-3L',
  providerBody: 'XEVAL-PROVIDER-BODY-4B',
} as const

export const EVAL_ALL_MARKERS: readonly string[] = Object.values(evalMarkers)

/** A room-memory harness (store + real service + captured logs) reused across gates. */
export type RoomMemoryHarness = {
  store: InMemoryRoomMemoryStore
  service: RoomMemoryService
  logEntries: LogEntry[]
}

export function createRoomMemoryHarness(idPrefix = 'eval-room-mem'): RoomMemoryHarness {
  const store = new InMemoryRoomMemoryStore()
  const logEntries: LogEntry[] = []
  const service = new RoomMemoryService(
    store,
    createFixedClock(),
    createSequentialIdGenerator(idPrefix),
    createSpyLogger(logEntries),
  )
  return { store, service, logEntries }
}

/** A valid `CanonSeed` for starting a real in-memory world session (Gate D / F). */
export function evalCanon(worldId: string = EVAL_CANON_WORLD_ID): unknown {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    worldId,
    name: 'eval-canon',
    startingRoomId: EVAL_ROOM_A_ID,
    initialPlayer: {
      health: { current: 10, max: 10 },
      status: [],
      inventory: [],
    },
  }
}

/** A real (in-memory) world-session harness with UUID ids and captured logs. */
export type WorldSessionHarness = {
  store: InMemoryWorldStore
  session: WorldSession
  saves: SaveGameService
  logEntries: LogEntry[]
}

export function createWorldSessionHarness(): WorldSessionHarness {
  const store = new InMemoryWorldStore()
  const logEntries: LogEntry[] = []
  const logger = createSpyLogger(logEntries)
  let id = 1
  const idGenerator: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  const clock = createFixedClock()
  return {
    store,
    session: new WorldSession(store, clock, idGenerator, logger),
    saves: new SaveGameService(store, logger),
    logEntries,
  }
}

/**
 * Deep-walk every string reachable from a captured log entry's message and
 * context values (Gate E). Objects/arrays are recursed; primitives are stringified
 * only if already strings — number/boolean values carry no free text to leak.
 */
export function collectLogStrings(entries: readonly LogEntry[]): string[] {
  const strings: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(visit)
  }
  for (const entry of entries) {
    strings.push(entry.message)
    visit(entry.context)
  }
  return strings
}

/**
 * Gate E sweep: no captured log string (message or any nested context value) may
 * contain a forbidden marker or the raw fixture memory-text prefix. Count/status
 * diagnostics (ids, enums, counts, codes) are allowed and are not asserted away.
 */
export function expectNoEvalMarkersInLogs(
  entries: readonly LogEntry[],
  forbidden: readonly string[] = EVAL_ALL_MARKERS,
): void {
  const strings = collectLogStrings(entries)
  for (const text of strings) {
    for (const marker of forbidden) expect(text).not.toContain(marker)
    expect(text).not.toContain('memory text ')
  }
}

/**
 * Gate E structural check: every logged context value is a primitive
 * (id/enum/count/code/boolean) — never a nested object, array, or raw text blob.
 * Mirrors the "log context values remain ids/enums/counts/codes/booleans only"
 * assertion in the plan.
 */
export function expectSafeLogContextValues(entries: readonly LogEntry[]): void {
  for (const entry of entries) {
    for (const value of Object.values(entry.context)) {
      const kind = typeof value
      const isPrimitive =
        kind === 'string' || kind === 'number' || kind === 'boolean' || value === null || value === undefined
      expect(isPrimitive).toBe(true)
    }
  }
}
