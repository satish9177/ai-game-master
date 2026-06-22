import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type RoomIssueSeverity = 'fatal' | 'warning'

export type RoomIssueCode =
  | 'room-too-small'
  | 'room-too-large'
  | 'room-unusual-aspect'
  | 'spawn-out-of-bounds'
  | 'spawn-height-unusual'
  | 'object-out-of-bounds'
  | 'object-above-ceiling'
  | 'object-crowds-spawn'
  | 'no-exit'
  | 'object-budget-exceeded'
  | 'object-budget-hard-exceeded'
  | 'light-budget-exceeded'
  | 'light-budget-hard-exceeded'
  | 'interaction-empty-prompt'
  | 'interaction-missing-body'
  | 'npc-unnamed'

export type RoomValidationIssue = {
  code: RoomIssueCode
  severity: RoomIssueSeverity
  message: string
  objectIndex?: number
  objectType?: RoomObject['type']
}

export type RoomValidationResult = {
  ok: boolean
  issues: RoomValidationIssue[]
}

/** Starting thresholds for the deterministic v0 semantic validator. */
export const LIMITS = {
  MIN_ROOM_DIM: 4,
  MIN_ROOM_HEIGHT: 2.2,
  MAX_ROOM_DIM: 300,
  BOUNDS_EPSILON: 0.5,
  SPAWN_CLEARANCE: 1,
  MAX_OBJECTS_SOFT: 60,
  MAX_OBJECTS_HARD: 300,
  MAX_LIGHTS_SOFT: 8,
  MAX_LIGHTS_HARD: 64,
  UNUSUAL_ASPECT_RATIO: 8,
  WALL_CLEARANCE: 0.3,
} as const

const SPAWN_BLOCKING_TYPES = new Set<RoomObject['type']>([
  'throne',
  'pillar',
  'npc',
  'prop',
])

export function validateRoom(room: LoadedRoom): RoomValidationResult {
  const issues: RoomValidationIssue[] = []
  const { width, depth, height } = room.shell.dimensions

  addRoomIssues(room, issues)

  const walkableMargin = room.shell.wallThickness / 2 + LIMITS.WALL_CLEARANCE
  const [spawnX, spawnY, spawnZ] = room.spawn.position
  if (
    spawnX < -(width / 2 - walkableMargin) ||
    spawnX > width / 2 - walkableMargin ||
    spawnZ < -(depth / 2 - walkableMargin) ||
    spawnZ > depth / 2 - walkableMargin
  ) {
    issues.push({
      code: 'spawn-out-of-bounds',
      severity: 'fatal',
      message: `Spawn (${spawnX}, ${spawnZ}) is outside the walkable room bounds.`,
    })
  }
  if (spawnY <= 0 || spawnY >= height) {
    issues.push({
      code: 'spawn-height-unusual',
      severity: 'warning',
      message: `Spawn height ${spawnY} is outside the expected interior range.`,
    })
  }

  room.objects.forEach((object, objectIndex) => {
    addObjectIssues(object, objectIndex, room, issues)
  })

  return {
    ok: !issues.some((issue) => issue.severity === 'fatal'),
    issues,
  }
}

