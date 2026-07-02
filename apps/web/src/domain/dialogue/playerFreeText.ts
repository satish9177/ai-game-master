export const MAX_PLAYER_FREE_TEXT_CHARS = 240

export function normalizePlayerFreeText(text: string): string | null {
  const withoutControlCharacters = Array.from(text, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  }).join('')
  const normalized = withoutControlCharacters
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_PLAYER_FREE_TEXT_CHARS)
    .trim()

  return normalized.length === 0 ? null : normalized
}
