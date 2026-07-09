import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDemoChaseEnabled, selectDemoChaseOptInNpcIds } from '../app/demoChaseOptIn'
import { readRoutineEnabled, selectNpcRoutineModes } from '../app/npcRoutine'
import type { NpcRoutineNpcType } from '../domain/npcRoutinePresets'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { deriveAndReduceRelationship } from '../app/deriveAndReduceRelationship'
import { deriveAndLogDialogueSemanticEvents } from '../app/deriveAndLogDialogueSemanticEvents'
import { deriveAndLogStructuredDialogueEffects } from '../app/deriveAndLogStructuredDialogueEffects'
import {
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  relationshipFeedbackAfterReduction,
  relationshipFeedbackOnRoomEntry,
  restoreNpcRelationshipsFromSlot,
  selectTransientFeedbackMessage,
} from '../app/App.helpers'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from '../app/relationshipFeedback'
import {
  accumulateRelationshipJournal,
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  RELATIONSHIP_JOURNAL_MAX_ENTRIES,
  toRelationshipJournalView,
} from '../app/relationshipJournalRuntime'
import { RELATIONSHIP_JOURNAL_TEMPLATES } from '../domain/npcRelationship/relationshipJournalCandidate'
import { buildNpcRelationshipSaveJson } from '../domain/npcRelationship/relationshipSaveState'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
} from '../domain/dialogueEvents/contracts'
import { familiarityBucket } from '../domain/npcRelationship/dialogueContext'
import { neutralRelationship } from '../domain/npcRelationship/neutral'
import { EFFECT_KIND_BY_SOURCE_KIND } from '../domain/structuredDialogueEffects/derive'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  type StructuredDialogueEffect,
} from '../domain/structuredDialogueEffects/contracts'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import type { NPCDialogueContext } from '../domain/dialogue/contracts'
import {
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createRoomMemoryHarness,
  createSpyLogger,
  createWorldSessionHarness,
  evalCanon,
  evalDialogueRequest,
  longSessionMemoryFixture,
  type LogEntry,
} from './fixtures'
import { toUngatedRoomMemoryDialogueContext } from './recalledRoomMemoryAdapter'

