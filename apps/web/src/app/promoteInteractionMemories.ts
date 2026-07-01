import type { DisplayNameResolver } from '../domain/memory/displayNames'
import { promoteWorldEvent } from '../domain/memory/promotion'
import type { WorldEvent } from '../domain/world/events'
import type { RoomMemoryService } from '../memory/RoomMemoryService'
import type { Logger } from '../platform/logger/Logger'

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
 * block gameplay.
 */
export async function promoteInteractionMemories(
  events: readonly WorldEvent[],
  worldId: string,
  roomMemory: RoomMemoryService,
  logger: Logger,
  displayNames?: DisplayNameResolver,
): Promise<void> {
  for (const event of events) {
    const promoted = promoteWorldEvent(event, { worldId, displayNames })
    if (promoted === null) continue

    try {
      await roomMemory.remember(promoted.input)
    } catch {
      logger.warn('interaction memory promotion threw', {
        eventType: event.type,
        code: 'promotion-threw',
      })
    }
  }
}
