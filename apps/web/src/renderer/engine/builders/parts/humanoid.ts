import * as THREE from 'three'

/**
 * Minimal shared humanoid part kit — the first concrete step toward the
 * compositional part library in ADR-0006. It assembles a low-poly figure from
 * primitives (feet, robe/legs, belt, shoulders, arms, hands, neck, head, nose
 * and optional headwear) along a few safe parameters. The renderer owns these
 * parts; RoomSpec never describes geometry.
 *
 * Defaults reproduce the original robed NPC exactly, so `npc` can route through
 * the kit unchanged; `zombie` reuses it with a pale palette, a forward "reach"
 * arm pose and a bare head. ~1.76 m tall, resting on the floor (base at y=0).
 *
 * Disposal invariant: one geometry + one material per mesh, allocated per call.
 * Shadow flags are applied by the caller's enableShadows() pass.
 */
export interface HumanoidOptions {
  /** Robe / clothing color (the body, shoulders and arms). */
  robeColor: THREE.ColorRepresentation
  /** Skin color for hands, neck and head. Defaults to a warm human tone. */
  skinColor?: THREE.ColorRepresentation
  /** Belt color. Defaults to the dark leather used for feet/nose. */
  beltColor?: THREE.ColorRepresentation
  /** `turban` adds simple headwear; `bare` leaves the head uncovered. */
  headwear?: 'turban' | 'bare'
  /** Headwear color when `headwear: 'turban'`. */
  turbanColor?: THREE.ColorRepresentation
  /** `rest` hangs the arms at the sides; `reach` extends them forward (+Z). */
  arms?: 'rest' | 'reach'
  /** Optional front-facing color accent for calm NPC readability. */
  accentColor?: THREE.ColorRepresentation
}

const DEFAULT_SKIN = '#c8a27a'
const DARK = '#3a2f25' // feet, nose, default belt
const DEFAULT_TURBAN = '#e8e2d0'
const HUMANOID_MATERIAL: Pick<THREE.MeshStandardMaterialParameters, 'roughness' | 'metalness'> = {
  roughness: 0.78,
  metalness: 0.02,
}

export function buildHumanoid(options: HumanoidOptions): THREE.Group {
  const {
    robeColor,
    skinColor = DEFAULT_SKIN,
    beltColor = DARK,
    headwear = 'turban',
    turbanColor = DEFAULT_TURBAN,
    arms = 'rest',
    accentColor,
  } = options

  const g = new THREE.Group()
  const part = (
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, humanoidMaterial(color))
    m.position.set(x, y, z)
    g.add(m)
    return m
  }

  part(new THREE.BoxGeometry(0.18, 0.1, 0.3), DARK, -0.13, 0.05, 0.06) // left foot
  part(new THREE.BoxGeometry(0.18, 0.1, 0.3), DARK, 0.13, 0.05, 0.06) // right foot
  part(new THREE.CylinderGeometry(0.24, 0.46, 1.15, 12), robeColor, 0, 0.575, 0) // robe + legs
  part(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12), beltColor, 0, 0.9, 0) // belt
  part(new THREE.BoxGeometry(0.56, 0.2, 0.3), robeColor, 0, 1.2, 0) // shoulders
  if (accentColor) {
    part(new THREE.BoxGeometry(0.12, 0.5, 0.04), accentColor, -0.12, 0.86, 0.25) // front sash
  }

  if (arms === 'reach') {
    // Arms rotated to point forward (+Z) with hands out front — a shambling,
    // grasping pose that reads instantly as a zombie from the isometric angle.
    const reach = -Math.PI / 2.4
    part(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 8), robeColor, -0.3, 1.05, 0.28).rotation.x =
      reach
    part(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 8), robeColor, 0.3, 1.05, 0.28).rotation.x =
      reach
    part(new THREE.SphereGeometry(0.09, 8, 8), skinColor, -0.3, 1.0, 0.62) // left hand
    part(new THREE.SphereGeometry(0.09, 8, 8), skinColor, 0.3, 1.0, 0.62) // right hand
  } else {
    part(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 8), robeColor, -0.32, 0.84, 0) // left arm
    part(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 8), robeColor, 0.32, 0.84, 0) // right arm
    part(new THREE.SphereGeometry(0.09, 8, 8), skinColor, -0.32, 0.46, 0) // left hand
    part(new THREE.SphereGeometry(0.09, 8, 8), skinColor, 0.32, 0.46, 0) // right hand
  }

  part(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), skinColor, 0, 1.32, 0) // neck
  part(new THREE.SphereGeometry(0.18, 16, 12), skinColor, 0, 1.52, 0) // head
  part(new THREE.BoxGeometry(0.05, 0.05, 0.07), DARK, 0, 1.5, 0.17) // nose (faces +Z)
  if (headwear === 'turban') {
    part(new THREE.SphereGeometry(0.2, 16, 12), turbanColor, 0, 1.62, 0).scale.set(1, 0.72, 1)
  }

  return g
}

function humanoidMaterial(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...HUMANOID_MATERIAL })
}
