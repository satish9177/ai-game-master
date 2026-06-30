export type GeneratedStoryThreadKind =
  | 'escape'
  | 'investigate'
  | 'survive'
  | 'rescue'
  | 'recover-item'

export type GeneratedStoryRoomRole = 'threshold' | 'developing' | 'deeper'

export type GeneratedStoryPressure = 'steady' | 'rising' | 'high'

export type GeneratedStoryRoomContext = {
  kind: GeneratedStoryThreadKind
  role: GeneratedStoryRoomRole
  pressure: GeneratedStoryPressure
}

export const MAX_STORY_PHRASE_LENGTH = 50

const SEED_PHRASES: Readonly<
  Record<GeneratedStoryThreadKind, Readonly<Record<GeneratedStoryRoomRole, string>>>
> = {
  escape: {
    threshold: 'escape route | first obstacle',
    developing: 'escape route | building pressure',
    deeper: 'escape route | critical path',
  },
  investigate: {
    threshold: 'investigation | early clues',
    developing: 'investigation | gathering evidence',
    deeper: 'investigation | close to the truth',
  },
  survive: {
    threshold: 'survival | first threat',
    developing: 'survival | escalating danger',
    deeper: 'survival | desperate stage',
  },
  rescue: {
    threshold: 'rescue mission | early search',
    developing: 'rescue mission | closing in',
    deeper: 'rescue mission | final approach',
  },
  'recover-item': {
    threshold: 'recovery | early search',
    developing: 'recovery | tracking the target',
    deeper: 'recovery | nearly there',
  },
}

export function deriveStoryThreadContext(
  kind: GeneratedStoryThreadKind | undefined,
  roomId: string,
): GeneratedStoryRoomContext | undefined {
  if (kind == null) return undefined

  const role = roleFromRoomId(roomId)
  return { kind, role, pressure: pressureFromRole(role) }
}

export function storyThreadToSeedPhrase(ctx: GeneratedStoryRoomContext): string {
  const phrase = SEED_PHRASES[ctx.kind][ctx.role]
  return phrase.length <= MAX_STORY_PHRASE_LENGTH
    ? phrase
    : phrase.slice(0, MAX_STORY_PHRASE_LENGTH)
}

function roleFromRoomId(roomId: string): GeneratedStoryRoomRole {
  const depth = (roomId.match(/:exit:/g) ?? []).length

  if (depth >= 4) return 'deeper'
  if (depth >= 2) return 'developing'
  return 'threshold'
}

function pressureFromRole(role: GeneratedStoryRoomRole): GeneratedStoryPressure {
  switch (role) {
    case 'threshold':
      return 'steady'
    case 'developing':
      return 'rising'
    case 'deeper':
      return 'high'
  }
}
