import { describe, expect, it } from 'vitest'
import { recallRoomMemoryContext, DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT } from '../app/recallRoomMemoryContext'
import { DEFAULT_RECALL_LIMIT, DEFAULT_RECALL_MAX_CHARS } from '../domain/memory/firewall'
import { DEFAULT_MIN_IMPORTANCE } from '../domain/memory/promotion'
import { DEFAULT_ROOM_RECALL_LIMIT, DEFAULT_ROOM_RECALL_MAX_CHARS } from '../domain/memory/roomFirewall'
import { ROOM_MEMORY_SAVE_MAX_PER_ROOM, ROOM_MEMORY_SAVE_MAX_TOTAL } from '../domain/memory/roomMemorySaveState'
import { MAX_MEMORY_ENTRIES, MAX_MEMORY_LINE_CHARS, buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import {
  EVAL_NPC_ID,
  EVAL_OBSERVATION_HEDGE_PREFIX,
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createSpyLogger,
  evalDialogueRequest,
  expectNoRawMemoryTextInLogs,
  longSessionMemoryFixture,
  longSessionNpcMemoryFixture,
  memorySectionLines,
  type LogEntry,
} from './fixtures'
import { toUngatedRoomMemoryDialogueContext } from './recalledRoomMemoryAdapter'

/**
 * Constants canary (§4 of the plan): absolute literals equal to today's
 * constants. Every threshold below the canary is a literal, never an
 * import of the constant — importing would make the gate tautological. A
 * deliberate cap change must consciously update this canary AND the literal
 * thresholds below it.
 */
describe('constants canary', () => {
  it('locks the constants this suite mirrors as absolute literals', () => {
    expect(DEFAULT_ROOM_RECALL_LIMIT).toBe(8)
    expect(DEFAULT_ROOM_RECALL_MAX_CHARS).toBe(600)
    expect(DEFAULT_RECALL_LIMIT).toBe(8)
    expect(DEFAULT_RECALL_MAX_CHARS).toBe(600)
    expect(DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT).toBe(5)
    expect(MAX_MEMORY_ENTRIES).toBe(3)
    expect(MAX_MEMORY_LINE_CHARS).toBe(160)
    expect(DEFAULT_MIN_IMPORTANCE).toBe(3)
    expect(ROOM_MEMORY_SAVE_MAX_PER_ROOM).toBe(8)
    expect(ROOM_MEMORY_SAVE_MAX_TOTAL).toBe(128)
  })
})

const ROOM_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }
const NPC_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, npcId: EVAL_NPC_ID }

async function composedPromptFor(count: number): Promise<{ promptText: string; logEntries: LogEntry[] }> {
  const fixture = await longSessionMemoryFixture({ count })
  const logEntries: LogEntry[] = []
  const recalled = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger(logEntries))
  const memory = toUngatedRoomMemoryDialogueContext(recalled)
  const request = evalDialogueRequest({ memory })
  const messages = buildDialoguePromptMessages(request)
  const promptText = messages.map((message) => message.content).join('\n\n')
  return { promptText, logEntries: [...logEntries, ...fixture.logEntries] }
}

describe('Gate A - prompt-context budget under load', () => {
  it('room recall stays within 8 records / 600 chars at N=1000', async () => {
    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const recall = await fixture.service.recall(ROOM_SCOPE)

    expect(recall.memories.length).toBeLessThanOrEqual(8)
    // Positive lower bound: with fixed 260-char records and a 600-char cap, exactly
    // 2 records fit (600 / 260 = 2.3). Guards against the gate passing vacuously
    // if recall starts returning 0 records.
    expect(recall.memories.length).toBe(2)
    const totalChars = recall.memories.reduce((sum, record) => sum + record.text.length, 0)
    expect(totalChars).toBeLessThanOrEqual(600)
    expectNoRawMemoryTextInLogs(fixture.logEntries)
  })

  it('dialogue recall context stays within 5 entries at N=1000', async () => {
    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const logEntries: LogEntry[] = []
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger(logEntries))
    const context = toUngatedRoomMemoryDialogueContext(recalled)

    expect(context.entries.length).toBeLessThanOrEqual(5)
    // Mirrors the room-recall lower bound: recall yields exactly 2 records at
    // N=1000, and recallRoomMemoryContext only reorders/truncates, never adds.
    expect(context.entries.length).toBe(2)
    expectNoRawMemoryTextInLogs(logEntries)
  })

  it('prompt MEMORY section stays within 3 lines x 160 chars at N=1000', async () => {
    const { promptText, logEntries } = await composedPromptFor(1000)
    const lines = memorySectionLines(promptText)

    expect(lines.length).toBeLessThanOrEqual(3)
    // Positive lower bound: 2 recalled entries compose to exactly 2 MEMORY lines
    // (well under the 3-line cap). Guards against the gate passing vacuously if
    // the MEMORY section renders empty.
    expect(lines.length).toBe(2)
    for (const line of lines) {
      expect(line.startsWith(EVAL_OBSERVATION_HEDGE_PREFIX)).toBe(true)
      const clampedText = line.slice(EVAL_OBSERVATION_HEDGE_PREFIX.length)
      expect(clampedText.length).toBeLessThanOrEqual(160)
    }
    expectNoRawMemoryTextInLogs(logEntries)
  })

  it('composed prompt length is identical at N=50 and N=1000 (byte-determinism)', async () => {
    const at50 = await composedPromptFor(50)
    const at1000 = await composedPromptFor(1000)
    const at1000Again = await composedPromptFor(1000)

    expect(at1000.promptText.length).toBe(at50.promptText.length)
    expect(at1000Again.promptText.length).toBe(at1000.promptText.length)
  })

  it('NPC-memory recall stays within 8 records / 600 chars at N=1000 (headless secondary case)', async () => {
    const fixture = await longSessionNpcMemoryFixture({ count: 1000 })
    const recall = await fixture.service.recall(NPC_SCOPE)

    expect(recall.memories.length).toBeLessThanOrEqual(8)
    // Same fixed-width math as the room-recall case above: exactly 2 records.
    expect(recall.memories.length).toBe(2)
    const totalChars = recall.memories.reduce((sum, record) => sum + record.text.length, 0)
    expect(totalChars).toBeLessThanOrEqual(600)
    expectNoRawMemoryTextInLogs(fixture.logEntries)
  })
})
