import type { NPCDialogueSpec } from '../domain/dialogue/contracts'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { NPCDialogueResult } from '../dialogue/NPCDialogueService'

export type NPCDialogueTarget = {
  npcId: string
  npcName: string
  dialogue: NPCDialogueSpec
  persona?: string
}

export type NPCDialogueLookup = ReadonlyMap<string, NPCDialogueTarget>

export function buildDialogueLookup(room: LoadedRoom): NPCDialogueLookup {
  const lookup = new Map<string, NPCDialogueTarget>()
  for (const object of room.objects) {
    const interaction = 'interaction' in object ? object.interaction : undefined
    if (!object.id || !interaction?.dialogue || lookup.has(object.id)) continue
    const dialogue = interaction.dialogue
    const npcName = 'name' in object && object.name ? object.name : object.id
    lookup.set(object.id, {
      npcId: object.id,
      npcName,
      dialogue,
      ...(dialogue.persona !== undefined ? { persona: dialogue.persona } : {}),
    })
  }
  return lookup
}

export function dialogueResultMessage(result: NPCDialogueResult): string | undefined {
  if (result.status === 'replied') return undefined
  if (result.status === 'rejected') return undefined
  if (result.reason === 'provider-unavailable') return 'They have nothing to say right now.'
  return 'This conversation is unavailable.'
}
