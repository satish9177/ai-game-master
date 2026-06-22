import { z } from 'zod'
import { InventoryItemSchema } from '../world/worldState'

export const InteractionEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inspect'),
    flag: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal('take-item'),
    item: InventoryItemSchema,
  }).strict(),
  z.object({
    kind: z.literal('use-item'),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1),
    health: z.object({ delta: z.number().int() }).strict().optional(),
  }).strict(),
])

export type InteractionEffect = z.infer<typeof InteractionEffectSchema>
