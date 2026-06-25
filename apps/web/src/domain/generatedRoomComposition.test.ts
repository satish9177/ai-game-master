import { describe, it, expect } from 'vitest'
import {
  COMPOSITION,
  classifyGeneratedCompositionRole,
  computeGeneratedCompositionZones,
  composeGeneratedRoom,
} from './generatedRoomComposition'
import { computePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import { loadRoomSpec } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

/**
 * Standard 18 × 18 × 4 room used across most tests. wallThickness defaults to 0.3.
 * bounds.halfX = bounds.halfZ = 9 - (0.3/2 + 0.3) = 9 - 0.45 = 8.55
 */
const STD_DIMS = { width: 18, depth: 18, height: 4 }

/** Build a LoadedRoom with the given objects in an 18×18×4 shell. */
function makeRoom(objects: unknown[], spawn: [number, number, number] = [0, 1.7, 6]) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'compose-test',
    name: 'compose-test',
    shell: {
      dimensions: STD_DIMS,
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: spawn },
    objects,
  })
}

/** Build a single validated RoomObject from a raw object literal via a scratch room. */
function loadObj(raw: unknown) {
  return makeRoom([raw]).objects[0]!
}

const STD_BOUNDS = computePlayableBounds(STD_DIMS, 0.3)

// ─── classifyGeneratedCompositionRole ─────────────────────────────────────────

describe('classifyGeneratedCompositionRole', () => {
  it('throne → anchor', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'throne', position: [0, 0, -6] }))).toBe('anchor')
  })

  it('npc → npc', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'npc', name: 'X', position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' },
    }))).toBe('npc')
  })

  it('scroll → interactable', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'scroll', position: [0, 0.5, 0],
      interaction: { key: 'E', prompt: 'Read', body: 'Text.' },
    }))).toBe('interactable')
  })

  it('crate without interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'crate', position: [3, 0, 3] }))).toBe('decorative')
  })

  it('crate with non-exit interaction → interactable', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'crate', position: [3, 0, 3],
      interaction: { key: 'E', prompt: 'Open', body: 'Loot.' },
    }))).toBe('interactable')
  })

  it('barrel without interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'barrel', position: [2, 0, 2] }))).toBe('decorative')
  })

  it('barrel with non-exit interaction → interactable', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'barrel', position: [2, 0, 2],
      interaction: { key: 'E', prompt: 'Check', body: 'Water.' },
    }))).toBe('interactable')
  })

  it('debris without interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'debris', position: [3, 0, -3] }))).toBe('decorative')
  })

  it('zombie without interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'zombie', position: [2, 0, 2] }))).toBe('decorative')
  })

  it('zombie with interaction → interactable', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'zombie', position: [2, 0, 2],
      interaction: { key: 'E', prompt: 'Examine', body: 'Shambling.' },
    }))).toBe('interactable')
  })

  it('pillar → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'pillar', position: [4, 0, -4] }))).toBe('decorative')
  })

  it('torch → structural', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'torch', position: [4, 3, -4] }))).toBe('structural')
  })

  it('arch without interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'arch', position: [0, 0, -9] }))).toBe('decorative')
  })

  it('arch with non-exit interaction → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'arch', position: [0, 0, -9],
      interaction: { key: 'E', prompt: 'Inspect' },
    }))).toBe('decorative')
  })

  it('arch with exit interaction → exit (not structural)', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'arch', position: [0, 0, -9],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next' } },
    }))).toBe('exit')
  })

  it('any object with exit interaction → exit (exit takes priority)', () => {
    expect(classifyGeneratedCompositionRole(loadObj({
      type: 'crate', position: [3, 0, 3],
      interaction: { key: 'E', prompt: 'Through', exit: { toRoomId: 'next' } },
    }))).toBe('exit')
  })

  it('prop → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'prop', position: [2, 0, 2] }))).toBe('decorative')
  })

  it('rug → decorative', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'rug', position: [0, 0.01, 0] }))).toBe('decorative')
  })

  it('is deterministic', () => {
    const obj = loadObj({ type: 'throne', position: [0, 0, -6] })
    expect(classifyGeneratedCompositionRole(obj)).toBe(classifyGeneratedCompositionRole(obj))
  })
})

// ─── computeGeneratedCompositionZones ─────────────────────────────────────────

