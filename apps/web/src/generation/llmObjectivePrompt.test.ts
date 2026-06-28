import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import {
  OBJECTIVE_SYSTEM_PROMPT,
  buildObjectivePromptDigest,
  buildObjectivePromptMessages,
} from './llmObjectivePrompt'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'secret-room-id',
    name: 'Secret Room Name',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects,
  })
}

describe('buildObjectivePromptDigest', () => {
  it('builds a closed structural digest for interact-object candidates only', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'book-1',
        position: [0, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', body: 'Secret body.', effect: { kind: 'inspect' } },
      },
      { type: 'crate', id: 'crate-1', position: [2, 0, -2] },
    ])

    expect(buildObjectivePromptDigest(room)).toEqual({
      conditionKind: 'interact-object',
      candidates: [{ objectId: 'book-1', type: 'book' }],
    })
  })

  it('does not include room JSON, names, prompts, bodies, hints, or generated text', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        name: 'Secret Object Name',
        position: [0, 0.5, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret interaction prompt',
          title: 'Secret interaction title',
          body: 'Secret generated text body',
          effect: { kind: 'inspect' },
        },
      },
    ])

    const serialized = JSON.stringify(buildObjectivePromptDigest(room))

    expect(serialized).toBe('{"conditionKind":"interact-object","candidates":[{"objectId":"scroll-1","type":"scroll"}]}')
    for (const forbidden of [
      'Secret Room Name',
      'Secret Object Name',
      'Secret interaction prompt',
      'Secret interaction title',
      'Secret generated text body',
      'hint',
      'provider output',
      'objects',
      'schemaVersion',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe('buildObjectivePromptMessages', () => {
  it('returns static system instructions plus the structural digest', () => {
    const room = makeRoom([
      {
        type: 'paper',
        id: 'paper-1',
        position: [0, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ])

    expect(buildObjectivePromptMessages(room)).toEqual([
      { role: 'system', content: OBJECTIVE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: '{"conditionKind":"interact-object","candidates":[{"objectId":"paper-1","type":"paper"}]}',
      },
    ])
  })

  it('system prompt restricts output to interact-object JSON only', () => {
    const lower = OBJECTIVE_SYSTEM_PROMPT.toLowerCase()

    expect(lower).toContain('condition.kind "interact-object"')
    expect(lower).toContain('do not use resolve-encounter or visit-room')
    expect(lower).toContain('do not output raw flags')
    expect(lower).not.toContain('user prompt')
    expect(lower).not.toContain('raw room json')
  })

  it('is deterministic and does not mutate the room', () => {
    const room = makeRoom([
      {
        type: 'artifact',
        id: 'artifact-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
    ])
    const before = JSON.stringify(room)

    expect(buildObjectivePromptMessages(room)).toEqual(buildObjectivePromptMessages(room))
    expect(JSON.stringify(room)).toBe(before)
  })
})
