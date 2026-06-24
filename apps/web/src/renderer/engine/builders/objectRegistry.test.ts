import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger, LogContext, LogLevel } from '../../../platform/logger/Logger'
import { buildObjects } from './index'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

function recordingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const logger: Logger = {
    debug: (message, context = {}) => entries.push({ level: 'debug', message, context }),
    info: (message, context = {}) => entries.push({ level: 'info', message, context }),
    warn: (message, context = {}) => entries.push({ level: 'warn', message, context }),
    error: (message, context = {}) => entries.push({ level: 'error', message, context }),
    child: () => logger,
  }
  return { logger, entries }
}

function roomEnvelope(objects: unknown[]): unknown {
  return {
    schemaVersion: 1,
    id: 'renderer-registry-test',
    name: 'Renderer Registry Test',
    shell: { dimensions: { width: 18, depth: 18, height: 5 }, exits: [] },
    spawn: { position: [0, 1.7, 4] },
    objects,
  }
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh)
  })
  return found
}

function mysteryMarkers(root: THREE.Object3D): THREE.Object3D[] {
  return root.children.filter((node) => node.name === 'mystery-marker')
}

function indicators(root: THREE.Object3D): THREE.Object3D[] {
  return root.children.filter((node) => node.name === 'interactable-indicator')
}

function materialColors(root: THREE.Object3D): string[] {
  return meshes(root).flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials.flatMap((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return []
      return [material.color.getHexString(), material.emissive.getHexString()]
    })
  })
}

// The mapped type is intentional: a new RoomObject type requires both a fixture
// here and a builder in the exhaustive renderer registry before TypeScript passes.
const currentObjects: { [K in RoomObject['type']]: unknown } = {
  throne: { type: 'throne', position: [0, 0, 0] },
  pillar: { type: 'pillar', position: [0, 0, 0] },
  rug: { type: 'rug', position: [0, 0, 0] },
  torch: { type: 'torch', position: [0, 3, 0] },
  arch: { type: 'arch', position: [0, 0, 0] },
  scroll: {
    type: 'scroll',
    position: [0, 0.5, 0],
    interaction: { key: 'E', prompt: 'Read', body: 'A validated document.' },
  },
  npc: {
    type: 'npc',
    name: 'Registry NPC',
    position: [0, 0, 0],
    interaction: { key: 'F', prompt: 'Talk', body: 'A validated NPC.' },
  },
  prop: { type: 'prop', position: [0, 0, 0] },
  crate: { type: 'crate', position: [0, 0, 0] },
  barrel: { type: 'barrel', position: [0, 0, 0] },
  debris: { type: 'debris', position: [0, 0, 0] },
  barricade: { type: 'barricade', position: [0, 0, 0] },
  zombie: { type: 'zombie', position: [0, 0, 0] },
}

describe('trusted object builder registry', () => {
  it.each(Object.entries(currentObjects))('%s has a registered trusted builder', (_type, raw) => {
    const room = loadRoomSpec(roomEnvelope([raw]))
    expect(room.skipped).toEqual([])

    const { logger, entries } = recordingLogger()
    const built = buildObjects(room, logger)
    expect(meshes(built).length).toBeGreaterThan(0)
    expect(mysteryMarkers(built)).toHaveLength(0)
    expect(entries).toEqual([])
  })
})

describe('skipped-object mystery marker', () => {
  it('renders an unknown object as a bounded, non-magenta mystery marker', () => {
    const room = loadRoomSpec(roomEnvelope([{
      type: 'SECRET-UNKNOWN-TYPE',
      id: 'SECRET-ID',
      name: 'SECRET-NAME',
      position: [2, 0, -3],
    }]))
    expect(room.objects).toEqual([])
    expect(room.skipped).toHaveLength(1)

    const { logger, entries } = recordingLogger()
    const built = buildObjects(room, logger)
    const marker = mysteryMarkers(built)[0]!
    expect(marker).toBeDefined()
    expect(marker.position.toArray()).toEqual([2, 0, -3])
    expect(indicators(built)).toHaveLength(0)
    expect(materialColors(marker)).not.toContain('ff00ff')

    const bounds = new THREE.Box3().setFromObject(marker)
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(0.8)
    expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(0.8)
    expect(entries).toEqual([])
  })

  it('renders a malformed known object as the same non-interactive marker', () => {
    const room = loadRoomSpec(roomEnvelope([{
      type: 'npc',
      id: 'SECRET-MALFORMED-ID',
      name: 'SECRET-MALFORMED-NAME',
      position: [1, 0, 1],
      // Missing the required validated interaction.
    }]))
    expect(room.objects).toEqual([])
    expect(room.skipped[0]?.type).toBe('npc')

    const { logger } = recordingLogger()
    const built = buildObjects(room, logger)
    expect(mysteryMarkers(built)).toHaveLength(1)
    expect(indicators(built)).toHaveLength(0)
  })

  it('does not expose raw skipped type, name, or id in rendered node names', () => {
    const sentinels = ['SECRET-RAW-TYPE', 'SECRET-RAW-NAME', 'SECRET-RAW-ID']
    const room = loadRoomSpec(roomEnvelope([{
      type: sentinels[0],
      name: sentinels[1],
      id: sentinels[2],
      position: [0, 0, 0],
    }]))
    const { logger } = recordingLogger()
    const built = buildObjects(room, logger)
    const names: string[] = []
    built.traverse((node) => names.push(node.name))
    const renderedNames = names.join('|')
    for (const sentinel of sentinels) expect(renderedNames).not.toContain(sentinel)
  })

  it('keeps the current schema vocabulary closed', () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'chest', position: [0, 0, 0] },
      { type: 'artifact', position: [1, 0, 0] },
    ]))
    expect(room.objects).toEqual([])
    expect(room.skipped.map((item) => item.type)).toEqual(['chest', 'artifact'])
  })
})
