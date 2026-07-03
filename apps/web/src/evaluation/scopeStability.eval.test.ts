import { describe, expect, it } from 'vitest'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import {
  ROOM_MEMORY_SAVE_MAX_PER_ROOM,
  ROOM_MEMORY_SAVE_MAX_TOTAL,
  buildRoomMemorySaveJson,
  filterRestorableRoomMemories,
  loadRoomMemorySaveState,
} from '../domain/memory/roomMemorySaveState'
import {
  EVAL_DECOY_ROOM_ID,
  EVAL_OTHER_SESSION_ID,
  EVAL_OTHER_WORLD_ID,
  EVAL_ROOM_IDS,
  createFixedClock,
  createRoomMemoryHarness,
  createSequentialIdGenerator,
  createSpyLogger,
  createWorldSessionHarness,
  evalCanon,
  type RoomMemoryHarness,
} from './fixtures'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../memory/RoomMemoryService'

/**
 * Gate D — scope-triple stability across save/load (Slice 3).
 *
 * The memory scope is `(worldId, sessionId, roomId)`. If a save/load cycle ever
 * yields a different `sessionId` than the one saved, every memory orphans
 * silently (assessment Risk 2). These gates lock:
 *   1. The world-session save/load round-trip keeps `worldId`/`sessionId`
 *      identical (the primary Risk-2 assertion — must exist even if nothing else
 *      ships).
 *   2. The ADR-0070 memory sidecar round-trip restores exactly the in-scope
 *      records and leaks ZERO cross-world / cross-session / cross-room decoys.
 *   3. Restore is read-only — no `WorldEvent` appended, no `WorldState` change.
 *   4. The deterministic sidecar caps (8/room, 128 total) hold byte-identically.
 *
 * Thresholds are absolute literals equal to today's constants (canary lives in
 * `promptBudget.eval.test.ts`). Assertions use counts + record identity (ids),
 * never raw memory text.
 */

const IN_SCOPE_PER_ROOM = 3

/** Records `IN_SCOPE_PER_ROOM` memories in each of the three in-scope rooms + three decoys. */
async function seedScopedMemories(
  harness: RoomMemoryHarness,
  worldId: string,
  sessionId: string,
): Promise<{ inScopeIds: Set<string>; decoyIds: Set<string>; crossRoomDecoyId: string }> {
  const inScopeIds = new Set<string>()
  for (const roomId of EVAL_ROOM_IDS) {
    for (let index = 0; index < IN_SCOPE_PER_ROOM; index += 1) {
      const draft: RoomMemoryDraftInput = {
        worldId,
        sessionId,
        roomId,
        kind: 'room_observation',
        source: 'game',
        text: `scoped memory ${roomId} ${index}`,
        confidence: 'medium',
        dedupeKey: `eval-scope-${roomId}-${index}`,
      }
      const result = await harness.service.remember(draft)
      if (result.status === 'recorded') inScopeIds.add(result.record.memoryId)
    }
  }

  const decoyIds = new Set<string>()
  let crossRoomDecoyId = ''
  const decoys: Array<{ draft: RoomMemoryDraftInput; crossRoom: boolean }> = [
    { crossRoom: false, draft: { worldId: EVAL_OTHER_WORLD_ID, sessionId, roomId: EVAL_ROOM_IDS[0], kind: 'room_observation', source: 'game', text: 'decoy other world', confidence: 'medium', dedupeKey: 'eval-decoy-world' } },
    { crossRoom: false, draft: { worldId, sessionId: EVAL_OTHER_SESSION_ID, roomId: EVAL_ROOM_IDS[0], kind: 'room_observation', source: 'game', text: 'decoy other session', confidence: 'medium', dedupeKey: 'eval-decoy-session' } },
    { crossRoom: true, draft: { worldId, sessionId, roomId: EVAL_DECOY_ROOM_ID, kind: 'room_observation', source: 'game', text: 'decoy other room', confidence: 'medium', dedupeKey: 'eval-decoy-room' } },
  ]
  for (const { draft, crossRoom } of decoys) {
    const result = await harness.service.remember(draft)
    if (result.status === 'recorded') {
      decoyIds.add(result.record.memoryId)
      if (crossRoom) crossRoomDecoyId = result.record.memoryId
    }
  }

  return { inScopeIds, decoyIds, crossRoomDecoyId }
}

describe('Gate D - world-session scope triple survives save/load (Risk-2 primary)', () => {
  it('restores an identical worldId and sessionId into a fresh store', async () => {
    const source = createWorldSessionHarness()
    const started = await source.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { worldId, sessionId } = started.state

    const changed = await source.session.changeHealth(sessionId, -1, started.state.revision)
    if (!changed.ok) throw new Error('append failed')
    const flagged = await source.session.setRoomState(
      sessionId,
      EVAL_ROOM_IDS[0],
      { flags: { 'eval-scope-flag': true } },
      changed.state.revision,
    )
    if (!flagged.ok) throw new Error('append failed')

    const saved = await source.saves.saveSession(sessionId)
    if (!saved.ok) throw new Error('save failed')

    // Fresh store/session context — restoreSession returns already-exists otherwise.
    const target = createWorldSessionHarness()
    const loaded = await target.saves.loadSession(saved.json)
    expect(loaded).toEqual({ ok: true, sessionId })

    const restored = await target.store.getSnapshot(sessionId)
    expect(restored?.worldId).toBe(worldId)
    expect(restored?.sessionId).toBe(sessionId)
    expect(restored).toEqual(flagged.state)
  })
})

