import type { AffordanceAction } from './contracts'
import type { InteractionEffect } from '../interactions/effects'
import type { RoomObject } from '../roomSpec'
import type { InventoryItem, RoomState } from '../world/worldState'

export type MeaningfulObjectFamily = 'document' | 'container' | 'remains'
export type MeaningfulObjectAction = Extract<AffordanceAction, 'inspect' | 'read' | 'open' | 'search'>
export type MeaningfulObjectState = 'closed' | 'open' | 'read' | 'looted' | 'unsearched'
export type MeaningfulObjectPersistentState = Extract<MeaningfulObjectState, 'open' | 'read' | 'looted'>
export type MeaningfulObjectChoice = Readonly<{ id: MeaningfulObjectAction; label: string }>

export type MeaningfulObjectView = Readonly<{
  family: MeaningfulObjectFamily
  state: MeaningfulObjectState
  choices: readonly MeaningfulObjectChoice[]
}>

const FAMILY_BY_TYPE: Partial<Record<RoomObject['type'], MeaningfulObjectFamily>> = {
  scroll: 'document',
  book: 'document',
  paper: 'document',
  map: 'document',
  chest: 'container',
  crate: 'container',
  barrel: 'container',
  corpse: 'remains',
}

const STATE_ACTIONS: Record<MeaningfulObjectFamily, Readonly<Record<MeaningfulObjectState, readonly MeaningfulObjectAction[]>>> = {
  document: {
    closed: ['inspect', 'read'],
    open: [],
    unsearched: [],
    read: ['inspect'],
    looted: [],
  },
  container: {
    closed: ['inspect', 'open'],
    open: ['inspect', 'search'],
    unsearched: [],
    read: [],
    looted: ['inspect'],
  },
  remains: {
    closed: [],
    open: [],
    unsearched: ['inspect', 'search'],
    read: [],
    looted: ['inspect'],
  },
}

const CHOICE_LABELS: Record<MeaningfulObjectAction, string> = {
  inspect: 'Inspect',
  read: 'Read',
  open: 'Open',
  search: 'Search',
}

export function meaningfulObjectStateFlagKey(
  objectId: string,
  state: MeaningfulObjectPersistentState,
): string {
  return `meaningful-object:${encodeURIComponent(objectId)}:${state}`
}

export function meaningfulObjectFamily(object: RoomObject): MeaningfulObjectFamily | undefined {
  return FAMILY_BY_TYPE[object.type]
}

export function deriveMeaningfulObjectView(input: {
  object: RoomObject
  roomState?: RoomState
  generatedPlay: boolean
}): MeaningfulObjectView | undefined {
  const family = meaningfulObjectFamily(input.object)
  if (!input.generatedPlay || family === undefined || !isEligibleObject(input.object)) return undefined

  const state = deriveMeaningfulObjectState(input.object, input.roomState, family)
  return {
    family,
    state,
    choices: STATE_ACTIONS[family][state].map((id) => ({ id, label: CHOICE_LABELS[id] })),
  }
}

export function deriveMeaningfulObjectState(
  object: RoomObject,
  roomState: RoomState | undefined,
  family = meaningfulObjectFamily(object),
): MeaningfulObjectState {
  if (object.id === undefined || family === undefined) return family === 'remains' ? 'unsearched' : 'closed'
  const flags = roomState?.flags
  const has = (state: MeaningfulObjectPersistentState) =>
    flags?.[meaningfulObjectStateFlagKey(object.id!, state)] === true

  if (family === 'document') return has('read') ? 'read' : 'closed'
  if (family === 'container') {
    if (has('looted') || hasLegacyLoot(object, flags)) return 'looted'
    return has('open') ? 'open' : 'closed'
  }
  return has('looted') || hasLegacyLoot(object, flags) ? 'looted' : 'unsearched'
}

export function derivedTransition(
  family: MeaningfulObjectFamily,
  action: Exclude<MeaningfulObjectAction, 'inspect'>,
): MeaningfulObjectPersistentState | undefined {
  if (family === 'document' && action === 'read') return 'read'
  if (family === 'container' && action === 'open') return 'open'
  if ((family === 'container' || family === 'remains') && action === 'search') return 'looted'
  return undefined
}

export function validatedSearchItem(object: RoomObject): InventoryItem | undefined {
  const effect = interactionEffect(object)
  return effect?.kind === 'take-item' ? { ...effect.item } : undefined
}

export function isEligibleObject(object: RoomObject): boolean {
  if (object.id === undefined || object.id.length === 0) return false
  const interaction = interactionFor(object)
  if (!interaction || interaction.exit || interaction.encounter || interaction.dialogue) return false
  const family = meaningfulObjectFamily(object)
  if (family === undefined) return false
  const effect = interaction.effect
  if (effect === undefined) return false
  return effect.kind === 'inspect' || (family !== 'document' && effect.kind === 'take-item')
}

export function sameInventoryItem(
  left: InventoryItem | undefined,
  right: InventoryItem | undefined,
): boolean {
  return left?.itemId === right?.itemId
    && left?.name === right?.name
    && left?.quantity === right?.quantity
}

function hasLegacyLoot(
  object: RoomObject,
  flags: Readonly<Record<string, boolean>> | undefined,
): boolean {
  const effect = interactionEffect(object)
  return (meaningfulObjectFamily(object) === 'container' || meaningfulObjectFamily(object) === 'remains')
    && effect?.kind === 'take-item'
    && object.id !== undefined
    && flags?.[`interaction:${object.id}`] === true
}

function interactionFor(
  object: RoomObject,
): Extract<RoomObject, { interaction?: unknown }>['interaction'] | undefined {
  return 'interaction' in object ? object.interaction : undefined
}

function interactionEffect(object: RoomObject): InteractionEffect | undefined {
  return interactionFor(object)?.effect
}
