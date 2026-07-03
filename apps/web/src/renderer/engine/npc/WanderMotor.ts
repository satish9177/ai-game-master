import { shouldPauseWander } from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import { createInitialWanderState, updateWanderStep } from './wanderStep'
import type { NpcWanderStepState } from './wanderStep'

export type WanderPositionNode = {
  position: {
    x: number
    z: number
  }
}

export type WanderInteractableRef = {
  position: {
    x: number
    z: number
  }
}

export type WanderMotorRegistration = {
  npcId: string
  node: WanderPositionNode
  ring?: WanderPositionNode
  interactable?: WanderInteractableRef
  field: NpcWanderField
  seed: string
  home: WanderXZ
}

export type WanderMotorPauseContext = {
  interactionLocked: boolean
  isNpcTalking: (npcId: string) => boolean
}

type WanderMotorEntry = {
  node: WanderPositionNode
  ring?: WanderPositionNode
  interactable?: WanderInteractableRef
  field: NpcWanderField
  seed: string
  state: NpcWanderStepState
}

export class WanderMotor {
  private readonly entries = new Map<string, WanderMotorEntry>()

  register(registration: WanderMotorRegistration): void {
    const state = createInitialWanderState(registration.home)
    const entry: WanderMotorEntry = {
      node: registration.node,
      field: registration.field,
      seed: registration.seed,
      state,
      ...(registration.ring !== undefined ? { ring: registration.ring } : {}),
      ...(registration.interactable !== undefined ? { interactable: registration.interactable } : {}),
    }

    this.entries.set(registration.npcId, entry)
    syncXZ(entry, state.position)
  }

  update(dtS: number, context: WanderMotorPauseContext): void {
    for (const [npcId, entry] of this.entries) {
      if (shouldPauseWander({
        interactionLocked: context.interactionLocked,
        npcTalking: context.isNpcTalking(npcId),
      })) {
        syncXZ(entry, entry.state.position)
        continue
      }

      entry.state = updateWanderStep({
        state: entry.state,
        field: entry.field,
        dtS,
        seed: entry.seed,
      })
      syncXZ(entry, entry.state.position)
    }
  }

  isWalking(npcId: string): boolean {
    return this.entries.get(npcId)?.state.mode === 'moving'
  }

  clear(): void {
    this.entries.clear()
  }
}

function syncXZ(entry: WanderMotorEntry, position: WanderXZ): void {
  entry.node.position.x = position.x
  entry.node.position.z = position.z

  if (entry.ring !== undefined) {
    entry.ring.position.x = position.x
    entry.ring.position.z = position.z
  }

  if (entry.interactable !== undefined) {
    entry.interactable.position.x = position.x
    entry.interactable.position.z = position.z
  }
}
