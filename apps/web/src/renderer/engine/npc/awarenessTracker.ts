import type { NpcPlayerAwarenessLevel, NpcPlayerAwarenessState } from '../../../domain/npcPlayerAwareness'

export type NpcAwarenessChange = Readonly<{
  npcId: string
  level: NpcPlayerAwarenessLevel
  previousLevel: NpcPlayerAwarenessLevel
}>

export class NpcAwarenessTracker {
  private readonly levels = new Map<string, NpcPlayerAwarenessLevel>()

  levelOf(npcId: string): NpcPlayerAwarenessLevel {
    return this.levels.get(npcId) ?? 'unaware'
  }

  update(state: NpcPlayerAwarenessState): NpcAwarenessChange | null {
    const previousLevel = this.levelOf(state.npcId)
    this.levels.set(state.npcId, state.level)

    if (previousLevel === state.level) return null

    return { npcId: state.npcId, level: state.level, previousLevel }
  }

  clear(): void {
    this.levels.clear()
  }
}