function addRoomIssues(
  room: LoadedRoom,
  issues: RoomValidationIssue[],
): void {
  const { width, depth, height } = room.shell.dimensions
  if (
    width < LIMITS.MIN_ROOM_DIM ||
    depth < LIMITS.MIN_ROOM_DIM ||
    height < LIMITS.MIN_ROOM_HEIGHT
  ) {
    issues.push({
      code: 'room-too-small',
      severity: 'fatal',
      message: 'Room dimensions are below the minimum playable size.',
    })
  }
  if (
    width > LIMITS.MAX_ROOM_DIM ||
    depth > LIMITS.MAX_ROOM_DIM ||
    height > LIMITS.MAX_ROOM_DIM
  ) {
    issues.push({
      code: 'room-too-large',
      severity: 'fatal',
      message: 'Room dimensions exceed the supported maximum size.',
    })
  }
  if (Math.max(width, depth) / Math.min(width, depth) > LIMITS.UNUSUAL_ASPECT_RATIO) {
    issues.push({
      code: 'room-unusual-aspect',
      severity: 'warning',
      message: 'Room footprint has an unusually narrow aspect ratio.',
    })
  }
  if (room.shell.exits.length === 0) {
    issues.push({
      code: 'no-exit',
      severity: 'warning',
      message: 'Room declares no exit.',
    })
  }

  addBudgetIssue(
    room.objects.length,
    LIMITS.MAX_OBJECTS_SOFT,
    LIMITS.MAX_OBJECTS_HARD,
    'object-budget-exceeded',
    'object-budget-hard-exceeded',
    'Room object count exceeds the recommended budget.',
    'Room object count exceeds the hard budget.',
    issues,
  )
  const lightCount = room.objects.filter((object) => object.type === 'torch').length
  addBudgetIssue(
    lightCount,
    LIMITS.MAX_LIGHTS_SOFT,
    LIMITS.MAX_LIGHTS_HARD,
    'light-budget-exceeded',
    'light-budget-hard-exceeded',
    'Room light count exceeds the recommended budget.',
    'Room light count exceeds the hard budget.',
    issues,
  )
}

function addBudgetIssue(
  count: number,
  softLimit: number,
  hardLimit: number,
  softCode: RoomIssueCode,
  hardCode: RoomIssueCode,
  softMessage: string,
  hardMessage: string,
  issues: RoomValidationIssue[],
): void {
  if (count > hardLimit) {
    issues.push({ code: hardCode, severity: 'fatal', message: hardMessage })
  } else if (count > softLimit) {
    issues.push({ code: softCode, severity: 'warning', message: softMessage })
  }
}

function addObjectIssues(
  object: RoomObject,
  objectIndex: number,
  room: LoadedRoom,
  issues: RoomValidationIssue[],
): void {
  const { width, depth, height } = room.shell.dimensions
  const [x, y, z] = object.position
  const objectDetails = { objectIndex, objectType: object.type }

  if (
    Math.abs(x) > width / 2 + LIMITS.BOUNDS_EPSILON ||
    Math.abs(z) > depth / 2 + LIMITS.BOUNDS_EPSILON
  ) {
    issues.push({
      code: 'object-out-of-bounds',
      severity: 'warning',
      message: `Object ${objectIndex} (${object.type}) anchor is outside the room footprint.`,
      ...objectDetails,
    })
  }
  if (y > height) {
    issues.push({
      code: 'object-above-ceiling',
      severity: 'warning',
      message: `Object ${objectIndex} (${object.type}) anchor is above the ceiling.`,
      ...objectDetails,
    })
  }

  const [spawnX, , spawnZ] = room.spawn.position
  if (
    SPAWN_BLOCKING_TYPES.has(object.type) &&
    Math.hypot(x - spawnX, z - spawnZ) < LIMITS.SPAWN_CLEARANCE
  ) {
    issues.push({
      code: 'object-crowds-spawn',
      severity: 'warning',
      message: `Object ${objectIndex} (${object.type}) crowds the spawn anchor.`,
      ...objectDetails,
    })
  }

  if (object.type === 'npc' || object.type === 'scroll') {
    if (object.interaction.prompt.trim() === '') {
      issues.push({
        code: 'interaction-empty-prompt',
        severity: 'warning',
        message: `Object ${objectIndex} (${object.type}) has an empty interaction prompt.`,
        ...objectDetails,
      })
    }
    if (!object.interaction.body || object.interaction.body.trim() === '') {
      issues.push({
        code: 'interaction-missing-body',
        severity: 'warning',
        message: `Object ${objectIndex} (${object.type}) has no interaction body.`,
        ...objectDetails,
      })
    }
  }
  if (object.type === 'npc' && object.name.trim() === '') {
    issues.push({
      code: 'npc-unnamed',
      severity: 'warning',
      message: `Object ${objectIndex} (npc) has an empty name.`,
      ...objectDetails,
    })
  }
}
