import type { NpcBehaviorState } from '../../../domain/ports/npcBehavior'

export class NpcBehaviorTracker {
  private talkingNpcId: string | null = null
  private readonly wanderingNpcIds = new Set<string>()

  stateOf(npcId: string): NpcBehaviorState {
    if (this.talkingNpcId === npcId) return 'talking'
    if (this.wanderingNpcIds.has(npcId)) return 'wandering'
    return 'idle'
  }

  setTalking(npcId: string | null): void {
    this.talkingNpcId = npcId
  }

  setWandering(npcId: string, walking: boolean): void {
    if (walking) {
      this.wanderingNpcIds.add(npcId)
      return
    }

    this.wanderingNpcIds.delete(npcId)
  }

  clear(): void {
    this.talkingNpcId = null
    this.wanderingNpcIds.clear()
  }
}
