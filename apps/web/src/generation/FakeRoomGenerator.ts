import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { createRng, xmur3 } from './prng'

/**
 * Deterministic fake RoomGenerator (Generation Foundation v0; ADR-0007 stage 1).
 *
 * It stands in for a real LLM with *no model, no network, no key*. Given a
 * prompt it derives a seeded PRNG and assembles a RoomSpec-shaped object from
 * the published vocabulary, then returns it as raw JSON text — exactly the shape
 * (and the trust level) a future model completion would have.
 *
 * Guarantees, all of which are covered by tests:
 * - **Deterministic.** The same prompt yields a byte-identical string (the PRNG
 *   is a pure function of the prompt; object/key order is fixed).
 * - **Pure.** No logger, no console, no IO, no `Date.now`, no `Math.random`.
 * - **Data only (ADR-0001).** Output is JSON built with `JSON.stringify`:
 *   numbers, strings, enums, arrays, objects. Never a function, code string,
 *   script, JSX, Three.js/Unity/Godot code, or any executable scene logic. The
 *   prompt is echoed back only as inert text in `name`/dialogue `body`.
 * - **Always valid.** Every emitted object uses a known `type` and satisfies the
 *   schema, so the output passes `loadRoomSpec` with zero skipped objects.
 *
 * The caller still treats the result as untrusted: `JSON.parse` then
 * `loadRoomSpec` (never `eval`). Nothing here weakens that boundary — it only
 * produces data that happens to be well-formed.
 *
 * Conventions (CONVENTIONS.md): Y-up, meters, -Z north, degrees for yaw,
 * ground objects anchored at their floor base, colors as #rrggbb.
 */

// Author-facing color fields, all valid #rrggbb. Variety here is the main reason
// different prompts read as visibly different rooms.
const FLOOR_COLORS = ['#4a4036', '#3c3a33', '#52423a', '#3a3f3a', '#46403c'] as const
const WALL_COLORS = ['#6b6355', '#5a5347', '#6a5f52', '#585a52', '#625a4e'] as const
const PROP_COLORS = ['#8a7d5a', '#6f7a8a', '#8a5a5a', '#5a8a6f', '#7a6f8a', '#888888'] as const
const PROP_SHAPES = ['box', 'cylinder', 'cone', 'sphere'] as const
const NPC_NAMES = ['Malik', 'Bram', 'Sera', 'Torval', 'Lyra', 'Garrick', 'Edda', 'Roan'] as const
const ANCHOR_TYPES = ['throne', 'altar', 'statue'] as const
const DOCUMENT_TYPES = ['scroll', 'book', 'paper', 'map'] as const
const PRACTICAL_TYPES = ['chest', 'corpse', 'table'] as const
const STRANGE_TYPES = ['machine', 'artifact', 'candle'] as const

/** Snap to a 0.5 m grid so coordinates stay tidy and round-trip cleanly. */
const snap = (v: number): number => Math.round(v * 2) / 2
/** Round to one decimal for compact, stable JSON numbers. */
const round1 = (v: number): number => Math.round(v * 10) / 10

/** Collapse whitespace and clamp; the prompt only ever becomes inert text. */
const clampPrompt = (prompt: string, max: number): string => {
  const normalized = prompt.trim().replace(/\s+/g, ' ')
  return normalized.length > max ? normalized.slice(0, max) : normalized
}

/** Stable prompt-salted choice that does not perturb the room-shape PRNG stream. */
function pickForPrompt<const T extends readonly string[]>(prompt: string, salt: string, choices: T): T[number] {
  return choices[xmur3(`${salt}:${prompt}`)() % choices.length]!
}

function buildAnchor(type: (typeof ANCHOR_TYPES)[number], z: number): unknown {
  switch (type) {
    case 'altar':
    case 'statue':
      return { type, position: [0, 0, z], rotationY: 180 }
    default:
      return { type: 'throne', position: [0, 0, z], rotationY: 180 }
  }
}

function buildDocument(
  type: (typeof DOCUMENT_TYPES)[number],
  position: [number, number, number],
  label: string,
): unknown {
  if (type === 'scroll') {
    return {
      type,
      position: [position[0], 0.5, position[2]],
      interaction: {
        key: 'E',
        prompt: 'Press E to read the scroll',
        body: label ? `The scroll reads: "${label}"` : 'The scroll is blank.',
      },
    }
  }
  if (type === 'map') return { type, position, rotationY: 12 }
  if (type === 'book') return { type, position, rotationY: -18 }
  return { type, position, rotationY: 8 }
}

function buildPracticalProp(type: (typeof PRACTICAL_TYPES)[number], position: [number, number, number]): unknown {
  return { type, position, rotationY: type === 'corpse' ? -22 : 14 }
}

function buildStrangeProp(type: (typeof STRANGE_TYPES)[number], position: [number, number, number]): unknown {
  return { type, position, rotationY: type === 'candle' ? 0 : -12 }
}

