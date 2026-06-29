import { describe, expect, it } from 'vitest'
import { InteractionEffectSchema } from './effects'
import { interactionFlagKey, planInteraction } from './planInteraction'
import type { WorldState } from '../world/worldState'

const baseState = (overrides: Partial<WorldState> = {}): WorldState => ({
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  currentRoomId: 'safehouse',
  player: { health: { current: 50, max: 100 }, status: [] },
  inventory: [{ itemId: 'medkit', name: 'SECRET MEDKIT NAME', quantity: 2 }],
  roomStates: { safehouse: { visited: true } },
  revision: 1,
  updatedAt: '2026-06-22T10:00:00.000Z',
  ...overrides,
})

describe('InteractionEffectSchema', () => {
  it('parses the three data-only effect variants', () => {
    expect(InteractionEffectSchema.parse({ kind: 'inspect' })).toEqual({ kind: 'inspect' })
    expect(InteractionEffectSchema.parse({
      kind: 'take-item',
      item: { itemId: 'key', name: 'Iron Key', quantity: 1 },
    }).kind).toBe('take-item')
    expect(InteractionEffectSchema.parse({
      kind: 'use-item',
      itemId: 'medkit',
      quantity: 1,
      health: { delta: 25 },
    }).kind).toBe('use-item')
  })

  it('rejects malformed and unknown effects', () => {
    expect(InteractionEffectSchema.safeParse({ kind: 'take-item', item: {} }).success).toBe(false)
    expect(InteractionEffectSchema.safeParse({
      kind: 'use-item',
      itemId: '',
      quantity: 0,
    }).success).toBe(false)
    expect(InteractionEffectSchema.safeParse({ kind: 'run-code' }).success).toBe(false)
  })
})

describe('planInteraction', () => {
  it('exports the same one-shot flag derivation used by the writer path', () => {
    expect(interactionFlagKey(undefined, 'case-file')).toBe('interaction:case-file')
    expect(interactionFlagKey('custom-flag', 'case-file')).toBe('custom-flag')
    expect(interactionFlagKey(undefined, undefined)).toBeUndefined()
  })

  it('plans inspect with a stable derived flag and recognizes it as resolved', () => {
    const effect = { kind: 'inspect' } as const
    expect(planInteraction({ effect, ref: 'note-1', state: baseState() })).toEqual({
      status: 'apply',
      commands: [{
        schemaVersion: 1,
        type: 'room-state-changed',
        roomId: 'safehouse',
        flags: { 'interaction:note-1': true },
      }],
      outcome: { kind: 'inspected' },
    })

    const resolved = baseState({
      roomStates: {
        safehouse: { visited: true, flags: { 'interaction:note-1': true } },
      },
    })
    expect(planInteraction({ effect, ref: 'note-1', state: resolved })).toEqual({
      status: 'already-resolved',
      outcome: { kind: 'nothing' },
    })
  })

  it('uses an explicit inspect flag without requiring an object id', () => {
    expect(planInteraction({
      effect: { kind: 'inspect', flag: 'royal-decree-read' },
      ref: undefined,
      state: baseState(),
    })).toMatchObject({
      status: 'apply',
      commands: [{ flags: { 'royal-decree-read': true } }],
    })
  })

  it('rejects one-shot effects without a stable id or explicit flag', () => {
    expect(planInteraction({
      effect: { kind: 'inspect' },
      ref: undefined,
      state: baseState(),
    })).toEqual({ status: 'rejected', reason: 'missing-id' })
    expect(planInteraction({
      effect: {
        kind: 'take-item',
        item: { itemId: 'key', name: 'Iron Key', quantity: 1 },
      },
      ref: undefined,
      state: baseState(),
    })).toEqual({ status: 'rejected', reason: 'missing-id' })
  })

  it('plans take-item in item-first then idempotency-flag order', () => {
    const plan = planInteraction({
      effect: {
        kind: 'take-item',
        item: { itemId: 'bandage', name: 'Bandage', quantity: 2 },
      },
      ref: 'medical-crate',
      state: baseState(),
    })
    expect(plan).toEqual({
      status: 'apply',
      commands: [
        {
          schemaVersion: 1,
          type: 'item-added',
          item: { itemId: 'bandage', name: 'Bandage', quantity: 2 },
        },
        {
          schemaVersion: 1,
          type: 'room-state-changed',
          roomId: 'safehouse',
          flags: { 'interaction:medical-crate': true },
        },
      ],
      outcome: {
        kind: 'item-taken',
        item: { itemId: 'bandage', name: 'Bandage', quantity: 2 },
      },
    })
  })

  it('plans use-item at the exact held boundary, with and without health', () => {
    expect(planInteraction({
      effect: { kind: 'use-item', itemId: 'medkit', quantity: 2 },
      ref: undefined,
      state: baseState(),
    })).toEqual({
      status: 'apply',
      commands: [{ schemaVersion: 1, type: 'item-removed', itemId: 'medkit', quantity: 2 }],
      outcome: { kind: 'item-used', itemId: 'medkit', quantityUsed: 2 },
    })

    expect(planInteraction({
      effect: {
        kind: 'use-item',
        itemId: 'medkit',
        quantity: 1,
        health: { delta: 25 },
      },
      ref: undefined,
      state: baseState(),
    })).toEqual({
      status: 'apply',
      commands: [
        { schemaVersion: 1, type: 'item-removed', itemId: 'medkit', quantity: 1 },
        { schemaVersion: 1, type: 'health-changed', delta: 25 },
      ],
      outcome: {
        kind: 'item-used',
        itemId: 'medkit',
        quantityUsed: 1,
        healthDelta: 25,
      },
    })
  })

  it('rejects use-item when held quantity is insufficient', () => {
    expect(planInteraction({
      effect: { kind: 'use-item', itemId: 'medkit', quantity: 3 },
      ref: undefined,
      state: baseState(),
    })).toEqual({ status: 'rejected', reason: 'insufficient-item' })
  })

  it('is deterministic and never mutates its effect or state inputs', () => {
    const effect = {
      kind: 'take-item',
      item: { itemId: 'key', name: 'SECRET KEY NAME', quantity: 1 },
    } as const
    const state = baseState()
    const effectBefore = structuredClone(effect)
    const stateBefore = structuredClone(state)
    const first = planInteraction({ effect, ref: 'locker', state })
    const second = planInteraction({ effect, ref: 'locker', state })
    expect(first).toEqual(second)
    expect(effect).toEqual(effectBefore)
    expect(state).toEqual(stateBefore)
  })
})
