/**
 * Demo/dev-only opt-in path for `hostile-npc-chase-lite-v0` (ADR-0084), gated by
 * a default-off env flag and a closed, id-only allowlist (ADR-0086).
 *
 * This module is a pure selector layer: it decides *which ids* (if any) reach the
 * existing, unchanged `SetRoomOptions.chaseOptInNpcIds` seam. It has no runtime
 * chase behavior of its own and reads only ids — never NPC name, room text, prompt
 * text, provider output, generated content, relationship state, or dialogue.
 *
 * Follows the same shape as `llmConfig.ts`: a pure, injectable-env config reader
 * with a safe (off) default.
 */

/**
 * Closed, hand-authored allowlist of NPC ids eligible for the demo chase opt-in.
 * Never derived, discovered, inferred, or expanded at runtime.
 */
export const DEMO_CHASE_NPC_IDS: ReadonlySet<string> = new Set(['herald-asha'])

/** The subset of env we read. Accepted as a param so the gate is unit-testable. */
export type DemoChaseRawEnv = Record<string, string | undefined>

/**
 * Read the demo chase gate from env. Defaults to `false` (off) when
 * `VITE_AIGM_DEMO_CHASE` is unset or not a recognized truthy value. Performs no
 * I/O and no logging.
 */
export function readDemoChaseEnabled(env: DemoChaseRawEnv = import.meta.env): boolean {
  const normalized = (env.VITE_AIGM_DEMO_CHASE ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/** Arguments for {@link selectDemoChaseOptInNpcIds}. Id-only; no content fields. */
export type SelectDemoChaseOptInNpcIdsArgs = {
  enabled: boolean
  presentNpcIds: ReadonlySet<string>
  allowlist?: ReadonlySet<string>
}

const EMPTY_NPC_IDS: ReadonlySet<string> = new Set()

/**
 * Select the demo chase opt-in NPC ids: the empty set when disabled, otherwise
 * the intersection of `allowlist` (default {@link DEMO_CHASE_NPC_IDS}) and
 * `presentNpcIds`, in allowlist order. Id-only; does not mutate its inputs.
 */
export function selectDemoChaseOptInNpcIds({
  enabled,
  presentNpcIds,
  allowlist = DEMO_CHASE_NPC_IDS,
}: SelectDemoChaseOptInNpcIdsArgs): ReadonlySet<string> {
  if (!enabled) {
    return EMPTY_NPC_IDS
  }
  const selected = new Set<string>()
  for (const id of allowlist) {
    if (presentNpcIds.has(id)) {
      selected.add(id)
    }
  }
  return selected
}
