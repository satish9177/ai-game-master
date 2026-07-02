import { z } from 'zod'
import type { Affordance } from '../interactions/affordance'
import type { RoomObject } from '../roomSpec'

export const NPCDialoguePromptSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()

export const NPCDialogueSpecSchema = z
  .object({
    persona: z.string().optional(),
    greeting: z.string().optional(),
    prompts: z.array(NPCDialoguePromptSchema).optional(),
  })
  .strict()

export type NPCDialoguePrompt = z.infer<typeof NPCDialoguePromptSchema>
export type NPCDialogueSpec = z.infer<typeof NPCDialogueSpecSchema>

export type NPCDialogueTurn = {
  speaker: 'player' | 'npc'
  text: string
}

export type NPCObjectiveKind = 'inspect' | 'resolve' | 'reach' | 'general'

export type NPCObjectiveContext = {
  status: 'active' | 'complete'
  kind: NPCObjectiveKind
}

export type QuestDialogueContext = {
  activeObjectiveId: string | null
  status: 'active' | 'complete'
  hint?: string
  completionHint?: string
  objective?: NPCObjectiveContext
}

export type RoomMemoryContextEntry = {
  text: string
  kind?: string
}

/**
 * Bounded, non-authoritative recall context (room-memory-recall-context-v0,
 * Slice F). Dialogue-local by design: `domain/dialogue` must not import
 * `domain/memory`, so this is a plain shape rather than a re-export of
 * `RoomMemoryRecord`. The app-layer orchestrator (`app/recallRoomMemoryContext.ts`)
 * maps recalled records into this shape. It is recall/context only — never
 * gameplay truth, never a source of state mutation.
 */
export type RoomMemoryDialogueContext = {
  entries: RoomMemoryContextEntry[]
}

export type NPCDialogueContext = {
  roomId: string
  npcId: string
  npcName: string
  persona?: string
  room?: RoomDialogueContext
  quest?: QuestDialogueContext
  /** Bounded, non-authoritative room-memory recall context. See `RoomMemoryDialogueContext`. */
  memory?: RoomMemoryDialogueContext
  player: {
    health: { current: number; max: number }
    status: string[]
    inventoryItemIds: string[]
  }
  history: NPCDialogueTurn[]
  relationship?: string
}

export type NPCDialogueRequest = {
  context: NPCDialogueContext
  promptId?: string
  playerLine?: string
}

export type NPCDialogueResponse = {
  text: string
}

export type RoomFeatureDirection = 'north' | 'south' | 'east' | 'west' | 'center'

export type RoomDialogueFeature = {
  type: RoomObject['type']
  direction: RoomFeatureDirection
}

export type RoomDialogueContext = {
  focus?: RoomDialogueFeature
  features: RoomDialogueFeature[]
  affordances: Affordance[]
  npcCount: number
}