describe('computeGeneratedCompositionZones', () => {
  it('corridorHalf matches COMPOSITION.CORRIDOR_HALF', () => {
    const zones = computeGeneratedCompositionZones(STD_BOUNDS)
    expect(zones.corridorHalf).toBe(COMPOSITION.CORRIDOR_HALF)
  })

  it('anchorTargetX is always 0', () => {
    expect(computeGeneratedCompositionZones(STD_BOUNDS).anchorTargetX).toBe(0)
  })

  it('anchorTargetZ is negative (north) and in the playable half', () => {
    const zones = computeGeneratedCompositionZones(STD_BOUNDS)
    expect(zones.anchorTargetZ).toBeLessThan(0)
    expect(Math.abs(zones.anchorTargetZ)).toBeLessThanOrEqual(STD_BOUNDS.halfZ)
  })

  it('npcTargetAbsX < clutterTargetAbsX (NPC closer to center than clutter)', () => {
    const zones = computeGeneratedCompositionZones(STD_BOUNDS)
    expect(zones.npcTargetAbsX).toBeLessThan(zones.clutterTargetAbsX)
  })

  it('interactableTargetAbsX < clutterTargetAbsX (interactable closer to center than clutter)', () => {
    const zones = computeGeneratedCompositionZones(STD_BOUNDS)
    expect(zones.interactableTargetAbsX).toBeLessThan(zones.clutterTargetAbsX)
  })

  it('all targets are > corridorHalf (objects land outside the corridor)', () => {
    const zones = computeGeneratedCompositionZones(STD_BOUNDS)
    expect(zones.npcTargetAbsX).toBeGreaterThan(zones.corridorHalf)
    expect(zones.interactableTargetAbsX).toBeGreaterThan(zones.corridorHalf)
    expect(zones.clutterTargetAbsX).toBeGreaterThan(zones.corridorHalf)
  })

  it('is deterministic', () => {
    expect(computeGeneratedCompositionZones(STD_BOUNDS)).toEqual(
      computeGeneratedCompositionZones(STD_BOUNDS),
    )
  })
})

// ─── composeGeneratedRoom — decorative clutter ────────────────────────────────

