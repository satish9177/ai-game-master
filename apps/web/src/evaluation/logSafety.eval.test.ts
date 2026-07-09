import { describe, expect, it, vi } from 'vitest'
import { readDemoChaseEnabled, selectDemoChaseOptInNpcIds } from '../app/demoChaseOptIn'
import { readRoutineEnabled, selectNpcRoutineModes } from '../app/npcRoutine'
import type { NpcRoutineNpcType } from '../domain/npcRoutinePresets'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { deriveAndReduceRelationship } from '../app/deriveAndReduceRelationship'
import { deriveAndLogDialogueSemanticEvents } from '../app/deriveAndLogDialogueSemanticEvents'
import { deriveAndLogStructuredDialogueEffects } from '../app/deriveAndLogStructuredDialogueEffects'
import { promoteInteractionMemories } from '../app/promoteInteractionMemories'
import {
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  relationshipFeedbackAfterReduction,
  restoreNpcRelationshipsFromSlot,
  selectTransientFeedbackMessage,
} from '../app/App.helpers'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from '../app/relationshipFeedback'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  toRelationshipJournalView,
} from '../app/relationshipJournalRuntime'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
} from '../domain/dialogueEvents/contracts'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import { familiarityBucket } from '../domain/npcRelationship/dialogueContext'
import { neutralRelationship } from '../domain/npcRelationship/neutral'
import { buildNpcRelationshipSaveJson } from '../domain/npcRelationship/relationshipSaveState'
import {
  buildRoomMemorySaveJson,
  filterRestorableRoomMemories,
  loadRoomMemorySaveState,
} from '../domain/memory/roomMemorySaveState'
import { EFFECT_KIND_BY_SOURCE_KIND } from '../domain/structuredDialogueEffects/derive'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  type StructuredDialogueEffect,
} from '../domain/structuredDialogueEffects/contracts'
import type { WorldEvent } from '../domain/world/events'
import { WORLD_SCHEMA_VERSION } from '../domain/world/worldState'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import type { NPCDialogueContext } from '../domain/dialogue/contracts'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import {
  EVAL_CANON_WORLD_ID,
  EVAL_NPC_ID,
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
const SIGNED_VALENCED_EFFECT_KINDS = [
  'player_threat_candidate',
  'player_apology_candidate',
  'player_gratitude_candidate',
  'player_insult_candidate',
] as const
const SOURCE_KIND_BY_SIGNED_EFFECT_KIND: Record<
  (typeof SIGNED_VALENCED_EFFECT_KINDS)[number],
  DialogueSemanticEventKind
> = {
  player_threat_candidate: 'player_threatened_npc',
  player_apology_candidate: 'player_apologized',
  player_gratitude_candidate: 'player_thanked_npc',
  player_insult_candidate: 'player_insulted_npc',
}

function signedValencedEffect(
  kind: (typeof SIGNED_VALENCED_EFFECT_KINDS)[number],
  index: number,
): StructuredDialogueEffect {
  return {
    schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
    effectId: `eval-reducer-log-effect-${index}`,
    kind,
    sourceEventId: `eval-reducer-log-event-${index}`,
    sourceKind: SOURCE_KIND_BY_SIGNED_EFFECT_KIND[kind],
    status: 'candidate',
    actor: 'player',
    target: 'npc',
    scope: { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID, npcId: EVAL_NPC_ID },
    provenance: {
      classifier: 'deterministic-local',
      promptId: evalMarkers.playerLine,
      turnIndex: index,
    },
    confidence: 'medium',
  }
}

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

describe('Gate E (relationship reducer) - signed valenced rows keep reducer logs count-only', () => {
  it('logs the unchanged reducer shape without raw text, candidate kinds, or deltas', () => {
    const logEntries: LogEntry[] = []
    const prior = neutralRelationship({ worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, npcId: EVAL_NPC_ID })

    deriveAndReduceRelationship({
      effects: SIGNED_VALENCED_EFFECT_KINDS.map((kind, index) => signedValencedEffect(kind, index)),
      prior,
      ctx: { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, npcId: EVAL_NPC_ID },
      logger: createSpyLogger(logEntries),
      playerLine: evalMarkers.playerLine,
      npcText: evalMarkers.memoryText,
      promptText: evalMarkers.playerLine,
      providerText: evalMarkers.providerBody,
    } as Parameters<typeof deriveAndReduceRelationship>[0])

    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.message).toBe('npc relationship reduced')
    expect(Object.keys(logEntries[0]!.context).sort()).toEqual(
      [
        'applied',
        'clampedAxes',
        'familiarityBucket',
        'interactionCount',
        'npcId',
        'processed',
        'rejected',
        'sessionId',
        'worldId',
      ].sort(),
    )
    expect(logEntries[0]?.context).toMatchObject({
      processed: 4,
      applied: 4,
      rejected: 0,
      clampedAxes: 0,
      interactionCount: 4,
      familiarityBucket: 'none',
      worldId: EVAL_WORLD_ID,
      sessionId: EVAL_SESSION_ID,
      npcId: EVAL_NPC_ID,
    })

    const serialized = JSON.stringify(logEntries)
    expectNoEvalMarkersInLogs(logEntries)
    expectSafeLogContextValues(logEntries)
    for (const kind of SIGNED_VALENCED_EFFECT_KINDS) {
      expect(serialized).not.toContain(kind)
      expect(serialized).not.toContain(SOURCE_KIND_BY_SIGNED_EFFECT_KIND[kind])
    }
    expect(serialized).not.toContain('trust')
    expect(serialized).not.toContain('respect')
    expect(serialized).not.toContain('fear')
    expect(serialized).not.toContain('delta')
    expect(serialized).not.toContain('-3')
    expect(serialized).not.toContain('-2')
  })
})