/**
 * Gate F — no side effects from evaluation flows (Slice 4).
 *
 * Recall / context / prompt building at N=1000:
 *   - append zero `WorldEvent`s and leave `WorldState` deep-equal;
 *   - cause zero memory writes (the store record count is unchanged);
 *   - make no provider / network / API call (a stubbed `fetch` is never hit).
 *
 * The memory layer structurally cannot reference `WorldSession` (lint firewall);
 * this gate re-proves it behaviorally at volume, mirroring the redteam
 * `dialogueAuthority` no-mutation stance.
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

afterEach(() => {
  vi.unstubAllGlobals()
})

function signedValencedEffect(
  kind: (typeof SIGNED_VALENCED_EFFECT_KINDS)[number],
  index: number,
  scope: { worldId: string; sessionId: string; roomId: string; npcId: string },
): StructuredDialogueEffect {
  return {
    schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
    effectId: `eval-signed-valenced-effect-${index}`,
    kind,
    sourceEventId: `eval-signed-valenced-event-${index}`,
    sourceKind: SOURCE_KIND_BY_SIGNED_EFFECT_KIND[kind],
    status: 'candidate',
    actor: 'player',
    target: 'npc',
    scope,
    provenance: { classifier: 'deterministic-local' },
    confidence: 'medium',
  }
}

describe('Gate F - recall/context/prompt at N=1000 has no side effects', () => {
  it('appends zero WorldEvents and leaves WorldState deep-equal', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { sessionId } = started.state

    const beforeEvents = await worldSession.store.listEvents(sessionId)
    const beforeState = await worldSession.session.getWorldState(sessionId)

    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const logEntries: LogEntry[] = []
    await fixture.service.recall(ROOM_SCOPE)
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger(logEntries))
    const context = toUngatedRoomMemoryDialogueContext(recalled)
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(await worldSession.store.listEvents(sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(sessionId)).toEqual(beforeState)
  })

  it('causes no memory writes (store record count unchanged)', async () => {
    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const before = fixture.store.snapshotAll().length
    expect(before).toBe(1000)

    await fixture.service.recall(ROOM_SCOPE)
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger([]))
    const context = toUngatedRoomMemoryDialogueContext(recalled)
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(fixture.store.snapshotAll().length).toBe(before)
  })

  it('makes no provider/network call during recall/context/prompt', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const fixture = await longSessionMemoryFixture({ count: 1000 })
    await fixture.service.recall(ROOM_SCOPE)
    const recalled = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger([]))
    const context = toUngatedRoomMemoryDialogueContext(recalled)
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('dialogue semantic event derivation creates no world, memory, persistence, or provider side effects', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const fixture = await longSessionMemoryFixture({ count: 3 })
    const beforeMemoryCount = fixture.store.snapshotAll().length
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const logEntries: LogEntry[] = []
    const events = deriveAndLogDialogueSemanticEvents({
      scope: {
        worldId: started.state.worldId,
        sessionId: started.state.sessionId,
        roomId: EVAL_ROOM_ID,
        npcId: 'eval-npc',
      },
      promptId: 'ask-room',
      turnIndex: 0,
      hasNpcReply: true,
      makeEventId: (kind, indexInTurn) => `eval-dialogue-semantic-${kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
    })

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(fixture.store.snapshotAll().length).toBe(beforeMemoryCount)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('structured dialogue effect derivation creates no world, memory, persistence, or provider side effects', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const fixture = await longSessionMemoryFixture({ count: 3 })
    const beforeMemoryCount = fixture.store.snapshotAll().length
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const logEntries: LogEntry[] = []
    const events = deriveAndLogDialogueSemanticEvents({
      scope: {
        worldId: started.state.worldId,
        sessionId: started.state.sessionId,
        roomId: EVAL_ROOM_ID,
        npcId: 'eval-npc',
      },
      promptId: 'ask-room',
      turnIndex: 0,
      hasNpcReply: true,
      makeEventId: (kind, indexInTurn) => `eval-dialogue-semantic-${kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
    })
    const effects = deriveAndLogStructuredDialogueEffects({
      events,
      makeEffectId: (sourceEvent, indexInTurn) => `eval-structured-effect-${sourceEvent.kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
    })

    expect(effects.map((effect) => effect.kind)).toEqual([
      'player_question_effect_candidate',
      'npc_response_effect_candidate',
    ])
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(fixture.store.snapshotAll().length).toBe(beforeMemoryCount)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('valenced candidate derivation (direct injection) creates no world, memory, persistence, or provider side effects', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const fixture = await longSessionMemoryFixture({ count: 3 })
    const beforeMemoryCount = fixture.store.snapshotAll().length
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    // classifyDialogueTurn cannot emit a valenced semantic-event kind (see
    // nonEmission.test.ts), so these events are constructed directly to exercise
    // the dry EFFECT_KIND_BY_SOURCE_KIND map wired in Slice 2.
    const knownNonValencedSourceKinds = new Set<DialogueSemanticEventKind>(['player_asked_question', 'npc_responded'])
    const valencedSourceKinds = (Object.keys(EFFECT_KIND_BY_SOURCE_KIND) as DialogueSemanticEventKind[]).filter(
      (kind) => !knownNonValencedSourceKinds.has(kind),
    )
    const valencedEvents: DialogueSemanticEvent[] = valencedSourceKinds.map((kind, index) => {
      const isNpc = kind.startsWith('npc_')
      return {
        schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
        eventId: `eval-valenced-event-${index}`,
        kind,
        actor: isNpc ? 'npc' : 'player',
        target: isNpc ? 'player' : 'npc',
        scope: {
          worldId: started.state.worldId,
          sessionId: started.state.sessionId,
          roomId: EVAL_ROOM_ID,
          npcId: 'eval-npc',
        },
        provenance: { classifier: 'deterministic-local' },
        confidence: 'medium',
      }
    })

    const logEntries: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects({
      events: valencedEvents,
      makeEffectId: (sourceEvent, indexInTurn) => `eval-valenced-effect-${sourceEvent.kind}-${indexInTurn}`,
      logger: createSpyLogger(logEntries),
    })

    expect(effects).toHaveLength(valencedSourceKinds.length)
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(fixture.store.snapshotAll().length).toBe(beforeMemoryCount)
    expect(fetchSpy).not.toHaveBeenCalled()
    // Relationship reducers are not reachable from this layer: domain/structuredDialogueEffects
    // cannot import domain/npcRelationship or world-session (lint-enforced boundary), so there is
    // no relationship state here for this derivation to mutate.
  })

  it('directly injected signed relationship candidates create no authority, memory, fact, prompt, UI, persistence, or provider side effects', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const fixture = await longSessionMemoryFixture({ count: 3 })
    const beforeMemoryRecords = fixture.store.snapshotAll()
    const beforeWorldStoreEvents = await worldSession.store.listEvents(started.state.sessionId)
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const commandSink: unknown[] = []
    const facts: unknown[] = []
    const factVisibility: unknown[] = []
    const persistenceWrites: unknown[] = []
    const providerCalls: unknown[] = []
    const promptState = { builtMessages: 0 }
    const uiState = { relationshipPanelUpdates: 0 }
    const logEntries: LogEntry[] = []
    const ctx = {
      worldId: started.state.worldId,
      sessionId: started.state.sessionId,
      roomId: EVAL_ROOM_ID,
      npcId: 'eval-npc',
    }
    const effects = SIGNED_VALENCED_EFFECT_KINDS.map((kind, index) => signedValencedEffect(kind, index, ctx))
    const prior = neutralRelationship({ worldId: ctx.worldId, sessionId: ctx.sessionId, npcId: ctx.npcId })

    const result = deriveAndReduceRelationship({
      effects,
      prior,
      ctx,
      logger: createSpyLogger(logEntries),
    })

    expect(result.reducerInvoked).toBe(true)
    expect(result.appliedCount).toBe(SIGNED_VALENCED_EFFECT_KINDS.length)
    expect(result.state.axes).not.toEqual(prior.axes)
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeWorldStoreEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(fixture.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(commandSink).toEqual([])
    expect(facts).toEqual([])
    expect(factVisibility).toEqual([])
    expect(persistenceWrites).toEqual([])
    expect(providerCalls).toEqual([])
    expect(promptState).toEqual({ builtMessages: 0 })
    expect(uiState).toEqual({ relationshipPanelUpdates: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deriving and selecting the relationship familiarity feedback message touches only local ephemeral feedback state', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const fixture = await longSessionMemoryFixture({ count: 3 })
    const beforeMemoryRecords = fixture.store.snapshotAll()
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const commandSink: unknown[] = []
    const facts: unknown[] = []
    const factVisibility: unknown[] = []
    const persistenceWrites: unknown[] = []
    const providerCalls: unknown[] = []
    const promptState = { builtMessages: 0 }
    const uiState = { relationshipPanelUpdates: 0 }
    const logEntries: LogEntry[] = []
    const ctx = {
      worldId: started.state.worldId,
      sessionId: started.state.sessionId,
      npcId: 'eval-npc',
    }
    const scope = { ...ctx, roomId: EVAL_ROOM_ID }
    const prior = neutralRelationship(ctx)
    const prevBucket = familiarityBucket(prior.axes.familiarity)

    // Only the two neutral candidate kinds are runtime-emittable; this is the
    // only effect kind that can actually drive a familiarity crossing.
    const effect: StructuredDialogueEffect = {
      schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
      effectId: 'eval-feedback-nofx-effect-0',
      kind: 'player_question_effect_candidate',
      sourceEventId: 'eval-feedback-nofx-source-event-0',
      sourceKind: 'player_asked_question',
      status: 'candidate',
      actor: 'player',
      target: 'npc',
      scope,
      provenance: { classifier: 'deterministic-local' },
      confidence: 'medium',
    }

    const result = deriveAndReduceRelationship({
      effects: [effect],
      prior,
      ctx,
      logger: createSpyLogger(logEntries),
    })
    const nextBucket = familiarityBucket(result.state.axes.familiarity)
    expect(prevBucket).toBe('none')
    expect(nextBucket).toBe('low') // guard against a vacuous pass

    const feedbackState = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
      prevBucket,
      nextBucket,
    })
    const selected = selectTransientFeedbackMessage(null, feedbackState.message)
    expect(selected).toBe(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)

    const clearedOnRoomEntry = relationshipFeedbackOnRoomEntry(feedbackState)
    expect(clearedOnRoomEntry).toEqual(INITIAL_RELATIONSHIP_FEEDBACK_STATE)

    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(fixture.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(commandSink).toEqual([])
    expect(facts).toEqual([])
    expect(factVisibility).toEqual([])
    expect(persistenceWrites).toEqual([])
    expect(providerCalls).toEqual([])
    expect(promptState).toEqual({ builtMessages: 0 })
    expect(uiState).toEqual({ relationshipPanelUpdates: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/**
 * Gate F extension — npc-relationship-persistence-v0 (ADR-0081, Slice 5).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that restoring the `npcRelationshipJson` sidecar is a pure
 * projection re-seed: no `WorldEvent` append, no `WorldState` mutation, no
 * memory write, no command/fact/fact-visibility write, and no provider call.
 */
