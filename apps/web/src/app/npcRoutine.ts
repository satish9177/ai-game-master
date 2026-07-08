/**
 * Demo/dev-only opt-in composition selector for `npc-day-night-routine-v0`
 * (ADR-0087), gated by a default-off env flag mirroring
 * `readDemoChaseEnabled`/`VITE_AIGM_DEMO_CHASE` (ADR-0086).
 *
 * This module is a pure selector layer: it decides *which ids* (if any) reach
 * the existing, unchanged `Engine.SetRoomOptions.npcRoutineModes` seam, and
 * what mode each resolves to for the current time bucket. It has no runtime
 * movement behavior of its own and reads only ids plus the existing
 * `TimeOfDay` bucket — never NPC name, room text, prompt text, provider
 * output, generated content, relationship state, or dialogue.
 */

import type { TimeOfDay } from '../domain/world/worldClock'
import type { NpcRoutineMode, NpcRoutineSchedule } from '../domain/npcRoutine'
import { selectRoutineMode } from '../domain/npcRoutine'
import { NPC_ROUTINE_CONFIG } from '../domain/npcRoutineConfig'

/** The subset of env we read. Accepted as a param so the gate is unit-testable. */
export type NpcRoutineRawEnv = Record<string, string | undefined>

/**
 * Read the demo routine gate from env. Defaults to `false` (off) when
 * `VITE_AIGM_DEMO_ROUTINE` is unset or not a recognized truthy value. Performs
 * no I/O and no logging.
 */
export function readRoutineEnabled(env: NpcRoutineRawEnv = import.meta.env): boolean {
  const normalized = (env.VITE_AIGM_DEMO_ROUTINE ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/** Arguments for {@link selectNpcRoutineModes}. Id-only; no content fields. */
export type SelectNpcRoutineModesArgs = {
  enabled: boolean
  presentNpcIds: ReadonlySet<string>
  timeOfDay: TimeOfDay | null | undefined
  config?: Readonly<Record<string, NpcRoutineSchedule>>
}

const EMPTY_ROUTINE_MODES: ReadonlyMap<string, NpcRoutineMode> = new Map()

/**
 * Select the resolved routine mode per NPC id: the empty map when disabled or
 * when `timeOfDay` is absent, otherwise the intersection of `config` (default
 * {@link NPC_ROUTINE_CONFIG}) and `presentNpcIds`, each mapped to its
 * schedule's mode for `timeOfDay` (unknown ids and missing/invalid buckets are
 * skipped, never defaulted). Config key order is preserved. Id-only; does not
 * mutate its inputs.
 */
export function selectNpcRoutineModes({
  enabled,
  presentNpcIds,
  timeOfDay,
  config = NPC_ROUTINE_CONFIG,
}: SelectNpcRoutineModesArgs): ReadonlyMap<string, NpcRoutineMode> {
  if (!enabled || timeOfDay === null || timeOfDay === undefined) {
    return EMPTY_ROUTINE_MODES
  }
  const selected = new Map<string, NpcRoutineMode>()
  for (const [npcId, schedule] of Object.entries(config)) {
    if (!presentNpcIds.has(npcId)) continue
    const mode = selectRoutineMode(schedule, timeOfDay)
    if (mode !== null) {
      selected.set(npcId, mode)
    }
  }
  return selected
}
