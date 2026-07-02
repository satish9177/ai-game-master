import { describe, expect, it } from 'vitest'
import {
  decideMemoryFeedback,
  EMPTY_PROMOTION_SUMMARY,
  MEMORY_CREATED_MESSAGE,
  MEMORY_RECALLED_MESSAGE,
  type MemoryFeedbackDecisionInput,
  type MemoryFeedbackMessage,
  type PromotionSummary,
} from './memoryFeedback'

const ZERO_SUMMARY: PromotionSummary = {
  recorded: 0,
  deduplicated: 0,
  rejected: 0,
  failed: 0,
}

function decide(overrides: Partial<MemoryFeedbackDecisionInput> = {}): MemoryFeedbackMessage | null {
  return decideMemoryFeedback({
    promotionSummary: ZERO_SUMMARY,
    hasRecalledMemory: false,
    roomEntrySeq: 1,
    shownForRoomEntrySeq: null,
    ...overrides,
  })
}

describe('decideMemoryFeedback', () => {
  it('returns creation feedback when at least one memory was recorded', () => {
    expect(decide({ promotionSummary: { ...ZERO_SUMMARY, recorded: 1 } })).toBe(
      MEMORY_CREATED_MESSAGE,
    )
  })

  it('returns null for deduplicated-only promotion results', () => {
    expect(decide({ promotionSummary: { ...ZERO_SUMMARY, deduplicated: 1 } })).toBeNull()
  })

  it('returns null for rejected-only promotion results', () => {
    expect(decide({ promotionSummary: { ...ZERO_SUMMARY, rejected: 1 } })).toBeNull()
  })

  it('returns null for failed-only promotion results', () => {
    expect(decide({ promotionSummary: { ...ZERO_SUMMARY, failed: 1 } })).toBeNull()
  })

  it('gives creation feedback precedence over recall feedback', () => {
    expect(
      decide({
        promotionSummary: { ...ZERO_SUMMARY, recorded: 1 },
        hasRecalledMemory: true,
      }),
    ).toBe(MEMORY_CREATED_MESSAGE)
  })

  it('returns recall feedback only when memory exists and the room entry is allowed', () => {
    expect(decide({ hasRecalledMemory: true, roomEntrySeq: 2 })).toBe(MEMORY_RECALLED_MESSAGE)
    expect(decide({ hasRecalledMemory: false, roomEntrySeq: 2 })).toBeNull()
  })

  it('does not return recall feedback when feedback was already shown for the same room entry', () => {
    expect(
      decide({
        hasRecalledMemory: true,
        roomEntrySeq: 7,
        shownForRoomEntrySeq: 7,
      }),
    ).toBeNull()
  })

  it('allows recall feedback again for a different room entry', () => {
    expect(
      decide({
        hasRecalledMemory: true,
        roomEntrySeq: 8,
        shownForRoomEntrySeq: 7,
      }),
    ).toBe(MEMORY_RECALLED_MESSAGE)
  })

  it('suppresses later recall feedback for the same room entry after creation feedback was shown', () => {
    const roomEntrySeq = 11
    const creation = decide({
      promotionSummary: { ...ZERO_SUMMARY, recorded: 1 },
      roomEntrySeq,
      shownForRoomEntrySeq: null,
    })

    expect(creation).toBe(MEMORY_CREATED_MESSAGE)
    expect(
      decide({
        promotionSummary: EMPTY_PROMOTION_SUMMARY,
        hasRecalledMemory: true,
        roomEntrySeq,
        shownForRoomEntrySeq: creation === null ? null : roomEntrySeq,
      }),
    ).toBeNull()
  })

  it('returns null for the empty promotion summary helper', () => {
    expect(EMPTY_PROMOTION_SUMMARY).toEqual(ZERO_SUMMARY)
    expect(decide({ promotionSummary: EMPTY_PROMOTION_SUMMARY })).toBeNull()
  })

  it('can return only null or the two closed message constants', () => {
    const outputs = [
      decide({ promotionSummary: { ...ZERO_SUMMARY, recorded: 1 } }),
      decide({ promotionSummary: { ...ZERO_SUMMARY, deduplicated: 1 } }),
      decide({ promotionSummary: { ...ZERO_SUMMARY, rejected: 1 } }),
      decide({ promotionSummary: { ...ZERO_SUMMARY, failed: 1 } }),
      decide({ hasRecalledMemory: true }),
      decide({ hasRecalledMemory: true, shownForRoomEntrySeq: 1 }),
      decide(),
    ]

    for (const output of outputs) {
      expect([null, MEMORY_CREATED_MESSAGE, MEMORY_RECALLED_MESSAGE]).toContain(output)
    }
  })

  it('never returns raw memory text, ids, names, or count strings from extra input data', () => {
    const rawText = 'SECRET memory text'
    const rawMemoryId = 'mem-secret-id'
    const rawRoomName = 'Forbidden Room Name'
    const rawItemName = 'Forbidden Item Name'
    const rawObjectName = 'Forbidden Object Name'
    const rawCountText = '3 memories'
    const rawStrings = [rawText, rawMemoryId, rawRoomName, rawItemName, rawObjectName, rawCountText]
    const decision = decideMemoryFeedback({
      promotionSummary: EMPTY_PROMOTION_SUMMARY,
      hasRecalledMemory: true,
      roomEntrySeq: 3,
      shownForRoomEntrySeq: null,
      text: rawText,
      memoryId: rawMemoryId,
      roomName: rawRoomName,
      itemName: rawItemName,
      objectName: rawObjectName,
      countText: rawCountText,
    } as unknown as MemoryFeedbackDecisionInput)

    expect(decision).toBe(MEMORY_RECALLED_MESSAGE)
    expect(rawStrings).not.toContain(decision)
  })
})