describe('composeGeneratedRoom — decorative corridor clutter', () => {
  it('decorative prop at corridor center is relocated to a side zone', () => {
    const room = makeRoom([{ type: 'prop', position: [0, 0, -2] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    const obj = composed.objects[0]!
    // Moved out of the corridor — |x| must now be ≥ CORRIDOR_HALF.
    expect(Math.abs(obj.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    // z is preserved
    expect(obj.position[2]).toBe(-2)
    // y is preserved
    expect(obj.position[1]).toBe(0)
  })

  it('decorative prop with negative x stays on the negative (west) side after relocation', () => {
    const room = makeRoom([{ type: 'prop', position: [-0.5, 0, 0] }])
    const { room: composed } = composeGeneratedRoom(room)
    const obj = composed.objects[0]!
    expect(obj.position[0]).toBeLessThan(0) // same side
  })

  it('decorative prop with positive x stays on the positive (east) side after relocation', () => {
    const room = makeRoom([{ type: 'prop', position: [0.5, 0, 0] }])
    const { room: composed } = composeGeneratedRoom(room)
    const obj = composed.objects[0]!
    expect(obj.position[0]).toBeGreaterThan(0) // same side
  })

  it('decorative prop already at the east side zone is unchanged (same reference)', () => {
    // |x| = 6 > CORRIDOR_HALF (2.0) → already in side zone, no relocation
    const room = makeRoom([{ type: 'prop', position: [6, 0, 0] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
    expect(diagnostics.composed).toBe(false)
  })

  it('decorative prop exactly at CORRIDOR_HALF is unchanged (boundary is inclusive, |x| >= → no move)', () => {
    const room = makeRoom([{ type: 'prop', position: [COMPOSITION.CORRIDOR_HALF, 0, 0] }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })

  it('rug in corridor is relocated to side zone', () => {
    const room = makeRoom([{ type: 'rug', position: [0, 0.01, 0] }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('relocated decorative object footprint stays inside playable bounds', () => {
    const room = makeRoom([{ type: 'prop', position: [0, 0, 0] }])
    const { room: composed } = composeGeneratedRoom(room)
    const obj = composed.objects[0]!
    const fp = objectFootprintRadius(obj)
    expect(Math.abs(obj.position[0]) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfX + 1e-9)
  })
})

// ─── composeGeneratedRoom — anchor (throne) ───────────────────────────────────

describe('composeGeneratedRoom — anchor (throne)', () => {
  it('throne placed off-center / in south half is moved to north-center anchor zone', () => {
    const room = makeRoom([{ type: 'throne', position: [3, 0, 3] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    const throne = composed.objects[0]!
    // Must be at x = 0
    expect(throne.position[0]).toBe(0)
    // Must be in the north half (z negative) and past the anchor threshold
    expect(throne.position[2]).toBeLessThanOrEqual(
      -(COMPOSITION.ANCHOR_Z_THRESHOLD * STD_BOUNDS.halfZ),
    )
    // y preserved
    expect(throne.position[1]).toBe(0)
  })

  it('throne anchor footprint stays inside playable bounds after relocation', () => {
    const room = makeRoom([{ type: 'throne', position: [3, 0, 3] }])
    const { room: composed } = composeGeneratedRoom(room)
    const throne = composed.objects[0]!
    const fp = objectFootprintRadius(throne)
    expect(Math.abs(throne.position[0]) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfX + 1e-9)
    expect(Math.abs(throne.position[2]) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfZ + 1e-9)
  })

  it('throne already in the anchor zone is unchanged (same reference — idempotency)', () => {
    // Run composition once to get the canonical anchor position, then run again.
    const room = makeRoom([{ type: 'throne', position: [3, 0, 3] }])
    const { room: once } = composeGeneratedRoom(room)
    const { room: twice } = composeGeneratedRoom(once)
    // Second pass must return the same reference (throne is already at target).
    expect(twice).toBe(once)
  })

  it('lacksAnchor is false when a throne exists', () => {
    const room = makeRoom([{ type: 'throne', position: [0, 0, -6] }])
    const { diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksAnchor).toBe(false)
  })

  it('lacksAnchor is true when no throne exists', () => {
    const room = makeRoom([
      { type: 'prop', position: [4, 0, 0] },
      { type: 'pillar', position: [3, 0, -4] },
    ])
    const { diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksAnchor).toBe(true)
  })

  it('room with no anchor: no structural change and no objects added or removed', () => {
    const room = makeRoom([
      { type: 'prop', position: [4, 0, 0] },
      { type: 'pillar', position: [3, 0, -4] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects).toHaveLength(2)
    // Prop at x=4 and pillar at x=3 are both outside the corridor — no moves.
    expect(composed).toBe(room)
  })

  it('room with only anchor and decorative outside corridor: anchor moves, decorative stays', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [5, 0, 0] }, // already outside corridor
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    // Throne moved to x=0
    expect(composed.objects[0]!.position[0]).toBe(0)
    // Prop x unchanged (it was already in side zone)
    expect(composed.objects[1]!.position[0]).toBe(5)
  })

  it('second throne (extra) is left in place — only first throne is the anchor', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },   // primary → moves to anchor zone
      { type: 'throne', position: [-3, 0, 2] },  // extra → stays in place
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects[0]!.position[0]).toBe(0) // primary anchor at center
    expect(composed.objects[1]!.position[0]).toBe(-3) // extra throne unchanged
    expect(composed.objects[1]!.position[2]).toBe(2)  // extra throne z unchanged
  })
})

// ─── composeGeneratedRoom — NPC ───────────────────────────────────────────────

describe('composeGeneratedRoom — NPC placement', () => {
  it('NPC in the corridor is moved to a mid-room flank', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Guard', position: [0, 0, -2],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    const npc = composed.objects[0]!
    // Must be outside the corridor now
    expect(Math.abs(npc.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    // z is preserved
    expect(npc.position[2]).toBe(-2)
  })

  it('NPC already off the corridor is unchanged (same reference)', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Guard', position: [4.5, 0, -2],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
    expect(diagnostics.composed).toBe(false)
  })

  it('NPC moves to positive side when at x=0 (positive-side tiebreak)', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Guard', position: [0, 0, -1],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects[0]!.position[0]).toBeGreaterThan(0)
  })

  it('NPC with negative x moves to the west (negative) side', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Guard', position: [-1, 0, -2],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects[0]!.position[0]).toBeLessThan(0)
  })

  it('relocated NPC footprint stays inside playable bounds', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Guard', position: [0, 0, -2],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    const npc = composed.objects[0]!
    const fp = objectFootprintRadius(npc)
    expect(Math.abs(npc.position[0]) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfX + 1e-9)
  })

  it('NPC interaction content (name, prompt, body) is unchanged after relocation', () => {
    const room = makeRoom([{
      type: 'npc', name: 'Sera', position: [0, 0, -3],
      interaction: { key: 'F', prompt: 'Press F to talk', body: 'Sera nods.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    const npc = composed.objects[0]!
    expect(npc.type).toBe('npc')
    if (npc.type === 'npc') {
      expect(npc.name).toBe('Sera')
      expect(npc.interaction.prompt).toBe('Press F to talk')
      expect(npc.interaction.body).toBe('Sera nods.')
    }
  })
})

// ─── composeGeneratedRoom — interactable clue/resource ────────────────────────

describe('composeGeneratedRoom — interactable clue/resource', () => {
  it('scroll in corridor is moved to a visible flank', () => {
    const room = makeRoom([{
      type: 'scroll', position: [0.5, 0.5, -2],
      interaction: { key: 'E', prompt: 'Read the scroll', body: 'A message.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    const scroll = composed.objects[0]!
    expect(Math.abs(scroll.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    // y and z preserved
    expect(scroll.position[1]).toBe(0.5)
    expect(scroll.position[2]).toBe(-2)
  })

  it('interactive crate in corridor is moved to interactable zone', () => {
    const room = makeRoom([{
      type: 'crate', position: [1, 0, -3],
      interaction: { key: 'E', prompt: 'Open crate', body: 'Loot.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('scroll already off corridor is unchanged (same reference)', () => {
    const room = makeRoom([{
      type: 'scroll', position: [3.5, 0.5, -2],
      interaction: { key: 'E', prompt: 'Read', body: 'Words.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })

  it('scroll in corridor alongside a decorative prop: both move, count preserved', () => {
    const room = makeRoom([
      { type: 'prop', position: [1, 0, -2] }, // decorative in corridor
      {
        type: 'scroll', position: [1.5, 0.5, -2],
        interaction: { key: 'E', prompt: 'Read', body: 'Text.' },
      }, // interactable in corridor
    ])
    const { room: composed } = composeGeneratedRoom(room)
    // Count preserved
    expect(composed.objects).toHaveLength(2)
    // Both moved out of the corridor
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    expect(Math.abs(composed.objects[1]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('lacksInteractable is false when a scroll exists', () => {
    const room = makeRoom([{
      type: 'scroll', position: [3, 0.5, -2],
      interaction: { key: 'E', prompt: 'Read', body: 'Text.' },
    }])
    expect(composeGeneratedRoom(room).diagnostics.lacksInteractable).toBe(false)
  })

  it('lacksInteractable is true when no interactable object exists', () => {
    const room = makeRoom([
      { type: 'prop', position: [4, 0, 0] },
      { type: 'pillar', position: [3, 0, -4] },
    ])
    expect(composeGeneratedRoom(room).diagnostics.lacksInteractable).toBe(true)
  })

  it('lacksInteractable is false for interactive barrel', () => {
    const room = makeRoom([{
      type: 'barrel', position: [4, 0, -2],
      interaction: { key: 'E', prompt: 'Check barrel', body: 'Water inside.' },
    }])
    expect(composeGeneratedRoom(room).diagnostics.lacksInteractable).toBe(false)
  })

  it('non-interactive barrel → decorative, does not satisfy lacksInteractable', () => {
    const room = makeRoom([{ type: 'barrel', position: [4, 0, -2] }])
    expect(composeGeneratedRoom(room).diagnostics.lacksInteractable).toBe(true)
  })

  it('relocated interactable footprint stays inside playable bounds', () => {
    const room = makeRoom([{
      type: 'scroll', position: [0, 0.5, -2],
      interaction: { key: 'E', prompt: 'Read', body: 'Text.' },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    const scroll = composed.objects[0]!
    const fp = objectFootprintRadius(scroll)
    expect(Math.abs(scroll.position[0]) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfX + 1e-9)
  })

  it('room with interactive prop and no scroll has lacksInteractable false', () => {
    // prop schema strips interaction; construct the object directly to test the
    // classification branch (hasNonExitInteraction on prop / default case).
    const propWithInteraction = {
      type: 'prop', shape: 'box', size: [1, 1, 1] as [number, number, number],
      color: '#888888', position: [4, 0, 0] as [number, number, number],
      interaction: { key: 'E', prompt: 'Examine', body: 'Interesting.' },
    } as unknown as RoomObject
    const room = { ...makeRoom([]), objects: [propWithInteraction] }
    const { diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(false)
  })
})

// ─── composeGeneratedRoom — torch/exit left in place; pillar/arch move ────────

describe('composeGeneratedRoom — torch and exit objects left in place', () => {
  it('pillar in the corridor is moved to a side clutter zone (decorative)', () => {
    const room = makeRoom([{ type: 'pillar', position: [0, 0, -2] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    // z preserved
    expect(composed.objects[0]!.position[2]).toBe(-2)
  })

  it('arch without interaction.exit in the corridor is moved to a side clutter zone (decorative)', () => {
    const room = makeRoom([{ type: 'arch', position: [1, 0, 0] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).not.toBe(room)
    expect(diagnostics.composed).toBe(true)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('torch in the corridor is NOT moved (structural wall-light)', () => {
    const room = makeRoom([{ type: 'torch', position: [1, 3, -3] }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })

  it('arch with exit interaction is NOT moved by composition (exit — left for stage 2.8)', () => {
    const room = makeRoom([{
      type: 'arch', position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next' } },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })

  it('crate with exit interaction is left in place (exit takes priority)', () => {
    const room = makeRoom([{
      type: 'crate', position: [1, 0, 0],
      interaction: { key: 'E', prompt: 'Exit', exit: { toRoomId: 'next' } },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })
})

// ─── composeGeneratedRoom — object count preservation ─────────────────────────

describe('composeGeneratedRoom — object count preservation', () => {
  it('count preserved when some objects are relocated', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, 0] },
      {
        type: 'npc', name: 'Guard', position: [1, 0, -2],
        interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' },
      },
      { type: 'pillar', position: [4, 0, -4] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects).toHaveLength(room.objects.length)
  })

  it('count preserved when no objects need relocation (same reference)', () => {
    const room = makeRoom([
      { type: 'pillar', position: [4, 0, -4] },
      { type: 'torch', position: [4, 3, -4] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
    expect(composed.objects).toHaveLength(2)
  })

  it('count preserved in a room with all role types', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'npc', name: 'A', position: [0, 0, -1], interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' } },
      { type: 'scroll', position: [0.5, 0.5, -2], interaction: { key: 'E', prompt: 'Read', body: 'Text.' } },
      { type: 'prop', position: [0.5, 0, 1] },
      { type: 'pillar', position: [4, 0, -4] },
      { type: 'torch', position: [4, 3, -4] },
      { type: 'arch', position: [0, 0, -9], interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next' } } },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects).toHaveLength(room.objects.length)
  })
})

// ─── composeGeneratedRoom — footprint bounds safety ───────────────────────────

describe('composeGeneratedRoom — footprint bounds safety', () => {
  it('all objects remain footprint-inside playable bounds after composition', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, 0] },
      { type: 'npc', name: 'G', position: [0.5, 0, -2], interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' } },
      { type: 'scroll', position: [1, 0.5, -2], interaction: { key: 'E', prompt: 'Read', body: 'Text.' } },
      { type: 'pillar', position: [4, 0, -4] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    for (const obj of composed.objects) {
      const fp = objectFootprintRadius(obj)
      const [x, , z] = obj.position
      expect(Math.abs(x) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfX + 1e-9)
      expect(Math.abs(z) + fp).toBeLessThanOrEqual(STD_BOUNDS.halfZ + 1e-9)
    }
  })

  it('compositions in a min-size (14×14) room keep objects in bounds', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'min', name: 'min',
      shell: { dimensions: { width: 14, depth: 14, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { type: 'throne', position: [3, 0, 3] },
        { type: 'prop', position: [0, 0, 0] },
      ],
    })
    const minBounds = computePlayableBounds({ width: 14, depth: 14 }, 0.3)
    const { room: composed } = composeGeneratedRoom(room)
    for (const obj of composed.objects) {
      const fp = objectFootprintRadius(obj)
      const [x, , z] = obj.position
      expect(Math.abs(x) + fp).toBeLessThanOrEqual(minBounds.halfX + 1e-9)
      expect(Math.abs(z) + fp).toBeLessThanOrEqual(minBounds.halfZ + 1e-9)
    }
  })

  it('compositions in a max-size (24×24) room keep objects in bounds', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'max', name: 'max',
      shell: { dimensions: { width: 24, depth: 24, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 9] },
      objects: [
        { type: 'throne', position: [5, 0, 5] },
        { type: 'prop', position: [0, 0, 0] },
      ],
    })
    const maxBounds = computePlayableBounds({ width: 24, depth: 24 }, 0.3)
    const { room: composed } = composeGeneratedRoom(room)
    for (const obj of composed.objects) {
      const fp = objectFootprintRadius(obj)
      const [x, , z] = obj.position
      expect(Math.abs(x) + fp).toBeLessThanOrEqual(maxBounds.halfX + 1e-9)
      expect(Math.abs(z) + fp).toBeLessThanOrEqual(maxBounds.halfZ + 1e-9)
    }
  })
})

// ─── composeGeneratedRoom — determinism and idempotency ───────────────────────

describe('composeGeneratedRoom — determinism and idempotency', () => {
  it('is deterministic: same input → same output', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, -1] },
      { type: 'npc', name: 'G', position: [0.5, 0, -2], interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' } },
    ])
    const result1 = composeGeneratedRoom(room)
    const result2 = composeGeneratedRoom(room)
    expect(result1.room.objects).toEqual(result2.room.objects)
    expect(result1.diagnostics).toEqual(result2.diagnostics)
  })

  it('is idempotent: compose(compose(r)) has same structure as compose(r)', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, -1] },
      { type: 'npc', name: 'G', position: [0.5, 0, -2], interaction: { key: 'F', prompt: 'Talk', body: 'Hi.' } },
    ])
    const { room: once } = composeGeneratedRoom(room)
    const { room: twice } = composeGeneratedRoom(once)
    // Positions must match exactly
    expect(twice.objects.map((o) => o.position)).toEqual(once.objects.map((o) => o.position))
  })

  it('same reference on second pass (idempotent same-reference)', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, -1] },
    ])
    const { room: once } = composeGeneratedRoom(room)
    const { room: twice } = composeGeneratedRoom(once)
    // Second pass must return the same reference
    expect(twice).toBe(once)
  })

  it('same reference when all objects already need no relocation', () => {
    const room = makeRoom([
      { type: 'pillar', position: [4, 0, -4] },
      { type: 'torch', position: [4, 3, -4] },
      { type: 'prop', position: [5, 0, 0] }, // already at side zone
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })
})

// ─── composeGeneratedRoom — no mutation of input ──────────────────────────────

describe('composeGeneratedRoom — no mutation', () => {
  it('does not mutate the input room object', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
      { type: 'prop', position: [0, 0, 0] },
    ])
    const posBefore = room.objects.map((o) => [...o.position])
    composeGeneratedRoom(room)
    expect(room.objects.map((o) => [...o.position])).toEqual(posBefore)
  })

  it('does not mutate input object references', () => {
    const room = makeRoom([{ type: 'prop', position: [0, 0, 0] }])
    const originalObj = room.objects[0]
    composeGeneratedRoom(room)
    // The original object in the original array must be untouched
    expect(room.objects[0]).toBe(originalObj)
    expect(room.objects[0]!.position).toEqual([0, 0, 0])
  })

  it('does not mutate input objects when relocation occurs', () => {
    const room = makeRoom([
      { type: 'throne', position: [3, 0, 3] },
    ])
    const throneRef = room.objects[0]
    const originalPos = [...room.objects[0]!.position]
    const { room: composed } = composeGeneratedRoom(room)
    // Composed has a different throne object (new position)
    expect(composed.objects[0]).not.toBe(throneRef)
    // But the original is unchanged
    expect(room.objects[0]).toBe(throneRef)
    expect(room.objects[0]!.position).toEqual(originalPos)
  })
})

// ─── composeGeneratedRoom — non-position content is unchanged ─────────────────

describe('composeGeneratedRoom — non-position content preserved', () => {
  it('relocated objects preserve id, type, color, scale, rotationY', () => {
    const room = makeRoom([{
      type: 'prop',
      id: 'my-prop',
      position: [0, 0, 0],
      rotationY: 45,
      scale: 1.5,
      color: '#ff0000',
    }])
    const { room: composed } = composeGeneratedRoom(room)
    const obj = composed.objects[0]!
    expect(obj.type).toBe('prop')
    // The only changed field is position[0] (x was 0, now moved to a side)
    expect(obj.position[1]).toBe(0)   // y unchanged
    expect(obj.position[2]).toBe(0)   // z unchanged
    expect(obj.rotationY).toBe(45)
    expect(obj.scale).toBe(1.5)
    if (obj.type === 'prop') {
      expect(obj.color).toBe('#ff0000')
    }
  })

  it('relocated NPC preserves interaction effect structure', () => {
    const room = makeRoom([{
      type: 'npc',
      name: 'Torval',
      position: [0, 0, -2],
      interaction: {
        key: 'F',
        prompt: 'Speak with Torval',
        body: 'Torval grumbles.',
        effect: { kind: 'inspect', flag: 'torval-met' },
      },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    const npc = composed.objects[0]!
    if (npc.type === 'npc') {
      expect(npc.name).toBe('Torval')
      expect(npc.interaction.key).toBe('F')
      expect(npc.interaction.prompt).toBe('Speak with Torval')
      expect(npc.interaction.body).toBe('Torval grumbles.')
      expect(npc.interaction.effect).toEqual({ kind: 'inspect', flag: 'torval-met' })
    }
  })
})

// ─── composeGeneratedRoom — empty room ────────────────────────────────────────

describe('composeGeneratedRoom — edge cases', () => {
  it('empty room returns same reference with lacksAnchor and lacksInteractable', () => {
    const room = makeRoom([])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
    expect(diagnostics.composed).toBe(false)
    expect(diagnostics.lacksAnchor).toBe(true)
    expect(diagnostics.lacksInteractable).toBe(true)
  })

  it('room with pillars and torch all outside the corridor returns same reference', () => {
    const room = makeRoom([
      { type: 'pillar', position: [4, 0, -4] },
      { type: 'pillar', position: [-4, 0, -4] },
      { type: 'torch', position: [4, 3, -4] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })

  it('room with only an exit arch returns same reference', () => {
    const room = makeRoom([{
      type: 'arch', position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next' } },
    }])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed).toBe(room)
  })
})

describe('document composition integration', () => {
  it.each(['book', 'paper', 'map'] as const)(
    '%s is decorative without interaction and interactable with interaction',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('decorative')
      expect(classifyGeneratedCompositionRole(loadObj({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect', body: 'Validated body.' },
      }))).toBe('interactable')
    },
  )

  it('moves an interactive map to the readable flank and preserves its content', () => {
    const room = makeRoom([{
      type: 'map',
      position: [0, 0, -2],
      interaction: { key: 'E', prompt: 'Study map', body: 'Validated body.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(false)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(
      COMPOSITION.CORRIDOR_HALF,
    )
    const document = composed.objects[0]
    expect(document?.type === 'map' && document.interaction?.prompt).toBe('Study map')
  })

  it('keeps existing scroll classification unchanged', () => {
    const scroll = loadObj({
      type: 'scroll',
      position: [0, 0.5, 0],
      interaction: { key: 'E', prompt: 'Read', body: 'Existing scroll.' },
    })
    expect(classifyGeneratedCompositionRole(scroll)).toBe('interactable')
  })
})

describe('practical prop composition integration', () => {
  it.each(['chest', 'corpse', 'table'] as const)(
    '%s is decorative without interaction and interactable with interaction',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('decorative')
      expect(classifyGeneratedCompositionRole(loadObj({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect', body: 'Validated body.' },
      }))).toBe('interactable')
    },
  )

  it('moves an interactive chest to the readable flank and preserves its content', () => {
    const room = makeRoom([{
      type: 'chest',
      position: [0, 0, -2],
      interaction: { key: 'E', prompt: 'Open chest', body: 'Validated body.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(false)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(
      COMPOSITION.CORRIDOR_HALF,
    )
    const chest = composed.objects[0]
    expect(chest?.type === 'chest' && chest.interaction?.prompt).toBe('Open chest')
  })

  it('moves a visual-only table as decorative side clutter', () => {
    const room = makeRoom([{ type: 'table', position: [0, 0, 0] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(true)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(
      COMPOSITION.CORRIDOR_HALF,
    )
  })

  it.each(['crate', 'barrel', 'debris', 'book', 'paper', 'map'] as const)(
    'keeps existing %s non-interactive role unchanged',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('decorative')
    },
  )
})

describe('story anchor composition integration', () => {
  it.each(['altar', 'statue'] as const)(
    '%s is an anchor candidate and interactive instances satisfy lacksInteractable',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('anchor')
      const room = makeRoom([{
        type,
        position: [3, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect', body: 'Validated body.' },
      }])
      expect(composeGeneratedRoom(room).diagnostics.lacksInteractable).toBe(false)
    },
  )

  it('keeps throne as the highest priority anchor over altar and statue', () => {
    const room = makeRoom([
      { type: 'altar', position: [0, 0, 0] },
      { type: 'statue', position: [0.5, 0, 0] },
      { type: 'throne', position: [3, 0, 3] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    const throne = composed.objects[2]!
    expect(throne.type).toBe('throne')
    expect(throne.position[0]).toBe(0)
    expect(throne.position[2]).toBeLessThan(0)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    expect(Math.abs(composed.objects[1]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('uses altar as the primary anchor when no throne exists', () => {
    const room = makeRoom([
      { type: 'statue', position: [0, 0, 0] },
      { type: 'altar', position: [3, 0, 3] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    const altar = composed.objects[1]!
    expect(altar.type).toBe('altar')
    expect(altar.position[0]).toBe(0)
    expect(altar.position[2]).toBeLessThan(0)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it('uses statue as the primary anchor only when no throne or altar exists', () => {
    const room = makeRoom([{ type: 'statue', position: [3, 0, 3] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksAnchor).toBe(false)
    expect(composed.objects[0]!.type).toBe('statue')
    expect(composed.objects[0]!.position[0]).toBe(0)
    expect(composed.objects[0]!.position[2]).toBeLessThan(0)
  })

  it('does not turn extra altar/statue objects into additional focal anchors', () => {
    const room = makeRoom([
      { type: 'altar', position: [3, 0, 3] },
      { type: 'altar', position: [0, 0, -1] },
      { type: 'statue', position: [0, 0, 1] },
    ])
    const { room: composed } = composeGeneratedRoom(room)
    expect(composed.objects[0]!.position[0]).toBe(0)
    expect(composed.objects[0]!.position[2]).toBeLessThan(0)
    expect(Math.abs(composed.objects[1]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    expect(Math.abs(composed.objects[2]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
  })

  it.each(['book', 'paper', 'map', 'chest', 'corpse', 'table'] as const)(
    'keeps existing %s non-interactive composition behavior unchanged',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('decorative')
    },
  )
})

describe('strange/device/light composition integration', () => {
  it.each(['machine', 'artifact'] as const)(
    '%s is decorative without interaction and interactable with interaction',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe('decorative')
      expect(classifyGeneratedCompositionRole(loadObj({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect', body: 'Validated body.' },
      }))).toBe('interactable')
    },
  )

  it('treats candle as decorative and not a structural wall light', () => {
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'candle', position: [0, 0, 0] })))
      .toBe('decorative')
    expect(classifyGeneratedCompositionRole(loadObj({ type: 'torch', position: [0, 3, 0] })))
      .toBe('structural')
  })

  it('moves an interactive machine to the readable flank and preserves its content', () => {
    const room = makeRoom([{
      type: 'machine',
      position: [0, 0, -2],
      interaction: { key: 'E', prompt: 'Inspect machine', body: 'Validated body.' },
    }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(false)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(
      COMPOSITION.CORRIDOR_HALF,
    )
    const machine = composed.objects[0]
    expect(machine?.type === 'machine' && machine.interaction?.prompt).toBe('Inspect machine')
  })

  it('moves a visual-only candle as decorative side clutter', () => {
    const room = makeRoom([{ type: 'candle', position: [0, 0, 0] }])
    const { room: composed, diagnostics } = composeGeneratedRoom(room)
    expect(diagnostics.lacksInteractable).toBe(true)
    expect(Math.abs(composed.objects[0]!.position[0])).toBeGreaterThanOrEqual(
      COMPOSITION.CORRIDOR_HALF,
    )
  })

  it.each(['book', 'paper', 'map', 'chest', 'corpse', 'table', 'altar', 'statue'] as const)(
    'keeps existing %s non-interactive composition behavior unchanged',
    (type) => {
      expect(classifyGeneratedCompositionRole(loadObj({ type, position: [0, 0, 0] })))
        .toBe(type === 'altar' || type === 'statue' ? 'anchor' : 'decorative')
    },
  )
})
