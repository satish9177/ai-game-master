import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { RoomSpec } from '../domain/roomSpec'
import type { WorldState } from '../domain/world/worldState'
import { assembleRoom } from '../domain/assembleRoom'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import { evaluateQuest } from '../domain/quests/evaluateQuest'
import { FakeObjectiveGenerator } from '../generation/FakeObjectiveGenerator'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import { buildGeneratedObjectiveAttachment, buildGeneratedObjectiveQuestSpec } from './generatedObjective'

const FALLBACK = loadRoomSpec(fallbackRoom)

/** Assemble a room exactly as the prompt-generated path does (generator → pipeline). */
async function assemblePromptRoom(prompt: string): Promise<LoadedRoom> {
  const result = assembleRoom(await new FakeRoomGenerator().generate(prompt), FALLBACK)
  expect(result.diagnostics.provenance).toBe('generated')
  return result.room
}

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function makeRoom(overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Secret Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read the secret note',
          body: 'Secret generated objective body',
          effect: { kind: 'inspect' },
        },
      },
    ],
    ...overrides,
  })
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'generated-room',
    player: { health: { current: 75, max: 100 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('buildGeneratedObjectiveQuestSpec', () => {
  it('returns sanitized hint text with the trusted QuestSpec attachment', async () => {
    const attachment = await buildGeneratedObjectiveAttachment(makeRoom(), new FakeObjectiveGenerator())

    expect(attachment?.questSpec.questId).toBe('generated-room-objective')
    expect(attachment?.hint).toBe('Look for the feature that responds to your touch.')
    expect(attachment?.completionHint).toBe('That was the important thing here.')
  })

  it('attaches a trusted QuestSpec when FakeObjectiveGenerator returns valid raw JSON', async () => {
    const room = makeRoom()
    const spec = await buildGeneratedObjectiveQuestSpec(room, new FakeObjectiveGenerator())

    expect(spec).toMatchObject({
      questId: 'generated-room-objective',
      title: 'Secure the room',
      anchorRoomId: 'generated-room',
      objectives: [
        {
          id: 'generated-0',
          text: 'Investigate the marked feature.',
          condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'interaction:note-1' },
        },
      ],
    })
  })

  it('produces a QuestSpec that evaluateQuest completes from the referenced interaction flag', async () => {
    const spec = await buildGeneratedObjectiveQuestSpec(makeRoom(), new FakeObjectiveGenerator())
    expect(spec).not.toBeNull()

    expect(evaluateQuest(spec!, makeState()).objectives[0]?.done).toBe(false)
    expect(
      evaluateQuest(
        spec!,
        makeState({
          roomStates: { 'generated-room': { visited: true, flags: { 'interaction:note-1': true } } },
        }),
      ).objectives[0]?.done,
    ).toBe(true)
  })

  it('returns null when the fake generator finds no valid objective object', async () => {
    const room = makeRoom({
      objects: [
        { type: 'crate', id: 'crate-1', position: [0, 0, -2] },
        {
          type: 'scroll',
          position: [1, 0, -2],
          interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
        },
      ],
    })

    await expect(buildGeneratedObjectiveAttachment(room, new FakeObjectiveGenerator())).resolves.toBeNull()
  })

  it('returns null for bad objective JSON without muting the room', async () => {
    const room = makeRoom()
    const before = JSON.stringify(room)
    const generator: ObjectiveGenerator = { generate: async () => '{"bad"' }

    const attachment = await buildGeneratedObjectiveAttachment(room, generator)

    expect(attachment).toBeNull()
    expect(JSON.stringify(room)).toBe(before)
  })

  it('returns null when the objective generator throws', async () => {
    const generator: ObjectiveGenerator = {
      generate: async () => {
        throw new Error('fixed-test-error')
      },
    }

    await expect(buildGeneratedObjectiveAttachment(makeRoom(), generator)).resolves.toBeNull()
  })

  it('does not expose prompt, room, object, or raw provider text through the trusted spec', async () => {
    const spec = await buildGeneratedObjectiveQuestSpec(makeRoom(), new FakeObjectiveGenerator())
    const dump = JSON.stringify(spec)

    expect(dump).not.toContain('Secret Generated Room')
    expect(dump).not.toContain('Read the secret note')
    expect(dump).not.toContain('Secret generated objective body')
    expect(dump).not.toContain('raw provider')
  })
})

// Regression for the Slice 4 smoke gap: a real prompt-generated room (the same
// FakeRoomGenerator → assembleRoom pipeline the App runs) must usually attach a
// generated objective, and interacting with the chosen object must complete it.
describe('generated objective on a real prompt-generated room', () => {
  const PROMPTS = ['a quiet archive', 'a haunted hall', 'a cluttered wizard study', 'a dripping crypt']

  it('attaches a satisfiable objective for each common prompt-generated room', async () => {
    for (const prompt of PROMPTS) {
      const room = await assemblePromptRoom(prompt)
      const attachment = await buildGeneratedObjectiveAttachment(room, new FakeObjectiveGenerator())

      expect(attachment, `no objective for prompt "${prompt}"`).not.toBeNull()
      expect(attachment?.questSpec.questId).toBe(`${room.id}-objective`)

      // The referenced object really exists in the room and carries an inspect
      // effect, so the existing interaction path can set its completion flag.
      const condition = attachment!.questSpec.objectives[0]!.condition
      expect(condition).toMatchObject({ kind: 'room-flag', roomId: room.id })
    }
  })

  it('completes the attached objective from the referenced interaction flag', async () => {
    const room = await assemblePromptRoom('a quiet archive')
    const attachment = await buildGeneratedObjectiveAttachment(room, new FakeObjectiveGenerator())
    expect(attachment).not.toBeNull()

    const condition = attachment!.questSpec.objectives[0]!.condition
    expect(condition.kind).toBe('room-flag')
    if (condition.kind !== 'room-flag') throw new Error('expected room-flag condition')

    const before = makeState({ currentRoomId: room.id })
    expect(evaluateQuest(attachment!.questSpec, before).status).toBe('active')

    const after = makeState({
      currentRoomId: room.id,
      roomStates: { [room.id]: { visited: true, flags: { [condition.flag]: true } } },
    })
    expect(evaluateQuest(attachment!.questSpec, after).status).toBe('complete')
  })

  it('does not surface prompt or generated room text through the objective hints', async () => {
    const attachment = await buildGeneratedObjectiveAttachment(
      await assemblePromptRoom('TOP-SECRET-PROMPT-do-not-leak'),
      new FakeObjectiveGenerator(),
    )
    const dump = JSON.stringify(attachment)

    expect(dump).not.toContain('TOP-SECRET-PROMPT')
    expect(dump).not.toContain('Generated room')
    expect(dump).not.toContain('scroll reads')
  })
})
