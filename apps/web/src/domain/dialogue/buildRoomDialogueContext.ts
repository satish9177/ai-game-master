import { selectGeneratedStoryAnchorIndex } from '../generatedRoomComposition'
import { affordanceForInteractableObject, type Affordance } from '../ports/interaction'
import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'
import type { RoomDialogueContext, RoomDialogueFeature, RoomFeatureDirection } from './contracts'

const CENTER_EPSILON = 1
const MAX_FEATURES = 4
const MAX_NPC_COUNT = 10

const NOTABLE_FEATURE_TYPES: readonly RoomObject['type'][] = [
  'corpse',
  'altar',
  'statue',
  'throne',
  'chest',
  'map',
  'book',
  'paper',
  'scroll',
  'machine',
  'artifact',
  'table',
  'barricade',
  'debris',
  'zombie',
]

const AFFORDANCE_ORDER: readonly Affordance[] = [
  'inspect',
  'talk',
  'take',
  'use',
  'exit',
  'approach',
]

export function buildRoomDialogueContext(room: LoadedRoom): RoomDialogueContext {
  const focus = selectFocus(room.objects)
  return {
    ...(focus ? { focus } : {}),
    features: selectFeatures(room.objects),
    affordances: selectAffordances(room.objects),
    npcCount: Math.min(countNpcs(room.objects), MAX_NPC_COUNT),
  }
}

function countNpcs(objects: RoomObject[]): number {
  return objects.filter((object) => object.type === 'npc').length
}

function selectFocus(objects: RoomObject[]): RoomDialogueFeature | undefined {
  const storyAnchorIndex = selectGeneratedStoryAnchorIndex(objects)
  const focusIndex = storyAnchorIndex !== -1
    ? storyAnchorIndex
    : objects.findIndex(isFallbackFocusObject)
  const object = focusIndex === -1 ? undefined : objects[focusIndex]
  return object ? featureFor(object) : undefined
}

function selectFeatures(objects: RoomObject[]): RoomDialogueFeature[] {
  const features: RoomDialogueFeature[] = []

  for (const type of NOTABLE_FEATURE_TYPES) {
    const object = objects.find((candidate) => candidate.type === type)
    if (!object) continue
    features.push(featureFor(object))
    if (features.length >= MAX_FEATURES) break
  }

  return features
}

function selectAffordances(objects: RoomObject[]): Affordance[] {
  const present = new Set<Affordance>()

  for (const object of objects) {
    const affordance = affordanceForInteractableObject(object)
    if (affordance) present.add(affordance)
  }

  return AFFORDANCE_ORDER.filter((affordance) => present.has(affordance))
}

function isFallbackFocusObject(object: RoomObject): boolean {
  return hasNonExitInteraction(object) || object.type === 'npc'
}

function hasNonExitInteraction(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction != null && object.interaction.exit == null
}

function featureFor(object: RoomObject): RoomDialogueFeature {
  return {
    type: object.type,
    direction: directionFor(object.position),
  }
}

function directionFor(position: RoomObject['position']): RoomFeatureDirection {
  const [x, , z] = position
  if (Math.abs(x) <= CENTER_EPSILON && Math.abs(z) <= CENTER_EPSILON) return 'center'
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'east' : 'west'
  return z < 0 ? 'north' : 'south'
}
