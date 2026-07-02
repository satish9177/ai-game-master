import type { DisplayNameResolver } from '../domain/memory/displayNames'
import { promoteWorldEvent } from '../domain/memory/promotion'
import type { WorldEvent } from '../domain/world/events'
import type { RoomMemoryService } from '../memory/RoomMemoryService'
import type { Logger } from '../platform/logger/Logger'
import { EMPTY_PROMOTION_SUMMARY, type PromotionSummary } from './memoryFeedback'

/**
 * Composition-root orchestrator (memory-event-promotion-v0, wiring slice).
 *
 * Bridges committed `WorldEvent`s from an already-applied interaction to the
 * headless `RoomMemoryService`, via the existing pure `promoteWorldEvent`
 * mapper. It is deliberately thin: no new decision logic, just "for each
 * committed event, promote it if the mapper says so, then best-effort
 * `remember` it."
 *
 * Promotion runs strictly AFTER the caller's gameplay commit already
 * succeeded — this function never appends events and never influences
 * `WorldState`. A `remember` failure (rejected/failed status, or an
 * unexpected throw from the store) is caught and logged as a safe code only;
 * it never propagates, so a memory-layer problem can never roll back or
 * block gameplay. The returned `PromotionSummary` carries only safe counts
 * (never memory text, ids, or names) so callers can decide on feedback.
 */
export async function promoteInteractionMemories(
  events: readonly WorldEvent[],
  worldId: string,
  roomMemory: RoomMemoryService,
  logger: Logger,
  displayNames?: DisplayNameResolver,
): Promise<PromotionSummary> {
  let recorded = 0
  let deduplicated = 0
  let rejected = 0
  let failed = 0

  for (const event of events) {
    const promoted = promoteWorldEvent(event, { worldId, displayNames })
    if (promoted === null) continue

    try {
      const result = await roomMemory.remember(promoted.input)
      switch (result.status) {
        case 'recorded':
          recorded++
          break
        case 'deduplicated':
          deduplicated++
          break
        case 'rejected':
          rejected++
          break
        case 'failed':
          failed++
          break
      }
    } catch {
      failed++
      logger.warn('interaction memory promotion threw', {
        eventType: event.type,
        code: 'promotion-threw',
      })
    }
  }

  if (recorded === 0 && deduplicated === 0 && rejected === 0 && failed === 0) {
    return EMPTY_PROMOTION_SUMMARY
  }

  return { recorded, deduplicated, rejected, failed }
}
