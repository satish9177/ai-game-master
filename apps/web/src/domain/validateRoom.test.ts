import { describe, expect, it } from 'vitest'
import { throneRoom } from './examples/throneRoom'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { LIMITS, validateRoom } from './validateRoom'
import type { RoomIssueCode, RoomIssueSeverity } from './validateRoom'

function validRoom(): LoadedRoom {
  return loadRoomSpec(structuredClone(throneRoom))
}

function expectIssue(
  room: LoadedRoom,
  code: RoomIssueCode,
  severity: RoomIssueSeverity,
): void {
  const result = validateRoom(room)
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, severity })]),
  )
  expect(result.ok).toBe(severity !== 'fatal')
}

function rugs(count: number): LoadedRoom['objects'] {
  const rug = validRoom().objects.find((object) => object.type === 'rug')
  if (!rug) throw new Error('valid fixture must contain a rug')
  return Array.from({ length: count }, (_, index) => ({
    ...rug,
    id: `rug-${index}`,
    position: [0, 0.01, 0],
  }))
}

function torches(count: number): LoadedRoom['objects'] {
  const torch = validRoom().objects.find((object) => object.type === 'torch')
  if (!torch) throw new Error('valid fixture must contain a torch')
  return Array.from({ length: count }, (_, index) => ({
    ...torch,
    id: `torch-${index}`,
    position: [0, 2, 0],
  }))
}