describe('Gate E (relationship feedback) - visible feedback derivation adds no logs', () => {
  it('deriving and selecting the familiarity feedback message logs nothing beyond the existing reducer shape', () => {
    const logEntries: LogEntry[] = []
    const prior = neutralRelationship({ worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, npcId: EVAL_NPC_ID })
    const ctx = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, npcId: EVAL_NPC_ID }
    const scope = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID, npcId: EVAL_NPC_ID }

    const prevBucket = familiarityBucket(prior.axes.familiarity)

    // A neutral candidate effect (the only kind the classifier can actually emit
    // at runtime) carrying poisoned provenance fields, to prove the feedback
    // path leaks none of it.
    const effect: StructuredDialogueEffect = {
      schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
      effectId: 'eval-feedback-effect-0',
      kind: 'player_question_effect_candidate',
      sourceEventId: 'eval-feedback-source-event-0',
      sourceKind: 'player_asked_question',
      status: 'candidate',
      actor: 'player',
      target: 'npc',
      scope,
      provenance: {
        classifier: 'deterministic-local',
        promptId: evalMarkers.playerLine,
        turnIndex: 0,
      },
      confidence: 'medium',
    }

    const result = deriveAndReduceRelationship({
      effects: [effect],
      prior,
      ctx,
      logger: createSpyLogger(logEntries),
    })
    const nextBucket = familiarityBucket(result.state.axes.familiarity)

    // Guard against a vacuous pass: this must actually be an upward crossing.
    expect(prevBucket).toBe('none')
    expect(nextBucket).toBe('low')

    const feedbackState = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
      prevBucket,
      nextBucket,
    })
    const selected = selectTransientFeedbackMessage(null, feedbackState.message)
    expect(selected).toBe(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)

    // Computing/selecting the feedback message must add zero new log calls;
    // only the pre-existing reducer log call is present.
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.message).toBe('npc relationship reduced')
    expect(Object.keys(logEntries[0]!.context).sort()).toEqual(
      [
        'applied',
        'clampedAxes',
        'familiarityBucket',
        'interactionCount',
        'npcId',
        'processed',
        'rejected',
        'sessionId',
        'worldId',
      ].sort(),
    )

    const serialized = JSON.stringify(logEntries)
    expectNoEvalMarkersInLogs(logEntries)
    expectSafeLogContextValues(logEntries)
    // The feedback message text itself, the effect/source kind, and the raw
    // axis names must never appear in logs.
    expect(serialized).not.toContain(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
    expect(serialized).not.toContain('player_question_effect_candidate')
    expect(serialized).not.toContain('player_asked_question')
    expect(serialized).not.toContain('trust')
    expect(serialized).not.toContain('respect')
    expect(serialized).not.toContain('fear')
    expect(serialized).not.toContain('delta')
  })
})

