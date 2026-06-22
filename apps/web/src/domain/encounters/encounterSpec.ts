import { z } from 'zod'
import { InventoryItemSchema } from '../world/worldState'

/**
 * EncounterSpec is DATA ONLY (ADR-0015). It describes a genre-neutral threat,
 * its choices, and the deterministic authored outcome of each choice. Nothing
 * here is executed as code: the planner maps these descriptors to the existing
 * WorldCommand union, and the renderer never sees them.
 *
 * The only fixed vocabulary is the genre-neutral `action` enum and the generic
 * effect-atom `kind` union. All threat text, choice labels, result text, status
 * strings, and item names/ids are authored data — no genre-specific code, and
 * none of this narrative text is ever logged.
 */

/** Genre-neutral choice vocabulary shared across every genre. */
export const ChoiceActionSchema = z.enum(['fight', 'hide', 'run', 'distract', 'negotiate'])
export type ChoiceAction = z.infer<typeof ChoiceActionSchema>

/**
 * A single, data-only outcome effect. Each `kind` maps 1:1 to one existing
 * WorldCommand (no new world-session event type — ADR-0015 decision 6):
 *   damage      → health-changed { delta: -amount }
 *   heal        → health-changed { delta: +amount }
 *   add-status  → status-changed { status, op: 'add' }
 *   clear-status→ status-changed { status, op: 'clear' }
 *   remove-item → item-removed   { itemId, quantity }
 *   add-item    → item-added     { item }
 */
export const EncounterEffectAtomSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('damage'), amount: z.number().int().min(1) }).strict(),
  z.object({ kind: z.literal('heal'), amount: z.number().int().min(1) }).strict(),
  z.object({ kind: z.literal('add-status'), status: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('clear-status'), status: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('remove-item'),
      itemId: z.string().min(1),
      quantity: z.number().int().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('add-item'), item: InventoryItemSchema }).strict(),
])
export type EncounterEffectAtom = z.infer<typeof EncounterEffectAtomSchema>

export const EncounterOutcomeSchema = z
  .object({
    // May be empty (e.g. 'hide' = nothing happens).
    effects: z.array(EncounterEffectAtomSchema).default([]),
    resultText: z.string().optional(), // display only; NEVER logged
  })
  .strict()
export type EncounterOutcome = z.infer<typeof EncounterOutcomeSchema>

export const EncounterChoiceSchema = z
  .object({
    id: z.string().min(1), // stable; identifies the chosen option
    action: ChoiceActionSchema,
    label: z.string().min(1), // display, e.g. "Fight it off"; NEVER logged
    // Optional possession gate. Checks possession only; consuming the item, if
    // desired, is an explicit `remove-item` atom in the same outcome.
    requires: z
      .object({ itemId: z.string().min(1), quantity: z.number().int().min(1) })
      .strict()
      .optional(),
    outcome: EncounterOutcomeSchema,
  })
  .strict()
export type EncounterChoice = z.infer<typeof EncounterChoiceSchema>

export const EncounterSpecSchema = z
  .object({
    id: z.string().optional(), // stable encounter id; falls back to the object ref
    title: z.string().optional(), // display threat name; NEVER logged
    description: z.string().min(1), // display threat text; NEVER logged
    choices: z
      .array(EncounterChoiceSchema)
      .min(1)
      .refine((choices) => new Set(choices.map((choice) => choice.id)).size === choices.length, {
        message: 'encounter choice ids must be unique',
      }),
  })
  .strict()
export type EncounterSpec = z.infer<typeof EncounterSpecSchema>
