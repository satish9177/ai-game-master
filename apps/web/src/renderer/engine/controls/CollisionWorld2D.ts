export type Point2D = Readonly<{ x: number; z: number }>

export type StaticCollider2D =
  | Readonly<{
      id: string
      kind: 'circle'
      center: Point2D
      radius: number
    }>
  | Readonly<{
      id: string
      kind: 'box'
      center: Point2D
      halfExtents: readonly [number, number]
      rotationY: number
    }>

export type CollisionMoveResult = Readonly<{
  position: Point2D
  collided: boolean
}>

/**
 * Deterministic static 2D collision world for room furniture/architecture.
 * It is deliberately not a physics engine: no velocity authority, impulses,
 * rigid bodies, or world-state mutation.
 */
export class CollisionWorld2D {
  private readonly colliders = new Map<string, StaticCollider2D>()
  private readonly buckets = new Map<string, Set<string>>()


  /** Stable read-only collider view for trusted renderer diagnostics/tests. */
  snapshot(): readonly StaticCollider2D[] {
    return [...this.colliders.values()]
  }
  private readonly cellSize: number
  constructor(cellSize = 2) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('collision cell size must be positive')
    }
    this.cellSize = cellSize
  }

  get size(): number {
    return this.colliders.size
  }

  add(collider: StaticCollider2D): void {
    if (this.colliders.has(collider.id)) this.remove(collider.id)
    this.colliders.set(collider.id, collider)
    for (const key of this.bucketKeys(colliderBounds(collider))) {
      const bucket = this.buckets.get(key) ?? new Set<string>()
      bucket.add(collider.id)
      this.buckets.set(key, bucket)
    }
  }

  remove(id: string): void {
    if (!this.colliders.delete(id)) return
    for (const [key, ids] of this.buckets) {
      ids.delete(id)
      if (ids.size === 0) this.buckets.delete(key)
    }
  }

  clear(): void {
    this.colliders.clear()
    this.buckets.clear()
  }

  collidesCircle(center: Point2D, radius: number): boolean {
    const bounds = {
      minX: center.x - radius,
      maxX: center.x + radius,
      minZ: center.z - radius,
      maxZ: center.z + radius,
    }
    const checked = new Set<string>()
    for (const key of this.bucketKeys(bounds)) {
      for (const id of this.buckets.get(key) ?? []) {
        if (checked.has(id)) continue
        checked.add(id)
        const collider = this.colliders.get(id)
        if (collider && overlapsCircle(center, radius, collider)) return true
      }
    }
    return false
  }

  moveCircle(
    start: Point2D,
    delta: Point2D,
    radius: number,
  ): CollisionMoveResult {
    const distance = Math.hypot(delta.x, delta.z)
    if (distance === 0) return { position: { ...start }, collided: false }

    const maximumStep = Math.max(0.05, radius * 0.45)
    const steps = Math.max(1, Math.ceil(distance / maximumStep))
    const step = { x: delta.x / steps, z: delta.z / steps }
    let position = { ...start }
    let collided = false

    for (let index = 0; index < steps; index += 1) {
      const direct = { x: position.x + step.x, z: position.z + step.z }
      if (!this.collidesCircle(direct, radius)) {
        position = direct
        continue
      }

      collided = true
      const xOnly = { x: position.x + step.x, z: position.z }
      const zOnly = { x: position.x, z: position.z + step.z }
      const preferX = Math.abs(step.x) >= Math.abs(step.z)
      const first = preferX ? xOnly : zOnly
      const second = preferX ? zOnly : xOnly

      if (!this.collidesCircle(first, radius)) position = first
      else if (!this.collidesCircle(second, radius)) position = second
    }

    return { position, collided }
  }

  private bucketKeys(bounds: Bounds2D): string[] {
    const minX = Math.floor(bounds.minX / this.cellSize)
    const maxX = Math.floor(bounds.maxX / this.cellSize)
    const minZ = Math.floor(bounds.minZ / this.cellSize)
    const maxZ = Math.floor(bounds.maxZ / this.cellSize)
    const keys: string[] = []
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) keys.push(x + ':' + z)
    }
    return keys
  }
}

type Bounds2D = Readonly<{
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}>

export function overlapsCircle(
  center: Point2D,
  radius: number,
  collider: StaticCollider2D,
): boolean {
  if (collider.kind === 'circle') {
    return Math.hypot(center.x - collider.center.x, center.z - collider.center.z)
      < radius + collider.radius
  }

  const cosine = Math.cos(-collider.rotationY)
  const sine = Math.sin(-collider.rotationY)
  const dx = center.x - collider.center.x
  const dz = center.z - collider.center.z
  const localX = (dx * cosine) - (dz * sine)
  const localZ = (dx * sine) + (dz * cosine)
  const closestX = clamp(localX, -collider.halfExtents[0], collider.halfExtents[0])
  const closestZ = clamp(localZ, -collider.halfExtents[1], collider.halfExtents[1])
  return Math.hypot(localX - closestX, localZ - closestZ) < radius
}

