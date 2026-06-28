import type { LoadedRoom } from '../loadRoomSpec'

/**
 * ObjectiveGenerator port for generated story-objective proposals.
 *
 * The returned string is raw, untrusted JSON text. Callers must pass it through
 * `assembleObjective` before it can become a trusted `QuestSpec`.
 */
export interface ObjectiveGenerator {
  generate(room: LoadedRoom): Promise<string | null>
}

