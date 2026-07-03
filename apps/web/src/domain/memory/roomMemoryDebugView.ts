import {
  MAX_ROOM_MEMORY_CHARS,
  RoomMemoryRecordSchema,
} from './roomContracts'
import type {
  RoomMemoryConfidence,
  RoomMemoryKind,
  RoomMemoryRecord,
  RoomMemorySource,
} from './roomContracts'
import {
  hasRoomMemoryControlCharacters,
  toSingleLineRoomMemoryText,
} from './roomFirewall'

export const ROOM_MEMORY_DEBUG_REDACTED_TEXT = '[redacted]'
export const ROOM_MEMORY_DEBUG_TRUNCATION_MARKER = '... [truncated]'
export const ROOM_MEMORY_DEBUG_TEXT_MAX_CHARS = 160

export type RoomMemoryDebugRow = {
  memoryId: string
  roomId: string
  kind: RoomMemoryKind
  source: RoomMemorySource
  confidence: RoomMemoryConfidence
  seq: number
  createdAt: string
  text: string
}

export function toRoomMemoryDebugView(
  records: readonly RoomMemoryRecord[],
): RoomMemoryDebugRow[] {
  return records.map(toRoomMemoryDebugRow)
}

function toRoomMemoryDebugRow(candidate: RoomMemoryRecord): RoomMemoryDebugRow {
  const parsed = RoomMemoryRecordSchema.safeParse(candidate)
  if (!parsed.success) {
    return redactedRow()
  }

  const record = parsed.data
  return {
    memoryId: record.memoryId,
    roomId: record.roomId,
    kind: record.kind,
    source: record.provenance.source,
    confidence: record.confidence,
    seq: record.seq,
    createdAt: record.createdAt,
    text: sanitizeRoomMemoryDebugText(record.text),
  }
}

function sanitizeRoomMemoryDebugText(text: string): string {
  if (hasRoomMemoryControlCharacters(text) || isPromptOrProviderLikeText(text)) {
    return ROOM_MEMORY_DEBUG_REDACTED_TEXT
  }

  const singleLine = toSingleLineRoomMemoryText(text)
  if (singleLine.length === 0 || isPromptOrProviderLikeText(singleLine)) {
    return ROOM_MEMORY_DEBUG_REDACTED_TEXT
  }

  if (singleLine.length <= ROOM_MEMORY_DEBUG_TEXT_MAX_CHARS) {
    return singleLine
  }

  return truncateWithMarker(singleLine)
}

function truncateWithMarker(text: string): string {
  const hardCap = Math.min(ROOM_MEMORY_DEBUG_TEXT_MAX_CHARS, MAX_ROOM_MEMORY_CHARS)
  const keepChars = Math.max(0, hardCap - ROOM_MEMORY_DEBUG_TRUNCATION_MARKER.length)
  return `${text.slice(0, keepChars)}${ROOM_MEMORY_DEBUG_TRUNCATION_MARKER}`
}

function isPromptOrProviderLikeText(text: string): boolean {
  const normalized = text.toLowerCase()
  return PROMPT_OR_PROVIDER_MARKERS.some((marker) => normalized.includes(marker))
}

const PROMPT_OR_PROVIDER_MARKERS = [
  'system prompt',
  'developer prompt',
  'raw prompt',
  'provider request',
  'provider response',
  'request body',
  'response body',
  'api key',
  'authorization:',
  'bearer ',
]

function redactedRow(): RoomMemoryDebugRow {
  return {
    memoryId: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
    roomId: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
    kind: 'room_note',
    source: 'game',
    confidence: 'low',
    seq: 0,
    createdAt: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
    text: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
  }
}
