export type NpcBehaviorState = 'idle' | 'talking' | 'wandering'

export const IDLE_INTENSITY_BY_STATE = {
  idle: 1,
  talking: 0,
  wandering: 1,
} as const satisfies Record<NpcBehaviorState, number>
