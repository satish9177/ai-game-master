import { describe, expect, it, vi } from 'vitest'
import { validateGeneratedMechanicalGate, type GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import type { WorldState } from '../domain/world/worldState'
import type { WorldStateResult } from '../world-session/WorldSession'
import type { NavigationResult } from './NavigationService'
import { navigateWithExitGate } from './gatedNavigation'

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: 'throne-room',
    player: { health: { current: 10, max: 10 }, status: [] },
    inventory: [],
    roomStates: { 'throne-room': { visited: true } },
    revision: 1,
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

function stateResult(state: WorldState): WorldStateResult {
  return { ok: true, state }
}

function notFoundResult(): WorldStateResult {
  return { ok: false, error: { code: 'not-found', message: 'Session not found.' } }
}

function generatedRoom(objects: unknown[] = generatedGateObjects()): LoadedRoom {
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

function generatedGateObjects(): unknown[] {
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

function generatedState(flags?: Record<string, boolean>): WorldState {
  return makeState({
    currentRoomId: 'generated-room',
    roomStates: {
      'generated-room': { visited: true, ...(flags ? { flags } : {}) },
    },
  })
}

function providerGate(overrides: Partial<GeneratedMechanicalGate> = {}): GeneratedMechanicalGate {
  const gate = validateGeneratedMechanicalGate({
    id: 'provider-gate',
    kind: 'locked-exit',
    condition: {
      kind: 'room-flag',
      roomId: 'generated-room',
      flag: 'interaction:control-panel',
    },
    effect: { kind: 'unlock-exit', toRoomId: 'north-room' },
    ...overrides,
  })
  if (gate === null) throw new Error('invalid test provider gate')
  return gate
}

const delegatedResult: NavigationResult = { status: 'rejected', reason: 'unknown-room' }

type RunOverrides = Partial<{
  sessionId: string
  fromRoomId: string
  toRoomId: string
  demoQuestEnabled: boolean
  getWorldState: (sessionId: string) => Promise<WorldStateResult>
  navigate: () => Promise<NavigationResult>
}>

function run(overrides: RunOverrides = {}) {
  const navigate = vi.fn<() => Promise<NavigationResult>>()
    .mockResolvedValue(delegatedResult)
  const getWorldState = vi.fn<(sessionId: string) => Promise<WorldStateResult>>()
    .mockResolvedValue(stateResult(makeState()))

  const result = navigateWithExitGate({
    sessionId: overrides.sessionId ?? '00000000-0000-4000-8000-000000000002',
    fromRoomId: overrides.fromRoomId ?? 'throne-room',
    toRoomId: overrides.toRoomId ?? 'ruined-safehouse',
    demoQuestEnabled: overrides.demoQuestEnabled ?? true,
    getWorldState: overrides.getWorldState ?? getWorldState,
    navigate: overrides.navigate ?? navigate,
  })

  return { getWorldState, navigate, result }
}

function runGenerated(overrides: Partial<{
  toRoomId: string
  room: LoadedRoom
  stateResult: WorldStateResult
  providerGateStatus: 'not-attempted' | 'accepted' | 'rejected'
  providerGate: GeneratedMechanicalGate
}>) {
  const navigate = vi.fn<() => Promise<NavigationResult>>()
    .mockResolvedValue(delegatedResult)
  const getWorldState = vi.fn<(sessionId: string) => Promise<WorldStateResult>>()
    .mockResolvedValue(overrides.stateResult ?? stateResult(generatedState()))

  const result = navigateWithExitGate({
    sessionId: '00000000-0000-4000-8000-000000000002',
    fromRoomId: 'generated-room',
    toRoomId: overrides.toRoomId ?? 'north-room',
    demoQuestEnabled: false,
    generatedGateEnabled: true,
    currentRoom: overrides.room ?? generatedRoom(),
    providerGateStatus: overrides.providerGateStatus,
    providerGate: overrides.providerGate,
    getWorldState,
    navigate,
  })

  return { getWorldState, navigate, result }
}

describe('navigateWithExitGate', () => {
  it('returns blocked and does not call navigation before Malik is resolved', async () => {
    const { getWorldState, navigate, result } = run()

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'blocked' })
    expect(getWorldState).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('delegates after Malik is resolved', async () => {
    const { navigate, result } = run({
      getWorldState: async () => stateResult(makeState({
        roomStates: {
          'throne-room': {
            visited: true,
            flags: { 'encounter:malik-encounter': true },
          },
        },
      })),
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does not gate non-demo sessions', async () => {
    const { getWorldState, navigate, result } = run({ demoQuestEnabled: false })

    await expect(result).resolves.toBe(delegatedResult)
    expect(getWorldState).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does not gate generated or unrelated room paths', async () => {
    const { navigate, result } = run({
      fromRoomId: 'generated-room-a',
      toRoomId: 'generated-room-b',
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('delegates to existing navigation behavior when authoritative state is unavailable', async () => {
    const { navigate, result } = run({ getWorldState: async () => notFoundResult() })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('rejects a generated governed exit while the unlock flag is missing', async () => {
    const { getWorldState, navigate, result } = runGenerated({})

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'gate-locked' })
    expect(getWorldState).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('rejects a generated governed exit while the unlock flag is false', async () => {
    const { navigate, result } = runGenerated({
      stateResult: stateResult(generatedState({ 'interaction:control-panel': false })),
    })

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'gate-locked' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('delegates a generated governed exit after the unlock flag is true', async () => {
    const { navigate, result } = runGenerated({
      stateResult: stateResult(generatedState({ 'interaction:control-panel': true })),
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('delegates generated non-governed exits', async () => {
    const { navigate, result } = runGenerated({ toRoomId: 'side-room' })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('delegates generated rooms with no derived gate', async () => {
    const { navigate, result } = runGenerated({
      room: generatedRoom([
        { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
        {
          type: 'arch',
          id: 'north-arch',
          position: [0, 0, -8],
          interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
        },
      ]),
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('fails open for generated gates when authoritative state is unavailable', async () => {
    const { navigate, result } = runGenerated({ stateResult: notFoundResult() })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('keeps the authored demo gate precedence when both checks are enabled', async () => {
    const navigate = vi.fn<() => Promise<NavigationResult>>()
      .mockResolvedValue(delegatedResult)
    const getWorldState = vi.fn<(sessionId: string) => Promise<WorldStateResult>>()
      .mockResolvedValue(stateResult(makeState()))

    const result = navigateWithExitGate({
      sessionId: '00000000-0000-4000-8000-000000000002',
      fromRoomId: 'throne-room',
      toRoomId: 'ruined-safehouse',
      demoQuestEnabled: true,
      generatedGateEnabled: true,
      currentRoom: generatedRoom(),
      getWorldState,
      navigate,
    })

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'blocked' })
    expect(getWorldState).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('forwards rejected provider status so generated navigation fails open without deterministic fallback', async () => {
    const { navigate, result } = runGenerated({ providerGateStatus: 'rejected' })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('forwards accepted provider gates to govern the generated exit', async () => {
    const { navigate, result } = runGenerated({
      providerGateStatus: 'accepted',
      providerGate: providerGate(),
    })

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'gate-locked' })
    expect(navigate).not.toHaveBeenCalled()
  })
})
