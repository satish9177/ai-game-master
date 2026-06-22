import * as THREE from 'three'
import { buildGroundRing } from './builders/indicators'

/**
 * The minimal visible player marker: a capsule "body" with a small nose marking
 * the facing direction, resting on the floor (base at y=0) and facing local +Z
 * (south at yaw=0 — the same facing convention as the NPC builder). The engine
 * moves it with WASD/arrows and the camera frames it from the isometric angle.
 *
 * Low-poly, one material per mesh, with a touch of emissive so it reads clearly
 * from the isometric angle in any room lighting. The body casts a shadow and a
 * faint ground ring sits under it so the marker reads as planted on the floor
 * rather than floating. Its geometry/materials are freed by the engine's
 * scene-graph disposal (`disposeObject`) like every other mesh.
 */
export function buildPlayerMarker(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'player'

  const color = '#3da9fc' // a bright, distinct "hero" blue, unlike the room props
  const radius = 0.3
  const bodyLength = 0.8 // capsule's straight part; total height = length + 2·radius = 1.4m
  const center = bodyLength / 2 + radius // lift so the capsule base sits on the floor

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, bodyLength, 6, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
  )
  body.position.y = center
  body.castShadow = true
  g.add(body)

  // Faint ring on the floor so the marker reads as planted, not floating.
  g.add(
    buildGroundRing({
      innerRadius: radius + 0.05,
      outerRadius: radius + 0.2,
      color,
      emissiveIntensity: 0.5,
      opacity: 0.85,
    }),
  )

  // Small cone nose pointing local +Z, so the marker's facing is legible from above.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.24, 12),
    new THREE.MeshStandardMaterial({ color: '#0a3a66' }),
  )
  nose.rotation.x = Math.PI / 2 // cone points +Y by default; rotate it to face +Z
  nose.position.set(0, center, radius + 0.05)
  g.add(nose)

  return g
}
