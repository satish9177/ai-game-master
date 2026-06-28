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

export type QuestDialogueContext = {
  activeObjectiveId: string | null
  status: 'active' | 'complete'
}

export type NPCDialogueContext = {
  roomId: string
  npcId: string
  npcName: string
  persona?: string
  room?: RoomDialogueContext
  quest?: QuestDialogueContext
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
