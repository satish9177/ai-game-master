import { describe, expect, it } from 'vitest'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import {
  DEFAULT_MIN_IMPORTANCE,
  dedupePromotions,
  importanceFor,
  promoteWorldEvent,
  type PromotedMemory,
  type PromotionContext,
} from '../domain/memory/promotion'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService, type RememberRoomMemoryResult } from '../memory/RoomMemoryService'
import {
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createFixedClock,
  createSequentialIdGenerator,
  createSpyLogger,
  evalDialogueRequest,
  expectNoRawMemoryTextInLogs,
  fixedWidthMemoryText,
  longSessionMemoryFixture,
  memorySectionLines,
  syntheticEventStream,
  type LogEntry,
} from './fixtures'

const ROOM_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }

describe('Gate C - dedupe under flood', () => {
  it('200 remember calls with the same dedupeKey produce exactly one stored record', async () => {
    const store = new InMemoryRoomMemoryStore()
    const clock = createFixedClock()
    const ids = createSequentialIdGenerator('eval-flood')
    const logEntries: LogEntry[] = []
    const service = new RoomMemoryService(store, clock, ids, createSpyLogger(logEntries))

    const draft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: fixedWidthMemoryText(0),
      confidence: 'medium',
      dedupeKey: 'eval-flood-key',
    }

    const results: RememberRoomMemoryResult[] = []
    for (let i = 0; i < 200; i += 1) {
      results.push(await service.remember(draft))
    }

    expect(results[0]?.status).toBe('recorded')
    for (const result of results.slice(1)) {
      expect(result.status).toBe('deduplicated')
    }

    const memoryIds = new Set(
      results
        .filter((result) => result.status === 'recorded' || result.status === 'deduplicated')
        .map((result) => (result as { record: { memoryId: string } }).record.memoryId),
    )
    expect(memoryIds.size).toBe(1)

    const recall = await service.recall(ROOM_SCOPE)
    expect(recall.memories.length).toBe(1)

    const context = await recallRoomMemoryContext(ROOM_SCOPE, service, createSpyLogger(logEntries))
    expect(context.entries.length).toBe(1)

    const request = evalDialogueRequest({ memory: context })
    const messages = buildDialoguePromptMessages(request)
    const promptText = messages.map((message) => message.content).join('\n\n')
    expect(memorySectionLines(promptText).length).toBe(1)

    expectNoRawMemoryTextInLogs(logEntries)
  })

  it('a synthetic stream of repeated equivalent events promotes exactly one memory per distinct key', () => {
    const belowFloorCount = 20
    const repeatedGroupSize = 50
    const totalCount = 200
    const events = syntheticEventStream(totalCount, { belowFloorCount, repeatedGroupSize })
    const ctx: PromotionContext = { worldId: EVAL_WORLD_ID }

    const promoted = events
      .map((event) => promoteWorldEvent(event, ctx))
      .filter((candidate): candidate is PromotedMemory => candidate !== null)

    // belowFloorCount events never promote; the rest (totalCount - belowFloorCount)
    // do, but repeatedGroupSize of those share one dedupe key.
    expect(promoted.length).toBe(totalCount - belowFloorCount)

    const { kept, keys } = dedupePromotions(promoted)
    const expectedDistinctKeys = totalCount - belowFloorCount - repeatedGroupSize + 1
    expect(kept.length).toBe(expectedDistinctKeys)
    expect(keys.length).toBe(expectedDistinctKeys)

    const keyCounts = new Map<string, number>()
    for (const item of promoted) {
      keyCounts.set(item.dedupeKey, (keyCounts.get(item.dedupeKey) ?? 0) + 1)
    }
    const repeatedGroupKey = promoted[0]?.dedupeKey
    expect(repeatedGroupKey).toBeDefined()
    if (repeatedGroupKey !== undefined) {
      expect(keyCounts.get(repeatedGroupKey)).toBe(repeatedGroupSize)
    }
  })

  it('events below the importance floor never promote', () => {
    const events = syntheticEventStream(50, { belowFloorCount: 50 })
    const ctx: PromotionContext = { worldId: EVAL_WORLD_ID }

    for (const event of events) {
      expect(importanceFor(event)).toBeLessThan(DEFAULT_MIN_IMPORTANCE)
      expect(promoteWorldEvent(event, ctx)).toBeNull()
    }
  })

  it('post-flood, recall/context/prompt bounds from Gate A still hold', async () => {
    const fixture = await longSessionMemoryFixture({ count: 1000 })

    for (let i = 0; i < 200; i += 1) {
      const draft: RoomMemoryDraftInput = {
        worldId: EVAL_WORLD_ID,
        sessionId: EVAL_SESSION_ID,
        roomId: EVAL_ROOM_ID,
        kind: 'room_observation',
        source: 'game',
        text: fixedWidthMemoryText(1000 + i),
        confidence: 'medium',
        dedupeKey: `eval-room-dedupe-flood-${i}`,
      }
      await fixture.service.remember(draft)
    }

    const recall = await fixture.service.recall(ROOM_SCOPE)
    expect(recall.memories.length).toBeLessThanOrEqual(8)
    const totalChars = recall.memories.reduce((sum, record) => sum + record.text.length, 0)
    expect(totalChars).toBeLessThanOrEqual(600)

    const logEntries: LogEntry[] = []
    const context = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger(logEntries))
    expect(context.entries.length).toBeLessThanOrEqual(5)

    const request = evalDialogueRequest({ memory: context })
    const messages = buildDialoguePromptMessages(request)
    const promptText = messages.map((message) => message.content).join('\n\n')
    expect(memorySectionLines(promptText).length).toBeLessThanOrEqual(3)

    expectNoRawMemoryTextInLogs([...fixture.logEntries, ...logEntries])
  })
})
