import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  MAX_STORY_PHRASE_LENGTH,
  deriveStoryThreadContext,
  storyThreadToSeedPhrase,
  type GeneratedStoryRoomContext,
  type GeneratedStoryRoomRole,
  type GeneratedStoryThreadKind,
} from './generatedStoryThread'

const STORY_KINDS = [
  'escape',
  'investigate',
  'survive',
  'rescue',
  'recover-item',
] as const satisfies readonly GeneratedStoryThreadKind[]

const ROOM_ROLES = [
  'threshold',
  'developing',
  'deeper',
] as const satisfies readonly GeneratedStoryRoomRole[]

const PHRASE_TABLE: Readonly<
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

describe('deriveStoryThreadContext', () => {
  it('returns undefined when kind is undefined', () => {
    expect(deriveStoryThreadContext(undefined, 'room:exit:north')).toBeUndefined()
  })

  it('maps depth 1 to threshold and steady pressure', () => {
    expect(deriveStoryThreadContext('escape', 'room:exit:north')).toEqual({
      kind: 'escape',
      role: 'threshold',
      pressure: 'steady',
    })
  })

  it('maps depth 2 to developing and rising pressure', () => {
    expect(deriveStoryThreadContext('escape', 'room:exit:north:exit:east')).toEqual({
      kind: 'escape',
      role: 'developing',
      pressure: 'rising',
    })
  })

  it('maps depth 3 to developing and rising pressure', () => {
    expect(
      deriveStoryThreadContext('escape', 'room:exit:north:exit:east:exit:south'),
    ).toEqual({
      kind: 'escape',
      role: 'developing',
      pressure: 'rising',
    })
  })

  it('maps depth 4 or more to deeper and high pressure', () => {
    expect(
      deriveStoryThreadContext('escape', 'room:exit:north:exit:east:exit:south:exit:west'),
    ).toEqual({
      kind: 'escape',
      role: 'deeper',
      pressure: 'high',
    })
  })

  it('degrades invalid or neutral room ids to threshold and steady pressure', () => {
    expect(deriveStoryThreadContext('investigate', 'authored-room')).toEqual({
      kind: 'investigate',
      role: 'threshold',
      pressure: 'steady',
    })
    expect(deriveStoryThreadContext('investigate', '')).toEqual({
      kind: 'investigate',
      role: 'threshold',
      pressure: 'steady',
    })
    expect(deriveStoryThreadContext('investigate', 'room:exitish:north')).toEqual({
      kind: 'investigate',
      role: 'threshold',
      pressure: 'steady',
    })
  })

  it.each(STORY_KINDS)('supports story kind %s', (kind) => {
    expect(deriveStoryThreadContext(kind, 'room:exit:north')?.kind).toBe(kind)
  })

  it('is deterministic', () => {
    expect(deriveStoryThreadContext('rescue', 'room:exit:north:exit:east')).toEqual(
      deriveStoryThreadContext('rescue', 'room:exit:north:exit:east'),
    )
  })
})

describe('storyThreadToSeedPhrase', () => {
  it('returns a closed table phrase for every story kind and room role', () => {
    for (const kind of STORY_KINDS) {
      for (const role of ROOM_ROLES) {
        const ctx: GeneratedStoryRoomContext = {
          kind,
          role,
          pressure: role === 'threshold' ? 'steady' : role === 'developing' ? 'rising' : 'high',
        }

        expect(storyThreadToSeedPhrase(ctx)).toBe(PHRASE_TABLE[kind][role])
      }
    }
  })

  it('returns only non-empty bounded phrases', () => {
    for (const kind of STORY_KINDS) {
      for (const role of ROOM_ROLES) {
        const phrase = storyThreadToSeedPhrase({ kind, role, pressure: 'steady' })

        expect(phrase.length).toBeGreaterThan(0)
        expect(phrase.length).toBeLessThanOrEqual(MAX_STORY_PHRASE_LENGTH)
      }
    }
  })

  it('is deterministic', () => {
    const ctx: GeneratedStoryRoomContext = {
      kind: 'recover-item',
      role: 'deeper',
      pressure: 'high',
    }

    expect(storyThreadToSeedPhrase(ctx)).toBe(storyThreadToSeedPhrase(ctx))
  })
})

describe('safety type contracts', () => {
  it('deriveStoryThreadContext accepts only the closed kind and structural room id', () => {
    expectTypeOf(deriveStoryThreadContext).parameters.toEqualTypeOf<[
      GeneratedStoryThreadKind | undefined,
      string,
    ]>()
  })

  it('storyThreadToSeedPhrase accepts only the derived context', () => {
    expectTypeOf(storyThreadToSeedPhrase).parameters.toEqualTypeOf<[
      GeneratedStoryRoomContext,
    ]>()
  })
})
