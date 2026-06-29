import { WorldCommandSchema } from '../world/events'
import type { WorldCommand } from '../world/events'
import type { InventoryItem, WorldState } from '../world/worldState'
import type { InteractionEffect } from './effects'

export type InteractionOutcome =
  | { kind: 'inspected' }
  | { kind: 'item-taken'; item: InventoryItem }
  | {
      kind: 'item-used'
      itemId: string
      quantityUsed: number
      healthDelta?: number
    }
  | { kind: 'nothing' }

export type InteractionRejectionReason =
  | 'missing-id'
  | 'missing-effect'
  | 'insufficient-item'

export type InteractionPlan =
  | { status: 'apply'; commands: WorldCommand[]; outcome: InteractionOutcome }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' } }
  | { status: 'rejected'; reason: InteractionRejectionReason }

export type PlanInteractionInput = {
  effect: InteractionEffect
  ref: string | undefined
  state: WorldState
}

export function planInteraction(input: PlanInteractionInput): InteractionPlan {
  const { effect, ref, state } = input
  switch (effect.kind) {
    case 'inspect':
      return planInspect(effect, ref, state)
    case 'take-item':
      return planTakeItem(effect, ref, state)
    case 'use-item':
      return planUseItem(effect, state)
    default:
      return assertNever(effect)
  }
}

function planInspect(
  effect: Extract<InteractionEffect, { kind: 'inspect' }>,
  ref: string | undefined,
  state: WorldState,
): InteractionPlan {
  const flagKey = interactionFlagKey(effect.flag, ref)
  if (flagKey === undefined) return { status: 'rejected', reason: 'missing-id' }
  if (isFlagSet(state, flagKey)) return alreadyResolved()

  return {
    status: 'apply',
    commands: [roomFlagCommand(state.currentRoomId, flagKey)],
    outcome: { kind: 'inspected' },
  }
}

function planTakeItem(
  effect: Extract<InteractionEffect, { kind: 'take-item' }>,
  ref: string | undefined,
  state: WorldState,
): InteractionPlan {
  const flagKey = interactionFlagKey(undefined, ref)
  if (flagKey === undefined) return { status: 'rejected', reason: 'missing-id' }
  if (isFlagSet(state, flagKey)) return alreadyResolved()

  const item = { ...effect.item }
  return {
    status: 'apply',
    commands: [
      WorldCommandSchema.parse({ schemaVersion: 1, type: 'item-added', item }),
      roomFlagCommand(state.currentRoomId, flagKey),
    ],
    outcome: { kind: 'item-taken', item: { ...item } },
  }
}

function planUseItem(
  effect: Extract<InteractionEffect, { kind: 'use-item' }>,
  state: WorldState,
): InteractionPlan {
  const held = state.inventory.find((item) => item.itemId === effect.itemId)?.quantity ?? 0
  if (held < effect.quantity) {
    return { status: 'rejected', reason: 'insufficient-item' }
  }

  const commands: WorldCommand[] = [
    WorldCommandSchema.parse({
      schemaVersion: 1,
      type: 'item-removed',
      itemId: effect.itemId,
      quantity: effect.quantity,
    }),
  ]
  if (effect.health) {
    commands.push(WorldCommandSchema.parse({
      schemaVersion: 1,
      type: 'health-changed',
      delta: effect.health.delta,
    }))
  }

  return {
    status: 'apply',
    commands,
    outcome: {
      kind: 'item-used',
      itemId: effect.itemId,
      quantityUsed: effect.quantity,
      ...(effect.health ? { healthDelta: effect.health.delta } : {}),
    },
  }
}

export function interactionFlagKey(
  explicitFlag: string | undefined,
  ref: string | undefined,
): string | undefined {
  return explicitFlag ?? (ref ? `interaction:${ref}` : undefined)
}

function isFlagSet(state: WorldState, flagKey: string): boolean {
  return state.roomStates[state.currentRoomId]?.flags?.[flagKey] === true
}

function roomFlagCommand(roomId: string, flagKey: string): WorldCommand {
  return WorldCommandSchema.parse({
    schemaVersion: 1,
    type: 'room-state-changed',
    roomId,
    flags: { [flagKey]: true },
  })
}

function alreadyResolved(): InteractionPlan {
  return { status: 'already-resolved', outcome: { kind: 'nothing' } }
}

function assertNever(value: never): never {
  throw new Error(`unhandled interaction effect: ${String(value)}`)
}
