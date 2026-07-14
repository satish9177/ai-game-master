import { resolvedObjectIds as deriveResolvedObjectIds } from '../interactions/resolvedObjects'
import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'
import type { RoomState } from '../world/worldState'
import type { ObjectInteractionState, ObjectPresentationState } from './contracts'

/** Boolean-only result compatible with the existing authored/generated gate evaluators. */
export type ExitGatePresentationResult = Readonly<{ gated: boolean }>
export type ExitGatePresentationResults = ReadonlyMap<string, ExitGatePresentationResult>
export type ObjectPresentationStateMap = ReadonlyMap<string, ObjectPresentationState>

export type RoomObjectPresentationInput = Readonly<{
  room: LoadedRoom
  roomState?: RoomState
  /** Reuses the existing App projection when it has already been computed. */
  resolvedObjectIds?: ReadonlySet<string>
  /** Keyed by validated interaction.exit.toRoomId. */
  exitGateResults?: ExitGatePresentationResults
}>

type ObjectPresentationInput = Readonly<{
  resolved?: boolean
  exitGateResult?: ExitGatePresentationResult
}>

/**
 * Projects one validated RoomObject into renderer-neutral visual state.
 * Static condition and dynamic interaction state remain orthogonal.
 */
export function projectObjectPresentationState(
  object: RoomObject,
  input: ObjectPresentationInput = {},
): ObjectPresentationState {
  const resolved = input.resolved === true
  return {
    condition: 'condition' in object && object.condition !== undefined
      ? object.condition
      : 'intact',
    interactionState: interactionStateFor(object, resolved, input.exitGateResult),
    resolved,
  }
}

/**
 * Builds the live-update map consumed by the RoomViewer/Engine seam. Objects
 * without IDs still receive their initial state through
 * projectObjectPresentationState during trusted scene construction.
 */
export function projectRoomObjectPresentationStates(
  input: RoomObjectPresentationInput,
): ObjectPresentationStateMap {
  const resolvedIds = input.resolvedObjectIds
    ?? deriveResolvedObjectIds(input.room, input.roomState)
  const states = new Map<string, ObjectPresentationState>()

  for (const object of input.room.objects) {
    if (object.id === undefined || states.has(object.id)) continue
    const exitTarget = interactionFor(object)?.exit?.toRoomId
    states.set(object.id, projectObjectPresentationState(object, {
      resolved: resolvedIds.has(object.id),
      ...(exitTarget === undefined
        ? {}
        : { exitGateResult: input.exitGateResults?.get(exitTarget) }),
    }))
  }

  return states
}

function interactionStateFor(
  object: RoomObject,
  resolved: boolean,
  exitGateResult: ExitGatePresentationResult | undefined,
): ObjectInteractionState {
  const interaction = interactionFor(object)

  if (interaction?.exit !== undefined) {
    return exitGateResult?.gated === true ? 'locked' : 'open'
  }

  const effect = interaction?.effect
  if (effect !== undefined) {
    switch (effect.kind) {
      case 'take-item':
        return resolved ? 'looted' : 'closed'
      case 'inspect':
        return resolved ? resolvedInspectState(object) : defaultInteractionState(object)
      case 'use-item':
        return resolved ? 'activated' : defaultInteractionState(object)
      default:
        return assertNever(effect)
    }
  }

  return defaultInteractionState(object)
}

function resolvedInspectState(object: RoomObject): ObjectInteractionState {
  if (isDocument(object)) return 'read'
  if (isContainer(object)) return 'open'
  return 'activated'
}

function defaultInteractionState(object: RoomObject): ObjectInteractionState {
  return isContainer(object) ? 'closed' : 'none'
}

function isDocument(object: RoomObject): boolean {
  return object.type === 'scroll'
    || object.type === 'book'
    || object.type === 'paper'
    || object.type === 'map'
}

function isContainer(object: RoomObject): boolean {
  if (object.type === 'chest' || object.type === 'crate' || object.type === 'barrel') {
    return true
  }
  if (object.type === 'arch') {
    return object.variant === 'wood-door' || object.variant === 'iron-gate'
  }
  if (object.type === 'architecture') {
    return object.kind === 'gate' || object.kind === 'trapdoor'
  }
  if (object.type === 'furniture') {
    return object.kind === 'cabinet' || object.kind === 'wardrobe'
  }
  return false
}

function interactionFor(
  object: RoomObject,
): Extract<RoomObject, { interaction?: unknown }>['interaction'] | undefined {
  return 'interaction' in object ? object.interaction : undefined
}

function assertNever(value: never): never {
  throw new Error(`unhandled interaction effect: ${String(value)}`)
}
