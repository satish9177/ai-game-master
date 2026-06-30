export function buildAdjacentRoomSeed(
  roomId: string,
  themeSeed?: string,
  storyPhrase?: string,
): string {
  const parts: string[] = []
  if (themeSeed?.trim()) parts.push(themeSeed)
  if (storyPhrase?.trim()) parts.push(storyPhrase)
  parts.push(`adjacent:${roomId}`)
  return parts.join(' | ')
}
