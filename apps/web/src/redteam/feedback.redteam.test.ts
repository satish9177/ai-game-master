import appSource from '../App.tsx?raw'
import appHelpersSource from '../app/App.helpers.ts?raw'
import { describe, expect, it } from 'vitest'
import {
  MEMORY_CREATED_MESSAGE,
  MEMORY_RECALLED_MESSAGE,
  decideMemoryFeedback,
  type MemoryFeedbackDecisionInput,
} from '../app/memoryFeedback'
import {
  INITIAL_MEMORY_FEEDBACK_STATE,
  memoryFeedbackAfterPromotion,
  memoryFeedbackAfterRecall,
} from '../app/App.helpers'
import { expectNoForbiddenMarkers, markers } from './fixtures'

const allowed = [null, MEMORY_CREATED_MESSAGE, MEMORY_RECALLED_MESSAGE] as const

function hostileDecision(overrides: Partial<MemoryFeedbackDecisionInput> = {}): MemoryFeedbackDecisionInput {
  return {
    promotionSummary: { recorded: 0, deduplicated: 13, rejected: 21, failed: 34 },
    hasRecalledMemory: true,
    roomEntrySeq: 4,
    shownForRoomEntrySeq: null,
    text: markers.memoryText,
    memoryId: 'memory-id-that-must-not-render',
    roomName: markers.roomName,
    objectName: markers.objectName,
    itemId: markers.itemId,
    providerBody: markers.providerBody,
    playerLine: markers.playerText,
    generatedDescription: markers.userPrompt,
    ...overrides,
  } as unknown as MemoryFeedbackDecisionInput
}

describe('redteam memory feedback leak boundary', () => {
  it('can return only null or the two closed constants under hostile inputs', () => {
    const outputs = [
      decideMemoryFeedback(hostileDecision()),
      decideMemoryFeedback(hostileDecision({ promotionSummary: { recorded: 1, deduplicated: 0, rejected: 0, failed: 0 } })),
      decideMemoryFeedback(hostileDecision({ hasRecalledMemory: false })),
      decideMemoryFeedback(hostileDecision({ shownForRoomEntrySeq: 4 })),
    ]

    for (const output of outputs) {
      expect(allowed).toContain(output)
      if (output !== null) expectNoForbiddenMarkers(output)
    }
  })

  it('App helper reducers preserve the closed-message domain', () => {
    const created = memoryFeedbackAfterPromotion(INITIAL_MEMORY_FEEDBACK_STATE, {
      promotionSummary: { recorded: 1, deduplicated: 999, rejected: 999, failed: 999 },
      roomEntrySeq: 7,
    })
    const recalled = memoryFeedbackAfterRecall(INITIAL_MEMORY_FEEDBACK_STATE, {
      hasRecalledMemory: true,
      roomEntrySeq: 8,
    })

    expect(created.message).toBe(MEMORY_CREATED_MESSAGE)
    expect(recalled.message).toBe(MEMORY_RECALLED_MESSAGE)
    expect(allowed).toContain(created.message)
    expect(allowed).toContain(recalled.message)
  })

  it('App wiring passes only the closed feedback state message to MemoryFeedback', () => {
    expect(appSource).toContain('<MemoryFeedback message={memoryFeedbackState.message} />')
    expect(appSource).toContain('memoryFeedbackAfterPromotion')
    expect(appSource).toContain('memoryFeedbackAfterRecall')
    expect(appHelpersSource).toContain('decideMemoryFeedback')

    for (const forbidden of [
      'memory.text',
      'record.text',
      'providerBody',
      'playerLine',
      'generatedDescription',
      'memoryId',
      'roomName',
      'objectName',
      'itemName',
    ]) {
      expect(appSource).not.toContain(`<MemoryFeedback message={${forbidden}`)
    }
  })
})
