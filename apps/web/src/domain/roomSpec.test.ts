import { describe, expect, it } from 'vitest'
import { RoomObjectSchema } from './roomSpec'
import { loadRoomSpec } from './loadRoomSpec'

/**
 * Schema-level coverage for the post-apocalyptic asset pack v0. Confirms each
 * new object type parses from a minimal literal (defaults + shared transform
 * fill the rest) and that the lenient loader keeps skipping genuinely unknown
 * types — adding vocabulary must not change the trust boundary.
 */

const minimalRoom = (objects: unknown[]): unknown => ({
  schemaVersion: 1,
  id: 'pack-test',
  name: 'Pack Test',
  shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
  spawn: { position: [0, 1.7, 4] },
  objects,
})

describe('post-apoc object schema', () => {
  it.each(['crate', 'barrel', 'debris', 'barricade', 'zombie'] as const)(
    'parses a minimal %s and fills shared transform defaults',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.position).toEqual([1, 0, 2])
      expect(parsed.rotationY).toBe(0) // transform default
      expect(parsed.scale).toBe(1) // transform default
    },
  )

  it('lets a zombie carry the shared optional interaction', () => {
    const parsed = RoomObjectSchema.parse({
      type: 'zombie',
      position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Press F to examine the corpse' },
    })
    expect(parsed.type === 'zombie' && parsed.interaction?.key).toBe('F')
  })

  it('omits interaction on a zombie that does not declare one', () => {
    const parsed = RoomObjectSchema.parse({ type: 'zombie', position: [0, 0, 0] })
    expect('interaction' in parsed).toBe(false)
  })

  it('keeps presentation-only interactions valid without an effect', () => {
    const parsed = RoomObjectSchema.parse({
      type: 'scroll',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Press E to read' },
    })
    expect(parsed.type === 'scroll' && parsed.interaction.effect).toBeUndefined()
  })

  it.each(['crate', 'barrel', 'debris', 'barricade'] as const)(
    'lets %s carry an optional interaction effect without making it required',
    (type) => {
      const parsed = RoomObjectSchema.parse({
        type,
        position: [0, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Press E to inspect',
          effect: { kind: 'inspect' },
        },
      })
      expect('interaction' in parsed && parsed.interaction?.effect?.kind).toBe('inspect')
      expect('interaction' in RoomObjectSchema.parse({ type, position: [0, 0, 0] })).toBe(false)
    },
  )

  it('keeps decorative arches valid and lets an arch carry a room exit', () => {
    const decorative = RoomObjectSchema.parse({ type: 'arch', position: [0, 0, 0] })
    expect('interaction' in decorative).toBe(false)

    const door = RoomObjectSchema.parse({
      type: 'arch',
      id: 'north-door',
      position: [0, 0, -5],
      interaction: {
        key: 'E',
        prompt: 'Press E to enter',
        exit: { toRoomId: 'next-room' },
      },
    })
    expect(door.type === 'arch' && door.interaction?.exit).toEqual({
      toRoomId: 'next-room',
    })
  })

  it('accepts dialogue, exit, encounter, and effect together', () => {
    const parsed = RoomObjectSchema.parse({
      type: 'arch',
      id: 'compound-door',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Press E',
        exit: { toRoomId: 'next-room' },
        effect: { kind: 'inspect' },
        dialogue: {
          persona: 'gatekeeper',
          prompts: [{ id: 'ask-entry', label: 'May I enter?' }],
        },
        encounter: {
          description: 'A guardian blocks the arch.',
          choices: [{
            id: 'run',
            action: 'run',
            label: 'Run through',
            outcome: { effects: [] },
          }],
        },
      },
    })
    if (parsed.type !== 'arch' || !parsed.interaction) throw new Error('arch did not parse')
    expect(parsed.interaction.exit?.toRoomId).toBe('next-room')
    expect(parsed.interaction.encounter?.choices[0]?.action).toBe('run')
    expect(parsed.interaction.effect?.kind).toBe('inspect')
    expect(parsed.interaction.dialogue).toEqual({
      persona: 'gatekeeper',
      prompts: [{ id: 'ask-entry', label: 'May I enter?' }],
    })

    const presentationOnly = RoomObjectSchema.parse({
      type: 'scroll',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Read' },
    })
    expect(presentationOnly.type === 'scroll' && presentationOnly.interaction.exit)
      .toBeUndefined()
    expect(presentationOnly.type === 'scroll' && presentationOnly.interaction.dialogue)
      .toBeUndefined()
  })

  it('lets an NPC opt into pure dialogue without requiring another behavior', () => {
    const npc = RoomObjectSchema.parse({
      type: 'npc',
      id: 'friendly-aide',
      name: 'Asha',
      position: [0, 0, 0],
      interaction: {
        key: 'F',
        prompt: 'Press F to talk',
        dialogue: { greeting: 'Welcome.', prompts: [] },
      },
    })
    expect(npc.type === 'npc' && npc.interaction.dialogue).toEqual({
      greeting: 'Welcome.',
      prompts: [],
    })
  })

  it('rejects empty and malformed exit targets', () => {
    expect(RoomObjectSchema.safeParse({
      type: 'arch',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: '' } },
    }).success).toBe(false)
    expect(RoomObjectSchema.safeParse({
      type: 'arch',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Enter',
        exit: { toRoomId: 'next-room', executable: true },
      },
    }).success).toBe(false)
  })

  it('loads the new types without skipping while still skipping unknown ones', () => {
    const loaded = loadRoomSpec(
      minimalRoom([
        { type: 'crate', position: [2, 0, 2] },
        { type: 'barrel', position: [-2, 0, 2] },
        { type: 'debris', position: [2, 0, -2] },
        { type: 'barricade', position: [-2, 0, -2] },
        { type: 'zombie', position: [0, 0, -3] },
        { type: 'mutant', position: [0, 0, 0] }, // not in the vocabulary
      ]),
    )
    expect(loaded.objects.map((o) => o.type)).toEqual([
      'crate',
      'barrel',
      'debris',
      'barricade',
      'zombie',
    ])
    expect(loaded.skipped).toHaveLength(1)
    expect(loaded.skipped[0]?.type).toBe('mutant')
  })
})
