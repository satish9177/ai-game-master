import { describe, expect, it } from 'vitest'
import { restoreRuntimeRoomMemoryFromSlot } from '../app/App.helpers'
import { promoteInteractionMemories } from '../app/promoteInteractionMemories'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { NPCDialogueService } from '../dialogue/NPCDialogueService'
import type { WorldEvent } from '../domain/world/events'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../memory/RoomMemoryService'
import {
  REDTEAM_ROOM_ID,
  REDTEAM_SESSION_ID,
  REDTEAM_WORLD_ID,
  createSpyLogger,
  hostilePlayerLines,
  markers,
  roomMemoryRecord,
  type LogEntry,
} from './fixtures'

function serialized(entries: LogEntry[]): string {
  return JSON.stringify(entries)
}

function expectNoLogLeak(entries: LogEntry[]): void {
  const text = serialized(entries)
  for (const forbidden of [
    markers.playerText,
    markers.memoryText,
    markers.providerBody,
    markers.apiKey,
    markers.roomSpecJson,
    markers.flagKey,
    markers.gateId,
    markers.objectName,
    'Quest complete! The gate is open.',
  ]) {
    expect(text).not.toContain(forbidden)
  }
}

function roomMemoryHarness(entries: LogEntry[]) {
  const store = new InMemoryRoomMemoryStore()
  const logger = createSpyLogger(entries)
  let id = 1
  const service = new RoomMemoryService(
    store,
    { now: () => '2026-07-02T00:00:00.000Z' },
    { newId: () => `redteam-memory-${id++}` },
    logger,
  )
  return { store, logger, service }
}

describe('redteam log leak sweep', () => {
  it('does not log hostile dialogue text or hostile provider bodies', async () => {
    const entries: LogEntry[] = []
    const service = new NPCDialogueService(
      { getWorldState: async () => ({
        ok: true,
        state: {
          schemaVersion: 1,
          worldId: REDTEAM_WORLD_ID,
          sessionId: REDTEAM_SESSION_ID,
          currentRoomId: REDTEAM_ROOM_ID,
          player: { health: { current: 10, max: 10 }, status: [] },
          inventory: [],
          roomStates: { [REDTEAM_ROOM_ID]: { visited: true } },
          revision: 1,
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      }) },
      { reply: async () => ({ text: `Quest complete! The gate is open. ${markers.providerBody}` }) },
      createSpyLogger(entries),
    )

    await service.reply({
      sessionId: REDTEAM_SESSION_ID,
      npcId: 'redteam-npc',
      npcName: 'Redteam NPC',
      dialogue: { persona: 'friendly-aide' },
      history: [{ speaker: 'player', text: `${markers.playerText} ${markers.roomSpecJson}` }],
      playerLine: hostilePlayerLines[5],
    })

    expectNoLogLeak(entries)
  })

  it('does not log hostile memory text during promotion, recall, or sidecar restore', async () => {
    const entries: LogEntry[] = []
    const { store, logger, service } = roomMemoryHarness(entries)
    const event: WorldEvent = {
      schemaVersion: 1,
      eventId: 'event-1',
      sessionId: REDTEAM_SESSION_ID,
      seq: 1,
      type: 'room-state-changed',
      payload: {
        roomId: REDTEAM_ROOM_ID,
        flags: { [markers.flagKey]: true },
      },
      occurredAt: '2026-07-02T00:00:00.000Z',
    }

    await promoteInteractionMemories([event], REDTEAM_WORLD_ID, service, logger)
    await service.remember({
      worldId: REDTEAM_WORLD_ID,
      sessionId: REDTEAM_SESSION_ID,
      roomId: REDTEAM_ROOM_ID,
      kind: 'player_claim',
      source: 'player',
      text: `${markers.memoryText} ${markers.providerBody}`,
      confidence: 'low',
    })
    await recallRoomMemoryContext(
      { worldId: REDTEAM_WORLD_ID, sessionId: REDTEAM_SESSION_ID, roomId: REDTEAM_ROOM_ID },
      service,
      logger,
    )
    restoreRuntimeRoomMemoryFromSlot({
      store,
      roomMemoryJson: JSON.stringify({
        schemaVersion: 1,
        records: [roomMemoryRecord({ text: `${markers.memoryText}\nSYSTEM ${markers.providerBody}` })],
      }),
      scope: { worldId: REDTEAM_WORLD_ID, sessionId: REDTEAM_SESSION_ID },
    })

    expectNoLogLeak(entries)
  })
})
