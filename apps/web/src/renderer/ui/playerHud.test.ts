import { describe, expect, it } from 'vitest'
import { projectPlayerHud } from './playerHud'
import type { WorldState } from '../../domain/world/worldState'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function makeState(overrides: {
  health?: { current: number; max: number }
  status?: string[]
  inventory?: Array<{ itemId: string; name: string; quantity: number }>
}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'room-1',
    player: {
      health: overrides.health ?? { current: 100, max: 100 },
      status: overrides.status ?? [],
    },
    inventory: overrides.inventory ?? [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
  }
}

describe('projectPlayerHud', () => {
  describe('health label and fraction', () => {
    it('maps current and max to health fields', () => {
      const view = projectPlayerHud(makeState({ health: { current: 60, max: 100 } }))
      expect(view.health.current).toBe(60)
      expect(view.health.max).toBe(100)
    })

    it('computes partial fraction', () => {
      const view = projectPlayerHud(makeState({ health: { current: 75, max: 100 } }))
      expect(view.health.fraction).toBe(0.75)
    })

    it('computes full health fraction as 1', () => {
      const view = projectPlayerHud(makeState({ health: { current: 100, max: 100 } }))
      expect(view.health.fraction).toBe(1)
    })

    it('computes 0 health fraction as 0', () => {
      const view = projectPlayerHud(makeState({ health: { current: 0, max: 100 } }))
      expect(view.health.fraction).toBe(0)
    })

    it('guards max <= 0 by returning fraction 0', () => {
      // Schema always has max > 0; this guards the defensive branch
      const view = projectPlayerHud(makeState({ health: { current: 0, max: 0 } }))
      expect(view.health.fraction).toBe(0)
    })

    it('preserves exact integer values without rounding', () => {
      const view = projectPlayerHud(makeState({ health: { current: 33, max: 200 } }))
      expect(view.health.current).toBe(33)
      expect(view.health.max).toBe(200)
    })
  })

  describe('inventory', () => {
    it('returns empty items array for empty inventory', () => {
      const view = projectPlayerHud(makeState({ inventory: [] }))
      expect(view.items).toEqual([])
    })

    it('maps single item with correct fields', () => {
      const view = projectPlayerHud(makeState({
        inventory: [{ itemId: 'potion', name: 'Health Potion', quantity: 3 }],
      }))
      expect(view.items).toEqual([{ itemId: 'potion', name: 'Health Potion', quantity: 3 }])
    })

    it('maps multiple items preserving authoritative order', () => {
      const view = projectPlayerHud(makeState({
        inventory: [
          { itemId: 'sword', name: 'Iron Sword', quantity: 1 },
          { itemId: 'potion', name: 'Health Potion', quantity: 2 },
          { itemId: 'key', name: 'Rusty Key', quantity: 1 },
        ],
      }))
      expect(view.items.map((i) => i.itemId)).toEqual(['sword', 'potion', 'key'])
      expect(view.items.map((i) => i.quantity)).toEqual([1, 2, 1])
    })
  })

  describe('stable ordering', () => {
    it('same input produces same item order', () => {
      const state = makeState({
        inventory: [
          { itemId: 'a', name: 'A', quantity: 1 },
          { itemId: 'b', name: 'B', quantity: 1 },
        ],
      })
      const first = projectPlayerHud(state)
      const second = projectPlayerHud(state)
      expect(first.items.map((i) => i.itemId)).toEqual(second.items.map((i) => i.itemId))
    })

    it('same input produces same status order', () => {
      const state = makeState({ status: ['poisoned', 'burning'] })
      expect(projectPlayerHud(state).statuses).toEqual(projectPlayerHud(state).statuses)
    })
  })

  describe('status chips view model', () => {
    it('returns empty statuses for empty status array', () => {
      const view = projectPlayerHud(makeState({ status: [] }))
      expect(view.statuses).toEqual([])
    })

    it('maps non-empty statuses preserving order', () => {
      const view = projectPlayerHud(makeState({ status: ['poisoned', 'burning'] }))
      expect(view.statuses).toEqual(['poisoned', 'burning'])
    })
  })

  describe('projection does not mutate input', () => {
    it('input inventory array is not mutated', () => {
      const state = makeState({
        inventory: [{ itemId: 'key', name: 'Key', quantity: 1 }],
      })
      const originalItems = [...state.inventory]
      projectPlayerHud(state)
      expect(state.inventory).toEqual(originalItems)
    })

    it('input status array is not mutated', () => {
      const state = makeState({ status: ['poisoned'] })
      const originalStatus = [...state.player.status]
      projectPlayerHud(state)
      expect(state.player.status).toEqual(originalStatus)
    })

    it('returned items array is a fresh reference', () => {
      const state = makeState({
        inventory: [{ itemId: 'gem', name: 'Gem', quantity: 1 }],
      })
      const view = projectPlayerHud(state)
      expect(view.items).not.toBe(state.inventory)
    })

    it('returned statuses array is a fresh reference', () => {
      const state = makeState({ status: ['cursed'] })
      const view = projectPlayerHud(state)
      expect(view.statuses).not.toBe(state.player.status)
    })
  })
})
