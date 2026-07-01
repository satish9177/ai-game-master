import type { WorldEvent } from './events'
import type { RoomState, WorldState } from './worldState'

export function applyEvent(state: WorldState | null, event: WorldEvent): WorldState {
  if (event.type === 'session-started') {
    if (state !== null) throw new Error('session-started must be the first event')

    const { seed } = event.payload
    return {
      schemaVersion: 1,
      worldId: seed.worldId,
      sessionId: event.sessionId,
      currentRoomId: seed.startingRoomId,
      player: {
        health: { ...seed.initialPlayer.health },
        status: [...new Set(seed.initialPlayer.status)],
      },
      inventory: seed.initialPlayer.inventory.map((item) => ({ ...item })),
      roomStates: { [seed.startingRoomId]: { visited: true } },
      revision: event.seq,
      updatedAt: event.occurredAt,
    }
  }

  if (state === null) throw new Error('the first event must be session-started')

  let next: WorldState
  switch (event.type) {
    case 'moved-to-room': {
      const existing = state.roomStates[event.payload.toRoomId]
      next = {
        ...state,
        currentRoomId: event.payload.toRoomId,
        roomStates: {
          ...state.roomStates,
          [event.payload.toRoomId]: existing
            ? {
                ...existing,
                visited: true,
                ...(existing.flags ? { flags: { ...existing.flags } } : {}),
              }
            : { visited: true },
        },
      }
      break
    }
    case 'item-added': {
      const existingIndex = state.inventory.findIndex(
        (item) => item.itemId === event.payload.item.itemId,
      )
      const inventory = state.inventory.map((item) => ({ ...item }))
      if (existingIndex === -1) {
        inventory.push({ ...event.payload.item })
      } else {
        const existing = inventory[existingIndex]!
        inventory[existingIndex] = {
          ...existing,
          quantity: existing.quantity + event.payload.item.quantity,
        }
      }
      next = { ...state, inventory }
      break
    }
    case 'item-discovered': {
      next = { ...state }
      break
    }
    case 'item-removed': {
      const inventory = state.inventory.flatMap((item) => {
        if (item.itemId !== event.payload.itemId) return [{ ...item }]
        const quantity = Math.max(0, item.quantity - event.payload.quantity)
        return quantity === 0 ? [] : [{ ...item, quantity }]
      })
      next = { ...state, inventory }
      break
    }
    case 'health-changed': {
      const { current, max } = state.player.health
      next = {
        ...state,
        player: {
          ...state.player,
          health: { current: Math.min(max, Math.max(0, current + event.payload.delta)), max },
          status: [...state.player.status],
        },
      }
      break
    }
    case 'status-changed': {
      const statuses = new Set(state.player.status)
      if (event.payload.op === 'add') statuses.add(event.payload.status)
      else statuses.delete(event.payload.status)
      next = {
        ...state,
        player: {
          ...state.player,
          health: { ...state.player.health },
          status: [...statuses],
        },
      }
      break
    }
    case 'room-state-changed': {
      const existing = state.roomStates[event.payload.roomId] ?? { visited: false }
      const roomState: RoomState = {
        visited: event.payload.visited ?? existing.visited,
      }
      const flags = event.payload.flags
        ? { ...(existing.flags ?? {}), ...event.payload.flags }
        : existing.flags
      if (flags !== undefined) roomState.flags = { ...flags }
      next = {
        ...state,
        roomStates: { ...state.roomStates, [event.payload.roomId]: roomState },
      }
      break
    }
    default:
      return assertNever(event)
  }

  return { ...next, revision: event.seq, updatedAt: event.occurredAt }
}

export function projectWorldState(log: readonly WorldEvent[]): WorldState {
  let state: WorldState | null = null
  for (const event of log) state = applyEvent(state, event)
  if (state === null) throw new Error('cannot project an empty event log')
  return state
}

function assertNever(value: never): never {
  throw new Error(`unhandled world event: ${String(value)}`)
}
