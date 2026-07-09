import { describe, it, expect } from 'vitest'
import {
  ROOM_SYSTEM_PROMPT,
  MAX_SEED_CHARS,
  buildRoomPromptMessages,
} from './llmRoomPrompt'
import { NPC_ROUTINE_NPC_TYPES } from '../domain/npcRoutinePresets'

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

const SAFE_STORY_ANCHOR_TYPES = [
  'throne',
  'altar',
  'statue',
  'corpse',
  'machine',
  'artifact',
  'chest',
  'table',
  'map',
  'book',
  'paper',
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

  it('asks for one dominant story anchor when appropriate', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('story anchor guidance')
    expect(lower).toContain('when appropriate')
    expect(lower).toContain('exactly one dominant story anchor')
    expect(lower).toContain('single object the player should notice first')
    expect(lower).toContain('understand what happened here')
    expect(lower).toContain('missing anchors are allowed')
  })

  it('asks the room name to reflect the story anchor, event, or purpose', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('room name should reflect the story anchor, event, or purpose')
    expect(lower).toContain('avoid generic names')
  })

  it('lists safe existing story anchor candidate types', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('safe existing vocabulary')
    for (const type of SAFE_STORY_ANCHOR_TYPES) {
      expect(lower).toContain(type)
    }
  })

  it('says secondary objects should support the anchor rather than compete', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('secondary objects should support the main anchor')
    expect(lower).toContain('not compete with it')
  })

  it('treats anchor interaction.body as optional short flavor text', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('if the anchor has an interaction')
    expect(lower).toContain('existing interaction.body')
    expect(lower).toContain('short flavor text')
    expect(lower).toContain('what happened or why the object matters')
    expect(lower).toContain('do not require every anchor to be interactive')
    expect(lower).not.toContain('every anchor must be interactive')
    expect(lower).not.toContain('all anchors must be interactive')
  })

  it('does not require clues, rewards, or objectives', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('do not require clues or rewards')
    expect(lower).toContain('do not create quest objectives')
    expect(lower).not.toContain('must include clues')
    expect(lower).not.toContain('must include rewards')
    expect(lower).not.toContain('must create quest objectives')
  })

  it('forbids quest, inventory, loot, combat, and story-state semantics', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('do not create inventory, loot, combat, quest, or story-state semantics')
    expect(lower).not.toContain('inventory mechanics')
    expect(lower).not.toContain('loot mechanics')
    expect(lower).not.toContain('combat mechanics')
    expect(lower).not.toContain('story-state mechanics')
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

/**
 * Coverage for generated-npc-routine-type-v0 (ADR-0090, Slice 2). The prompt
 * may hint the closed `npcType` category so generated NPCs can populate it,
 * but it must ask for a category label only -- never a schedule, routine,
 * mode, patrol path, time-based behavior, or any statement that the provider
 * controls routine state. The schema (Slice 1) already drops anything else
 * to `undefined`, so this hint is a population aid, not a trust boundary.
 */
describe('ROOM_SYSTEM_PROMPT npcType hint', () => {
  it('reuses the same closed npcType vocabulary as the RoomSpec schema and has exactly seven values', () => {
    expect(NPC_ROUTINE_NPC_TYPES).toEqual([
      'guard',
      'merchant',
      'villager',
      'noble',
      'servant',
      'wanderer',
      'static_npc',
    ])
  })

  it('mentions the npcType field name and every one of its closed allowed values', () => {
    expect(ROOM_SYSTEM_PROMPT).toContain('npcType')
    for (const npcType of NPC_ROUTINE_NPC_TYPES) {
      expect(ROOM_SYSTEM_PROMPT).toContain(npcType)
    }
  })

  it('describes npcType as optional and as a category/data label, not a requirement', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('may optionally include "npctype"')
    expect(lower).toContain('npctype is only a category label')
    expect(lower).toContain('(data only)')
  })

  it('does not ask the model to produce a schedule, routine, routine mode, patrol path, or time-based behavior for npcType', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    // The prompt is allowed to name these terms only inside the negative
    // instruction that forbids them -- assert that exact forbidding sentence
    // exists, and that no other, non-negated instruction asks for any of
    // them in connection with npcType.
    expect(lower).toContain(
      'npctype is only a category label (data only) — never include a schedule, routine, routine mode, patrol path, or time-based behavior for npctype.',
    )
    expect(lower).not.toContain('include a schedule for npctype')
    expect(lower).not.toContain('assign a routine')
    expect(lower).not.toContain('define a patrol path')
    expect(lower).not.toContain('specify time-based behavior')
    expect(lower).not.toContain('npctype schedule')
    expect(lower).not.toContain('npctype routine')
  })

  it('does not ask for custom/free-text routine descriptions or behavior commands', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).not.toContain('custom routine')
    expect(lower).not.toContain('routine text')
    expect(lower).not.toContain('behavior command')
    expect(lower).not.toContain('describe the npc\'s behavior')
  })

  it('never states or implies that the provider/model controls routine or schedule state', () => {
    const lower = ROOM_SYSTEM_PROMPT.toLowerCase()
    expect(lower).not.toContain('you control')
    expect(lower).not.toContain('you decide the routine')
    expect(lower).not.toContain('you set the schedule')
    expect(lower).not.toContain('determines the npc\'s routine')
    expect(lower).not.toContain('controls the routine')
  })

  it('keeps the npcType hint small -- two short sentences, not a growing spec', () => {
    const start = ROOM_SYSTEM_PROMPT.indexOf('An npc object may optionally include "npcType"')
    expect(start).toBeGreaterThanOrEqual(0) // guard against a vacuous pass
    const end = ROOM_SYSTEM_PROMPT.indexOf('\n\n', start)
    const hintBlock = end === -1 ? ROOM_SYSTEM_PROMPT.slice(start) : ROOM_SYSTEM_PROMPT.slice(start, end)
    expect(hintBlock.length).toBeLessThan(400)
  })

  it('keeps overall existing generated-room prompt behavior stable alongside the new hint', () => {
    expect(ROOM_SYSTEM_PROMPT.length).toBeLessThan(4500)
    const messages = buildRoomPromptMessages('a quiet chapel')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toBe(ROOM_SYSTEM_PROMPT)
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toBe('a quiet chapel')
  })
})
