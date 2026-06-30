import type { WorldEvent } from '../world/events'
import type { DisplayNameResolver } from './displayNames'
import type { RoomMemoryDraftInput } from './roomFirewall'

/**
 * Memory promotion mapper (memory-event-promotion-v0, Slice A).
 *
 * Pure, total, deterministic: given a committed `WorldEvent` and a small neutral
 * context, decide whether it deserves a long-term memory and, if so, produce a
 * ready-to-`remember` draft + importance + a deterministic dedupe key; else
 * `null` (ignore). No I/O, no clock/randomness, no input mutation.
 *
 * Truth → memory is the only safe direction. This module CONSUMES `WorldEvent`
 * as input and returns memory drafts only; it exports NO `WorldCommand`/
 * `WorldEvent`-producing function and has no write path to truth (the memory
 * firewall). It imports only domain *types*.
 *
 * v0 promotes ROOM memories from durable room-state changes only. The mechanical
 * event union carries no richer semantics yet; richer events (and an `npc` arm)
 * arrive with a later, coordinated slice. See
 * `docs/architecture/implementation-plans/memory-event-promotion-v0.md`.
 */

/** Backend-assigned, informational-only confidence — NEVER read from or proposed by an LLM. */
export const PROMOTION_CONFIDENCE = 'medium' as const
/** Deterministic game-rule origin (not hidden system/developer text). */
export const PROMOTION_SOURCE = 'game' as const
/** The room memory kind v0 promotes into. */
export const PROMOTION_ROOM_KIND = 'room_observation' as const
/** Default promotion threshold: importance must be >= this to promote. */
export const DEFAULT_MIN_IMPORTANCE = 3
/**
 * Generic, id/name-free room-state memory text. Used as the FALLBACK whenever no
 * display name is available (no resolver, or an unknown room id). Putting raw
 * system ids in memory text is disallowed.
 */
export const ROOM_STATE_MEMORY_TEXT = 'This area changed in a lasting way.'

/**
 * Readable room-state memory text built from a resolved display name (Slice C2).
 * Id-free by construction: only the human name reaches the text. The display name
 * is already bounded by the resolver, so the result stays within the memory cap.
 */
export function namedRoomStateText(displayName: string): string {
  return `The ${displayName} changed in a lasting way.`
}

/** Neutral context the future orchestrator injects. No WorldSession/WorldStore. */
export type PromotionContext = {
  /** Events carry `sessionId`, not `worldId`; the caller supplies the world scope. */
  worldId: string
  /** Promote only if importance >= this (default `DEFAULT_MIN_IMPORTANCE`). */
  minImportance?: number
  /**
   * Optional, neutral resolver (Slice C2). When supplied and it knows the room,
   * the draft gets readable text + a `{ room }` entity snapshot; otherwise the
   * generic id-free text is used unchanged. No `WorldSession`/truth path.
   */
  displayNames?: DisplayNameResolver
}

/**
 * A promotable memory: the exact `RoomMemoryDraftInput` the shipped
 * `RoomMemoryService.remember` consumes, plus the (currently un-persisted)
 * importance and dedupe key. `target` is a labelled field so a future `npc` arm
 * is additive.
 */
export type PromotedMemory = {
  target: 'room'
  input: RoomMemoryDraftInput
  importance: number
  dedupeKey: string
}

type RoomStateChangedEvent = Extract<WorldEvent, { type: 'room-state-changed' }>

/**
 * A `room-state-changed` event that represents a DURABLE consequence — i.e. it
 * carries a non-empty `flags` map. A bare `visited` toggle (or any visit-count
 * style change) is transient presence, not a durable consequence, and returns
 * `null`. (`visited` alongside non-empty `flags` still qualifies.)
 */
function durableRoomStateEvent(event: WorldEvent): RoomStateChangedEvent | null {
  if (event.type !== 'room-state-changed') return null
  const { flags } = event.payload
  if (flags === undefined || Object.keys(flags).length === 0) return null
  return event
}