/** Build the room as a plain JSON-shaped value (data only, never typed code). */
function buildRoom(prompt: string): unknown {
  const rng = createRng(prompt)
  // A stable id from an independent hash, so it does not depend on how many
  // draws the body happens to make.
  const id = `gen-${xmur3(prompt)().toString(16).padStart(8, '0')}`
  const label = clampPrompt(prompt, 60)

  const width = rng.int(10, 20) // 10..19 m
  const depth = rng.int(12, 24) // 12..23 m
  const height = rng.int(5, 8) // 5..7 m
  const halfW = width / 2
  const halfD = depth / 2

  const floorColor = rng.pick(FLOOR_COLORS)
  const wallColor = rng.pick(WALL_COLORS)

  // 1–2 exits on distinct walls.
  const sides = ['north', 'south', 'east', 'west'] as const
  const exitCount = rng.int(1, 3)
  const chosen = new Set<string>()
  const exits: { side: string; width: number }[] = []
  while (exits.length < exitCount) {
    const side = rng.pick(sides)
    if (!chosen.has(side)) {
      chosen.add(side)
      exits.push({ side, width: 3 })
    }
  }

  const ambientIntensity = round1(rng.range(0.6, 0.95))

  const objects: unknown[] = []

  // Focal anchor at the north end, facing the room (yaw 180 → -Z north).
  objects.push(buildAnchor(pickForPrompt(prompt, 'anchor', ANCHOR_TYPES), snap(-halfD + 2)))

  // Central rug, lifted a hair off the floor to avoid z-fighting.
  objects.push({ type: 'rug', position: [0, 0.01, 0], size: [4, snap(halfD)] })

  // Symmetric pillars down the side walls, each pair optionally torch-lit.
  const pairs = rng.int(1, 4) // 1..3 pairs
  const pillarX = snap(halfW - 1.5)
  for (let i = 0; i < pairs; i++) {
    const z = snap(-halfD + 3 + (i * (depth - 6)) / pairs)
    objects.push({ type: 'pillar', position: [-pillarX, 0, z] })
    objects.push({ type: 'pillar', position: [pillarX, 0, z] })
    if (rng.bool(0.7)) {
      // Torch position is the mount point (CONVENTIONS.md), partway up the pillar.
      objects.push({ type: 'torch', position: [-pillarX, 3, z], light: { intensity: 10, distance: 8 } })
      objects.push({ type: 'torch', position: [pillarX, 3, z], light: { intensity: 10, distance: 8 } })
    }
  }

  // Deterministic vocabulary sample for browser QA; all still pure RoomSpec data.
  const primaryDocument = pickForPrompt(prompt, 'document-a', DOCUMENT_TYPES)
  const secondaryDocument = pickForPrompt(prompt, 'document-b', DOCUMENT_TYPES)
  objects.push(buildDocument(primaryDocument, [snap(-halfW + 2.2), 0, snap(-1.5)], label))
  if (secondaryDocument !== primaryDocument && rng.bool(0.55)) {
    objects.push(buildDocument(secondaryDocument, [snap(halfW - 2.2), 0, snap(1.2)], label))
  }

  objects.push(buildPracticalProp(
    pickForPrompt(prompt, 'practical', PRACTICAL_TYPES),
    [snap(-halfW + 2.3), 0, snap(halfD * 0.2)],
  ))
  objects.push(buildStrangeProp(
    pickForPrompt(prompt, 'strange', STRANGE_TYPES),
    [snap(halfW - 2.3), 0, snap(-halfD * 0.2)],
  ))

  // Often an NPC with a name and a talk interaction.
  if (rng.bool(0.75)) {
    const name = rng.pick(NPC_NAMES)
    objects.push({
      type: 'npc',
      name,
      position: [snap(rng.range(-halfW + 2, halfW - 2)), 0, snap(rng.range(-halfD + 3, 0))],
      interaction: { key: 'F', prompt: `Press F to speak with ${name}`, body: `${name} nods quietly.` },
    })
  }

  // A handful of filler props to exercise the generic data path.
  const propCount = rng.int(1, 5) // 1..4
  for (let i = 0; i < propCount; i++) {
    objects.push({
      type: 'prop',
      shape: rng.pick(PROP_SHAPES),
      position: [snap(rng.range(-halfW + 1.5, halfW - 1.5)), 0, snap(rng.range(-halfD + 2, halfD - 2))],
      size: [round1(rng.range(0.5, 1.5)), round1(rng.range(0.5, 1.5)), round1(rng.range(0.5, 1.5))],
      color: rng.pick(PROP_COLORS),
    })
  }

  // An arch framing the north wall.
  objects.push({ type: 'arch', position: [0, 0, snap(-halfD)] })

  return {
    schemaVersion: 1,
    id,
    name: label ? `Generated room — ${label}` : 'Generated room',
    shell: { dimensions: { width, depth, height }, floorColor, wallColor, exits },
    spawn: { position: [0, 1.7, snap(halfD - 2)], yaw: 180 }, // near south wall, facing north
    lighting: { ambient: { intensity: ambientIntensity }, hemisphere: { intensity: 0.5 } },
    objects,
  }
}

export class FakeRoomGenerator implements RoomGenerator {
  /**
   * Produce a room as raw, untrusted JSON text. Deterministic and pure: the same
   * prompt returns a byte-identical string. The caller must `JSON.parse` and then
   * validate via `loadRoomSpec` before anything reaches the renderer.
   */
  async generate(prompt: string): Promise<string> {
    return JSON.stringify(buildRoom(prompt))
  }
}
