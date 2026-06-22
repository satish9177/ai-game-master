import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/**
 * Trusted, hand-written builders for the zombie / post-apocalyptic asset pack
 * v0: crate, barrel, debris, barricade. Each is procedural low-poly Three.js,
 * built resting on the local floor plane (base at y=0) so RoomSpec `position`
 * stays the floor anchor (CONVENTIONS.md).
 *
 * Disposal invariant: one geometry + one material per mesh, freshly allocated
 * per call, so disposeObject frees each exactly once. Shadow flags are applied
 * by buildObjects' enableShadows() pass, not here.
 */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/* ---------- builders ---------- */

/** Wooden crate: a body box, a lighter lid cap, and four darker corner posts. */
export function buildCrate(obj: ObjectOf<'crate'>): THREE.Object3D {
  const [w, h, d] = obj.size
  const g = new THREE.Group()
  const post = Math.min(0.1, Math.min(w, d) * 0.15)

  g.add(box(w, h, d, 0, h / 2, 0, obj.color)) // body
  g.add(box(w * 1.02, 0.06, d * 1.02, 0, h, 0, shade(obj.color, 1.25))) // lid cap

  const px = w / 2 - post / 2
  const pz = d / 2 - post / 2
  const postColor = shade(obj.color, 0.6)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(post, h, post, sx * px, h / 2, sz * pz, postColor))
    }
  }
  return g
}

/** Steel drum: cylinder body, two rim bands, and a slightly inset top lid. */
export function buildBarrel(obj: ObjectOf<'barrel'>): THREE.Object3D {
  const { radius: r, height: h, color } = obj
  const g = new THREE.Group()

  g.add(cylinder(r, r, h, 0, h / 2, 0, color)) // body
  const band = shade(color, 0.6)
  g.add(cylinder(r * 1.06, r * 1.06, 0.06, 0, h * 0.28, 0, band)) // lower band
  g.add(cylinder(r * 1.06, r * 1.06, 0.06, 0, h * 0.72, 0, band)) // upper band
  g.add(cylinder(r * 0.94, r * 0.94, 0.04, 0, h, 0, shade(color, 1.2))) // lid
  return g
}

/**
 * Rubble pile: a fixed, deterministic cluster of tilted chunks scaled to
 * `size`. Layout is hand-authored (no RNG) so the same spec always yields the
 * same heap. Each row is [fx, fz, fw, fh, fd, rotY, shadeFactor] as fractions.
 */
const DEBRIS_CHUNKS: readonly [number, number, number, number, number, number, number][] = [
  [0.0, 0.0, 0.55, 1.0, 0.5, 0.2, 1.0],
  [-0.3, 0.22, 0.35, 0.55, 0.32, -0.5, 0.82],
  [0.32, -0.26, 0.4, 0.72, 0.34, 0.9, 0.7],
  [0.16, 0.3, 0.3, 0.36, 0.3, 1.4, 0.92],
  [-0.26, -0.3, 0.3, 0.46, 0.26, 0.35, 0.76],
  [0.02, -0.12, 0.24, 0.22, 0.62, -0.95, 0.6],
]

export function buildDebris(obj: ObjectOf<'debris'>): THREE.Object3D {
  const [w, h, d] = obj.size
  const g = new THREE.Group()
  for (const [fx, fz, fw, fh, fd, rotY, factor] of DEBRIS_CHUNKS) {
    const sy = fh * h
    const chunk = box(fw * w, sy, fd * d, fx * w, sy / 2, fz * d, shade(obj.color, factor))
    chunk.rotation.y = rotY
    g.add(chunk)
  }
  return g
}

export function buildBarricade(obj: ObjectOf<'barricade'>): THREE.Object3D {
  return obj.style === 'sandbags' ? buildSandbags(obj) : buildPlanks(obj)
}

/** Improvised plank wall: two end posts, three rough planks, one diagonal brace. */
function buildPlanks(obj: ObjectOf<'barricade'>): THREE.Object3D {
  const { length: L, height: H, color } = obj
  const g = new THREE.Group()
  const postColor = shade(color, 0.7)
  const px = L / 2 - 0.06
  g.add(box(0.12, H, 0.12, -px, H / 2, 0, postColor))
  g.add(box(0.12, H, 0.12, px, H / 2, 0, postColor))

  const plankH = H * 0.22
  for (const fy of [0.22, 0.55, 0.85]) {
    g.add(box(L, plankH, 0.1, 0, H * fy, 0, color))
  }
  const brace = box(L * 1.04, 0.12, 0.08, 0, H * 0.5, 0.02, shade(color, 1.15))
  brace.rotation.z = 0.22 // a leaning, salvaged plank
  g.add(brace)
  return g
}

/** Stacked sandbag wall: a deterministic pyramid of rounded bags. */
function buildSandbags(obj: ObjectOf<'barricade'>): THREE.Object3D {
  const { length: L, height: H, color } = obj
  const g = new THREE.Group()
  const perRow = clamp(Math.round(L / 0.7), 2, 6)
  const rows = clamp(Math.round(H / 0.45), 2, 3)
  const bagW = L / perRow
  const bagH = H / rows
  const depth = Math.max(0.4, bagW * 0.7)

  for (let row = 0; row < rows; row++) {
    const count = perRow - row // narrows toward the top
    const rowWidth = count * bagW
    for (let i = 0; i < count; i++) {
      const x = -rowWidth / 2 + bagW * (i + 0.5)
      const y = bagH * (row + 0.5)
      const factor = (row + i) % 2 === 0 ? 1 : 0.85 // gentle bag-to-bag variation
      g.add(box(bagW * 0.96, bagH * 0.9, depth, x, y, 0, shade(color, factor)))
    }
  }
  return g
}

/* ---------- helpers ---------- */

function box(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color }),
  )
  m.position.set(px, py, pz)
  return m
}

function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  px: number,
  py: number,
  pz: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBottom, h, 12),
    new THREE.MeshStandardMaterial({ color }),
  )
  m.position.set(px, py, pz)
  return m
}

/** Lighten (factor > 1) or darken (factor < 1) a hex color for trim/variation. */
function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
