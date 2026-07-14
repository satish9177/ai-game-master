import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'

const HOSTILE_MARKERS = [
  'https://attacker.invalid/runtime.glb',
  '../../outside-pack/material.json',
  'globalThis.fetch("https://attacker.invalid")',
  'replaceSceneAndExecute',
] as const

function hostileRoom(objects: unknown[]) {
  return {
    schemaVersion: 1,
    id: 'visual-pack-redteam',
    name: 'Visual pack redteam fixture',
    environmentKind: HOSTILE_MARKERS[0],
    visualPackId: HOSTILE_MARKERS[1],
    rendererInstructions: HOSTILE_MARKERS[3],
    shell: {
      dimensions: { width: 18, depth: 18, height: 5 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6] },
    objects,
  }
}

describe('redteam visual-pack semantic boundary', () => {
  it('strips hostile renderer fields from supported semantics and drops invalid appearance blocks', () => {
    const loaded = loadRoomSpec(hostileRoom([
      {
        type: 'architecture',
        kind: 'wall-straight',
        position: [-3, 0, -3],
        modelPath: HOSTILE_MARKERS[0],
        materialPath: HOSTILE_MARKERS[1],
        executableCode: HOSTILE_MARKERS[2],
        rendererInstructions: HOSTILE_MARKERS[3],
        interaction: {
          key: 'E',
          prompt: 'Inspect the wall',
          rendererInstructions: HOSTILE_MARKERS[3],
        },
      },
      {
        type: 'npc',
        id: 'safe-npc',
        name: 'Safe NPC',
        position: [3, 0, -3],
        modelPath: HOSTILE_MARKERS[0],
        appearance: {
          preset: 'guard',
          palette: 'guard',
          modelPath: HOSTILE_MARKERS[0],
        },
        interaction: {
          key: 'F',
          prompt: 'Talk',
          body: 'A safe closed interaction.',
        },
      },
      {
        type: 'prop',
        shape: 'box',
        position: [0, 0, -4],
        geometry: HOSTILE_MARKERS[2],
        shader: HOSTILE_MARKERS[3],
      },
    ]))

    expect(loaded.environmentKind).toBeUndefined()
    expect(loaded.objects).toHaveLength(3)
    expect(loaded.skipped).toEqual([])

    const safeJson = JSON.stringify({
      environmentKind: loaded.environmentKind,
      objects: loaded.objects,
    })
    for (const marker of HOSTILE_MARKERS) expect(safeJson).not.toContain(marker)

    const architecture = loaded.objects[0] as unknown as Record<string, unknown>
    const npc = loaded.objects[1]
    const prop = loaded.objects[2] as unknown as Record<string, unknown>
    expect(architecture).not.toHaveProperty('modelPath')
    expect(architecture).not.toHaveProperty('materialPath')
    expect(architecture).not.toHaveProperty('rendererInstructions')
    expect(architecture.interaction).not.toHaveProperty('rendererInstructions')
    expect(npc?.type).toBe('npc')
    if (npc?.type !== 'npc') throw new Error('expected npc')
    expect(npc.appearance).toBeUndefined()
    expect(prop).not.toHaveProperty('geometry')
    expect(prop).not.toHaveProperty('shader')
  })

  it('skips unknown kinds, arbitrary model types, and executable interaction effects', () => {
    const loaded = loadRoomSpec(hostileRoom([
      {
        type: 'architecture',
        kind: HOSTILE_MARKERS[0],
        position: [0, 0, 0],
      },
      {
        type: 'model',
        url: HOSTILE_MARKERS[0],
        material: HOSTILE_MARKERS[1],
        position: [0, 0, 0],
      },
      {
        type: 'crate',
        position: [0, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Execute',
          effect: { kind: 'execute', code: HOSTILE_MARKERS[2] },
        },
      },
    ]))

    expect(loaded.objects).toEqual([])
    expect(loaded.skipped.map((entry) => entry.index)).toEqual([0, 1, 2])
    expect(loaded.skippedObjectReasonCounts.otherSchemaInvalid).toBe(1)
    expect(Object.values(loaded.skippedObjectReasonCounts).reduce(
      (total, count) => total + count,
      0,
    )).toBe(3)
  })

  it('never exposes a generated pack selector or free-form renderer instruction', () => {
    const loaded = loadRoomSpec(hostileRoom([
      { type: 'vegetation', kind: 'tree', position: [2, 0, 2] },
    ]))
    const envelope = loaded as unknown as Record<string, unknown>

    expect(envelope).not.toHaveProperty('visualPackId')
    expect(envelope).not.toHaveProperty('rendererInstructions')
    expect(Object.keys(loaded.objects[0] ?? {})).toEqual(expect.arrayContaining([
      'type', 'kind', 'position', 'rotationY', 'scale',
    ]))
  })
})
