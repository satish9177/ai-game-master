import { describe, expect, it } from 'vitest'
import { WorldCommandSchema, WorldEventSchema } from '../world/events'
import {
  FACT_SCHEMA_VERSION,
  FactSchema,
  MAX_FACT_TEXT_CHARS,
} from './contracts'
import type { Fact } from './contracts'

function validFact(overrides: Partial<Fact> = {}): Fact {
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: 'fact-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    kind: 'observed',
    source: 'game',
    authority: 'unverified',
    confidence: 'medium',
    visibility: { scope: 'public' },
    ...overrides,
  }
}

describe('FactSchema', () => {
  it('parses a valid fact and round-trips it unchanged', () => {
    const fact = validFact({
      subjectRef: 'room-1',
      objectRef: 'object-1',
      text: 'ambient supporting context',
      provenance: { roomId: 'room-1', npcId: 'npc-1', turnIndex: 2 },
    })
    expect(FactSchema.parse(fact)).toEqual(fact)
  })

  it('pins schemaVersion to 1', () => {
    expect(FactSchema.safeParse(validFact()).success).toBe(true)
    expect(FactSchema.safeParse(validFact({ schemaVersion: 2 as never })).success).toBe(false)
  })

  it('enforces closed enums', () => {
    expect(FactSchema.safeParse(validFact({ kind: 'world-truth' as never })).success).toBe(false)
    expect(FactSchema.safeParse(validFact({ source: 'system' as never })).success).toBe(false)
    expect(FactSchema.safeParse(validFact({ authority: 'authoritative' as never })).success).toBe(false)
    expect(FactSchema.safeParse(validFact({ confidence: 'certain' as never })).success).toBe(false)
  })

  it('rejects empty required ids', () => {
    expect(FactSchema.safeParse(validFact({ factId: '' })).success).toBe(false)
    expect(FactSchema.safeParse(validFact({ worldId: '' })).success).toBe(false)
    expect(FactSchema.safeParse(validFact({ sessionId: '' })).success).toBe(false)
  })

  it('rejects npc-known visibility with empty npcIds', () => {
    expect(FactSchema.safeParse(validFact({ visibility: { scope: 'npc-known', npcIds: [] } })).success).toBe(false)
  })

  it('rejects room-known visibility without roomId', () => {
    expect(FactSchema.safeParse(validFact({ visibility: { scope: 'room-known' } as never })).success).toBe(false)
  })

  it('accepts optional text as bounded inert data without rewriting it', () => {
    const rawText = 'private note\nnot a prompt header\t'
    const parsed = FactSchema.parse(validFact({ text: rawText }))
    expect(parsed.text).toBe(rawText)
    expect(FactSchema.safeParse(validFact({ text: 'a'.repeat(MAX_FACT_TEXT_CHARS) })).success).toBe(true)
    expect(FactSchema.safeParse(validFact({ text: 'a'.repeat(MAX_FACT_TEXT_CHARS + 1) })).success).toBe(false)
  })

  it('rejects unknown extra keys at every structured boundary', () => {
    expect(FactSchema.safeParse({ ...validFact(), extra: true }).success).toBe(false)
    expect(
      FactSchema.safeParse(validFact({ visibility: { scope: 'public', roomId: 'room-1' } as never })).success,
    ).toBe(false)
    expect(
      FactSchema.safeParse(validFact({ provenance: { roomId: 'room-1', secret: 'x' } as never })).success,
    ).toBe(false)
  })

  it('fact records are not world authority shapes', () => {
    const fact = FactSchema.parse(validFact({
      authority: 'world-derived',
      visibility: { scope: 'room-known', roomId: 'room-1' },
      provenance: { roomId: 'room-1' },
    }))

    expect(WorldEventSchema.safeParse(fact).success).toBe(false)
    expect(WorldCommandSchema.safeParse(fact).success).toBe(false)
    expect('type' in fact).toBe(false)
    expect('payload' in fact).toBe(false)
  })
})