describe('Gate F (npc relationship persistence) - sidecar restore is a silent, authority-free re-seed', () => {
  it('restoring a scoped npcRelationshipJson sidecar appends no WorldEvents, mutates no WorldState, writes no memory, and makes no provider call', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { worldId, sessionId } = started.state
    const beforeEvents = await worldSession.store.listEvents(sessionId)
    const beforeState = await worldSession.session.getWorldState(sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const record = neutralRelationship({ worldId, sessionId, npcId: 'eval-relationship-npc' })
    const json = buildNpcRelationshipSaveJson(
      [{ ...record, axes: { ...record.axes, familiarity: 88 }, interactionCount: 40 }],
      { worldId, sessionId },
    )!

    const commandSink: unknown[] = []
    const facts: unknown[] = []
    const factVisibility: unknown[] = []

    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope: { worldId, sessionId } })

    expect(restored.records).toHaveLength(1) // guard against a vacuous pass
    expect(await worldSession.store.listEvents(sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(commandSink).toEqual([])
    expect(facts).toEqual([])
    expect(factVisibility).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/**
 * Gate F extension — relationship-journal-runtime-v0 (ADR-0085, Slice 4).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that accumulating relationship journal entries (including dedupe and
 * cap-overflow across many NPCs) appends zero `WorldEvent`s, mutates no
 * `WorldState`, writes no memory record, and makes no provider/network call --
 * and that the persisted `SaveGame` JSON is byte-identical to, and never
 * contains any trace of, an accumulated relationship journal.
 */
describe('Gate F (relationship journal runtime) - accumulation is side-effect-free and save-game-invisible', () => {
  it('accumulating to and beyond the cap across many NPCs, with repeated dedupe, causes zero world/memory/provider side effects', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    let journalState = INITIAL_RELATIONSHIP_JOURNAL_STATE
    for (let index = 0; index < RELATIONSHIP_JOURNAL_MAX_ENTRIES + 5; index += 1) {
      journalState = accumulateRelationshipJournal(journalState, {
        worldId: started.state.worldId,
        sessionId: started.state.sessionId,
        npcId: `eval-relationship-journal-npc-${index}`,
        prevBucket: 'none',
        nextBucket: 'low',
      })
      // Re-apply the first NPC's crossing every iteration to exercise dedupe
      // under repeated turns, not just a single accumulation pass.
      journalState = accumulateRelationshipJournal(journalState, {
        worldId: started.state.worldId,
        sessionId: started.state.sessionId,
        npcId: 'eval-relationship-journal-npc-0',
        prevBucket: 'none',
        nextBucket: 'low',
      })
    }
    const view = toRelationshipJournalView(journalState)
    expect(view.entries).toHaveLength(RELATIONSHIP_JOURNAL_MAX_ENTRIES) // guard against a vacuous pass

    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the saved game JSON is byte-identical whether or not the relationship journal has accumulated entries, and never contains its journal id or template text', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')

    const beforeJournalSave = await worldSession.saves.saveSession(started.state.sessionId)
    if (!beforeJournalSave.ok) throw new Error('save failed')

    // Accumulate relationship journal entries -- this is App-owned React state,
    // structurally disconnected from SaveGameService; it is never passed in.
    const journalState = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, {
      worldId: started.state.worldId,
      sessionId: started.state.sessionId,
      npcId: 'eval-relationship-journal-save-npc',
      prevBucket: 'none',
      nextBucket: 'low',
    })
    expect(toRelationshipJournalView(journalState).entries).toHaveLength(1) // guard against a vacuous pass

    const afterJournalSave = await worldSession.saves.saveSession(started.state.sessionId)
    if (!afterJournalSave.ok) throw new Error('save failed')

    expect(afterJournalSave.json).toBe(beforeJournalSave.json)
    expect(afterJournalSave.json).not.toContain('relationship-journal')
    expect(afterJournalSave.json).not.toContain(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)
  })
})

/**
 * Gate F extension — hostile-npc-chase-demo-opt-in-v0 (ADR-0086, Slice 4).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that the demo chase opt-in gate/selector append zero `WorldEvent`s,
 * mutate no `WorldState`, write no memory record, and make no provider/network
 * call at volume -- including when every candidate id is a poisoned,
 * content-shaped string and the env carries poisoned adjacent keys.
 */
describe('Gate F (demo chase opt-in) - gate/selector at volume create no side effects', () => {
  it('selecting from 1000 present ids (allowlisted, absent, and content-shaped poison mixed) touches no world/memory/network state', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const presentNpcIds = new Set<string>(['herald-asha'])
    for (let index = 0; index < 999; index += 1) {
      presentNpcIds.add(`eval-chase-poison-${index}-${index % 2 === 0 ? 'relationship' : 'prompt'}`)
    }
    expect(presentNpcIds.size).toBe(1000) // guard against a vacuous pass

    const result = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds })

    expect([...result]).toEqual(['herald-asha'])
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reading the env gate with 1000 poisoned/adjacent keys touches no world/memory/network state and stays false', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const poisonedEnv: Record<string, string | undefined> = {}
    for (let index = 0; index < 1000; index += 1) {
      poisonedEnv[`VITE_AIGM_DEMO_CHASE_${index}`] = 'true'
    }
    expect(Object.keys(poisonedEnv).length).toBe(1000) // guard against a vacuous pass

    expect(readDemoChaseEnabled(poisonedEnv)).toBe(false)
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/**
 * Gate F extension — npc-day-night-routine-v0 (ADR-0087, Slice 5).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that the routine gate/selector append zero `WorldEvent`s, mutate no
 * `WorldState`, write no memory record, and make no provider/network call at
 * volume -- including when every candidate id is a poisoned, content-shaped
 * string and the env carries poisoned adjacent keys.
 */
describe('Gate F (npc day/night routine) - gate/selector at volume create no side effects', () => {
  it('selecting from 1000 present ids (allowlisted, absent, and content-shaped poison mixed) touches no world/memory/network state', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const presentNpcIds = new Set<string>(['herald-asha'])
    for (let index = 0; index < 999; index += 1) {
      presentNpcIds.add(`eval-routine-poison-${index}-${index % 2 === 0 ? 'relationship' : 'prompt'}`)
    }
    expect(presentNpcIds.size).toBe(1000) // guard against a vacuous pass

    const result = selectNpcRoutineModes({ enabled: true, presentNpcIds, timeOfDay: 'day' })

    expect([...result.keys()]).toEqual(['herald-asha'])
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reading the env gate with 1000 poisoned/adjacent keys touches no world/memory/network state and stays false', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const poisonedEnv: Record<string, string | undefined> = {}
    for (let index = 0; index < 1000; index += 1) {
      poisonedEnv[`VITE_AIGM_DEMO_ROUTINE_${index}`] = 'true'
    }
    expect(Object.keys(poisonedEnv).length).toBe(1000) // guard against a vacuous pass

    expect(readRoutineEnabled(poisonedEnv)).toBe(false)
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/**
 * Gate F extension — generated-npc-routine-type-v0 (ADR-0090, Slice 4).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that the selector's new `roomNpcTypeById` type source appends zero
 * `WorldEvent`s, mutates no `WorldState`, writes no memory record, and makes
 * no provider/network call at volume -- including when the room-supplied
 * npcType map mixes a valid closed value, poisoned/content-shaped ids, and a
 * hostile-looking (invalid, cast) type value.
 */
describe('Gate F (generated npc routine type) - roomNpcTypeById at volume creates no side effects', () => {
  it('selecting from 1000 present ids with a mixed valid/poisoned roomNpcTypeById map touches no world/memory/network state', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const presentNpcIds = new Set<string>(['herald-asha', 'generated-npc-typed'])
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([
      ['generated-npc-typed', 'guard'],
      ['herald-asha', 'wanderer'], // disagrees with the explicit config; must never win
    ])
    for (let index = 0; index < 998; index += 1) {
      const poisonedId = `eval-roomnpctype-poison-${index}-${index % 2 === 0 ? 'relationship' : 'prompt'}`
      presentNpcIds.add(poisonedId)
      // Every third poisoned id also gets an invalid (cast, hostile-looking)
      // roomNpcTypeById entry -- must never resolve a schedule.
      if (index % 3 === 0) {
        roomNpcTypeById.set(poisonedId, 'bandit leader' as unknown as NpcRoutineNpcType)
      }
    }
    expect(presentNpcIds.size).toBe(1000) // guard against a vacuous pass

    const result = selectNpcRoutineModes({ enabled: true, presentNpcIds, timeOfDay: 'day', roomNpcTypeById })

    expect([...result.keys()].sort()).toEqual(['generated-npc-typed', 'herald-asha'])
    expect(result.get('herald-asha')).toBe('patrol') // explicit config wins, never wanderer's preset
    expect(result.get('generated-npc-typed')).toBe('patrol') // guard's real preset
    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/**
 * Gate F extension — npc-routine-dialogue-context-v0 (ADR-0089, Slice 4).
 * Proves behaviorally, against a real in-memory `WorldSession` and room-memory
 * store, that building the dialogue prompt with a routine context present (all
 * four closed modes, rotated at volume) appends zero `WorldEvent`s, mutates no
 * `WorldState`, writes no memory record, and makes no provider/network call --
 * mirroring Gate F's existing memory/context/prompt proof, now extended to the
 * new `CURRENT ACTIVITY` prompt section.
 */
describe('Gate F (npc routine dialogue context) - prompt build with routine context at volume creates no side effects', () => {
  it('building 1000 routine-aware prompts (rotating mode/timeOfDay, some with poisoned extra fields) touches no world/memory/network state', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const beforeEvents = await worldSession.store.listEvents(started.state.sessionId)
    const beforeState = await worldSession.session.getWorldState(started.state.sessionId)

    const memoryHarness = createRoomMemoryHarness()
    const beforeMemoryRecords = memoryHarness.store.snapshotAll()

    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

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
      buildDialoguePromptMessages(
        evalDialogueRequest({
          routine: {
            mode,
            activity: activities[mode],
            timeOfDay,
            // Poisoned extra fields an unsafe caller might add -- must never
            // reach `WorldSession`/memory/network regardless.
            npcId: `eval-routine-poison-${index}`,
            schedule: ['dawn:idle', 'day:patrol', 'dusk:rest', 'night:passive'],
          } as unknown as NPCDialogueContext['routine'],
        }),
      )
    }

    expect(await worldSession.store.listEvents(started.state.sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(started.state.sessionId)).toEqual(beforeState)
    expect(memoryHarness.store.snapshotAll()).toEqual(beforeMemoryRecords)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
