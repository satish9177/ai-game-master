import { describe, it, expect } from 'vitest'
import {
  ROOM_SYSTEM_PROMPT,
  MAX_SEED_CHARS,
  buildRoomPromptMessages,
} from './llmRoomPrompt'

describe('buildRoomPromptMessages', () => {
  it('returns a system message then a user message', () => {
    const messages = buildRoomPromptMessages('a quiet chapel')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
  })

  it('passes a short seed through verbatim in the user message', () => {
    const seed = 'The Ember Keep | fantasy-keep | grim'
    const messages = buildRoomPromptMessages(seed)
    expect(messages[1]!.content).toBe(seed)
  })

  it('uses the fixed system prompt verbatim', () => {
    const messages = buildRoomPromptMessages('anything')
    expect(messages[0]!.content).toBe(ROOM_SYSTEM_PROMPT)
  })

  it('bounds the user seed: long input is clamped to MAX_SEED_CHARS', () => {
    const long = 'x'.repeat(MAX_SEED_CHARS + 500)
    const messages = buildRoomPromptMessages(long)
    expect(messages[1]!.content.length).toBe(MAX_SEED_CHARS)
  })

  it('never produces unbounded user text across awkward seeds', () => {
    const seeds = ['', '   ', 'y'.repeat(10_000), 'dragon lair 🐉', 'a, "b" & c\n\t']
    for (const seed of seeds) {
      const messages = buildRoomPromptMessages(seed)
      expect(messages[1]!.content.length).toBeLessThanOrEqual(MAX_SEED_CHARS)
    }
  })
})

describe('ROOM_SYSTEM_PROMPT', () => {
  it('instructs JSON-only output with no markdown fences', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('json')
    expect(lower).toContain('no markdown')
  })

  it('names the published object vocabulary', () => {
    for (const type of ['throne', 'pillar', 'rug', 'torch', 'arch', 'scroll', 'npc', 'prop']) {
      expect(ROOM_SYSTEM_PROMPT).toContain(type)
    }
  })

  it('is bounded (static, prompt-free instruction)', () => {
    expect(ROOM_SYSTEM_PROMPT.length).toBeLessThan(2000)
  })
})
