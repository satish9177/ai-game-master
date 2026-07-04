import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT, recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import {
  DEFAULT_MEMORY_RANKING_WEIGHTS,
  rankMemories,
  type RankableMemory,
} from '../domain/memory/ranking'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import { buildDialoguePromptMessages, MAX_MEMORY_ENTRIES } from '../generation/llmDialoguePrompt'
import {
  EVAL_NPC_ID,
  EVAL_OBSERVATION_HEDGE_PREFIX,
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createRoomMemoryHarness,
  createSpyLogger,
  evalDialogueRequest,
  expectNoRawMemoryTextInLogs,
  memorySectionLines,
  type LogEntry,
} from './fixtures'
import { toUngatedRoomMemoryDialogueContext } from './recalledRoomMemoryAdapter'

/**
 * Gate B — relevance with planted memories (Slice 3).
 *
 * `rankMemories` is the ranking authority; recall (`selectRecallRoomMemories`)
 * remains the retrieval/cap authority and orders by `seq` desc. These gates
 * assert two things and are honest about a third:
 *   1. A distinguishable planted memory (higher importance/confidence, or a
 *      same-room / same-NPC match) is ranked first and survives into the bounded
 *      dialogue context and the prompt MEMORY section.
 *   2. When the planted record and the flood are indistinguishable to the ranker
 *      (same kind/confidence/importance, differing only by content text), the
 *      ranker CANNOT prefer it — there is no semantic match. This is the known
 *      Risk-3 retrieval plateau. The gate locks the *documented tie-break*
 *      (`seq` desc → `memoryId` asc) so a future retrieval feature has a
 *      red-to-green target; it does NOT pretend semantic matching exists.
 *
 * Thresholds are absolute literals equal to today's constants (§4 anti-tautology
 * stance); the constants canary lives in `promptBudget.eval.test.ts`.
 */

const ROOM_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }

/** Minimal, explicit `RankableMemory` builder for the pure-ranker gates. */
function rankable(overrides: Partial<RankableMemory> & { memoryId: string; seq: number }): RankableMemory {
  return {
    kind: 'room_observation',
    confidence: 'medium',
    provenance: { source: 'game' },
    ...overrides,
  }
}

describe('Gate B - ranker prefers a distinguishable planted memory', () => {
  it('ranks a higher-importance/confidence planted record first over a flood', () => {
    // 40 low-value noise records (kind proxy 2 / confidence low) plus one planted
    // record (persisted importance 5, confidence high). The score arithmetic makes
    // this deterministic, not probabilistic: importance 10*5=50 dominates.
    const noise: RankableMemory[] = Array.from({ length: 40 }, (_, index) =>
      rankable({
        memoryId: `eval-noise-${String(index).padStart(3, '0')}`,
        seq: index + 1,
        kind: 'room_note', // KIND_IMPORTANCE_PROXY 2
        confidence: 'low',
      }),
    )
    // Deliberately NOT the highest seq — proves score, not recency, wins.
    const planted = rankable({
      memoryId: 'eval-planted',
      seq: 5,
      kind: 'room_observation',
      confidence: 'high',
      importance: 5,
    })

    const ranked = rankMemories([...noise, planted], { currentRoomId: EVAL_ROOM_ID })

    expect(ranked[0]?.record.memoryId).toBe('eval-planted')
    // Score is strictly greater than every noise record (no tie at the top).
    const plantedScore = ranked[0]?.score ?? 0
    for (const entry of ranked.slice(1)) {
      expect(plantedScore).toBeGreaterThan(entry.score)
    }
  })

  it('applies the same-room boost (weight 10) for a room-scoped record', () => {
    // NPC-record shape: provenance carries roomId, so the sameRoom boost fires.
    const sameRoom = rankable({
      memoryId: 'eval-same-room',
      seq: 1, // lower seq
      kind: 'npc_observation',
      provenance: { source: 'game', roomId: EVAL_ROOM_ID },
    })
    const otherRoom = rankable({
      memoryId: 'eval-other-room',
      seq: 2, // higher seq — would win a pure recency tie-break
      kind: 'npc_observation',
      provenance: { source: 'game', roomId: 'eval-different-room' },
    })

    const ranked = rankMemories([otherRoom, sameRoom], { currentRoomId: EVAL_ROOM_ID })

    expect(ranked[0]?.record.memoryId).toBe('eval-same-room')
    expect((ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0)).toBe(DEFAULT_MEMORY_RANKING_WEIGHTS.sameRoom)
  })

  it('applies the same-NPC boost (weight 20) for a room memory with matching npcId', () => {
    // Room-record shape: provenance carries npcId, so the sameNpc boost fires.
    const sameNpc = rankable({
      memoryId: 'eval-same-npc',
      seq: 1,
      provenance: { source: 'game', npcId: EVAL_NPC_ID },
    })
    const otherNpc = rankable({
      memoryId: 'eval-other-npc',
      seq: 2,
      provenance: { source: 'game' },
    })

    const ranked = rankMemories([otherNpc, sameNpc], { activeNpcId: EVAL_NPC_ID })

    expect(ranked[0]?.record.memoryId).toBe('eval-same-npc')
    expect((ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0)).toBe(DEFAULT_MEMORY_RANKING_WEIGHTS.sameNpc)
  })
})

