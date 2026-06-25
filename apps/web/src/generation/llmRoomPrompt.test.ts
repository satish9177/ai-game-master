import { describe, it, expect } from 'vitest'
import {
  ROOM_SYSTEM_PROMPT,
  MAX_SEED_CHARS,
  buildRoomPromptMessages,
} from './llmRoomPrompt'

const ALLOWED_ROOM_OBJECT_TYPES = [
  'throne',
  'pillar',
  'rug',
  'torch',
  'arch',
  'scroll',
  'npc',
  'prop',
  'crate',
  'barrel',
  'debris',
  'barricade',
  'zombie',
  'book',
  'paper',
  'map',
  'chest',
  'corpse',
  'table',
  'altar',
  'statue',
  'machine',
  'artifact',
  'candle',
] as const

const BAD_NATURAL_TYPE_NOUNS = [
  'notes',
  'bloodstain',
  'bones',
  'skeleton',
  'door',
  'desk',
  'lamp',
  'gem',
  'ritual circle',
  'machinery',
] as const

const SYNONYM_MAPPINGS = [
  'notes/letter/parchment -> paper or scroll',
  'bookcase/journal -> book',
  'floor plan/route chart -> map',
  'dead body/skeleton/bones -> corpse',
  'desk/workbench -> table',
  'shrine/ritual platform -> altar',
  'monument/idol -> statue',
  'generator/console/lab equipment -> machine',
  'crystal/relic/strange orb -> artifact',
  'candles/small flames -> candle',
  'door/doorway/gate -> arch',
  'trash/rubble/broken parts -> debris',
] as const

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

  it('names every current allowed RoomSpec object type', () => {
    for (const type of ALLOWED_ROOM_OBJECT_TYPES) {
      expect(ROOM_SYSTEM_PROMPT).toContain(type)
    }
  })

  it('no longer advertises only the old eight object types', () => {
    expect(ROOM_SYSTEM_PROMPT).not.toContain(
      'Allowed object "type" values only: throne, pillar, rug, torch, arch, scroll, npc, prop.',
    )
    expect(ROOM_SYSTEM_PROMPT).toContain('crate')
    expect(ROOM_SYSTEM_PROMPT).toContain('artifact')
    expect(ROOM_SYSTEM_PROMPT).toContain('candle')
  })

  it('tells the model to use only exact allowed strings and never invent object types', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(ROOM_SYSTEM_PROMPT).toContain('OBJECT TYPE ALLOWLIST')
    expect(ROOM_SYSTEM_PROMPT).toContain('every object.type MUST be exactly one of these strings')
    expect(lower).toContain('object type allowlist')
    expect(lower).toContain('must be exactly one of these strings')
    expect(lower).toContain('never invent object types')
    expect(lower).toContain('never use natural-language nouns as type values')
    expect(lower).toContain('choose the closest allowed type')
  })

  it('gives explicit no-invent examples for common bad natural-language type nouns', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    for (const noun of BAD_NATURAL_TYPE_NOUNS) {
      expect(lower).toContain(`"${noun}"`)
    }
  })

  it('maps common generated synonyms to allowed object types', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    for (const mapping of SYNONYM_MAPPINGS) {
      expect(lower).toContain(mapping)
    }
  })

  it('says to use prop if unsure rather than inventing a new type', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('if unsure, use prop')
    expect(lower).toContain('rather than inventing a new type')
  })

  it('keeps output data-only and outside renderer/code asset concerns', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('schemaVersion 1'.toLowerCase())
    expect(lower).toContain('data')
    expect(lower).toContain('do not output renderer hints')
    expect(lower).toContain('executable logic')
    expect(lower).not.toContain('three.js')
    expect(lower).not.toContain('gltf')
    expect(lower).not.toContain('texture')
    expect(lower).not.toContain('shader')
    expect(lower).not.toContain('builder')
  })

  it('does not require clue/document objects to be interactive', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('for clues/documents use scroll, book, paper, or map')
    expect(lower).toContain('they do not all need interactions')
    expect(lower).not.toContain('all clues must be interactive')
    expect(lower).not.toContain('all documents must be interactive')
  })

  it('treats torch as wall lighting and candle as visual-only', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('torch for wall lighting')
    expect(lower).toContain('candle for small visual candles')
    expect(lower).toContain('candle is visual-only')
  })

  it('keeps generated-room safety guidance compactly present', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('14-24m')
    expect(lower).toContain('object count under 30')
    expect(lower).toContain('spawn clear')
    expect(lower).toContain('exits on walls')
    expect(lower).toContain('central path readable')
    expect(lower).toContain('clutter near sides')
  })

  it('is bounded (static, prompt-free instruction)', () => {
    expect(ROOM_SYSTEM_PROMPT.length).toBeLessThan(4500)
  })
})
