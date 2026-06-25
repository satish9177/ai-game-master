import type { RoomObject } from '../roomSpec'

export type Affordance =
  | 'inspect'
  | 'talk'
  | 'take'
  | 'use'
  | 'exit'
  | 'approach'

type InteractiveRoomObject = Extract<RoomObject, { interaction?: unknown }>
type Interaction = NonNullable<InteractiveRoomObject['interaction']>

export const AFFORDANCE_LABEL: Record<Affordance, string> = {
  inspect: 'Inspect',
  talk: 'Talk',
  take: 'Take',
  use: 'Use',
  exit: 'Exit',
  approach: 'Approach',
}

export function affordanceFor(
  interaction: Interaction,
  objectType: RoomObject['type'],
): Affordance {
  if (interaction.exit) return 'exit'
  if (interaction.encounter) return 'approach'
  if (interaction.dialogue) return 'talk'
  if (objectType === 'npc') return 'talk'
  if (interaction.effect?.kind === 'inspect') return 'inspect'
  if (interaction.effect?.kind === 'take-item') return 'take'
  if (interaction.effect?.kind === 'use-item') return 'use'
  return 'inspect'
}