describe('Gate D - memory sidecar round-trip: exact in-scope recall, zero decoy leak', () => {
  it('restores every in-scope record and leaks no cross-world/session/room decoy', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { worldId, sessionId } = started.state

    const runtime = createRoomMemoryHarness()
    const { inScopeIds, decoyIds, crossRoomDecoyId } = await seedScopedMemories(runtime, worldId, sessionId)

    // Save side: scope filter drops cross-world/cross-session records.
    const json = buildRoomMemorySaveJson(runtime.store.snapshotAll(), { worldId, sessionId })
    expect(json).not.toBeNull()

    // Load side: parse, re-validate, scope-filter, cap.
    const loaded = loadRoomMemorySaveState(json ?? '')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const restorable = filterRestorableRoomMemories(loaded.state.records, { worldId, sessionId })

    // Restore into a FRESH store/service (mirrors the real app reload flow).
    const restoredStore = new InMemoryRoomMemoryStore()
    restoredStore.restoreAll(restorable.records)
    const restoredService = new RoomMemoryService(
      restoredStore,
      createFixedClock(),
      createSequentialIdGenerator('eval-restored'),
      createSpyLogger([]),
    )

    // Cross-world / cross-session decoys never made it into the sidecar at all.
    const restoredIds = new Set(restoredStore.snapshotAll().map((record) => record.memoryId))
    for (const decoyId of decoyIds) {
      // Only the cross-room decoy (same world+session) survives the scope filter;
      // the cross-world and cross-session decoys are dropped before restore.
      if (decoyId === crossRoomDecoyId) continue
      expect(restoredIds.has(decoyId)).toBe(false)
    }

    for (const roomId of EVAL_ROOM_IDS) {
      const recall = await restoredService.recall({ worldId, sessionId, roomId })
      expect(recall.memories.length).toBe(IN_SCOPE_PER_ROOM)
      for (const record of recall.memories) {
        // Restored scope still matches the saved triple (Gate D point 5).
        expect(record.worldId).toBe(worldId)
        expect(record.sessionId).toBe(sessionId)
        expect(record.roomId).toBe(roomId)
        expect(inScopeIds.has(record.memoryId)).toBe(true)
        // No decoy of any kind leaks into an active room's recall.
        expect(decoyIds.has(record.memoryId)).toBe(false)
      }

      const context = await recallRoomMemoryContext({ worldId, sessionId, roomId }, restoredService, createSpyLogger([]))
      for (const entry of context.entries) {
        expect(entry.text.startsWith('decoy')).toBe(false)
      }
    }
  })
})

describe('Gate D - restore is read-only (no event append, no WorldState change)', () => {
  it('leaves the world-session event log and snapshot untouched through the memory cycle', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { worldId, sessionId } = started.state

    const beforeEvents = await worldSession.store.listEvents(sessionId)
    const beforeState = await worldSession.session.getWorldState(sessionId)

    const runtime = createRoomMemoryHarness()
    await seedScopedMemories(runtime, worldId, sessionId)
    const json = buildRoomMemorySaveJson(runtime.store.snapshotAll(), { worldId, sessionId })
    const loaded = loadRoomMemorySaveState(json ?? '')
    if (!loaded.ok) throw new Error('load failed')
    const restorable = filterRestorableRoomMemories(loaded.state.records, { worldId, sessionId })
    const restoredStore = new InMemoryRoomMemoryStore()
    restoredStore.restoreAll(restorable.records)

    // The whole memory save/load cycle touched no WorldSession API.
    expect(await worldSession.store.listEvents(sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(sessionId)).toEqual(beforeState)
  })
})

describe('Gate D - deterministic sidecar caps', () => {
  async function buildCappedJson(rooms: number, perRoom: number): Promise<string> {
    const harness = createRoomMemoryHarness()
    for (let room = 0; room < rooms; room += 1) {
      for (let index = 0; index < perRoom; index += 1) {
        const draft: RoomMemoryDraftInput = {
          worldId: EVAL_OTHER_WORLD_ID,
          sessionId: EVAL_OTHER_SESSION_ID,
          roomId: `eval-cap-room-${String(room).padStart(2, '0')}`,
          kind: 'room_observation',
          source: 'game',
          text: `cap memory ${room} ${index}`,
          confidence: 'medium',
          dedupeKey: `eval-cap-${room}-${index}`,
        }
        await harness.service.remember(draft)
      }
    }
    const json = buildRoomMemorySaveJson(harness.store.snapshotAll())
    if (json === null) throw new Error('expected non-null save json')
    return json
  }

  it('keeps only the newest 8 records per room (ROOM_MEMORY_SAVE_MAX_PER_ROOM)', async () => {
    const json = await buildCappedJson(1, 12)
    const loaded = loadRoomMemorySaveState(json)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    expect(loaded.state.records.length).toBe(8) // literal ROOM_MEMORY_SAVE_MAX_PER_ROOM
    expect(ROOM_MEMORY_SAVE_MAX_PER_ROOM).toBe(8)
    // Newest 8 of seq 1..12 => seq 5..12, stored in stable seq-asc order.
    expect(loaded.state.records.map((record) => record.seq)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('caps the total at 128 via whole-room eviction, byte-identical across runs', async () => {
    const first = await buildCappedJson(20, 8) // 20 * 8 = 160 > 128
    const second = await buildCappedJson(20, 8)

    expect(first).toBe(second) // deterministic

    const loaded = loadRoomMemorySaveState(first)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.state.records.length).toBe(128) // literal ROOM_MEMORY_SAVE_MAX_TOTAL
    expect(ROOM_MEMORY_SAVE_MAX_TOTAL).toBe(128)
  })
})
