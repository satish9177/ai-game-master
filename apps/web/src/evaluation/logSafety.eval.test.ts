import { describe, expect, it } from 'vitest'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { deriveAndLogDialogueSemanticEvents } from '../app/deriveAndLogDialogueSemanticEvents'
import { deriveAndLogStructuredDialogueEffects } from '../app/deriveAndLogStructuredDialogueEffects'
import { promoteInteractionMemories } from '../app/promoteInteractionMemories'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
} from '../domain/dialogueEvents/contracts'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import {
  buildRoomMemorySaveJson,
  filterRestorableRoomMemories,
  loadRoomMemorySaveState,
} from '../domain/memory/roomMemorySaveState'
import { EFFECT_KIND_BY_SOURCE_KIND } from '../domain/structuredDialogueEffects/derive'
import type { WorldEvent } from '../domain/world/events'
import { WORLD_SCHEMA_VERSION } from '../domain/world/worldState'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import {
  EVAL_CANON_WORLD_ID,
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createRoomMemoryHarness,
  createSpyLogger,
  createWorldSessionHarness,
  evalCanon,
  evalDialogueRequest,
  evalMarkers,
  expectNoEvalMarkersInLogs,
  expectNoRawMemoryTextInLogs,
  expectSafeLogContextValues,
  type LogEntry,
} from './fixtures'
import { toUngatedRoomMemoryDialogueContext } from './recalledRoomMemoryAdapter'

/**
 * Gate E — count-only diagnostics / no-leak log sweep (Slice 4).
 *
 * Every memory-text, player-like input, and provider-looking string in the
 * fixtures embeds a unique forbidden marker. All recall / context / prompt /
 * promotion / save-load flows run under spy loggers, and the sweep asserts:
 *   - No captured log string (message or any nested context value) contains a
 *     marker or the raw fixture memory-text prefix.
 *   - Every logged context value is a primitive (id/enum/count/code/boolean) —
 *     never a raw object or text blob.
 *
 * Only the two generic redteam helpers (`createSpyLogger`, indirectly) are
 * reused; the eval markers here are distinct from the redteam attack payloads.
 */

const ROOM_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }

describe('Gate E - no raw memory/player/provider text in logs', () => {
  it('sweeps recall, context, prompt, promotion, and save-load logs clean', async () => {
    const logEntries: LogEntry[] = []

    // --- Memory write/recall/context flow, with markers in inert memory text. ---
    const runtime = createRoomMemoryHarness()

    const draft: RoomMemoryDraftInput = {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      roomId: EVAL_ROOM_ID,
      kind: 'player_claim',
      source: 'player',
      // A poisoned memory carrying both a memory marker and a provider-looking body.
      text: `${evalMarkers.memoryText} ${evalMarkers.providerBody}`,
      confidence: 'low',
      dedupeKey: 'eval-logsafety-1',
    }
    await runtime.service.remember(draft)
    await runtime.service.recall(ROOM_SCOPE)
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, runtime.service, createSpyLogger(logEntries))
    const context = toUngatedRoomMemoryDialogueContext(recalled)

    // --- Prompt build (no logger of its own; marker rides player line + memory). ---
    const request = evalDialogueRequest({
      memory: context,
      history: [{ speaker: 'player', text: evalMarkers.playerLine }],
    })
    buildDialoguePromptMessages(request)

    // --- Promotion flow: a flag key carries a marker; promotion logs counts only. ---
    const markerEvent: WorldEvent = {
      schemaVersion: WORLD_SCHEMA_VERSION,
      eventId: 'eval-logsafety-event',
      sessionId: EVAL_SESSION_ID,
      seq: 1,
      occurredAt: '2026-07-03T00:00:00.000Z',
      type: 'room-state-changed',
      payload: { roomId: EVAL_ROOM_ID, flags: { [`${evalMarkers.memoryText}-flag`]: true } },
    }
    await promoteInteractionMemories([markerEvent], EVAL_WORLD_ID, runtime.service, createSpyLogger(logEntries))

    // --- Dialogue semantic event derivation logs structural fields only. ---
    const dialogueSemanticEvents = deriveAndLogDialogueSemanticEvents({
      scope: {
        worldId: EVAL_WORLD_ID,
        sessionId: EVAL_SESSION_ID,
        roomId: EVAL_ROOM_ID,
        npcId: 'eval-logsafety-npc',
      },
      promptId: 'ask-room',
      turnIndex: 1,
      hasNpcReply: true,
      makeEventId: (kind, indexInTurn) => `eval-dialogue-semantic-${kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
      playerLine: evalMarkers.playerLine,
      npcText: evalMarkers.memoryText,
      providerText: evalMarkers.providerBody,
      memoryText: evalMarkers.memoryText,
    } as Parameters<typeof deriveAndLogDialogueSemanticEvents>[0])

    // --- Structured dialogue effect derivation also logs structural fields only. ---
    deriveAndLogStructuredDialogueEffects({
      events: dialogueSemanticEvents,
      makeEffectId: (sourceEvent, indexInTurn) => `eval-structured-effect-${sourceEvent.kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
      playerLine: evalMarkers.playerLine,
      npcText: evalMarkers.memoryText,
      providerText: evalMarkers.providerBody,
      promptText: evalMarkers.playerLine,
      memoryText: evalMarkers.memoryText,
      rawProviderPayload: evalMarkers.providerBody,
      generatedText: evalMarkers.memoryText,
    } as Parameters<typeof deriveAndLogStructuredDialogueEffects>[0])

    // --- Memory sidecar save/load (pure domain; no logger, but exercise the path). ---
    const json = buildRoomMemorySaveJson(runtime.store.snapshotAll(), {
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
    })
    if (json !== null) {
      const loaded = loadRoomMemorySaveState(json)
      if (loaded.ok) {
        const restorable = filterRestorableRoomMemories(loaded.state.records, {
          worldId: EVAL_WORLD_ID,
          sessionId: EVAL_SESSION_ID,
        })
        new InMemoryRoomMemoryStore().restoreAll(restorable.records)
      }
    }

    // --- World-session save/load: logs sessionId/revision/eventCount only. ---
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon(EVAL_CANON_WORLD_ID))
    if (!started.ok) throw new Error('session start failed')
    const saved = await worldSession.saves.saveSession(started.state.sessionId)
    if (!saved.ok) throw new Error('save failed')
    const target = createWorldSessionHarness()
    await target.saves.loadSession(saved.json)
    logEntries.push(...runtime.logEntries, ...worldSession.logEntries, ...target.logEntries)

    // --- The sweep. ---
    expect(logEntries.length).toBeGreaterThan(0) // guard against a vacuous pass
    expectNoEvalMarkersInLogs(logEntries)
    expectNoRawMemoryTextInLogs(logEntries)
    expectSafeLogContextValues(logEntries)
    // The world save JSON itself must never appear in any log line.
    expect(JSON.stringify(logEntries)).not.toContain(saved.json)
  })
})

