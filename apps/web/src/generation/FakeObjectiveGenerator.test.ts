import { describe, expect, it } from 'vitest'
import { assembleObjective } from '../domain/quests/assembleObjective'
import { assembleRoom } from '../domain/assembleRoom'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import { FakeObjectiveGenerator } from './FakeObjectiveGenerator'
import { FakeRoomGenerator } from './FakeRoomGenerator'

function makeRoom(overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Secret prompt text that must not leak',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    objects: [
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Object prompt that must not leak',
          body: 'Provider body that must not leak',
          effect: { kind: 'inspect' },
        },
      },
      {
        type: 'scroll',
        id: 'note-2',
        position: [1, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ],
    ...overrides,
  })
}

describe('FakeObjectiveGenerator', () => {
  it('emits raw generated objective JSON for the first valid interactable object', async () => {
    const room = makeRoom()
    const raw = await new FakeObjectiveGenerator().generate(room)

    expect(typeof raw).toBe('string')
    const parsed = JSON.parse(raw!)
    expect(parsed).toMatchObject({
      title: 'Secure the room',
      description: 'Investigate the marked feature.',
      hint: 'Look for the feature that responds to your touch.',
      completionHint: 'That was the important thing here.',
      condition: { kind: 'interact-object', objectId: 'note-1' },
    })
    expect(room.objects.some((object) => object.id === parsed.condition.objectId)).toBe(true)
  })

  it('emits raw JSON that assembleObjective can convert into a valid QuestSpec', async () => {
    const room = makeRoom()
    const raw = await new FakeObjectiveGenerator().generate(room)
    const result = assembleObjective(raw!, room)

    expect(result.spec?.objectives[0]?.condition).toEqual({
      kind: 'room-flag',
      roomId: 'generated-room',
      flag: 'interaction:note-1',
    })
    expect(result.diagnostics.objectiveValid).toBe(true)
  })

  it('returns null when no valid object has a stable satisfiable interaction', async () => {
    const generator = new FakeObjectiveGenerator()
    const noObjects = makeRoom({ objects: [] })
    const idless = makeRoom({
      objects: [
        {
          type: 'scroll',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
        },
      ],
    })
    const unsatisfiable = makeRoom({
      objects: [
        { type: 'crate', id: 'crate-1', position: [0, 0, -2] },
        {
          type: 'scroll',
          id: 'display-only',
          position: [1, 0, -2],
          interaction: { key: 'E', prompt: 'Read' },
        },
        {
          type: 'npc',
          id: 'encounter-only',
          name: 'Threat',
          position: [2, 0, -2],
          interaction: {
            key: 'F',
            prompt: 'Confront',
            encounter: {
              description: 'A threat.',
              choices: [{ id: 'talk', action: 'negotiate', label: 'Talk', outcome: { effects: [] } }],
            },
          },
        },
      ],
    })

    expect(await generator.generate(noObjects)).toBeNull()
    expect(await generator.generate(idless)).toBeNull()
    expect(await generator.generate(unsatisfiable)).toBeNull()
  })

  it('is deterministic and does not mutate the input room', async () => {
    const generator = new FakeObjectiveGenerator()
    const room = makeRoom()
    const before = JSON.stringify(room)

    const first = await generator.generate(room)
    const second = await generator.generate(room)

    expect(first).toBe(second)
    expect(JSON.stringify(room)).toBe(before)
  })

  it('does not use prompt, provider, room, or object display text', async () => {
    const raw = await new FakeObjectiveGenerator().generate(makeRoom())

    expect(raw).not.toContain('Secret prompt text')
    expect(raw).not.toContain('Object prompt')
    expect(raw).not.toContain('Provider body')
    expect(raw).not.toContain('generated JSON')
  })

  // Regression for the Slice 4 smoke gap: real FakeRoomGenerator output (run
  // through the assembly pipeline, as the App does) must expose an interactable
  // the generator can anchor a satisfiable objective to.
  it('selects a satisfiable objective object from a real prompt-generated room', async () => {
    const fallback = loadRoomSpec(fallbackRoom)
    for (const prompt of ['a quiet archive', 'a haunted hall', 'a dripping crypt']) {
      const assembled = assembleRoom(await new FakeRoomGenerator().generate(prompt), fallback)
      expect(assembled.diagnostics.provenance).toBe('generated')

      const raw = await new FakeObjectiveGenerator().generate(assembled.room)
      expect(raw, `no objective for prompt "${prompt}"`).not.toBeNull()

      const parsed = JSON.parse(raw!) as { condition: { kind: string; objectId: string } }
      const target = assembled.room.objects.find((object) => object.id === parsed.condition.objectId)
      expect(target, 'objective object must exist in the room').toBeDefined()
      const interaction = target && 'interaction' in target ? target.interaction : undefined
      expect(interaction?.effect?.kind).toBe('inspect')

      // It round-trips into a valid QuestSpec on the same room.
      expect(assembleObjective(raw!, assembled.room).diagnostics.objectiveValid).toBe(true)
    }
  })
})

