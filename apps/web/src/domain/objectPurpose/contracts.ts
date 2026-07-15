import { z } from 'zod'
import { ObjectInteractionStateSchema, type ObjectInteractionState } from '../visuals/contracts'

export const AFFORDANCE_ACTIONS = ['inspect', 'read', 'search', 'open', 'take', 'use'] as const
export const AffordanceActionSchema = z.enum(AFFORDANCE_ACTIONS)
export type AffordanceAction = z.infer<typeof AffordanceActionSchema>

const AffordancePreconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room-flag'), roomId: z.string().min(1), flag: z.string().min(1), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('has-item'), itemId: z.string().min(1), quantity: z.number().int().min(1).optional() }).strict(),
  z.object({ kind: z.literal('object-state'), objectId: z.string().min(1), state: ObjectInteractionStateSchema }).strict(),
  z.object({ kind: z.literal('objective-stage'), objectiveId: z.string().min(1), atLeast: z.number().int().nonnegative() }).strict(),
])
export type AffordancePrecondition = z.infer<typeof AffordancePreconditionSchema>

const InventoryItemSchema = z.object({ itemId: z.string().min(1), name: z.string().min(1), quantity: z.number().int().min(1) }).strict()
const AffordanceEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set-object-state'), objectId: z.string().min(1), state: ObjectInteractionStateSchema }).strict(),
  z.object({ kind: z.literal('set-room-flag'), roomId: z.string().min(1), flag: z.string().min(1), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('add-item'), item: InventoryItemSchema }).strict(),
  z.object({ kind: z.literal('reveal-clue'), clueId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('progress-objective'), objectiveId: z.string().min(1), toStage: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('unlock-exit'), exitId: z.string().min(1) }).strict(),
])
export type AffordanceEffect = z.infer<typeof AffordanceEffectSchema>

export const AFFORDANCE_REPEAT_POLICIES = ['once', 'per-state', 'always'] as const
export const AffordanceRepeatPolicySchema = z.enum(AFFORDANCE_REPEAT_POLICIES)
export type AffordanceRepeatPolicy = z.infer<typeof AffordanceRepeatPolicySchema>

const ObjectAffordanceSchema = z.object({ id: z.string().min(1), action: AffordanceActionSchema, preconditions: z.array(AffordancePreconditionSchema), effects: z.array(AffordanceEffectSchema), repeat: AffordanceRepeatPolicySchema }).strict()
export type ObjectAffordance = z.infer<typeof ObjectAffordanceSchema>

export const OBJECT_PURPOSE_CATEGORIES = ['clue-bearing', 'container', 'lore', 'mechanism', 'blocker', 'resource', 'decorative'] as const
export const ObjectPurposeCategorySchema = z.enum(OBJECT_PURPOSE_CATEGORIES)
export type ObjectPurposeCategory = z.infer<typeof ObjectPurposeCategorySchema>

const ObjectPurposeSchema = z.object({ objectId: z.string().min(1), category: ObjectPurposeCategorySchema, required: z.boolean(), affordances: z.array(ObjectAffordanceSchema) }).strict()
export type ObjectPurpose = z.infer<typeof ObjectPurposeSchema>

/** Strict, fail-closed parsing for the inert Slice A data contract. */
export function validateObjectPurpose(raw: unknown): ObjectPurpose | null {
  const parsed = ObjectPurposeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export type { ObjectInteractionState }
