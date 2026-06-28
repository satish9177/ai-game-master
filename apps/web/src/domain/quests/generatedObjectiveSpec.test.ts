import { describe, expect, it } from 'vitest'
import { GeneratedObjectiveSpecSchema } from './generatedObjectiveSpec'

const validProposal = {
  title: 'Find the lever',
  description: 'Inspect the marked lever.',
  hint: 'The lever is near the door.',
  completionHint: 'That opened the way.',
  condition: { kind: 'interact-object', objectId: 'lever-1' },
}

describe('GeneratedObjectiveSpecSchema', () => {
  it('accepts interact-object, resolve-encounter, and visit-room conditions', () => {
    expect(GeneratedObjectiveSpecSchema.safeParse(validProposal).success).toBe(true)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({
        ...validProposal,
        condition: { kind: 'resolve-encounter', objectId: 'guard-1' },
      }).success,
    ).toBe(true)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({
        ...validProposal,
        condition: { kind: 'visit-room', roomId: 'north-room' },
      }).success,
    ).toBe(true)
  })

  it('rejects unknown condition kinds', () => {
    expect(
      GeneratedObjectiveSpecSchema.safeParse({
        ...validProposal,
        condition: { kind: 'room-flag', roomId: 'room', flag: 'interaction:x' },
      }).success,
    ).toBe(false)
  })

  it('rejects extra keys on the proposal and condition', () => {
    expect(GeneratedObjectiveSpecSchema.safeParse({ ...validProposal, extra: true }).success).toBe(false)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({
        ...validProposal,
        condition: { kind: 'interact-object', objectId: 'lever-1', flag: 'interaction:lever-1' },
      }).success,
    ).toBe(false)
  })

  it('rejects missing required fields', () => {
    const missingHint: Partial<typeof validProposal> = { ...validProposal }
    delete missingHint.hint
    expect(GeneratedObjectiveSpecSchema.safeParse(missingHint).success).toBe(false)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({
        ...validProposal,
        condition: { kind: 'interact-object' },
      }).success,
    ).toBe(false)
  })

  it('rejects over-length text fields', () => {
    expect(GeneratedObjectiveSpecSchema.safeParse({ ...validProposal, title: 'x'.repeat(81) }).success).toBe(false)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({ ...validProposal, description: 'x'.repeat(161) }).success,
    ).toBe(false)
    expect(GeneratedObjectiveSpecSchema.safeParse({ ...validProposal, hint: 'x'.repeat(161) }).success).toBe(false)
    expect(
      GeneratedObjectiveSpecSchema.safeParse({ ...validProposal, completionHint: 'x'.repeat(161) }).success,
    ).toBe(false)
  })
})
