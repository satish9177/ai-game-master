import type { WorldState } from '../../domain/world/worldState'

export type PlayerHudHealth = {
  current: number
  max: number
  /** current/max as a 0..1 fraction, 0 when max <= 0; for the bar width only. */
  fraction: number
}

export type PlayerHudItem = {
  itemId: string
  name: string
  quantity: number
}

export type PlayerHudView = {
  health: PlayerHudHealth
  items: PlayerHudItem[]
  statuses: string[]
}

export function projectPlayerHud(state: WorldState): PlayerHudView {
  const { current, max } = state.player.health
  const fraction = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0

  return {
    health: { current, max, fraction },
    items: state.inventory.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      quantity: item.quantity,
    })),
    statuses: [...state.player.status],
  }
}