/**
 * Gate E extension — npc-relationship-persistence-v0 (ADR-0081, Slice 5).
 * `App.tsx`'s handleLoad logs exactly the `diagnostics` object returned by
 * `restoreNpcRelationshipsFromSlot` (see `App.helpers.ts`); this proves that
 * object's shape and content are safe even when the parked blob carries
 * poisoned npcIds and out-of-range axis values, so nothing new needs to be
 * logged/scrubbed at the App.tsx call site.
 */
describe('Gate E (npc relationship sidecar restore) - diagnostics stay count/status-code only', () => {
  it('restore diagnostics for a valid scoped sidecar contain only safe counts and status, never npcId or axis values', () => {
    const scope = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID }
    const record = neutralRelationship({ ...scope, npcId: evalMarkers.playerLine })
    const json = buildNpcRelationshipSaveJson(
      [{ ...record, axes: { ...record.axes, familiarity: 91 }, interactionCount: 77 }],
      scope,
    )!

    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })

    expect(restored.diagnostics.status).toBe('restored')
    expect(Object.keys(restored.diagnostics).sort()).toEqual(
      ['droppedByCap', 'droppedByScope', 'droppedCount', 'restoredCount', 'status'].sort(),
    )
    for (const value of Object.values(restored.diagnostics)) {
      expect(typeof value === 'number' || typeof value === 'string').toBe(true)
    }

    const serializedDiagnostics = JSON.stringify(restored.diagnostics)
    expectNoEvalMarkersInLogs([{ level: 'info', message: 'diagnostics', context: restored.diagnostics }])
    expect(serializedDiagnostics).not.toContain('91')
    expect(serializedDiagnostics).not.toContain('77')
  })

  it('restore diagnostics for an invalid sidecar carry only a fixed reason code, never the raw blob or a poisoned value', () => {
    const scope = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID }
    const poisonedJson = `{not-json ${evalMarkers.providerBody}`

    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: poisonedJson, scope })

    expect(restored.diagnostics.status).toBe('invalid')
    expect(restored.diagnostics.reason).toBe('invalid-json')
    const serializedDiagnostics = JSON.stringify(restored.diagnostics)
    expect(serializedDiagnostics).not.toContain(poisonedJson)
    expectNoEvalMarkersInLogs([{ level: 'warn', message: 'diagnostics', context: restored.diagnostics }])
  })
})

/**
 * Gate E extension — relationship-journal-runtime-v0 (ADR-0085, Slice 4).
 * `accumulateRelationshipJournal`/`toRelationshipJournalView` are pure and take
 * no logger parameter at all (see `app/relationshipJournalRuntime.ts`), so this
 * proves that behaviorally: driving accumulation, dedupe, cap-overflow, and
 * projection with eval-marker-laden scope ids never calls `console.*` and
 * never produces a marker-laden string anywhere in the resulting state/view.
 */
