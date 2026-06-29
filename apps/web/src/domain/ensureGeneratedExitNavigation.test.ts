import { describe, expect, it } from 'vitest'
import { buildExitLookup } from '../app/exits'
import { repairGeneratedExits } from './generatedRoomLayout'
import { ensureGeneratedExitNavigation } from './ensureGeneratedExitNavigation'
import { loadRoomSpec } from './loadRoomSpec'
import { validateRoom } from './validateRoom'

function roomWith(objects: unknown[], exits: unknown[] = [{ side: 'north', width: 3 }]) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'room-secret-sentinel',
    name: 'ROOM_NAME_SENTINEL',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits,
    },
    spawn: { position: [0, 1.7, 5], yaw: 180 },
    objects,
  })
}

function firstExitArch(room = roomWith([{ type: 'arch', position: [2, 0, 2] }])) {
  const result = ensureGeneratedExitNavigation(room)
  const arch = result.room.objects.find((object) => object.type === 'arch')!
  return { result, arch }
}

describe('ensureGeneratedExitNavigation', () => {
  it('preserves an existing stable usable exit and returns the same room reference', () => {
    const room = roomWith([{
      type: 'arch',
      id: 'authored-exit',
      position: [0, 0, -9],
      interaction: {
        key: 'E',
        prompt: 'Enter next room',
        exit: { toRoomId: 'room-secret-sentinel:exit:north' },
      },
    }])

    const result = ensureGeneratedExitNavigation(room)

    expect(result.room).toBe(room)
    expect(result.exitNavigationEnsured).toBe(true)
  })

  it('upgrades an arch without interaction with deterministic navigation fields', () => {
    const { result, arch } = firstExitArch()

    expect(result.exitNavigationEnsured).toBe(true)
    expect(arch).toMatchObject({
      id: 'room-secret-sentinel:generated-exit:north',
      position: [0, 0, -9],
      interaction: {
        key: 'E',
        prompt: 'Enter next room',
        exit: { toRoomId: 'room-secret-sentinel:exit:north' },
      },
    })
  })

  it('assigns a deterministic id to an arch without id', () => {
    const { arch } = firstExitArch()
    expect(arch.id).toBe('room-secret-sentinel:generated-exit:north')
  })

  it('inserts a wall arch and matching shell exit when no arch exists', () => {
    const result = ensureGeneratedExitNavigation(roomWith([{ type: 'pillar', position: [3, 0, -3] }], []))

    expect(result.exitNavigationEnsured).toBe(true)
    expect(result.room.shell.exits).toContainEqual({ side: 'north', width: 3 })
    expect(result.room.objects.at(-1)).toMatchObject({
      type: 'arch',
      id: 'room-secret-sentinel:generated-exit:north',
      position: [0, 0, -9],
      interaction: { exit: { toRoomId: 'room-secret-sentinel:exit:north' } },
    })
  })

  it('uses a non-north shell exit side when upgrading an arch', () => {
    const room = roomWith(
      [{ type: 'arch', position: [0, 0, 0] }],
      [{ side: 'east', width: 4 }],
    )

    const result = ensureGeneratedExitNavigation(room)
    const arch = result.room.objects.find((object) => object.type === 'arch')!

    expect(result.exitNavigationEnsured).toBe(true)
    expect(result.room.shell.exits).toContainEqual({ side: 'east', width: 4 })
    expect(arch.position[0]).toBeCloseTo(result.room.shell.dimensions.width / 2)
    expect(arch.position[1]).toBe(0)
    expect(arch.position[2]).toBe(0)
    expect(arch.rotationY).toBe(90)
    expect(buildExitLookup(result.room).get(arch.id!)).toEqual({
      toRoomId: 'room-secret-sentinel:exit:east',
    })
    expect(validateRoom(result.room).issues.filter((issue) => issue.severity === 'fatal')).toEqual([])
  })

  it('suffixes the generated exit id when the base id already exists', () => {
    const baseId = 'room-secret-sentinel:generated-exit:north'
    const room = roomWith([
      { type: 'prop', id: baseId, position: [2, 0, 0] },
      { type: 'arch', position: [0, 0, -8] },
    ])

    const result = ensureGeneratedExitNavigation(room)
    const arch = result.room.objects.find((object) => object.type === 'arch')!

    expect(arch.id).toBe(`${baseId}:2`)
    expect(arch.id).not.toBe(baseId)
    expect(buildExitLookup(result.room).get(`${baseId}:2`)).toEqual({
      toRoomId: 'room-secret-sentinel:exit:north',
    })
  })

  it('assigns an id to an existing exit arch without preserving its prior target', () => {
    const room = roomWith([{
      type: 'arch',
      position: [0, 0, -8],
      interaction: {
        key: 'E',
        prompt: 'Existing generated exit',
        exit: { toRoomId: 'prior-generated-target' },
      },
    }])

    const result = ensureGeneratedExitNavigation(room)
    const arch = result.room.objects.find((object) => object.type === 'arch')!

    expect(arch.id).toBe('room-secret-sentinel:generated-exit:north')
    // Id-less exit targets are not runtime-usable, so the helper rebuilds the
    // structural target instead of preserving generated/provider-authored text.
    expect(arch.interaction?.exit?.toRoomId).toBe('room-secret-sentinel:exit:north')
    expect(arch.interaction?.exit?.toRoomId).not.toBe('prior-generated-target')
    expect(buildExitLookup(result.room).get(arch.id!)).toEqual({
      toRoomId: 'room-secret-sentinel:exit:north',
    })
  })

  it('builds a usable exit lookup entry', () => {
    const { result, arch } = firstExitArch()
    expect(buildExitLookup(result.room).get(arch.id!)).toEqual({
      toRoomId: 'room-secret-sentinel:exit:north',
    })
  })

  it('is deterministic and does not mutate the input room', () => {
    const room = roomWith([{ type: 'arch', position: [2, 0, 2] }])
    const before = JSON.parse(JSON.stringify(room))

    expect(ensureGeneratedExitNavigation(room)).toEqual(ensureGeneratedExitNavigation(room))
    expect(room).toEqual(before)
  })

  it('does not throw on malformed-but-loaded room data', () => {
    const room = roomWith([{ type: 'arch', position: [0, 0, -8] }])
    const malformed = { ...room, shell: { ...room.shell, exits: [] } }

    expect(() => ensureGeneratedExitNavigation(malformed)).not.toThrow()
    expect(ensureGeneratedExitNavigation(malformed).exitNavigationEnsured).toBe(true)
  })

  it('does not derive toRoomId from names, object ids, or interaction text', () => {
    const room = roomWith([{
      type: 'arch',
      id: 'OBJECT_NAME_SENTINEL',
      position: [0, 0, -8],
      interaction: { key: 'E', prompt: 'PROMPT_SENTINEL', body: 'BODY_SENTINEL' },
    }])

    const result = ensureGeneratedExitNavigation(room)
    const target = [...buildExitLookup(result.room).values()][0]!.toRoomId

    expect(target).toBe('room-secret-sentinel:exit:north')
    expect(target).not.toContain('ROOM_NAME_SENTINEL')
    expect(target).not.toContain('OBJECT_NAME_SENTINEL')
    expect(target).not.toContain('PROMPT_SENTINEL')
    expect(target).not.toContain('BODY_SENTINEL')
  })

  it('validates with zero fatal issues after helper', () => {
    const { result } = firstExitArch()
    expect(validateRoom(result.room).issues.filter((issue) => issue.severity === 'fatal')).toEqual([])
  })

  it('keeps the forward arch color unchanged at #9a9488', () => {
    const result = ensureGeneratedExitNavigation(roomWith([], []))
    const arch = result.room.objects.find((object) => object.type === 'arch')!
    expect((arch as { color?: string }).color).toBe('#9a9488')
  })

  it('is already on the chosen wall so repairGeneratedExits does not move it', () => {
    const { result } = firstExitArch()
    expect(repairGeneratedExits(result.room)).toBe(result.room)
  })

  it('still gets a usable exit at the generated soft object cap', () => {
    const room = roomWith(
      Array.from({ length: 30 }, (_, index) => ({
        type: 'prop',
        id: `prop-${index}`,
        shape: 'box',
        position: [0, 0, 0],
      })),
      [],
    )

    const result = ensureGeneratedExitNavigation(room)

    expect(result.room.objects.some((object) => object.type === 'arch')).toBe(true)
    expect(buildExitLookup(result.room).size).toBe(1)
  })
})
