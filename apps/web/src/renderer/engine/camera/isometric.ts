/**
 * Pure math for the isometric camera (true-isometric, orthographic) and its
 * screen-relative movement. NO Three.js, no DOM, no logger, no scene mutation —
 * just numbers in, numbers out — so it is unit-testable without a WebGL context
 * and reusable by the CameraController (wired into the Engine in a later commit).
 *
 * Plain `{x,y,z}` / `{x,z}` records are used instead of `THREE.Vector3` so this
 * module stays dependency-free; the controller converts to Three.js at the call
 * site (`camera.position.set(...)`, `camera.lookAt(...)`).
 *
 * Conventions (CONVENTIONS.md): Y-up, meters, -Z = north, +X = east. The camera
 * looks DOWN at a fixed azimuth/elevation and follows a target (the player); it
 * never rotates with input. "Screen-relative" movement means W goes up-screen
 * (into the scene, away from the camera), S down-screen (toward the camera), and
 * A/D strafe screen-left / screen-right, all on the ground (XZ) plane.
 */

/** A point or direction in 3D space (meters). */
export type Vec3 = { x: number; y: number; z: number }

/** A point or direction on the horizontal ground plane (meters); Y is implicit (0). */
export type GroundVec = { x: number; z: number }

/** Axis-aligned clamp region for the player on the XZ plane (meters). */
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

/** Movement intent from the keys: forward = W(+1)/S(-1), strafe = D(+1)/A(-1). */
export type MoveInput = { forward: number; strafe: number }

/** Where the camera sits and the point it looks at, in world space. */
export type CameraPose = { position: Vec3; target: Vec3 }

/** Orthographic frustum half-extents (meters) for an `OrthographicCamera`. */
export type OrthoFrustum = { left: number; right: number; top: number; bottom: number }

/**
 * Tunable isometric-camera constants, co-located like `validateRoom`'s `LIMITS`
 * (there is no config layer yet). The angles define a TRUE isometric view —
 * azimuth 45° and elevation `atan(1/√2) ≈ 35.264°` — at which the three world
 * axes project 120° apart and equal world lengths read equally on screen. (At
 * 45° azimuth this makes the unit offset direction exactly `(1/√3, 1/√3, 1/√3)`.)
 */
export const ISOMETRIC = {
  /** Camera azimuth about +Y. 0 looks north (-Z); 45° is the diagonal iso view. */
  azimuthRad: Math.PI / 4,
  /** Elevation above the ground plane; `atan(1/√2)` is the true-isometric angle. */
  elevationRad: Math.atan(1 / Math.SQRT2),
  /** Target→camera distance (meters). Orthographic: affects clipping, not apparent size. */
  distance: 40,
  /** World-meters visible vertically — the orthographic "zoom" (fixed in v0). */
  viewSize: 18,
  /** Near clip plane (meters). */
  near: 0.1,
  /** Far clip plane (meters); generous so the room always sits between near/far. */
  far: 200,
} as const

/**
 * Unit vector pointing FROM the target TO the camera for the given azimuth and
 * elevation. Its horizontal part has length `cos(elevation)` and its vertical
 * part is `sin(elevation)`, so the camera always sits above and to one side of
 * the target. Pure; allocates a fresh vector.
 */
export function isometricOffsetDirection(
  azimuthRad: number = ISOMETRIC.azimuthRad,
  elevationRad: number = ISOMETRIC.elevationRad,
): Vec3 {
  const horizontal = Math.cos(elevationRad)
  return {
    x: horizontal * Math.sin(azimuthRad),
    y: Math.sin(elevationRad),
    z: horizontal * Math.cos(azimuthRad),
  }
}

/**
 * Camera pose that frames `target` from the fixed isometric offset: the camera
 * sits at `target + distance · offsetDirection` and looks at `target`.
 * Deterministic and pure — the same target always yields the same pose, and
 * translating the target translates the camera identically (the follow
 * property). Does not mutate the input.
 */
export function isometricCameraPose(
  target: Vec3,
  options: { distance?: number; azimuthRad?: number; elevationRad?: number } = {},
): CameraPose {
  const distance = options.distance ?? ISOMETRIC.distance
  const dir = isometricOffsetDirection(options.azimuthRad, options.elevationRad)
  return {
    position: {
      x: target.x + dir.x * distance,
      y: target.y + dir.y * distance,
      z: target.z + dir.z * distance,
    },
    target: { x: target.x, y: target.y, z: target.z },
  }
}

/**
 * Screen-relative movement direction on the ground plane for the given input,
 * under a fixed camera azimuth. W (forward +1) heads up-screen — away from the
 * camera, into the scene — and S the opposite; D (strafe +1) goes screen-right,
 * A screen-left. The result is a UNIT vector (so diagonals are not faster) or
 * `{x:0, z:0}` when there is no input; the caller scales it by `speed · dt`.
 * Pure; the input is not mutated.
 */
export function screenRelativeMove(
  input: MoveInput,
  azimuthRad: number = ISOMETRIC.azimuthRad,
): GroundVec {
  const sin = Math.sin(azimuthRad)
  const cos = Math.cos(azimuthRad)
  // Ground basis under the fixed azimuth: up-screen `u = (-sin, -cos)` (the
  // horizontal projection of the view direction) and screen-right `r = (cos, -sin)`.
  const x = input.forward * -sin + input.strafe * cos
  const z = input.forward * -cos + input.strafe * -sin
  const length = Math.hypot(x, z)
  if (length === 0) return { x: 0, z: 0 }
  return { x: x / length, z: z / length }
}

/**
 * Clamp a ground position into an axis-aligned room box. Returns a fresh vector;
 * the input is not mutated. Extracted here so the engine's movement and this
 * module can share one tested clamp.
 */
export function clampToBounds(pos: GroundVec, bounds: Bounds): GroundVec {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, pos.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, pos.z)),
  }
}

/**
 * Orthographic frustum half-extents that show `viewSize` world-meters vertically
 * at the given `aspect` (width / height), keeping square world units un-stretched
 * on any viewport. Pure: the controller passes the live aspect; no DOM here.
 */
export function orthographicFrustum(
  aspect: number,
  viewSize: number = ISOMETRIC.viewSize,
): OrthoFrustum {
  const halfHeight = viewSize / 2
  const halfWidth = halfHeight * aspect
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}
