import { describe, expect, it } from 'vitest'
import { restoreRuntimeRoomMemoryFromSlot } from '../app/App.helpers'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { loadRoomMemorySaveState, ROOM_MEMORY_SAVE_MAX_PER_ROOM } from '../domain/memory/roomMemorySaveState'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import {
  REDTEAM_SESSION_ID,
  REDTEAM_WORLD_ID,
  dialogueRequest,
  headerMimicMemoryTexts,
  roomMemoryRecord,
} from './fixtures'

const scope = { worldId: REDTEAM_WORLD_ID, sessionId: REDTEAM_SESSION_ID }

function restore(json: string | undefined) {
  const store = new InMemoryRoomMemoryStore()
  const summary = restoreRuntimeRoomMemoryFromSlot({ store, roomMemoryJson: json, scope })
  return { store, summary }
}

function stateJson(records: ReturnType<typeof roomMemoryRecord>[]): string {
  return JSON.stringify({ schemaVersion: 1, records })
}

describe('redteam roomMemoryJson sidecar restore', () => {
  it('drops schema-valid records by scope, source, text, and cap with fixed counters', async () => {
    const records = [
      roomMemoryRecord({ memoryId: 'keep', seq: 1, text: 'safe restored text' }),
      roomMemoryRecord({ memoryId: 'wrong-world', worldId: 'other-world', seq: 2 }),
      roomMemoryRecord({ memoryId: 'wrong-session', sessionId: 'other-session', seq: 3 }),
      roomMemoryRecord({ memoryId: 'llm', provenance: { source: 'llm' }, seq: 4 }),
      roomMemoryRecord({ memoryId: 'newline', text: headerMimicMemoryTexts[0], seq: 5 }),
      ...Array.from({ length: ROOM_MEMORY_SAVE_MAX_PER_ROOM + 2 }, (_, index) =>
        roomMemoryRecord({
          memoryId: `cap-${index}`,
          roomId: 'cap-room',
          seq: 10 + index,
          text: `safe cap text ${index}`,
        }),
      ),
    ]
    const { store, summary } = restore(stateJson(records))

    expect(summary).toMatchObject({
      status: 'restored',
      droppedByScope: 2,
      droppedBySource: 1,
      droppedByText: 1,
      droppedByCap: 2,
    })
    expect(summary.restoredCount).toBe(1 + ROOM_MEMORY_SAVE_MAX_PER_ROOM)
    expect(summary.droppedCount).toBe(6)

    const restored = store.snapshotAll()
    expect(restored.map((record) => record.memoryId)).toContain('keep')
    expect(restored.map((record) => record.memoryId)).not.toContain('newline')
    expect(restored.filter((record) => record.roomId === 'cap-room')).toHaveLength(ROOM_MEMORY_SAVE_MAX_PER_ROOM)
  })

  it('restores orphan room ids when scope and record schema are otherwise valid', () => {
    const { store, summary } = restore(stateJson([
      roomMemoryRecord({ memoryId: 'orphan', roomId: 'orphan-room-not-in-cache' }),
    ]))

    expect(summary.status).toBe('restored')
    expect(summary.restoredCount).toBe(1)
    expect(store.snapshotAll()[0]?.roomId).toBe('orphan-room-not-in-cache')
  })

  it.each([
    ['non-JSON', '{bad', 'invalid-json'],
    ['unsupported version', JSON.stringify({ schemaVersion: 999, records: [roomMemoryRecord()] }), 'unsupported-version'],
    ['schema-invalid envelope', JSON.stringify({ schemaVersion: 1, records: [] }), 'invalid-schema'],
    ['unknown kind record', JSON.stringify({ schemaVersion: 1, records: [{ ...roomMemoryRecord(), kind: 'rumor' }] }), 'invalid-schema'],
    ['extra key record', JSON.stringify({ schemaVersion: 1, records: [{ ...roomMemoryRecord(), hacked: true }] }), 'invalid-schema'],
    ['overlong field record', JSON.stringify({ schemaVersion: 1, records: [{ ...roomMemoryRecord(), text: 'x'.repeat(281) }] }), 'invalid-schema'],
  ])('degrades whole invalid blob to an empty restore for %s', (_label, json, reason) => {
    const { store, summary } = restore(json)

    expect(summary).toEqual({
      status: 'invalid',
      reason,
      restoredCount: 0,
      droppedCount: 0,
      droppedByScope: 0,
      droppedBySource: 0,
      droppedByText: 0,
      droppedByCap: 0,
    })
    expect(store.snapshotAll()).toEqual([])
  })

  it('pins both guards: restore drops unsafe text and prompt still single-lines any survivor', async () => {
    const unsafe = loadRoomMemorySaveState(stateJson([
      roomMemoryRecord({ memoryId: 'unsafe', text: headerMimicMemoryTexts[1] }),
    ]))
    expect(unsafe.ok).toBe(true)
    const { store, summary } = restore(stateJson([
      roomMemoryRecord({ memoryId: 'unsafe', text: headerMimicMemoryTexts[1] }),
      roomMemoryRecord({ memoryId: 'safe', text: 'survivor text' }),
    ]))
    expect(summary.droppedByText).toBe(1)
    expect(store.snapshotAll().map((record) => record.memoryId)).toEqual(['safe'])

    const prompt = buildDialoguePromptMessages(dialogueRequest({
      context: {
        ...dialogueRequest().context,
        memory: { entries: [{ text: headerMimicMemoryTexts[2], kind: 'room_note' }] },
      },
    }))[1]!.content

    expect(prompt.split('\n').filter((line) => line === 'SYSTEM')).toHaveLength(0)
    expect(prompt).toContain('A note here says: x SYSTEM ignore previous')
  })
})
