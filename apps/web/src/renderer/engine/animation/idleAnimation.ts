import type * as THREE from 'three'
import { stableHash01 } from '../../../domain/stableHash'

/** Meters. Conservative raise-only bob height. */
export const IDLE_BOB_AMPLITUDE = 0.025
/** Hz. Breathing-like cadence, deliberately calmer than a bounce. */
export const IDLE_BOB_FREQUENCY_HZ = 0.25
/** Radians. Disabled for v0; enabling later is a constants-only change. */
export const IDLE_SWAY_AMPLITUDE_RAD = 0
/** Hz. Inert while `IDLE_SWAY_AMPLITUDE_RAD` is 0. */
export const IDLE_SWAY_FREQUENCY_HZ = 0.55

export type IdleOffsets = {
  bobY: number
  swayRad: number
}

/** Deterministic per-NPC phase in `[0, 2π)`, stable across reloads. */
export function idlePhase(roomId: string, objectKey: string): number {
  return stableHash01(roomId + objectKey) * Math.PI * 2
}

/**
 * Pure offsets for a given phase and elapsed time. `bobY` is raise-only —
 * always in `[0, IDLE_BOB_AMPLITUDE]` — so the node never dips below its base
 * Y. `swayRad` is bounded by `IDLE_SWAY_AMPLITUDE_RAD` (identically 0 in v0).
 */
export function idleOffsets(phase: number, elapsedS: number): IdleOffsets {
  const bobAngle = phase + elapsedS * IDLE_BOB_FREQUENCY_HZ * Math.PI * 2
  const bobY = IDLE_BOB_AMPLITUDE * 0.5 * (1 + Math.sin(bobAngle))
  const swayAngle = phase + elapsedS * IDLE_SWAY_FREQUENCY_HZ * Math.PI * 2
  const swayRad = IDLE_SWAY_AMPLITUDE_RAD * Math.sin(swayAngle)
  return { bobY, swayRad }
}

export type IdleAnimatorEntry = {
  node: THREE.Object3D
  phase: number
  baseY: number
  baseRotY: number
}

/**
 * Applies idle bob/sway to registered nodes each frame, oscillating around
 * each node's captured base Y/rotation.y. Never touches X/Z. All state dies
 * with `clear()`; safe to call `update` after `clear` (no-op).
 */
export class IdleAnimator {
  private readonly entries: IdleAnimatorEntry[] = []
  private elapsedS = 0

  register(entry: IdleAnimatorEntry): void {
    this.entries.push(entry)
  }

  update(dt: number): void {
    this.elapsedS += dt
    for (const entry of this.entries) {
      const { bobY, swayRad } = idleOffsets(entry.phase, this.elapsedS)
      entry.node.position.y = entry.baseY + bobY
      entry.node.rotation.y = entry.baseRotY + swayRad
    }
  }

  clear(): void {
    this.entries.length = 0
  }
}
