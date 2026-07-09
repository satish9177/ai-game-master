import roomSpecSource from './roomSpec.ts?raw'
import { describe, expect, it } from 'vitest'
import { RoomObjectSchema } from './roomSpec'
import { loadRoomSpec } from './loadRoomSpec'
import { NPC_ROUTINE_NPC_TYPES } from './npcRoutinePresets'

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}

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

describe('document object schema', () => {
  it.each(['book', 'paper', 'map'] as const)(
    'parses a minimal %s with defaults and no invented interaction',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.rotationY).toBe(0)
      expect(parsed.scale).toBe(1)
      expect('interaction' in parsed).toBe(false)
    },
  )

  it.each(['book', 'paper', 'map'] as const)(
    'preserves an optional existing interaction on %s',
    (type) => {
      const parsed = RoomObjectSchema.parse({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect document', body: 'Validated text.' },
      })
      expect('interaction' in parsed && parsed.interaction?.key).toBe('E')
    },
  )

  it('keeps unknown document-like types skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([{ type: 'journal', position: [0, 0, 0] }]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped[0]?.type).toBe('journal')
  })

  it('keeps malformed document objects skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([
      { type: 'book', position: [0, 0, 0], size: [0.7, -0.1, 0.5] },
      { type: 'paper', position: [0, 0, 0], size: [0.8] },
      { type: 'map', position: [0, 0, 0], markColor: 'red' },
    ]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped.map((item) => item.type)).toEqual(['book', 'paper', 'map'])
  })
})

describe('practical prop object schema', () => {
  it.each(['chest', 'corpse', 'table'] as const)(
    'parses a minimal %s with defaults and no invented interaction',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.rotationY).toBe(0)
      expect(parsed.scale).toBe(1)
      expect('interaction' in parsed).toBe(false)
    },
  )

  it.each(['chest', 'corpse', 'table'] as const)(
    'preserves an optional existing interaction on %s',
    (type) => {
      const parsed = RoomObjectSchema.parse({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect prop', body: 'Validated text.' },
      })
      expect('interaction' in parsed && parsed.interaction?.key).toBe('E')
    },
  )

  it('keeps unknown practical-prop-like types skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([{ type: 'coffer', position: [0, 0, 0] }]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped[0]?.type).toBe('coffer')
  })

  it('keeps malformed practical prop objects skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([
      { type: 'chest', position: [0, 0, 0], size: [1.2, -0.8, 0.75] },
      { type: 'corpse', position: [0, 0, 0], clothColor: 'green' },
      { type: 'table', position: [0, 0, 0], size: [1.8, 0.9] },
    ]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped.map((item) => item.type)).toEqual(['chest', 'corpse', 'table'])
  })
})

describe('story anchor object schema', () => {
  it.each(['altar', 'statue'] as const)(
    'parses a minimal %s with defaults and no invented interaction',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.rotationY).toBe(0)
      expect(parsed.scale).toBe(1)
      expect('interaction' in parsed).toBe(false)
    },
  )

  it.each(['altar', 'statue'] as const)(
    'preserves an optional existing interaction on %s',
    (type) => {
      const parsed = RoomObjectSchema.parse({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect anchor', body: 'Validated text.' },
      })
      expect('interaction' in parsed && parsed.interaction?.key).toBe('E')
    },
  )

  it('keeps unknown anchor-like types skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([{ type: 'shrine', position: [0, 0, 0] }]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped[0]?.type).toBe('shrine')
  })

  it('keeps malformed story anchor objects skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([
      { type: 'altar', position: [0, 0, 0], size: [1.8, -1, 1.1] },
      { type: 'statue', position: [0, 0, 0], radius: 0 },
    ]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped.map((item) => item.type)).toEqual(['altar', 'statue'])
  })
})

describe('strange/device/light object schema', () => {
  it.each(['machine', 'artifact', 'candle'] as const)(
    'parses a minimal %s with defaults and no invented interaction',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.rotationY).toBe(0)
      expect(parsed.scale).toBe(1)
      expect('interaction' in parsed).toBe(false)
    },
  )

  it.each(['machine', 'artifact'] as const)(
    'preserves an optional existing interaction on %s',
    (type) => {
      const parsed = RoomObjectSchema.parse({
        type,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect strange object', body: 'Validated text.' },
      })
      expect('interaction' in parsed && parsed.interaction?.key).toBe('E')
    },
  )

  it('keeps candle visual-only even if raw data includes an interaction-like field', () => {
    const parsed = RoomObjectSchema.parse({
      type: 'candle',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Light candle' },
    })
    expect(parsed.type).toBe('candle')
    expect('interaction' in parsed).toBe(false)
  })

  it('keeps unknown strange-device-like types skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([{ type: 'reactor', position: [0, 0, 0] }]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped[0]?.type).toBe('reactor')
  })

  it('keeps malformed strange/device/light objects skipped', () => {
    const loaded = loadRoomSpec(minimalRoom([
      { type: 'machine', position: [0, 0, 0], size: [1.6, -1.2, 1] },
      { type: 'artifact', position: [0, 0, 0], crystalColor: 'cyan' },
      { type: 'candle', position: [0, 0, 0], radius: 0 },
    ]))
    expect(loaded.objects).toEqual([])
    expect(loaded.skipped.map((item) => item.type)).toEqual(['machine', 'artifact', 'candle'])
  })
})

