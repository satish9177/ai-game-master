import { describe, expect, it } from 'vitest'
import type { MemoryFtsQuery } from '../domain/memory/ftsQuery'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import type { RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemorySearchStore } from '../domain/ports/RoomMemorySearchStore'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../memory/RoomMemoryService'
import { recallRelevantRoomMemoryContext } from './recallRelevantRoomMemoryContext'
import {
  EVAL_OBSERVATION_HEDGE_PREFIX,
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createFixedClock,
  createSequentialIdGenerator,
  createSpyLogger,
  evalDialogueRequest,
  evalMarkers,
  expectNoEvalMarkersInLogs,
  expectNoRawMemoryTextInLogs,
  expectSafeLogContextValues,
  memorySectionLines,
  type LogEntry,
} from './fixtures'

/**
 * Gate B-FTS (sqlite-fts-memory-retrieval Slice 3a) — evaluation-only.
 *
 * The real SQLite/bm25 retrieval mechanism is already proven at the store level in
 * `persistence/memoryFts.test.ts` (relevance-over-flood, scope isolation, injection
 * safety, determinism). That proof cannot live in this folder: a file cannot import
 * both `persistence/**` and the headless `memory/**` application layer or `generation/**`
 * from the same module (the memory/persistence/generation lint firewalls are mutually
 * exclusive by design). This suite instead proves the OTHER half of the Slice 3a claim —
 * that `RoomMemoryService.recallRelevant`'s FTS-ordered candidate set survives, unmodified
 * in order, through the eval-only `recallRelevantRoomMemoryContext` orchestrator into the
 * bounded dialogue context and the first prompt MEMORY line — using a deterministic fake
 * `RoomMemorySearchStore` that filters/orders over the SAME real, firewall-validated
 * `InMemoryRoomMemoryStore` records `remember()` produced. The fake does not implement
 * bm25 scoring; it proves keyword-filter-and-propagate wiring, not the SQL ranking
 * function (which is out of scope for anything outside `persistence/**`).
 *
 * No SQLite, no provider/LLM call, no runtime/App/RoomViewer/dialogue-provider wiring.
 * `recallRoomMemoryContext.ts`, `RoomMemoryService.ts`, `ranking.ts`, `ftsQuery.ts`, and
 * the existing `relevance.eval.test.ts` plateau assertions are untouched.
 */

const ROOM_SCOPE: RoomMemoryScope = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }

/** Extracts the lowercase tokens `createMemoryFtsQueryFromTokens` quoted/OR-joined. */
function extractQueryTokens(expression: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(expression)) !== null) {
    const token = match[1]
    if (token !== undefined) tokens.push(token.toLowerCase())
  }
  return tokens
}

/**
 * Deterministic fake `RoomMemorySearchStore`: reads the real scope-filtered records from
 * the injected `InMemoryRoomMemoryStore` (the same store `remember()` writes through), then
 * keeps only records whose `text` contains at least one safe query token, ordered by `seq`
 * desc then `memoryId` asc (the same tie-break the real SQLite adapter uses after `bm25`).
 * This is a keyword-filter stand-in, not a bm25 re-implementation.
 */
class FakeFtsRoomMemorySearchStore implements RoomMemorySearchStore {
  constructor(private readonly baseStore: InMemoryRoomMemoryStore) {}

  async searchForRoom(
    scope: RoomMemoryScope,
    query: MemoryFtsQuery,
    options?: { limit?: number },
  ): Promise<RoomMemoryRecord[]> {
    const tokens = extractQueryTokens(query.expression)
    const all = await this.baseStore.listForRoom(scope)
    const matched = all.filter((record) => tokens.some((token) => record.text.toLowerCase().includes(token)))
    const ordered = [...matched].sort((a, b) =>
      b.seq !== a.seq ? b.seq - a.seq : a.memoryId.localeCompare(b.memoryId),
    )
    return options?.limit !== undefined ? ordered.slice(0, Math.max(0, options.limit)) : ordered
  }
}

type FtsHarness = {
  store: InMemoryRoomMemoryStore
  service: RoomMemoryService
  logEntries: LogEntry[]
}

function createFtsHarness(options: { withSearchStore: boolean }): FtsHarness {
  const store = new InMemoryRoomMemoryStore()
  const clock = createFixedClock()
  const ids = createSequentialIdGenerator('eval-fts-room-mem')
  const logEntries: LogEntry[] = []
  const logger = createSpyLogger(logEntries)
  const searchStore = options.withSearchStore ? new FakeFtsRoomMemorySearchStore(store) : undefined
  const service = new RoomMemoryService(store, clock, ids, logger, searchStore)
  return { store, service, logEntries }
}

async function rememberFlood(service: RoomMemoryService, count: number, textPrefix = 'common lantern flicker'): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const draft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: `${textPrefix} number ${String(index).padStart(2, '0')}`,
      confidence: 'medium',
      dedupeKey: `eval-fts-flood-${textPrefix}-${index}`,
    }
    await service.remember(draft)
  }
}

