import * as THREE from 'three'

/**
 * A flat, softly-glowing ring lying on the floor — a renderer-internal
 * readability cue. Used under the player marker ("you are here") and under
 * interactable objects ("you can act here"). Procedural and low-poly: one
 * RingGeometry + one material, so the engine's disposeObject frees it like any
 * other mesh. It is presentation only — never RoomSpec data, and it carries no
 * interaction logic (proximity still reads player.position in the engine).
 *
 * Conventions: Y-up, meters. The ring lies in the XZ plane just above the floor
 * (y = 0) so it never z-fights with the floor slab.
 */
export function buildGroundRing(options: {
  innerRadius: number
  outerRadius: number
  color: string
  emissiveIntensity?: number
  opacity?: number
  floorY?: number
  renderOrder?: number
  toneMapped?: boolean
}): THREE.Mesh {
  const {
    innerRadius,
    outerRadius,
    color,
    emissiveIntensity = 0.6,
    opacity = 0.9,
    floorY = 0.02,
    renderOrder = 0,
    toneMapped = true,
  } = options

  // Thirty-two segments stay smooth at the isometric camera distance while
  // keeping every interaction cue deliberately inexpensive.
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 32)
  geometry.rotateX(-Math.PI / 2) // RingGeometry faces +Z by default; lay it flat facing +Y

  const ring = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false, // a thin floor decal; don't occlude via the depth buffer
      roughness: 0.55,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      toneMapped,
    }),
  )
  ring.position.y = floorY
  ring.renderOrder = renderOrder
  ring.name = 'ground-ring'
  ring.castShadow = false
  ring.receiveShadow = false
  return ring
}
