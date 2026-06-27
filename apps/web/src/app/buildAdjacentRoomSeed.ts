export function buildAdjacentRoomSeed(roomId: string, themeSeed?: string): string {
  if (themeSeed?.trim()) {
    return `${themeSeed} | adjacent:${roomId}`
  }

  return `adjacent:${roomId}`
}
