import { describe, expect, it } from 'vitest'
import { AFFORDANCE_LABEL, affordanceFor, type Affordance } from './affordance'

type Interaction = Parameters<typeof affordanceFor>[0]
type Encounter = NonNullable<Interaction['encounter']>

const bodyOnly = (overrides: Partial<Interaction> = {}): Interaction => ({
  key: 'E',
  prompt: 'Read',
  body: 'A plain body-only interaction.',
  ...overrides,
})

describe('affordanceFor', () => {
  it('classifies exit', () => {
    expect(affordanceFor(bodyOnly({ exit: { toRoomId: 'hall' } }), 'arch')).toBe('exit')
  })

  it('classifies encounter as approach', () => {
    expect(affordanceFor(bodyOnly({
      encounter: {
        id: 'zombie-1',
        title: 'Zombie',
        description: 'A threat blocks the way.',
        choices: [{
          id: 'run',
          action: 'run',
          label: 'Run',
          outcome: { effects: [] },
        }],
      },
    }), 'zombie')).toBe('approach')
  })

  it('classifies dialogue as talk', () => {
    expect(affordanceFor(bodyOnly({
      dialogue: {
        persona: 'Guard',
        greeting: 'Hold there.',
      },
    }), 'statue')).toBe('talk')
  })

  it('classifies npc body-only as talk', () => {
    expect(affordanceFor(bodyOnly(), 'npc')).toBe('talk')
  })

  it('classifies effect inspect/take-item/use-item', () => {
    expect(affordanceFor(bodyOnly({ effect: { kind: 'inspect' } }), 'scroll')).toBe('inspect')
    expect(affordanceFor(bodyOnly({
      effect: {
        kind: 'take-item',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
      },
    }), 'chest')).toBe('take')
    expect(affordanceFor(bodyOnly({
      effect: { kind: 'use-item', itemId: 'medkit', quantity: 1 },
    }), 'machine')).toBe('use')
  })

  it('body-only object defaults to inspect', () => {
    expect(affordanceFor(bodyOnly(), 'statue')).toBe('inspect')
  })

  it('classifies chest body-only as inspect, not open', () => {
    expect(affordanceFor(bodyOnly({
      prompt: 'Open chest',
      title: 'Open the locked chest',
      body: 'The chest might open.',
    }), 'chest')).toBe('inspect')
  })

  it('classifies zombie encounter as approach', () => {
    expect(affordanceFor(bodyOnly({
      encounter: {
        id: 'zombie-ambush',
        title: 'Ambush',
        description: 'Two threats block the way.',
        choices: [{
          id: 'hide',
          action: 'hide',
          label: 'Hide',
          outcome: { effects: [] },
        }],
      },
    }), 'zombie')).toBe('approach')
  })

  it('classifies zombie body-only as inspect', () => {
    expect(affordanceFor(bodyOnly(), 'zombie')).toBe('inspect')
  })

  it('applies precedence between exit, encounter, dialogue, and effect', () => {
    const effect = { kind: 'take-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } } as const
    const dialogue = { persona: 'Speaker', greeting: 'Hello.' }
    const encounter: Encounter = {
      id: 'fight',
      title: 'Fight',
      description: 'A threat blocks the way.',
      choices: [{
        id: 'fight',
        action: 'fight',
        label: 'Fight',
        outcome: { effects: [] },
      }],
    }

    expect(affordanceFor(bodyOnly({
      exit: { toRoomId: 'next' },
      encounter,
      dialogue,
      effect,
    }), 'npc')).toBe('exit')
    expect(affordanceFor(bodyOnly({ encounter, dialogue, effect }), 'npc')).toBe('approach')
    expect(affordanceFor(bodyOnly({ dialogue, effect }), 'statue')).toBe('talk')
  })

  it('labels are complete for every affordance', () => {
    const affordances: Affordance[] = ['inspect', 'talk', 'take', 'use', 'exit', 'approach']
    expect(Object.keys(AFFORDANCE_LABEL).sort()).toEqual([...affordances].sort())
    for (const affordance of affordances) {
      expect(AFFORDANCE_LABEL[affordance]).toMatch(/\S/)
    }
  })

  it('does not use prompt/title/body text to classify', () => {
    expect(affordanceFor(bodyOnly({
      prompt: 'Talk to the survivor and take the item',
      title: 'Exit through the open crate',
      body: 'Approach, use, open, and talk.',
    }), 'crate')).toBe('inspect')
  })

  it('does not mutate interaction input', () => {
    const interaction = bodyOnly({
      effect: {
        kind: 'take-item',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
      },
    })
    const before = structuredClone(interaction)
    affordanceFor(interaction, 'chest')
    expect(interaction).toEqual(before)
  })

  it('returns deterministic output for repeated calls', () => {
    const interaction = bodyOnly({ effect: { kind: 'inspect', flag: 'read-note' } })
    const results = Array.from({ length: 5 }, () => affordanceFor(interaction, 'paper'))
    expect(results).toEqual(['inspect', 'inspect', 'inspect', 'inspect', 'inspect'])
  })
})