describe('Gate B-FTS - recallRelevant surfaces a keyword-distinct planted memory over a token-lacking flood', () => {
  const FLOOD_COUNT = 8
  const PLANTED_TEXT = 'obsidian astrolabe clue eval-fts-planted-marker'
  const QUERY_TOKENS = ['obsidian', 'astrolabe']

  async function plantedHarness() {
    const harness = createFtsHarness({ withSearchStore: true })
    await rememberFlood(harness.service, FLOOD_COUNT)
    const plantedDraft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: PLANTED_TEXT,
      confidence: 'medium',
      dedupeKey: 'eval-fts-planted',
    }
    const plantedResult = await harness.service.remember(plantedDraft)
    return { harness, plantedResult }
  }

  it('ranks the planted record first (and excludes the flood) in the bounded relevant context', async () => {
    const { harness, plantedResult } = await plantedHarness()
    expect(plantedResult.status).toBe('recorded')

    const orchestratorLogs: LogEntry[] = []
    const context = await recallRelevantRoomMemoryContext(
      ROOM_SCOPE,
      harness.service,
      createSpyLogger(orchestratorLogs),
      { tokens: QUERY_TOKENS },
    )

    expect(context.entries.length).toBe(1)
    expect(context.entries[0]?.text).toBe(PLANTED_TEXT)
    expect(context.entries[0]?.kind).toBe('room_observation')
    expectNoRawMemoryTextInLogs([...harness.logEntries, ...orchestratorLogs])
  })

  it('surfaces the planted record as the first prompt MEMORY line', async () => {
    const { harness } = await plantedHarness()
    const context = await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]), {
      tokens: QUERY_TOKENS,
    })

    const request = evalDialogueRequest({ memory: context })
    const promptText = buildDialoguePromptMessages(request)
      .map((message) => message.content)
      .join('\n\n')
    const lines = memorySectionLines(promptText)

    expect(lines.length).toBe(1)
    expect(lines[0]?.startsWith(EVAL_OBSERVATION_HEDGE_PREFIX)).toBe(true)
    expect(lines[0]).toContain(PLANTED_TEXT)
  })

  it('preserves FTS incoming (seq-desc) order across multiple matching records', async () => {
    const harness = createFtsHarness({ withSearchStore: true })
    await rememberFlood(harness.service, FLOOD_COUNT)

    const olderMatch: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: 'obsidian astrolabe older clue',
      confidence: 'medium',
      dedupeKey: 'eval-fts-planted-order-older',
    }
    await harness.service.remember(olderMatch)

    const newerMatch: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: 'obsidian astrolabe newer clue',
      confidence: 'medium',
      dedupeKey: 'eval-fts-planted-order-newer',
    }
    await harness.service.remember(newerMatch)

    const context = await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]), {
      tokens: QUERY_TOKENS,
    })

    expect(context.entries.length).toBe(2)
    expect(context.entries[0]?.text).toBe(newerMatch.text)
    expect(context.entries[1]?.text).toBe(olderMatch.text)
  })
})

describe('Gate B-FTS - degradation always falls back to recall() + rankMemories, never an emptied context', () => {
  it('falls back when the query has no safe tokens (empty/punctuation)', async () => {
    const harness = createFtsHarness({ withSearchStore: true })
    await rememberFlood(harness.service, 4)

    const context = await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]), {
      tokens: ['', '!!!', '🙂'],
    })

    expect(context.entries.length).toBe(4)
  })

  it('falls back when the FTS query matches nothing', async () => {
    const harness = createFtsHarness({ withSearchStore: true })
    await rememberFlood(harness.service, 4)

    const context = await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]), {
      tokens: ['zzznosuchtoken'],
    })

    expect(context.entries.length).toBe(4)
  })

  it('behaves identically to recallRoomMemoryContext when no search store is injected (unavailable)', async () => {
    const harness = createFtsHarness({ withSearchStore: false })
    await rememberFlood(harness.service, 6)

    const viaOrchestrator = await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]), {
      tokens: ['anything'],
    })
    const viaExisting = await recallRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]))

    expect(viaOrchestrator).toEqual(viaExisting)
    expect(viaOrchestrator.entries.length).toBeGreaterThan(0)
  })
})

describe('Gate B-FTS - log safety', () => {
  it('never leaks planted memory text or query tokens in captured logs', async () => {
    const harness = createFtsHarness({ withSearchStore: true })
    await rememberFlood(harness.service, 5)
    const plantedDraft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: `${evalMarkers.plantedText} silver compass clue`,
      confidence: 'medium',
      dedupeKey: 'eval-fts-log-safety-planted',
    }
    await harness.service.remember(plantedDraft)

    const orchestratorLogs: LogEntry[] = []
    await recallRelevantRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger(orchestratorLogs), {
      tokens: ['compass'],
    })

    const allLogs = [...harness.logEntries, ...orchestratorLogs]
    expectNoEvalMarkersInLogs(allLogs)
    expectSafeLogContextValues(allLogs)
  })
})
