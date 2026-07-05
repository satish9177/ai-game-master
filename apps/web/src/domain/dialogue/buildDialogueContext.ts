import type { WorldState } from '../world/worldState'
import type {
  NPCDialogueContext,
  NPCDialogueTurn,
  QuestDialogueContext,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
} from './contracts'
import { projectRelationshipDialogueContext } from '../npcRelationship/dialogueContext'
import type { NpcRelationshipState } from '../npcRelationship/contracts'
import type { PromptTimeContext } from '../world/worldClock'

export type DialogueNPC = {
  npcId: string
  npcName: string
  persona?: string
}

/** Pure projection of authoritative world facts into provider-safe dialogue context. */
export function buildDialogueContext(
  state: WorldState,
  npc: DialogueNPC,
  history: NPCDialogueTurn[],
  roomContext?: RoomDialogueContext,
  questContext?: QuestDialogueContext,
  memoryContext?: RoomMemoryDialogueContext,
  relationshipState?: NpcRelationshipState,
  timeContext?: PromptTimeContext,
): NPCDialogueContext {
  return {
    roomId: state.currentRoomId,
    npcId: npc.npcId,
    npcName: npc.npcName,
    ...(npc.persona !== undefined ? { persona: npc.persona } : {}),
    ...(roomContext !== undefined ? { room: copyRoomDialogueContext(roomContext) } : {}),
    ...(questContext !== undefined ? { quest: { ...questContext } } : {}),
    ...(memoryContext !== undefined ? { memory: copyRoomMemoryDialogueContext(memoryContext) } : {}),
    player: {
      health: { ...state.player.health },
      status: [...state.player.status],
      inventoryItemIds: state.inventory.map((item) => item.itemId),
    },
    history: history.map((turn) => ({ ...turn })),
    // Always present, even absent a projection: the pure projector degrades a
    // missing relationship to the neutral/no-familiarity context, never omits
    // the field or leaks another NPC's/session's state.
    relationship: projectRelationshipDialogueContext(relationshipState),
    ...(timeContext !== undefined ? { time: { ...timeContext } } : {}),
  }
}

function copyRoomDialogueContext(room: RoomDialogueContext): RoomDialogueContext {
  return {
    ...(room.focus ? { focus: { ...room.focus } } : {}),
    features: room.features.map((feature) => ({ ...feature })),
    affordances: [...room.affordances],
    npcCount: room.npcCount,
  }
}

function copyRoomMemoryDialogueContext(memory: RoomMemoryDialogueContext): RoomMemoryDialogueContext {
  return {
    entries: memory.entries.map((entry) => ({ ...entry })),
  }
}
