import { z } from 'zod'
import { ObjectiveConditionSchema } from '../quests/questSpec'

export const JournalEntrySpecSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    condition: ObjectiveConditionSchema,
  })
  .strict()

export type JournalEntrySpec = z.infer<typeof JournalEntrySpecSchema>

export const JournalSpecSchema = z
  .object({
    journalId: z.string().min(1),
    title: z.string().min(1),
    anchorRoomId: z.string().min(1),
    entries: z.array(JournalEntrySpecSchema).min(1).refine(
      (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
      { message: 'entry ids must be unique' },
    ),
  })
  .strict()

export type JournalSpec = z.infer<typeof JournalSpecSchema>