describe('Gate B - calibrated honesty: the retrieval plateau is locked, not fixed', () => {
  it('cannot prefer a semantically-relevant record when nothing is distinguishable', () => {
    // Same kind/confidence/importance, no room/npc match, differing only by content.
    // The ranker has no semantic signal, so scores tie and the documented tie-break
    // (seq desc → memoryId asc) decides. The newer, LESS relevant record wins —
    // this IS the plateau. We lock it; we do not assert the relevant record wins.
    const relevantButOld = rankable({ memoryId: 'eval-plateau-a', seq: 1 })
    const irrelevantButNew = rankable({ memoryId: 'eval-plateau-b', seq: 2 })

    const ranked = rankMemories([relevantButOld, irrelevantButNew], { currentRoomId: EVAL_ROOM_ID })

    expect(ranked[0]?.score).toBe(ranked[1]?.score) // no semantic differentiation
    expect(ranked.map((entry) => entry.record.memoryId)).toEqual(['eval-plateau-b', 'eval-plateau-a'])
  })

  it('breaks a same-seq tie by memoryId ascending (documented order)', () => {
    const later = rankable({ memoryId: 'eval-tie-z', seq: 7 })
    const earlier = rankable({ memoryId: 'eval-tie-a', seq: 7 })

    const ranked = rankMemories([later, earlier], { currentRoomId: EVAL_ROOM_ID })

    expect(ranked[0]?.score).toBe(ranked[1]?.score)
    expect(ranked.map((entry) => entry.record.memoryId)).toEqual(['eval-tie-a', 'eval-tie-z'])
  })
})

/**
 * End-to-end survival: a distinguishable planted record recorded through the real
 * `remember` firewall must survive recall's `seq`/char caps, rank first in the
 * dialogue context, and appear as the first prompt MEMORY line. Records are kept
 * short so recall returns them all (the cap gate is Gate A); this gate is about
 * relevance ordering, asserted on counts + record identity, not raw log text.
 */
describe('Gate B - planted record survives recall -> context -> prompt', () => {
  const NOISE_COUNT = 6
  const PLANTED_TEXT = 'planted observation eval-planted-marker'

  async function plantedContextHarness() {
    const harness = createRoomMemoryHarness()
    for (let index = 0; index < NOISE_COUNT; index += 1) {
      const draft: RoomMemoryDraftInput = {
        worldId: EVAL_WORLD_ID,
        sessionId: EVAL_SESSION_ID,
        roomId: EVAL_ROOM_ID,
        kind: 'room_note', // proxy 2
        source: 'game',
        text: `noise observation number ${String(index).padStart(2, '0')}`,
        confidence: 'low',
        dedupeKey: `eval-relevance-noise-${index}`,
      }
      await harness.service.remember(draft)
    }
    const plantedDraft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'room_observation', // proxy 3
      source: 'game',
      text: PLANTED_TEXT,
      confidence: 'high',
      importance: 5,
      dedupeKey: 'eval-relevance-planted',
    }
    const plantedResult = await harness.service.remember(plantedDraft)
    return { harness, plantedResult }
  }

  it('ranks the planted record first in the bounded dialogue context', async () => {
    const { harness, plantedResult } = await plantedContextHarness()
    expect(plantedResult.status).toBe('recorded')

    const logEntries: LogEntry[] = []
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger(logEntries))
    const context = toUngatedRoomMemoryDialogueContext(recalled)

    // Recall returns all 7 short records; context slices to the 5-entry dialogue cap.
    expect(context.entries.length).toBe(DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT)
    expect(context.entries[0]?.text).toBe(PLANTED_TEXT)
    expect(context.entries[0]?.kind).toBe('room_observation')
    expectNoRawMemoryTextInLogs([...harness.logEntries, ...logEntries])
  })

  it('surfaces the planted record as the first prompt MEMORY line', async () => {
    const { harness } = await plantedContextHarness()
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, harness.service, createSpyLogger([]))
    const context = toUngatedRoomMemoryDialogueContext(recalled)

    const request = evalDialogueRequest({ memory: context })
    const promptText = buildDialoguePromptMessages(request)
      .map((message) => message.content)
      .join('\n\n')
    const lines = memorySectionLines(promptText)

    // 5 context entries collapse to the 3-line prompt cap; planted is first.
    expect(lines.length).toBe(MAX_MEMORY_ENTRIES)
    expect(lines[0]?.startsWith(EVAL_OBSERVATION_HEDGE_PREFIX)).toBe(true)
    expect(lines[0]).toContain(PLANTED_TEXT)
  })
})
