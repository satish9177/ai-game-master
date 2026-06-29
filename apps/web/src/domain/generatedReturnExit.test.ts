import { describe, expect, it } from 'vitest'
import { buildExitLookup } from '../app/exits'
import { buildGeneratedExitTargetId } from './ensureGeneratedExitNavigation'
import {
  ensureGeneratedReturnExit,
  isReturnExitObject,
  opposite,
  parseGeneratedExitTargetId,
  rebaseGeneratedExitTargets,
  RETURN_EXIT_ARCH_COLOR,
  RETURN_EXIT_ID_INFIX,
} from './generatedReturnExit'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import { validateRoom } from './validateRoom'

const SIDES = ['north', 'south', 'east', 'west'] as const

function roomWith(objects: unknown[], exits: unknown[] = [{ side: 'north', width: 3 }]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'R1:exit:north',
    name: 'ROOM_NAME_SENTINEL',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits,
    },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    objects,
  })
}

function exitArch(id: string, toRoomId: string, position: [number, number, number]) {
  return {
    type: 'arch',
    id,
    position,
    interaction: {
      key: 'E',
      prompt: 'Exit',
      exit: { toRoomId },
    },
  }
}

function exitTargets(room: LoadedRoom): string[] {
  return [...buildExitLookup(room).values()].map((exit) => exit.toRoomId)
}

describe('parseGeneratedExitTargetId', () => {
  it('round-trips ids built by buildGeneratedExitTargetId for all sides', () => {
    for (const side of SIDES) {
      expect(parseGeneratedExitTargetId(buildGeneratedExitTargetId('R1', side))).toEqual({
        parentId: 'R1',
        side,
      })
    }
  })

  it('parses nested generated exit ids as the immediate parent', () => {
    const id = buildGeneratedExitTargetId('R1:exit:north', 'south')

    expect(parseGeneratedExitTargetId(id)).toEqual({
      parentId: 'R1:exit:north',
      side: 'south',
    })
  })

  it('returns null for non-suffixed or garbage ids', () => {
    expect(parseGeneratedExitTargetId('R1')).toBeNull()
    expect(parseGeneratedExitTargetId('R1:exit:up')).toBeNull()
    expect(parseGeneratedExitTargetId(':exit:north')).toBeNull()
    expect(parseGeneratedExitTargetId('')).toBeNull()
  })
})

describe('opposite', () => {
  it('maps cardinal sides to their opposite side', () => {
    expect(opposite('north')).toBe('south')
    expect(opposite('south')).toBe('north')
    expect(opposite('east')).toBe('west')
    expect(opposite('west')).toBe('east')
  })
})

describe('rebaseGeneratedExitTargets', () => {
  it('rewrites deterministic forward generated-exit targets from the old room id to the new room id', () => {
    const oldTarget = buildGeneratedExitTargetId('genB', 'north')
    const newRoomId = buildGeneratedExitTargetId('genA', 'north')
    const room = roomWith([
      exitArch('forward', oldTarget, [0, 0, -9]),
    ])

    const rebased = rebaseGeneratedExitTargets(room, 'genB', newRoomId)

    expect(buildExitLookup(rebased).get('forward')).toEqual({
      toRoomId: buildGeneratedExitTargetId(newRoomId, 'north'),
    })
    expect(rebased.objects[0]?.id).toBe('forward')
    expect(room.objects[0]).toMatchObject({
      id: 'forward',
      interaction: { exit: { toRoomId: oldTarget } },
    })
  })

  it('leaves return-exit targets unchanged even when they match the generated-exit id shape', () => {
    const oldTarget = buildGeneratedExitTargetId('genB', 'south')
    const room = roomWith([
      exitArch(`child${RETURN_EXIT_ID_INFIX}south`, oldTarget, [0, 0, 9]),
    ])

    const rebased = rebaseGeneratedExitTargets(room, 'genB', buildGeneratedExitTargetId('genA', 'north'))

    expect(rebased).toBe(room)
    expect(buildExitLookup(rebased).get(`child${RETURN_EXIT_ID_INFIX}south`)).toEqual({
      toRoomId: oldTarget,
    })
  })

  it('leaves authored and non-matching exit targets unchanged', () => {
    const room = roomWith([
      exitArch('authored', 'throne-room', [0, 0, -9]),
      exitArch('other-generated', buildGeneratedExitTargetId('other', 'east'), [9, 0, 0]),
    ])

    const rebased = rebaseGeneratedExitTargets(room, 'genB', buildGeneratedExitTargetId('genA', 'north'))

    expect(rebased).toBe(room)
    expect(exitTargets(rebased)).toEqual([
      'throne-room',
      buildGeneratedExitTargetId('other', 'east'),
    ])
  })

  it('preserves object ids and other fields when rewriting only the exit target', () => {
    const room = roomWith([
      {
        type: 'arch',
        id: 'forward',
        position: [0, 0, -9],
        rotationY: 45,
        scale: 2,
        width: 4,
        height: 5,
        color: '#123456',
        interaction: {
          key: 'E',
          prompt: 'Forward',
          exit: { toRoomId: buildGeneratedExitTargetId('genB', 'west') },
        },
      },
    ])

    const rebased = rebaseGeneratedExitTargets(room, 'genB', 'genA:exit:north')

    expect(rebased.objects[0]).toMatchObject({
      id: 'forward',
      position: [0, 0, -9],
      rotationY: 45,
      scale: 2,
      width: 4,
      height: 5,
      color: '#123456',
      interaction: {
        key: 'E',
        prompt: 'Forward',
        exit: { toRoomId: 'genA:exit:north:exit:west' },
      },
    })
  })
})

