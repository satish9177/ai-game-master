export const MEMORY_CREATED_MESSAGE = 'The room remembers this.'
export const MEMORY_RECALLED_MESSAGE = 'Something about this place feels remembered.'

export const MEMORY_FEEDBACK_AUTO_DISMISS_MS = 4000

export type MemoryFeedbackMessage =
  | typeof MEMORY_CREATED_MESSAGE
  | typeof MEMORY_RECALLED_MESSAGE

export type PromotionSummary = Readonly<{
  recorded: number
  deduplicated: number
  rejected: number
  failed: number
}>

export const EMPTY_PROMOTION_SUMMARY: PromotionSummary = {
  recorded: 0,
  deduplicated: 0,
  rejected: 0,
  failed: 0,
}

export type MemoryFeedbackDecisionInput = Readonly<{
  promotionSummary: PromotionSummary
  hasRecalledMemory: boolean
  roomEntrySeq: number
  shownForRoomEntrySeq: number | null
}>

export function decideMemoryFeedback(input: MemoryFeedbackDecisionInput): MemoryFeedbackMessage | null {
  if (input.promotionSummary.recorded > 0) {
    return MEMORY_CREATED_MESSAGE
  }

  if (input.hasRecalledMemory && input.shownForRoomEntrySeq !== input.roomEntrySeq) {
    return MEMORY_RECALLED_MESSAGE
  }

  return null
}
