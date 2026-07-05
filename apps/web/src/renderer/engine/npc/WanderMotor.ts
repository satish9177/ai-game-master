import { shouldPauseWander } from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import type { PatrolRoute } from '../../../domain/npcPatrolContract'
import { createInitialWanderState, updateWanderStep } from './wanderStep'
import type { NpcWanderStepState } from './wanderStep'
import { createInitialPatrolState, updatePatrolStep } from './patrolStep'
import type { NpcPatrolStepState } from './patrolStep'

export type WanderMotorPolicy = 'wander' | 'patrol'

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

type WanderMotorRegistrationBase = {
  npcId: string
  node: WanderPositionNode
  ring?: WanderPositionNode
  interactable?: WanderInteractableRef
  field: NpcWanderField
  seed: string
}

export type WanderMotorRegistration =
  | (WanderMotorRegistrationBase & { policy?: 'wander'; home: WanderXZ })
  | (WanderMotorRegistrationBase & { policy: 'patrol'; route: PatrolRoute })

export type WanderMotorPauseContext = {
  interactionLocked: boolean
  isNpcTalking: (npcId: string) => boolean
}

type WanderMotorEntryBase = {
  node: WanderPositionNode
  ring?: WanderPositionNode
  interactable?: WanderInteractableRef
  field: NpcWanderField
  seed: string
}

type WanderMotorEntry =
  | (WanderMotorEntryBase & { policy: 'wander'; state: NpcWanderStepState })
  | (WanderMotorEntryBase & { policy: 'patrol'; route: PatrolRoute; state: NpcPatrolStepState })

export class WanderMotor {
  private readonly entries = new Map<string, WanderMotorEntry>()

  register(registration: WanderMotorRegistration): void {
    const base: WanderMotorEntryBase = {
      node: registration.node,
      field: registration.field,
      seed: registration.seed,
      ...(registration.ring !== undefined ? { ring: registration.ring } : {}),
      ...(registration.interactable !== undefined ? { interactable: registration.interactable } : {}),
    }

    const entry: WanderMotorEntry = registration.policy === 'patrol'
      ? { ...base, policy: 'patrol', route: registration.route, state: createInitialPatrolState(registration.route) }
      : { ...base, policy: 'wander', state: createInitialWanderState(registration.home) }

    this.entries.set(registration.npcId, entry)
    syncXZ(entry, entry.state.position)
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

      if (entry.policy === 'patrol') {
        entry.state = updatePatrolStep({
          state: entry.state,
          route: entry.route,
          field: entry.field,
          dtS,
          seed: entry.seed,
        })
      } else {
        entry.state = updateWanderStep({
          state: entry.state,
          field: entry.field,
          dtS,
          seed: entry.seed,
        })
      }
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

function syncXZ(entry: WanderMotorEntryBase, position: WanderXZ): void {
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
