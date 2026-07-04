import type { Fact } from './contracts'

export type NPCFactViewer = {
  kind: 'npc'
  worldId: string
  sessionId: string
  npcId: string
  roomId: string
}

export function filterVisibleFacts(facts: readonly Fact[], viewer: NPCFactViewer): Fact[] {
  return facts.filter((fact) => {
    if (fact.worldId !== viewer.worldId || fact.sessionId !== viewer.sessionId) {
      return false
    }

    switch (fact.visibility.scope) {
      case 'public':
        return true
      case 'room-known':
        return fact.visibility.roomId === viewer.roomId
      case 'npc-known':
        return fact.visibility.npcIds.includes(viewer.npcId)
      case 'player-known':
      case 'hidden':
        return false
    }
  })
}