describe('Gate E (relationship journal runtime) - pure accumulation adds no logs and leaks no markers', () => {
  it('accumulation/dedupe/projection under marker-laden scope ids calls no console method and leaks no eval marker', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    }

    try {
      let state = INITIAL_RELATIONSHIP_JOURNAL_STATE
      const scope = {
        worldId: `${evalMarkers.plantedText}-world`,
        sessionId: `${evalMarkers.playerLine}-session`,
        npcId: `${evalMarkers.providerBody}-npc`,
      }
      state = accumulateRelationshipJournal(state, { ...scope, prevBucket: 'none', nextBucket: 'low' })
      state = accumulateRelationshipJournal(state, { ...scope, prevBucket: 'none', nextBucket: 'low' }) // dedupe pass
      state = accumulateRelationshipJournal(state, { ...scope, prevBucket: 'low', nextBucket: 'medium' })
      const view = toRelationshipJournalView(state)
      expect(view.entries).toHaveLength(2) // guard against a vacuous pass

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()

      const serialized = JSON.stringify(view)
      for (const marker of Object.values(evalMarkers)) expect(serialized).not.toContain(marker)
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})

/**
 * Gate E extension — hostile-npc-chase-demo-opt-in-v0 (ADR-0086, Slice 4).
 * `readDemoChaseEnabled`/`selectDemoChaseOptInNpcIds` are pure and take no
 * logger parameter at all (see `app/demoChaseOptIn.ts`), so this proves
 * behaviorally: driving the gate and selector with marker-laden env keys and
 * candidate/allowlist ids never calls `console.*` and never leaks a marker
 * into the returned value.
 */
describe('Gate E (demo chase opt-in) - pure gate/selector adds no logs and leaks no markers', () => {
  it('reading the env gate and selecting ids under marker-laden poison calls no console method and leaks no eval marker', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    }

    try {
      const poisonedEnv = {
        VITE_AIGM_DEMO_CHASE: `true-${evalMarkers.providerBody}`, // not an exact match -> off
        [`VITE_AIGM_DEMO_CHASE_${evalMarkers.plantedText}`]: 'true',
      }
      expect(readDemoChaseEnabled(poisonedEnv)).toBe(false) // guard against a vacuous pass

      const presentNpcIds = new Set([
        'herald-asha',
        evalMarkers.memoryText,
        evalMarkers.playerLine,
        evalMarkers.providerBody,
        `${evalMarkers.plantedText}-npc`,
      ])
      const selected = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds })
      expect([...selected]).toEqual(['herald-asha']) // guard against a vacuous pass

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()

      const serialized = JSON.stringify([...selected])
      for (const marker of Object.values(evalMarkers)) expect(serialized).not.toContain(marker)
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})

/**
 * Gate E extension — npc-day-night-routine-v0 (ADR-0087, Slice 5).
 * `readRoutineEnabled`/`selectNpcRoutineModes` are pure and take no logger
 * parameter at all (see `app/npcRoutine.ts`), so this proves behaviorally:
 * driving the gate and selector with marker-laden env keys and candidate ids
 * never calls `console.*` and never leaks a marker into the returned value.
 * The selected modes are also a closed enum, so no NPC name, prompt, or
 * provider text can ride along even indirectly.
 */
