import type { WorldState } from '../world/worldState'
import type { NPCDialogueContext, NPCDialogueTurn, RoomDialogueContext } from './contracts'

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
): NPCDialogueContext {
  return {
    roomId: state.currentRoomId,
    npcId: npc.npcId,
    npcName: npc.npcName,
    ...(npc.persona !== undefined ? { persona: npc.persona } : {}),
    ...(roomContext !== undefined ? { room: copyRoomDialogueContext(roomContext) } : {}),
    player: {
      health: { ...state.player.health },
      status: [...state.player.status],
      inventoryItemIds: state.inventory.map((item) => item.itemId),
    },
    history: history.map((turn) => ({ ...turn })),
    relationship: undefined,
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