describe('validateRoom', () => {
  it('accepts a valid throne-room-shaped room without issues', () => {
    expect(validateRoom(validRoom())).toEqual({ ok: true, issues: [] })
  })

  it('accepts rich layouts without raw object or light performance warnings', () => {
    const room = validRoom()
    room.objects = [...rugs(500), ...torches(100)]

    const result = validateRoom(room)

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it.each([
    ['room-too-small', (room: LoadedRoom) => {
      room.shell.dimensions.width = LIMITS.MIN_ROOM_DIM - 0.1
    }],
    ['room-too-large', (room: LoadedRoom) => {
      room.shell.dimensions.depth = LIMITS.MAX_ROOM_DIM + 0.1
    }],
    ['spawn-out-of-bounds', (room: LoadedRoom) => {
      room.spawn.position[0] = room.shell.dimensions.width
    }],
    ['object-envelope-exceeded', (room: LoadedRoom) => {
      room.objects = rugs(LIMITS.MAX_ROOM_OBJECT_ENTRIES + 1)
    }],
  ] satisfies [RoomIssueCode, (room: LoadedRoom) => void][])(
    'returns fatal %s',
    (code, arrange) => {
      const room = validRoom()
      arrange(room)
      expectIssue(room, code, 'fatal')
    },
  )

  it.each([
    ['room-unusual-aspect', (room: LoadedRoom) => {
      room.shell.dimensions.width = 40
      room.shell.dimensions.depth = 4
      room.spawn.position = [0, 1.7, 0]
    }],
    ['spawn-height-unusual', (room: LoadedRoom) => {
      room.spawn.position[1] = 0
    }],
    ['object-out-of-bounds', (room: LoadedRoom) => {
      room.objects[0]!.position[0] = room.shell.dimensions.width
    }],
    ['object-above-ceiling', (room: LoadedRoom) => {
      room.objects[0]!.position[1] = room.shell.dimensions.height + 0.1
    }],
    ['object-crowds-spawn', (room: LoadedRoom) => {
      room.objects[0]!.position = [...room.spawn.position]
    }],
    ['no-exit', (room: LoadedRoom) => {
      room.shell.exits = []
    }],
    ['interaction-empty-prompt', (room: LoadedRoom) => {
      const scroll = room.objects.find((object) => object.type === 'scroll')
      if (scroll?.type === 'scroll') scroll.interaction.prompt = '   '
    }],
    ['interaction-missing-body', (room: LoadedRoom) => {
      const scroll = room.objects.find((object) => object.type === 'scroll')
      if (scroll?.type === 'scroll') scroll.interaction.body = '   '
    }],
    ['npc-unnamed', (room: LoadedRoom) => {
      const npc = room.objects.find((object) => object.type === 'npc')
      if (npc?.type === 'npc') npc.name = '   '
    }],
  ] satisfies [RoomIssueCode, (room: LoadedRoom) => void][])(
    'returns warning %s without rejecting the room',
    (code, arrange) => {
      const room = validRoom()
      arrange(room)
      expectIssue(room, code, 'warning')
    },
  )

  it('attaches object index and type to object-scoped issues', () => {
    const room = validRoom()
    room.objects[0]!.position[0] = room.shell.dimensions.width

    expect(validateRoom(room).issues).toContainEqual(
      expect.objectContaining({
        code: 'object-out-of-bounds',
        objectIndex: 0,
        objectType: room.objects[0]!.type,
      }),
    )
  })

  it('allows wall-edge anchors at the bounds epsilon', () => {
    const room = validRoom()
    const halfDepth = room.shell.dimensions.depth / 2
    const arch = room.objects.find((object) => object.type === 'arch')
    const torch = room.objects.find((object) => object.type === 'torch')
    if (!arch || !torch) throw new Error('valid fixture must contain edge objects')
    arch.position[2] = -halfDepth - LIMITS.BOUNDS_EPSILON
    torch.position[2] = halfDepth + LIMITS.BOUNDS_EPSILON

    expect(validateRoom(room).issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'object-out-of-bounds' }),
      ]),
    )
  })

  it('does not treat a rug at spawn as a solid obstruction', () => {
    const room = validRoom()
    const rug = room.objects.find((object) => object.type === 'rug')
    if (!rug) throw new Error('valid fixture must contain a rug')
    rug.position = [...room.spawn.position]

    const rugIndex = room.objects.indexOf(rug)
    expect(validateRoom(room).issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'object-crowds-spawn',
          objectIndex: rugIndex,
        }),
      ]),
    )
  })

  it.each(['crate', 'barrel', 'chest', 'corpse', 'table', 'altar', 'statue', 'machine', 'artifact', 'barricade', 'debris', 'zombie'] as const)(
    'treats a %s at the spawn as a solid obstruction',
    (type) => {
      const room = validRoom()
      const at = room.spawn.position
      // Append a freshly loaded object of the new type sitting on the spawn.
      room.objects = [
        ...room.objects,
        ...loadRoomSpec({
          ...structuredClone(throneRoom),
          objects: [{ type, position: [at[0], 0, at[2]] }],
        }).objects,
      ]
      const index = room.objects.length - 1

      expect(validateRoom(room).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'object-crowds-spawn',
            objectIndex: index,
            objectType: type,
          }),
        ]),
      )
    },
  )

  it('does not treat a candle at spawn as a solid obstruction', () => {
    const room = validRoom()
    const at = room.spawn.position
    room.objects = [
      ...room.objects,
      ...loadRoomSpec({
        ...structuredClone(throneRoom),
        objects: [{ type: 'candle', position: [at[0], 0, at[2]] }],
      }).objects,
    ]
    const index = room.objects.length - 1

    expect(validateRoom(room).issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'object-crowds-spawn',
          objectIndex: index,
          objectType: 'candle',
        }),
      ]),
    )
  })

  it('accepts spawn exactly on the walkable boundary', () => {
    const room = validRoom()
    const margin = room.shell.wallThickness / 2 + LIMITS.WALL_CLEARANCE
    room.spawn.position[0] = room.shell.dimensions.width / 2 - margin

    expect(validateRoom(room).issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'spawn-out-of-bounds' }),
      ]),
    )
  })

  it('is deterministic and does not mutate its input', () => {
    const room = validRoom()
    room.shell.exits = []
    const before = JSON.stringify(room)

    const first = validateRoom(room)
    const second = validateRoom(room)

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(room)).toBe(before)
  })

  it('returns issues in stable room, spawn, then object-index order', () => {
    const room = validRoom()
    room.shell.dimensions.width = 40
    room.shell.dimensions.depth = 4
    room.shell.exits = []
    room.spawn.position = [0, 0, 1.8]
    room.objects = [
      { ...room.objects[0]!, position: [0, 0, 1.8] },
      { ...room.objects[0]!, position: [0, 10, 3] },
    ]

    expect(validateRoom(room).issues.map((issue) => issue.code)).toEqual([
      'room-unusual-aspect',
      'no-exit',
      'spawn-out-of-bounds',
      'spawn-height-unusual',
      'object-crowds-spawn',
      'object-out-of-bounds',
      'object-above-ceiling',
    ])
    expect(validateRoom(room).issues.map((issue) => issue.objectIndex)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      1,
      1,
    ])
  })
})
