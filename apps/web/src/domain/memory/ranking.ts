/**
 * Memory relevance ranking (memory-context-ranking-v0, Slice B).
 *
 * Pure, total, deterministic, and ADDITIVE: given already-recalled memory records
 * and a small neutral query, return them ordered by a configurable relevance score
 * with a stable tie-break. It does NOT retrieve, cap, or scope — recall
 * (`filterMemoriesForScope` + `selectRecall*`) remains the retrieval/cap authority
 * and is unchanged. No I/O, no `Date.now`/`Math.random`, no input mutation.
 *
 * Structural truth separation: this module consumes inert memory data and returns
 * ranked data; it exports NO `WorldCommand`/`WorldEvent`-producing function and has
 * no path to truth. `confidence` stays informational — using it to order recall
 * does not make it authoritative.
 *
 * See docs/architecture/implementation-plans/memory-context-ranking-v0.md.
 */

export type RankConfidence = 'low' | 'medium' | 'high'

/**
 * The minimal structural shape the ranker needs. Both `NpcMemoryRecord` (whose
 * `provenance` carries `roomId`) and `RoomMemoryRecord` (whose `provenance`
 * carries `npcId`) satisfy it, so one ranker serves both. The optional
 * cross-fields let same-room / same-NPC boosts work for either record type.
 */
export interface RankableMemory {
  memoryId: string
  kind: string
  confidence: RankConfidence
  seq: number
  /**
   * Not persisted yet (Slice A computes it, Slice C persists it). When present it
   * is used directly; when absent a documented kind proxy is used instead.
   */
  importance?: number
  provenance: {
    source: string
    roomId?: string
    npcId?: string
    turnIndex?: number
  }
}

export type MemoryRankingQuery = {
  currentRoomId?: string
  activeNpcId?: string
  currentTurnIndex?: number
  /** Optional HARD filter (memory_type allow-list). An empty array allows nothing. */
  allowedKinds?: readonly string[]
}

export type RankedMemory<T extends RankableMemory> = { record: T; score: number }

export const DEFAULT_MEMORY_RANKING_WEIGHTS = {
  importance: 10,
  confidence: 5,
  sameRoom: 10,
  sameNpc: 20,
  recency: 10,
} as const

/** Weight values widen to `number` so callers can override with any value (the `as const` default stays literal). */
export type MemoryRankingWeights = Record<keyof typeof DEFAULT_MEMORY_RANKING_WEIGHTS, number>

/** Turns within which recency still contributes; at/after it the factor is 0. */
export const RECENCY_WINDOW_TURNS = 50

/**
 * Documented `kind → importance` proxy (0–5), used ONLY when a record has no
 * persisted `importance`. Forward-compatible: once importance is persisted
 * (Slice C), `record.importance` is used and this proxy is bypassed entirely.
 */
const KIND_IMPORTANCE_PROXY: Readonly<Record<string, number>> = {
  player_claim: 3,
  npc_belief: 2,
  npc_observation: 3,
  dialogue_summary: 1,
  room_observation: 3,
  room_note: 2,
  room_summary: 1,
}
const DEFAULT_KIND_IMPORTANCE = 1

const CONFIDENCE_RANK: Readonly<Record<RankConfidence, number>> = {
  low: 0,
  medium: 1,
  high: 2,
}

function importanceOf(record: RankableMemory): number {
  if (typeof record.importance === 'number') return record.importance
  return KIND_IMPORTANCE_PROXY[record.kind] ?? DEFAULT_KIND_IMPORTANCE
}

/**
 * Recency by turn closeness, bounded to `[0, 1]`. Requires both the query's
 * `currentTurnIndex` and the record's `turnIndex`; otherwise contributes 0 (so
 * `seq` influences order only via the tie-break, never as a clock).
 */
function recencyFactor(
  turnIndex: number | undefined,
  currentTurnIndex: number | undefined,
): number {
  if (typeof turnIndex !== 'number' || typeof currentTurnIndex !== 'number') return 0
  const factor = 1 - Math.abs(currentTurnIndex - turnIndex) / RECENCY_WINDOW_TURNS
  if (factor < 0) return 0
  if (factor > 1) return 1
  return factor
}

function scoreFor(
  record: RankableMemory,
  query: MemoryRankingQuery | undefined,
  weights: MemoryRankingWeights,
): number {
  let score = 0
  score += weights.importance * importanceOf(record)
  score += weights.confidence * (CONFIDENCE_RANK[record.confidence] ?? 0)

  if (query?.currentRoomId !== undefined && record.provenance.roomId === query.currentRoomId) {
    score += weights.sameRoom
  }
  if (query?.activeNpcId !== undefined && record.provenance.npcId === query.activeNpcId) {
    score += weights.sameNpc
  }
  score += weights.recency * recencyFactor(record.provenance.turnIndex, query?.currentTurnIndex)

  return score
}

/** Score desc → `seq` desc → `memoryId` asc (the existing recall tie-break convention). */
function compareRanked(a: RankedMemory<RankableMemory>, b: RankedMemory<RankableMemory>): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.record.seq !== b.record.seq) return b.record.seq - a.record.seq
  if (a.record.memoryId < b.record.memoryId) return -1
  if (a.record.memoryId > b.record.memoryId) return 1
  return 0
}

/**
 * Rank already-recalled records by relevance. Pure: builds a new array of
 * `{ record, score }` wrappers (records are referenced, never mutated) and sorts
 * deterministically. Applies only the `allowedKinds` hard filter (scope is already
 * enforced by recall); missing query fields contribute 0.
 */
export function rankMemories<T extends RankableMemory>(
  records: readonly T[],
  query?: MemoryRankingQuery,
  weights?: Partial<MemoryRankingWeights>,
): RankedMemory<T>[] {
  const w: MemoryRankingWeights = {
    importance: weights?.importance ?? DEFAULT_MEMORY_RANKING_WEIGHTS.importance,
    confidence: weights?.confidence ?? DEFAULT_MEMORY_RANKING_WEIGHTS.confidence,
    sameRoom: weights?.sameRoom ?? DEFAULT_MEMORY_RANKING_WEIGHTS.sameRoom,
    sameNpc: weights?.sameNpc ?? DEFAULT_MEMORY_RANKING_WEIGHTS.sameNpc,
    recency: weights?.recency ?? DEFAULT_MEMORY_RANKING_WEIGHTS.recency,
  }
  const allowed = query?.allowedKinds !== undefined ? new Set(query.allowedKinds) : undefined

  const scored: RankedMemory<T>[] = []
  for (const record of records) {
    if (allowed !== undefined && !allowed.has(record.kind)) continue
    scored.push({ record, score: scoreFor(record, query, w) })
  }
  scored.sort(compareRanked)
  return scored
}
