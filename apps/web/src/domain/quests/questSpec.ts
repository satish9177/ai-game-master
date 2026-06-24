import { z } from 'zod'

export const ObjectiveConditionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('room-flag'), roomId: z.string().min(1), flag: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal('has-item'),
      itemId: z.string().min(1),
      min: z.number().int().min(1).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('room-visited'), roomId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('has-status'), status: z.string().min(1) }).strict(),
])

export type ObjectiveCondition = z.infer<typeof ObjectiveConditionSchema>

export const QuestObjectiveSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    condition: ObjectiveConditionSchema,
  })
  .strict()

export type QuestObjective = z.infer<typeof QuestObjectiveSchema>

export const QuestSpecSchema = z
  .object({
    questId: z.string().min(1),
    title: z.string().min(1),
    anchorRoomId: z.string().min(1),
    objectives: z.array(QuestObjectiveSchema).min(1).refine(
      (objs) => new Set(objs.map((o) => o.id)).size === objs.length,
      { message: 'objective ids must be unique' },
    ),
  })
  .strict()

export type QuestSpec = z.infer<typeof QuestSpecSchema>