/**
 * Gate E extension — valenced dialogue effect candidates (Slice 3,
 * valenced-dialogue-effect-candidates-v0). `classifyDialogueTurn` cannot emit a
 * valenced semantic-event kind (see `nonEmission.test.ts`), so these events are
 * constructed directly to exercise the dry map's derive+log path. This proves
 * the new candidate kinds are the only new strings in the log output and that
 * marker-laden extra fields (mirroring `playerLine`/NPC-reply text) never leak.
 */
const KNOWN_NON_VALENCED_SOURCE_KINDS = new Set<DialogueSemanticEventKind>(['player_asked_question', 'npc_responded'])

function actorTargetForSourceKind(kind: DialogueSemanticEventKind): { actor: 'player' | 'npc'; target: 'player' | 'npc' } {
  return kind.startsWith('npc_') ? { actor: 'npc', target: 'player' } : { actor: 'player', target: 'npc' }
}

describe('Gate E (valenced candidates) - no raw text leaks for the 9 new candidate kinds', () => {
  it('sweeps derive+log output for every valenced candidate kind clean of marker text', () => {
    const valencedSourceKinds = (Object.keys(EFFECT_KIND_BY_SOURCE_KIND) as DialogueSemanticEventKind[]).filter(
      (kind) => !KNOWN_NON_VALENCED_SOURCE_KINDS.has(kind),
    )
    expect(valencedSourceKinds).toHaveLength(9) // guard against a vacuous sweep

    const valencedEvents: DialogueSemanticEvent[] = valencedSourceKinds.map((kind, index) => {
      const { actor, target } = actorTargetForSourceKind(kind)
      return {
        schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
        eventId: `eval-valenced-event-${index}`,
        kind,
        actor,
        target,
        scope: { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID, npcId: 'eval-valenced-npc' },
        provenance: { classifier: 'deterministic-local' },
        confidence: 'medium',
      }
    })

    const logEntries: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects({
      events: valencedEvents,
      makeEffectId: (sourceEvent, indexInTurn) => `eval-valenced-effect-${sourceEvent.kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
      playerLine: evalMarkers.playerLine,
      npcText: evalMarkers.memoryText,
      providerText: evalMarkers.providerBody,
      promptText: evalMarkers.playerLine,
      memoryText: evalMarkers.memoryText,
      rawProviderPayload: evalMarkers.providerBody,
      generatedText: evalMarkers.memoryText,
    } as Parameters<typeof deriveAndLogStructuredDialogueEffects>[0])

    expect(effects).toHaveLength(valencedSourceKinds.length)
    expect(
      effects.every(
        (effect) => effect.kind !== 'player_question_effect_candidate' && effect.kind !== 'npc_response_effect_candidate',
      ),
    ).toBe(true)
    expect(logEntries.length).toBeGreaterThan(0) // guard against a vacuous pass
    expectNoEvalMarkersInLogs(logEntries)
    expectSafeLogContextValues(logEntries)
  })
})