describe('Gate E (npc day/night routine) - pure gate/selector adds no logs and leaks no markers', () => {
  it('reading the env gate and selecting modes under marker-laden poison calls no console method and leaks no eval marker', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    }

    try {
      const poisonedEnv = {
        VITE_AIGM_DEMO_ROUTINE: `true-${evalMarkers.providerBody}`, // not an exact match -> off
        [`VITE_AIGM_DEMO_ROUTINE_${evalMarkers.plantedText}`]: 'true',
      }
      expect(readRoutineEnabled(poisonedEnv)).toBe(false) // guard against a vacuous pass

      const presentNpcIds = new Set([
        'herald-asha',
        evalMarkers.memoryText,
        evalMarkers.playerLine,
        evalMarkers.providerBody,
        `${evalMarkers.plantedText}-npc`,
      ])
      const selected = selectNpcRoutineModes({ enabled: true, presentNpcIds, timeOfDay: 'day' })
      expect([...selected.keys()]).toEqual(['herald-asha']) // guard against a vacuous pass
      expect(['idle', 'patrol', 'rest', 'passive']).toContain(selected.get('herald-asha'))

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()

      const serialized = JSON.stringify([...selected])
      for (const marker of Object.values(evalMarkers)) expect(serialized).not.toContain(marker)
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})

/**
 * Gate E extension — generated-npc-routine-type-v0 (ADR-0090, Slice 4).
 * `selectNpcRoutineModes` takes no logger parameter at all, so this proves
 * behaviorally: driving the selector with a `roomNpcTypeById` map keyed by
 * marker-laden poisoned ids (and an invalid, hostile-looking cast type value)
 * never calls `console.*` and never leaks a marker into the returned value.
 * The resolved modes remain a closed enum, so no id, npcType string, or
 * provider/prompt text can ride along even indirectly.
 */
describe('Gate E (generated npc routine type) - roomNpcTypeById adds no logs and leaks no markers', () => {
  it('selecting modes with a marker-laden, partly-invalid roomNpcTypeById map calls no console method and leaks no eval marker', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    }

    try {
      const presentNpcIds = new Set([
        'herald-asha',
        'generated-npc-typed',
        evalMarkers.memoryText,
        evalMarkers.playerLine,
        evalMarkers.providerBody,
        `${evalMarkers.plantedText}-npc`,
      ])
      // Only the two legitimate ids ever get a valid npcType; every marker-
      // bearing id either has no entry at all or an invalid/hostile-looking
      // cast type, so none of them can ever resolve into the returned map --
      // proving the "no marker in output" assertion below is not vacuous.
      const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([
        ['generated-npc-typed', 'guard'],
        ['herald-asha', 'wanderer'], // disagrees with explicit config; must never win or leak
        [evalMarkers.memoryText, 'bandit leader' as unknown as NpcRoutineNpcType], // invalid, hostile-looking
        [evalMarkers.playerLine, 'GUARD' as unknown as NpcRoutineNpcType], // wrong case, invalid
      ])

      const selected = selectNpcRoutineModes({
        enabled: true,
        presentNpcIds,
        timeOfDay: 'day',
        roomNpcTypeById,
      })
      expect([...selected.keys()].sort()).toEqual(
        ['generated-npc-typed', 'herald-asha'].sort(),
      ) // guard against a vacuous pass
      expect(selected.get('herald-asha')).toBe('patrol') // explicit config wins
      for (const mode of selected.values()) {
        expect(['idle', 'patrol', 'rest', 'passive']).toContain(mode)
      }

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()

      const serialized = JSON.stringify([...selected])
      for (const marker of Object.values(evalMarkers)) expect(serialized).not.toContain(marker)
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})

/**
 * Gate E extension — npc-routine-dialogue-context-v0 (ADR-0089, Slice 4).
 * `buildDialoguePromptMessages` takes no logger parameter at all, so this
 * proves behaviorally: building the routine-aware prompt at volume, including
 * with marker-laden poisoned extra fields on an unsafe caller's routine
 * context, never calls `console.*` and never leaks a marker into the rendered
 * prompt string. The `CURRENT ACTIVITY` section renders only the closed
 * `activity`/`timeOfDay` labels, mirroring the existing `buildRoutineSection`
 * unit coverage in `generation/llmDialoguePrompt.test.ts`, now proven at
 * volume against a marker sweep instead of hand-picked cases.
 */
describe('Gate E extension (npc routine dialogue context) - prompt build adds no logs and leaks no markers', () => {
  it('building 1000 routine-aware prompts under marker-laden poisoned extra fields calls no console method and leaks no marker into the prompt', () => {
    const consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    }

    try {
      const modes = ['idle', 'patrol', 'rest', 'passive'] as const
      const activities = {
        idle: 'standing by',
        patrol: 'patrolling',
        rest: 'resting',
        passive: 'keeping a quiet watch',
      } as const
      const timesOfDay = ['dawn', 'day', 'dusk', 'night'] as const

      for (let index = 0; index < 1000; index += 1) {
        const mode = modes[index % modes.length]!
        const timeOfDay = timesOfDay[index % timesOfDay.length]!
        const [systemMessage, userMessage] = buildDialoguePromptMessages(
          evalDialogueRequest({
            routine: {
              mode,
              activity: activities[mode],
              timeOfDay,
              // Poisoned extra fields an unsafe caller might add -- must
              // never reach the rendered prompt regardless.
              npcId: `${evalMarkers.plantedText}-${index}`,
              schedule: [`dawn:${evalMarkers.memoryText}`, `day:${evalMarkers.providerBody}`],
            } as unknown as NPCDialogueContext['routine'],
          }),
        )

        for (const marker of Object.values(evalMarkers)) {
          expect(systemMessage!.content).not.toContain(marker)
          expect(userMessage!.content).not.toContain(marker)
        }
        expect(userMessage!.content).toContain('CURRENT ACTIVITY - AMBIENT CONTEXT ONLY')
        expect(userMessage!.content).toContain(`activity: ${activities[mode]}`)
        expect(userMessage!.content).toContain(`timeOfDay: ${timeOfDay}`)
      }

      for (const spy of Object.values(consoleSpy)) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of Object.values(consoleSpy)) spy.mockRestore()
    }
  })
})
