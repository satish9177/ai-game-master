import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../../../domain/loadRoomSpec'
import { buildVisualShellRoom } from './buildVisualShell'

function shellRoom(exits: { side: 'north' | 'south' | 'east' | 'west'; width: number }[] = []) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'visual-shell-room',
    name: 'Visual shell room',
    environmentKind: 'crypt',
    shell: { dimensions: { width: 12, depth: 10, height: 4 }, exits },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [],
  })
}

describe('buildVisualShellRoom', () => {
  it('uses only closed semantic architecture records and retains a modular floor', () => {
    const projected = buildVisualShellRoom(shellRoom())
    expect(projected.objects.length).toBeGreaterThan(12)
    expect(projected.objects.every((object) => object.type === 'architecture')).toBe(true)
    expect(projected.objects.filter((object) =>
      object.type === 'architecture' && object.kind === 'floor-section',
    )).toHaveLength(9)
    expect(JSON.stringify(projected.objects)).not.toMatch(/\.glb|\/visual-packs\/|nodeName|material/i)
  })

  it.each(['north', 'south', 'east', 'west'] as const)(
    'leaves the declared centered %s exit gap clear',
    (side) => {
      const gap = 3
      const projected = buildVisualShellRoom(shellRoom([{ side, width: gap }]))
      const walls = projected.objects.filter((object) => {
        if (object.type !== 'architecture' || object.kind === 'floor-section') return false
        if (side === 'north') return object.position[2] === -5
        if (side === 'south') return object.position[2] === 5
        if (side === 'east') return object.position[0] === 6
        return object.position[0] === -6
      })
      expect(walls.length).toBeGreaterThan(0)
      for (const wall of walls) {
        const along = side === 'north' || side === 'south' ? wall.position[0] : wall.position[2]
        const halfLength = wall.type === 'architecture' ? wall.size[0] / 2 : 0
        expect(Math.abs(along) - halfLength).toBeGreaterThanOrEqual(gap / 2 - 1e-9)
      }
    },
  )

  it('uses low ruined modules for camera-facing cutaways', () => {
    const projected = buildVisualShellRoom(shellRoom(), ['south', 'east'])
    const cutaways = projected.objects.filter((object) =>
      object.type === 'architecture' && object.kind === 'wall-ruined',
    )
    expect(cutaways.length).toBeGreaterThan(0)
    expect(cutaways.every((object) => object.type === 'architecture' && object.size[1] === 0.4))
      .toBe(true)
  })

  it('does not mutate the validated story room or replace its generated composition', () => {
    const room = shellRoom()
    const projected = buildVisualShellRoom(room)
    expect(room.objects).toEqual([])
    expect(projected.id).toBe(room.id)
    expect(projected.objects).not.toBe(room.objects)
  })
})