/** Importance score (0–5) per the plan's promotion table. */
export function importanceFor(event: WorldEvent): number {
  switch (event.type) {
    case 'room-state-changed':
      return durableRoomStateEvent(event) !== null ? 3 : 1
    case 'moved-to-room':
    case 'item-added':
    case 'item-removed':
    case 'health-changed':
    case 'status-changed':
      return 1
    case 'session-started':
      return 0
    default: {
      // Exhaustiveness: a new WorldEvent type must be classified above.
      const _exhaustive: never = event
      void _exhaustive
      return 0
    }
  }
}

/**
 * Idempotency key tied to the source event's identity. Using `eventId` (every
 * committed event has a unique one; `seq` is a stable fallback) guarantees the
 * SAME committed event is never promoted twice and never wrongly collapses two
 * DISTINCT durable changes in the same room. Carries no payload text.
 *
 * Semantic anti-spam dedupe (collapsing different events into one memory) needs
 * persisted history and is deliberately NOT done here.
 */
export function promotionDedupeKey(event: WorldEvent, ctx: PromotionContext): string {
  const worldId = typeof ctx.worldId === 'string' ? ctx.worldId.trim() : ''
  const identity = event.eventId.length > 0 ? event.eventId : `seq:${event.seq}`
  return [worldId, event.sessionId, event.type, identity].join('|')
}

/**
 * Decide promotion for one committed event. Returns a `PromotedMemory` or `null`
 * (ignore). Total and side-effect-free: any non-promotable or malformed input
 * degrades to `null`.
 */
export function promoteWorldEvent(
  event: WorldEvent,
  ctx: PromotionContext,
): PromotedMemory | null {
  const worldId = typeof ctx.worldId === 'string' ? ctx.worldId.trim() : ''
  if (worldId.length === 0) return null

  // v0: only durable room-state changes promote.
  const roomEvent = durableRoomStateEvent(event)
  if (roomEvent === null) return null

  const importance = importanceFor(roomEvent)
  const minImportance = ctx.minImportance ?? DEFAULT_MIN_IMPORTANCE
  if (importance < minImportance) return null

  const roomId = roomEvent.payload.roomId.trim()
  if (roomId.length === 0) return null

  // The sole entity of a durable room-state change is the room itself. With a
  // resolver that knows it, emit readable text + a `{ room }` snapshot; otherwise
  // keep the generic id-free text and store no snapshot.
  const roomSnapshot = ctx.displayNames?.resolve('room', roomId) ?? null
  const text = roomSnapshot ? namedRoomStateText(roomSnapshot.displayName) : ROOM_STATE_MEMORY_TEXT

  const input: RoomMemoryDraftInput = {
    worldId,
    sessionId: roomEvent.sessionId,
    roomId,
    kind: PROMOTION_ROOM_KIND,
    source: PROMOTION_SOURCE,
    text,
    confidence: PROMOTION_CONFIDENCE,
    ...(roomSnapshot ? { entitySnapshots: { room: roomSnapshot } } : {}),
  }

  return {
    target: 'room',
    input,
    importance,
    dedupeKey: promotionDedupeKey(roomEvent, ctx),
  }
}

/**
 * Drop promotions whose dedupe key is already in `seenKeys` or repeated within
 * the batch. Pure: returns a new `kept` array and the list of NEW keys added
 * (so a caller can extend its own seen set). Does not mutate inputs.
 */
export function dedupePromotions(
  items: readonly PromotedMemory[],
  seenKeys: readonly string[] = [],
): { kept: PromotedMemory[]; keys: string[] } {
  const seen = new Set(seenKeys)
  const kept: PromotedMemory[] = []
  const keys: string[] = []
  for (const item of items) {
    if (seen.has(item.dedupeKey)) continue
    seen.add(item.dedupeKey)
    kept.push(item)
    keys.push(item.dedupeKey)
  }
  return { kept, keys }
}
