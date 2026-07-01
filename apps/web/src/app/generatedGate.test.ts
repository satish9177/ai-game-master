import { describe, expect, it, vi } from 'vitest'
import type { GateGenerator } from '../domain/ports/GateGenerator'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import { assembleGate } from '../domain/generatedMechanicalGateProposal'
import { buildGeneratedGateAttachment } from './generatedGate'

vi.mock('../domain/generatedMechanicalGateProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/generatedMechanicalGateProposal')>()
  return {
    ...actual,
    assembleGate: vi.fn(actual.assembleGate),
  }
})

function makeRoom(objects: unknown[] = gateObjects()): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      wallThickness: 0.3,
      floorColor: '#4a4036',
      wallColor: '#6b6355',
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: { ambient: { color: '#404858', intensity: 0.6 } },
    objects,
  } satisfies RoomSpec)
}

function gateObjects(): unknown[] {
  return [
    {
      type: 'machine',
      id: 'control-panel',
      position: [0, 0, -2],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    },
    {
      type: 'arch',
      id: 'north-arch',
      position: [0, 0, -8],
      interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
    },
  ]
}

function generator(raw: string | null): GateGenerator {
  return { generate: async () => raw }
}

describe('buildGeneratedGateAttachment', () => {
  it('returns accepted for valid raw text assembled into a gate', async () => {
    const room = makeRoom()

    const result = await buildGeneratedGateAttachment(
      room,
      generator('{"unlockObjectId":"control-panel","exitToRoomId":"north-room"}'),
    )

    expect(result.status).toBe('accepted')
    expect(result.status === 'accepted' ? result.gate.effect.toRoomId : null).toBe('north-room')
  })

  it('returns rejected when the generator returns null', async () => {
    await expect(buildGeneratedGateAttachment(makeRoom(), generator(null)))
      .resolves.toEqual({ status: 'rejected' })
  })

  it('returns rejected when the generator throws', async () => {
    const failingGenerator: GateGenerator = {
      generate: async () => {
        throw new Error('raw provider text should not escape')
      },
    }

    await expect(buildGeneratedGateAttachment(makeRoom(), failingGenerator))
      .resolves.toEqual({ status: 'rejected' })
  })

  it('returns rejected when assembleGate drops the raw proposal', async () => {
    await expect(buildGeneratedGateAttachment(
      makeRoom(),
      generator('{"unlockObjectId":"missing-panel","exitToRoomId":"north-room"}'),
    )).resolves.toEqual({ status: 'rejected' })
  })

  it('catches unexpected assembly throws and returns rejected', async () => {
    vi.mocked(assembleGate).mockImplementationOnce(() => {
      throw new Error('unexpected raw provider text')
    })

    await expect(buildGeneratedGateAttachment(
      makeRoom(),
      generator('{"unlockObjectId":"control-panel","exitToRoomId":"north-room"}'),
    )).resolves.toEqual({ status: 'rejected' })
  })
})
