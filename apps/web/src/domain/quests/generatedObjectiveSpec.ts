import { z } from 'zod'

export const GENERATED_OBJECTIVE_TITLE_MAX_LENGTH = 80
export const GENERATED_OBJECTIVE_TEXT_MAX_LENGTH = 160

const GeneratedObjectiveObjectIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/^(?:interaction|encounter):/.test(value), {
    message: 'objectId must be a room object id, not a derived flag key',
  })

export const GeneratedObjectiveConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interact-object'), objectId: GeneratedObjectiveObjectIdSchema }).strict(),
  z.object({ kind: z.literal('resolve-encounter'), objectId: GeneratedObjectiveObjectIdSchema }).strict(),
  z.object({ kind: z.literal('visit-room'), roomId: z.string().trim().min(1) }).strict(),
])

export type GeneratedObjectiveCondition = z.infer<typeof GeneratedObjectiveConditionSchema>
export type GeneratedObjectiveConditionKind = GeneratedObjectiveCondition['kind']

export const GeneratedObjectiveSpecSchema = z
  .object({
    title: z.string().trim().min(1).max(GENERATED_OBJECTIVE_TITLE_MAX_LENGTH),
    description: z.string().trim().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    hint: z.string().trim().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    completionHint: z.string().trim().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    condition: GeneratedObjectiveConditionSchema,
  })
  .strict()

export type GeneratedObjectiveSpec = z.infer<typeof GeneratedObjectiveSpecSchema>