/**
 * Schema-level coverage for generated-npc-routine-type-v0 (ADR-0090, Slice 1).
 *
 * `npcType` is a closed, optional, data-only category label -- never a
 * schedule or behavior command. It reuses the closed vocabulary already
 * proven safe by npc-routine-presets-v0 (ADR-0088):
 * `NPC_ROUTINE_NPC_TYPES`. Any value outside that closed set is dropped to
 * `undefined` at the schema boundary (`.optional().catch(undefined)`) so the
 * NPC and the room still validate; nothing downstream needs to repair or
 * fall back for an invalid `npcType`.
 */
describe('npc schema npcType field', () => {
  const npcBase = {
    type: 'npc' as const,
    name: 'Asha',
    position: [0, 0, 0] as [number, number, number],
    interaction: { key: 'F' as const, prompt: 'Press F to talk' },
  }

  it.each(NPC_ROUTINE_NPC_TYPES)('accepts and preserves the closed npcType value %s', (npcType) => {
    const parsed = RoomObjectSchema.parse({ ...npcBase, npcType })
    expect(parsed.type === 'npc' && parsed.npcType).toBe(npcType)
  })

  it('leaves npcType absent/undefined when not supplied', () => {
    const parsed = RoomObjectSchema.parse(npcBase)
    expect(parsed.type === 'npc' && parsed.npcType).toBeUndefined()
    expect('npcType' in parsed).toBe(false)
  })

  it.each([
    'GUARD',
    'Guard',
    'guardian',
    'night guard patrol schedule',
    '<script>alert(1)</script>',
    'guard; DROP TABLE npcs',
    '',
    ' guard',
    'static-npc', // hyphen instead of underscore
  ])('drops the invalid free-text/wrong-case npcType %j to undefined while the NPC still validates', (npcType) => {
    const parsed = RoomObjectSchema.parse({ ...npcBase, npcType })
    expect(parsed.type === 'npc' && parsed.npcType).toBeUndefined()
  })

  it.each([null, 123, true, false, ['guard'], { npcType: 'guard' }])(
    'drops a non-string npcType %j to undefined while the NPC still validates',
    (npcType) => {
      const parsed = RoomObjectSchema.parse({ ...npcBase, npcType })
      expect(parsed.type === 'npc' && parsed.npcType).toBeUndefined()
    },
  )

  it('keeps the whole room valid when an NPC carries an invalid npcType', () => {
    const loaded = loadRoomSpec(minimalRoom([
      { ...npcBase, id: 'poisoned-npc', npcType: 'not-a-real-type' },
    ]))
    expect(loaded.skipped).toHaveLength(0)
    const npc = loaded.objects[0]
    expect(npc?.type === 'npc' && npc.npcType).toBeUndefined()
  })

  it('keeps an existing NPC fixture with no npcType field parsing exactly as before', () => {
    const loaded = loadRoomSpec(minimalRoom([
      {
        type: 'npc',
        id: 'friendly-aide',
        name: 'Asha',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Press F to talk' },
      },
    ]))
    expect(loaded.skipped).toHaveLength(0)
    const npc = loaded.objects[0]
    expect(npc?.type).toBe('npc')
    expect(npc && 'npcType' in npc).toBe(false)
  })

  it('NPC_ROUTINE_NPC_TYPES contains exactly the seven closed values used by the schema', () => {
    expect([...NPC_ROUTINE_NPC_TYPES].sort()).toEqual(
      ['guard', 'merchant', 'noble', 'servant', 'static_npc', 'villager', 'wanderer'],
    )
  })

  it('domain/roomSpec.ts imports the closed npcType vocabulary only from the pure npcRoutinePresets module, never provider/prompt/LLM/persistence/world-event/memory/fact modules', () => {
    const specifiers = importSpecifiers(roomSpecSource)
    expect(specifiers).toContain('./npcRoutinePresets')
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(
        /provider|llm|persistence|sqlite|world-session|worldevent|worldcommand|memory|fact|server/i,
      )
    }
  })
})
