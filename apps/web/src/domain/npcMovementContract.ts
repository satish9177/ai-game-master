import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { computePlayableBounds, isInsidePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import type { PlayableBounds } from './generatedRoomLayout'
import { stableHash01 } from './stableHash'
import { LIMITS } from './validateRoom'

export const NPC_WANDER = {
  MAX_RADIUS_FROM_HOME: 2.5,
  MAX_SPEED: 0.8,
  STEP_MIN: 0.6,
  STEP_MAX: 1.6,
  EXIT_CLEARANCE: 1.6,
  INTERACTABLE_CLEARANCE: 1.4,
  SEGMENT_SAMPLE_SPACING: 0.4,
  PAUSE_MIN_S: 1.5,
  PAUSE_MAX_S: 4.5,
} as const

export type WanderXZ = Readonly<{ x: number; z: number }>

export type NpcWanderExclusionReason =
  | 'spawn'
  | 'exit'
  | 'interactable'
  | 'npc-home'
  | 'footprint'

export type NpcWanderExclusionDisc = Readonly<{
  x: number
  z: number
  radius: number
  reason: NpcWanderExclusionReason
  objectId?: string
  objectType?: RoomObject['type']
}>

export type NpcWanderField = Readonly<{
  roomId: string
  npcId: string
  home: WanderXZ
  bounds: PlayableBounds
  exclusions: readonly NpcWanderExclusionDisc[]
}>

export type WanderStep = Readonly<{ target: WanderXZ }>

const CANDIDATE_COUNT = 24

export function buildNpcWanderField(
  room: LoadedRoom,
  npcObjectId: string,
): NpcWanderField | null {
  const npc = room.objects.find((object) => object.id === npcObjectId)
  if (!npc || npc.type !== 'npc') return null

  const [homeX, , homeZ] = npc.position
  const exclusions: NpcWanderExclusionDisc[] = [{
    x: room.spawn.position[0],
    z: room.spawn.position[2],
    radius: LIMITS.SPAWN_CLEARANCE,
    reason: 'spawn',
  }]

  for (const object of room.objects) {
    if (object === npc) continue
    const [x, , z] = object.position
    const interaction = 'interaction' in object ? object.interaction : undefined
    const objectFields = {
      ...(object.id !== undefined ? { objectId: object.id } : {}),
      objectType: object.type,
    }

    if (interaction?.exit !== undefined) {
      exclusions.push({
        x,
        z,
        radius: NPC_WANDER.EXIT_CLEARANCE,
        reason: 'exit',
        ...objectFields,
      })
      continue
    }

    if (object.type === 'npc') {
      exclusions.push({
        x,
        z,
        radius: NPC_WANDER.INTERACTABLE_CLEARANCE,
        reason: 'npc-home',
        ...objectFields,
      })
      continue
    }

    if (interaction !== undefined) {
      exclusions.push({
        x,
        z,
        radius: NPC_WANDER.INTERACTABLE_CLEARANCE,
        reason: 'interactable',
        ...objectFields,
      })
      continue
    }

    exclusions.push({
      x,
      z,
      radius: objectFootprintRadius(object),
      reason: 'footprint',
      ...objectFields,
    })
  }

  return {
    roomId: room.id,
    npcId: npcObjectId,
    home: { x: homeX, z: homeZ },
    bounds: computePlayableBounds(room.shell.dimensions, room.shell.wallThickness),
    exclusions,
  }
}

export function isWanderPositionAllowed(field: NpcWanderField, position: WanderXZ): boolean {
  if (!isInsidePlayableBounds([position.x, 0, position.z], field.bounds)) return false
  if (distanceXZ(field.home, position) > NPC_WANDER.MAX_RADIUS_FROM_HOME) return false
  return field.exclusions.every((disc) => distanceXZ(disc, position) >= disc.radius)
}

export function chooseWanderStep(
  field: NpcWanderField,
  current: WanderXZ,
  seed: number,
  stepIndex: number,
): WanderStep | null {
  const key = `${field.roomId}:${field.npcId}:${fixed(current.x)}:${fixed(current.z)}:${seed}:${stepIndex}`
  for (let candidate = 0; candidate < CANDIDATE_COUNT; candidate += 1) {
    const angle = stableHash01(`${key}:angle:${candidate}`) * Math.PI * 2
    const length01 = stableHash01(`${key}:length:${candidate}`)
    const length = NPC_WANDER.STEP_MIN
      + length01 * (NPC_WANDER.STEP_MAX - NPC_WANDER.STEP_MIN)
    const target = {
      x: current.x + Math.cos(angle) * length,
      z: current.z + Math.sin(angle) * length,
    }
    if (isWanderSegmentAllowed(field, current, target)) return { target }
  }
  return null
}

export function wanderPauseSeconds(seed: number, stepIndex: number): number {
  const t = stableHash01(`${seed}:${stepIndex}:pause`)
  return NPC_WANDER.PAUSE_MIN_S + t * (NPC_WANDER.PAUSE_MAX_S - NPC_WANDER.PAUSE_MIN_S)
}

export function shouldPauseWander(input: {
  interactionLocked: boolean
  npcTalking: boolean
}): boolean {
  return input.interactionLocked || input.npcTalking
}

function isWanderSegmentAllowed(field: NpcWanderField, start: WanderXZ, end: WanderXZ): boolean {
  const distance = distanceXZ(start, end)
  const samples = Math.max(1, Math.ceil(distance / NPC_WANDER.SEGMENT_SAMPLE_SPACING))
  for (let sample = 0; sample <= samples; sample += 1) {
    const t = sample / samples
    if (!isWanderPositionAllowed(field, {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    })) return false
  }
  return true
}

function distanceXZ(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function fixed(value: number): string {
  return value.toFixed(3)
}
