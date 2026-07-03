import { describe, expect, it } from 'vitest'
import {
  chooseWanderStep,
  isWanderPositionAllowed,
  NPC_WANDER,
  wanderPauseSeconds,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import { stableHash01, stableHash32 } from '../../../domain/stableHash'
import { createInitialWanderState, updateWanderStep } from './wanderStep'
import type { NpcWanderStepState } from './wanderStep'

function openField(): NpcWanderField {
  return {
    roomId: 'wander-step-room',
    npcId: 'npc',
    home: { x: 0, z: 0 },
    bounds: { halfX: 8, halfZ: 8 },
    exclusions: [],
  }
}

function boxedField(): NpcWanderField {
  const seed = stableHash32('boxed')
  const current = { x: 0, z: 0 }
  const key = `boxed:npc:${current.x.toFixed(3)}:${current.z.toFixed(3)}:${seed}:0`
  const candidates = Array.from({ length: 24 }, (_, candidate) => {
    const angle = stableHash01(`${key}:angle:${candidate}`) * Math.PI * 2
    const length = NPC_WANDER.STEP_MIN
      + stableHash01(`${key}:length:${candidate}`) * (NPC_WANDER.STEP_MAX - NPC_WANDER.STEP_MIN)
    return {
      x: Math.cos(angle) * length,
      z: Math.sin(angle) * length,
    }
  })

  return {
    ...openField(),
    roomId: 'boxed',
    exclusions: candidates.map((target) => ({
      x: target.x,
      z: target.z,
      radius: 0.001,
      reason: 'footprint' as const,
    })),
  }
}

function distance(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function runSequence(field: NpcWanderField, seed: string, dts: readonly number[]): NpcWanderStepState[] {
  let state = createInitialWanderState(field.home)
  return dts.map((dtS) => {
    state = updateWanderStep({ state, field, dtS, seed })
    return state
  })
}

describe('wanderStep', () => {
  it('createInitialWanderState starts paused at home XZ', () => {
    const home = { x: 1.25, z: -2.5 }
    const state = createInitialWanderState(home)

    expect(state).toEqual({
      mode: 'pausing',
      position: home,
      target: null,
      pauseRemainingS: 0,
      stepIndex: 0,
    })
    expect(state.position).not.toBe(home)
  })

  it('is deterministic for the same field, home, seed, and dt sequence', () => {
    const field = openField()
    const dts = [0.1, 0.2, 0.35, 1.2, 0.016, 0.5, 2.1, 0.3, 4]

    expect(runSequence(field, 'same-seed', dts)).toEqual(runSequence(field, 'same-seed', dts))
  })

  it('keeps every emitted position inside the wander contract over many updates', () => {
    const field = openField()
    let state = createInitialWanderState(field.home)

    for (let index = 0; index < 300; index += 1) {
      state = updateWanderStep({ state, field, dtS: 0.1, seed: 'sweep' })

      expect(isWanderPositionAllowed(field, state.position)).toBe(true)
    }
  })

  it('caps movement distance by max speed per update', () => {
    const field = openField()
    let state = updateWanderStep({
      state: createInitialWanderState(field.home),
      field,
      dtS: 0,
      seed: 'speed-cap',
    })
    const before = state.position

    state = updateWanderStep({ state, field, dtS: 0.25, seed: 'speed-cap' })

    expect(distance(before, state.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * 0.25) + 1e-12)
  })

  it('snaps to the target instead of overshooting on a large dt', () => {
    const field = openField()
    const seed = 'no-overshoot'
    const first = chooseWanderStep(field, field.home, stableHash32(seed), 0)
    expect(first).not.toBeNull()

    const moving: NpcWanderStepState = {
      mode: 'moving',
      position: { ...field.home },
      target: first!.target,
      pauseRemainingS: 0,
      stepIndex: 0,
    }

    const state = updateWanderStep({ state: moving, field, dtS: 100, seed })

    expect(state.mode).toBe('pausing')
    expect(state.position).toEqual(first!.target)
    expect(distance(field.home, state.position)).toBeLessThanOrEqual(distance(field.home, first!.target))
  })

  it('snaps exactly to the target on arrival', () => {
    const field = openField()
    const seed = 'arrival-snap'
    const first = chooseWanderStep(field, field.home, stableHash32(seed), 0)
    expect(first).not.toBeNull()
    let state: NpcWanderStepState = {
      mode: 'moving',
      position: { ...field.home },
      target: first!.target,
      pauseRemainingS: 0,
      stepIndex: 0,
    }

    for (let index = 0; state.mode === 'moving' && index < 200; index += 1) {
      state = updateWanderStep({ state, field, dtS: 0.1, seed })
    }

    expect(state.position).toEqual(first!.target)
  })

  it('enters pausing after arrival with a contract-ranged pause', () => {
    const field = openField()
    const seed = 'pause-after-arrival'
    const first = chooseWanderStep(field, field.home, stableHash32(seed), 0)
    expect(first).not.toBeNull()
    const state = updateWanderStep({
      state: {
        mode: 'moving',
        position: { ...field.home },
        target: first!.target,
        pauseRemainingS: 0,
        stepIndex: 0,
      },
      field,
      dtS: 100,
      seed,
    })

    expect(state.mode).toBe('pausing')
    expect(state.pauseRemainingS).toBe(wanderPauseSeconds(stableHash32(seed), 0))
    expect(state.pauseRemainingS).toBeGreaterThanOrEqual(NPC_WANDER.PAUSE_MIN_S)
    expect(state.pauseRemainingS).toBeLessThan(NPC_WANDER.PAUSE_MAX_S)
  })

  it('keeps a boxed-in NPC safe and jitter-free when no target exists', () => {
    const field = boxedField()
    let state = createInitialWanderState(field.home)
    const positions: WanderXZ[] = []

    for (let index = 0; index < 10; index += 1) {
      state = updateWanderStep({ state, field, dtS: 0.25, seed: 'boxed' })
      positions.push(state.position)
    }

    expect(isWanderPositionAllowed(field, field.home)).toBe(true)
    expect(chooseWanderStep(field, field.home, stableHash32('boxed'), 0)).toBeNull()
    expect(positions.every((position) => position.x === field.home.x && position.z === field.home.z)).toBe(true)
    expect(state.mode).toBe('pausing')
    expect(state.target).toBeNull()
  })

  it('keeps smaller-frame updates safe and deterministic over equivalent total time', () => {
    const field = openField()
    const fine = runSequence(field, 'frame-rate', Array.from({ length: 60 }, () => 1 / 60))
    const fineAgain = runSequence(field, 'frame-rate', Array.from({ length: 60 }, () => 1 / 60))
    const coarse = runSequence(field, 'frame-rate', Array.from({ length: 10 }, () => 0.1))

    expect(fine).toEqual(fineAgain)
    expect(isWanderPositionAllowed(field, fine[fine.length - 1]!.position)).toBe(true)
    expect(isWanderPositionAllowed(field, coarse[coarse.length - 1]!.position)).toBe(true)
  })

  it('does not mutate input state or field', () => {
    const field = openField()
    const state = createInitialWanderState(field.home)
    const fieldBefore = JSON.stringify(field)
    const stateBefore = JSON.stringify(state)

    const next = updateWanderStep({ state, field, dtS: 0.2, seed: 'immutable' })

    expect(JSON.stringify(field)).toBe(fieldBefore)
    expect(JSON.stringify(state)).toBe(stateBefore)
    expect(next).not.toBe(state)
    expect(next.position).not.toBe(state.position)
  })

  it('does not construct WebGL or Engine objects', () => {
    const field = openField()

    expect(() => {
      updateWanderStep({
        state: createInitialWanderState(field.home),
        field,
        dtS: 0.1,
        seed: 'pure',
      })
    }).not.toThrow()
  })
})
