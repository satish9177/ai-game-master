export type RoomIntroPanelState = {
  resetKey: string
  dismissed: boolean
}

export function dismissRoomIntroPanel(resetKey: string): RoomIntroPanelState {
  return { resetKey, dismissed: true }
}

export function isRoomIntroPanelDismissed(
  state: RoomIntroPanelState,
  resetKey: string,
): boolean {
  return state.resetKey === resetKey && state.dismissed
}
