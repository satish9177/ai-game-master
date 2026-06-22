import { z } from 'zod'

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

export type NPCDialogueContext = {
  roomId: string
  npcId: string
  npcName: string
  persona?: string
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
