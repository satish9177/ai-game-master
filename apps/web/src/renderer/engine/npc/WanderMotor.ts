import { shouldPauseWander } from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import type { PatrolRoute } from '../../../domain/npcPatrolContract'
import { createInitialWanderState, updateWanderStep } from './wanderStep'
import type { NpcWanderStepState } from './wanderStep'
import { createInitialPatrolState, updatePatrolStep } from './patrolStep'
import type { NpcPatrolStepState } from './patrolStep'
import { chaseStep } from './chaseStep'

export type WanderMotorPolicy = 'wander' | 'patrol' | 'idle'

type NpcIdleStepState = {
  mode: 'pausing'
  position: { x: number; z: number }
}

function createInitialIdleState(home: WanderXZ): NpcIdleStepState {
  return { mode: 'pausing', position: { x: home.x, z: home.z } }
}

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
  chaseEligible?: boolean
}

export type WanderMotorRegistration =
  | (WanderMotorRegistrationBase & { policy?: 'wander'; home: WanderXZ })
  | (WanderMotorRegistrationBase & { policy: 'patrol'; route: PatrolRoute })
  | (WanderMotorRegistrationBase & { policy: 'idle'; home: WanderXZ })

export type WanderMotorPauseContext = {
  interactionLocked: boolean
  isNpcTalking: (npcId: string) => boolean
  playerPosition?: WanderXZ
  isChaseActive?: (npcId: string) => boolean
}

type WanderMotorEntryBase = {
  node: WanderPositionNode
  ring?: WanderPositionNode
  interactable?: WanderInteractableRef
  field: NpcWanderField
  seed: string
  chaseEligible: boolean
  chaseMoving: boolean
}

type WanderMotorEntry =
  | (WanderMotorEntryBase & { policy: 'wander'; state: NpcWanderStepState })
  | (WanderMotorEntryBase & { policy: 'patrol'; route: PatrolRoute; state: NpcPatrolStepState })
  | (WanderMotorEntryBase & { policy: 'idle'; state: NpcIdleStepState })

export class WanderMotor {
  private readonly entries = new Map<string, WanderMotorEntry>()

  register(registration: WanderMotorRegistration): void {
    const base: WanderMotorEntryBase = {
      node: registration.node,
      field: registration.field,
      seed: registration.seed,
      chaseEligible: registration.chaseEligible === true,
      chaseMoving: false,
      ...(registration.ring !== undefined ? { ring: registration.ring } : {}),
      ...(registration.interactable !== undefined ? { interactable: registration.interactable } : {}),
    }

    const entry: WanderMotorEntry = registration.policy === 'patrol'
      ? { ...base, policy: 'patrol', route: registration.route, state: createInitialPatrolState(registration.route) }
      : registration.policy === 'idle'
      ? { ...base, policy: 'idle', state: createInitialIdleState(registration.home) }
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
        entry.chaseMoving = false
        syncXZ(entry, entry.state.position)
        continue
      }

      if (
        entry.chaseEligible
        && context.playerPosition !== undefined
        && context.isChaseActive?.(npcId) === true
      ) {
        const previousPosition = entry.state.position
        const next = chaseStep({
          field: entry.field,
          position: previousPosition,
          playerTarget: context.playerPosition,
          dtS,
        })

        entry.chaseMoving = next.position.x !== previousPosition.x || next.position.z !== previousPosition.z
        resetEntryPosition(entry, next.position)
        syncXZ(entry, entry.state.position)
        continue
      }

      entry.chaseMoving = false
      if (entry.policy === 'patrol') {
        entry.state = updatePatrolStep({
          state: entry.state,
          route: entry.route,
          field: entry.field,
          dtS,
          seed: entry.seed,
        })
      } else if (entry.policy === 'wander') {
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
    const entry = this.entries.get(npcId)
    return entry !== undefined && (entry.chaseMoving || entry.state.mode === 'moving')
  }

  clear(): void {
    this.entries.clear()
  }
}

function resetEntryPosition(entry: WanderMotorEntry, position: WanderXZ): void {
  if (entry.policy === 'patrol') {
    entry.state = {
      ...entry.state,
      mode: 'pausing',
      position: { x: position.x, z: position.z },
      pauseRemainingS: 0,
    }
    return
  }

  if (entry.policy === 'idle') {
    entry.state = { mode: 'pausing', position: { x: position.x, z: position.z } }
    return
  }

  entry.state = {
    ...entry.state,
    mode: 'pausing',
    position: { x: position.x, z: position.z },
    target: null,
    pauseRemainingS: 0,
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