function colliderBounds(collider: StaticCollider2D): Bounds2D {
  if (collider.kind === 'circle') {
    return {
      minX: collider.center.x - collider.radius,
      maxX: collider.center.x + collider.radius,
      minZ: collider.center.z - collider.radius,
      maxZ: collider.center.z + collider.radius,
    }
  }

  const cosine = Math.abs(Math.cos(collider.rotationY))
  const sine = Math.abs(Math.sin(collider.rotationY))
  const extentX = (collider.halfExtents[0] * cosine) + (collider.halfExtents[1] * sine)
  const extentZ = (collider.halfExtents[0] * sine) + (collider.halfExtents[1] * cosine)
  return {
    minX: collider.center.x - extentX,
    maxX: collider.center.x + extentX,
    minZ: collider.center.z - extentZ,
    maxZ: collider.center.z + extentZ,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Trusted renderer-only walkable envelope used by spawn/path validation. */
export type WalkableBounds2D = Readonly<{
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}>

/** Finds the nearest deterministic clear point while installing a room. */
export function findNearestFreePoint(
  world: CollisionWorld2D,
  preferred: Point2D,
  bounds: WalkableBounds2D,
  radius: number,
  gridSize = 0.25,
): Point2D | null {
  if (!isUsableBounds(bounds, radius) || !Number.isFinite(gridSize) || gridSize <= 0) return null
  const clamped = clampToWalkableBounds(preferred, bounds, radius)
  if (!world.collidesCircle(clamped, radius)) return clamped

  const candidates: Point2D[] = []
  const minX = bounds.minX + radius
  const maxX = bounds.maxX - radius
  const minZ = bounds.minZ + radius
  const maxZ = bounds.maxZ - radius
  for (let x = minX; x <= maxX + 1e-9; x += gridSize) {
    for (let z = minZ; z <= maxZ + 1e-9; z += gridSize) {
      candidates.push({ x: roundGrid(x), z: roundGrid(z) })
    }
  }
  candidates.sort((left, right) => (
    squaredDistance(left, clamped) - squaredDistance(right, clamped)
    || left.x - right.x
    || left.z - right.z
  ))
  return candidates.find((candidate) => !world.collidesCircle(candidate, radius)) ?? null
}

/**
 * Deterministic cardinal-grid flood fill through the final trusted collision
 * world. A target may be occupied: success means the player reaches its
 * interaction radius, not necessarily its exact center.
 */
export function canReachWithinBounds(
  world: CollisionWorld2D,
  start: Point2D,
  target: Point2D,
  targetRadius: number,
  bounds: WalkableBounds2D,
  playerRadius: number,
  gridSize = 0.5,
): boolean {
  if (!isUsableBounds(bounds, playerRadius) || targetRadius < 0 || gridSize <= 0) return false
  const origin = findNearestFreePoint(world, start, bounds, playerRadius, gridSize)
  if (!origin) return false
  if (Math.hypot(origin.x - target.x, origin.z - target.z) <= targetRadius) return true

  const minX = bounds.minX + playerRadius
  const maxX = bounds.maxX - playerRadius
  const minZ = bounds.minZ + playerRadius
  const maxZ = bounds.maxZ - playerRadius
  const columns = Math.floor((maxX - minX) / gridSize) + 1
  const rows = Math.floor((maxZ - minZ) / gridSize) + 1
  if (columns <= 0 || rows <= 0) return false

  const nearestIndex = (value: number, minimum: number, maximum: number) => Math.min(
    Math.max(0, Math.round((value - minimum) / gridSize)),
    Math.floor((maximum - minimum) / gridSize),
  )
  const startColumn = nearestIndex(origin.x, minX, maxX)
  const startRow = nearestIndex(origin.z, minZ, maxZ)
  const queue: Array<readonly [number, number]> = [[startColumn, startRow]]
  const visited = new Set<string>([startColumn + ':' + startRow])

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [column, row] = queue[cursor]!
    const point = { x: minX + column * gridSize, z: minZ + row * gridSize }
    if (Math.hypot(point.x - target.x, point.z - target.z) <= targetRadius) return true

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = column + dx
      const nextRow = row + dz
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue
      const key = nextColumn + ':' + nextRow
      if (visited.has(key)) continue
      const next = { x: minX + nextColumn * gridSize, z: minZ + nextRow * gridSize }
      if (world.collidesCircle(next, playerRadius)) continue
      const move = world.moveCircle(point, { x: next.x - point.x, z: next.z - point.z }, playerRadius)
      if (Math.abs(move.position.x - next.x) > 1e-6 || Math.abs(move.position.z - next.z) > 1e-6) continue
      visited.add(key)
      queue.push([nextColumn, nextRow])
    }
  }
  return false
}

function isUsableBounds(bounds: WalkableBounds2D, radius: number): boolean {
  return Number.isFinite(radius)
    && radius >= 0
    && bounds.maxX - bounds.minX >= radius * 2
    && bounds.maxZ - bounds.minZ >= radius * 2
}

function clampToWalkableBounds(
  point: Point2D,
  bounds: WalkableBounds2D,
  radius: number,
): Point2D {
  return {
    x: clamp(point.x, bounds.minX + radius, bounds.maxX - radius),
    z: clamp(point.z, bounds.minZ + radius, bounds.maxZ - radius),
  }
}

function squaredDistance(left: Point2D, right: Point2D): number {
  return ((left.x - right.x) ** 2) + ((left.z - right.z) ** 2)

}
function roundGrid(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