describe('RETURN_EXIT_ID_INFIX', () => {
  it('is the literal string :return-exit:', () => {
    expect(RETURN_EXIT_ID_INFIX).toBe(':return-exit:')
  })
})

describe('isReturnExitObject', () => {
  it('returns true for an object whose id contains the return-exit infix', () => {
    expect(isReturnExitObject({ type: 'arch', id: 'R1:exit:north:return-exit:south', position: [0, 0, 9], rotationY: 180, scale: 1, width: 3, height: 3.5, color: RETURN_EXIT_ARCH_COLOR })).toBe(true)
  })

  it('returns true for a suffixed collision id', () => {
    expect(isReturnExitObject({ type: 'arch', id: 'R1:exit:north:return-exit:south:2', position: [0, 0, 9], rotationY: 180, scale: 1, width: 3, height: 3.5, color: RETURN_EXIT_ARCH_COLOR })).toBe(true)
  })

  it('returns false for a forward generated-exit id', () => {
    expect(isReturnExitObject({ type: 'arch', id: 'R1:generated-exit:north', position: [0, 0, -9], rotationY: 0, scale: 1, width: 3, height: 3.5, color: '#9a9488' })).toBe(false)
  })

  it('returns false for an authored room id', () => {
    expect(isReturnExitObject({ type: 'arch', id: 'throne-room', position: [0, 0, -9], rotationY: 0, scale: 1, width: 3, height: 3.5, color: '#9a9488' })).toBe(false)
  })

  it('returns false for an object with no id', () => {
    expect(isReturnExitObject({ type: 'arch', position: [0, 0, -9], rotationY: 0, scale: 1, width: 3, height: 3.5, color: '#9a9488' })).toBe(false)
  })

  it('returns false for an object with undefined id', () => {
    expect(isReturnExitObject({ type: 'arch', id: undefined, position: [0, 0, -9], rotationY: 0, scale: 1, width: 3, height: 3.5, color: '#9a9488' })).toBe(false)
  })
})

describe('ensureGeneratedReturnExit', () => {
  it('adds a return arch on the side opposite the entry side', () => {
    const room = roomWith([])

    const result = ensureGeneratedReturnExit(room, 'R1', 'north')
    const arch = result.room.objects.at(-1)!

    expect(result.returnExitEnsured).toBe(true)
    expect(arch).toMatchObject({
      type: 'arch',
      id: 'R1:exit:north:return-exit:south',
      position: [0, 0, 9],
      rotationY: 180,
      interaction: {
        key: 'E',
        prompt: 'Return to previous room',
        exit: { toRoomId: 'R1' },
      },
    })
    expect((arch as { color?: string }).color).toBe(RETURN_EXIT_ARCH_COLOR)
    expect(isReturnExitObject(arch)).toBe(true)
    expect(result.room.shell.exits).toContainEqual({ side: 'south', width: 3 })
    expect(buildExitLookup(result.room).get(arch.id!)).toEqual({ toRoomId: 'R1' })
  })

  it('uses a deterministic fallback side when the preferred side already has an exit object', () => {
    const room = roomWith([
      exitArch('forward-south', 'R1:exit:north:exit:south', [0, 0, 9]),
    ])

    const result = ensureGeneratedReturnExit(room, 'R1', 'north')
    const arch = result.room.objects.at(-1)!

    expect(arch).toMatchObject({
      id: 'R1:exit:north:return-exit:west',
      position: [-9, 0, 0],
      rotationY: -90,
      interaction: { exit: { toRoomId: 'R1' } },
    })
    expect(result.room.shell.exits).toContainEqual({ side: 'west', width: 3 })
  })

  it('suffixes the return arch id on collision', () => {
    const room = roomWith([
      { type: 'prop', id: 'R1:exit:north:return-exit:south', position: [0, 0, 0] },
    ])

    const result = ensureGeneratedReturnExit(room, 'R1', 'north')
    const arch = result.room.objects.at(-1)!

    expect(arch.id).toBe('R1:exit:north:return-exit:south:2')
  })

  it('is idempotent when a usable exit to the parent already exists', () => {
    const room = roomWith([
      exitArch('return-exit', 'R1', [0, 0, 9]),
    ])

    const result = ensureGeneratedReturnExit(room, 'R1', 'north')

    expect(result.returnExitEnsured).toBe(true)
    expect(result.room).toBe(room)
  })

  it('is deterministic and does not mutate the input room', () => {
    const room = roomWith([])
    const before = JSON.parse(JSON.stringify(room))

    expect(ensureGeneratedReturnExit(room, 'R1', 'north')).toEqual(
      ensureGeneratedReturnExit(room, 'R1', 'north'),
    )
    expect(room).toEqual(before)
  })

  it('returns a fresh room when it enriches the room', () => {
    const room = roomWith([])

    const result = ensureGeneratedReturnExit(room, 'R1', 'north')

    expect(result.room).not.toBe(room)
    expect(result.room.objects).not.toBe(room.objects)
    expect(result.room.shell).not.toBe(room.shell)
  })

  it('passes semantic validation after enrichment', () => {
    const result = ensureGeneratedReturnExit(roomWith([]), 'R1', 'north')

    expect(validateRoom(result.room).issues.filter((issue) => issue.severity === 'fatal')).toEqual([])
  })
})
