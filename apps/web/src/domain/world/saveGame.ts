import { z } from 'zod'
import { WorldEventSchema } from './events'
import { CanonSeedSchema, WorldStateSchema, WORLD_SCHEMA_VERSION } from './worldState'

export const SaveGameSchema = z.object({
  schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
  seed: CanonSeedSchema,
  log: z.array(WorldEventSchema),
  snapshot: WorldStateSchema,
}).strict()

/** Minimal envelope used to distinguish malformed documents from newer versions. */
export const SaveGameVersionEnvelopeSchema = z
  .object({ schemaVersion: z.number().int() })
  .passthrough()

export type SaveGame = z.infer<typeof SaveGameSchema>
