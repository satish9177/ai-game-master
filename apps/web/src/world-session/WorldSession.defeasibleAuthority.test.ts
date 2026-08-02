import { describe, expect, it } from 'vitest'
import { evaluateNpcActionExitGate } from '../app/npcActionExitGate'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { DefeasibleNpcActionBinding } from '../domain/npcBelief/defeasibleBindings'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { projectWorldState } from '../domain/world/applyEvent'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'

const logger: Logger = {
  debug: () => undefined, info: () => undefined, warn: () => undefined,
  error: () => undefined, child: () => logger,
}

const room = loadRoomSpec({
  schemaVersion: 1, id: 'room', name: 'Room',
  shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
  spawn: { position: [0, 0, 0] },
  objects: [
    { type: 'npc', id: 'npc', name: 'NPC', position: [0, 0, 0], interaction: {
      key: 'F', prompt: 'Attend', effect: { kind: 'inspect' },
    } },
    { type: 'chest', id: 'container', position: [1, 0, 0] },
    { type: 'table', id: 'truth-trigger', position: [2, 0, 0] },
    { type: 'altar', id: 'source', position: [3, 0, 0] },
    { type: 'table', id: 'presentation', position: [4, 0, 0], interaction: {
      key: 'E', prompt: 'Present', effect: { kind: 'inspect' },
    } },
    { type: 'arch', id: 'exit', position: [5, 0, 0], interaction: {
      key: 'E', prompt: 'Leave', exit: { toRoomId: 'other' },
    } },
  ],
})

const binding: DefeasibleNpcActionBinding = {
  roomId: 'room', npcId: 'npc', targetObjectId: 'exit', triggerItemId: 'item',
  containerId: 'container', initialContainerContents: 'present',
  attentionObjectIds: ['attention'], minConfidence: 'low',
  offstageTruth: {
    triggerObjectId: 'truth-trigger', actorId: 'concealed-actor', itemId: 'item',
    ruleId: 'offstage-truth/rule@1',
  },
  evidenceArtifacts: [{
    evidenceId: 'p4-evidence', roomId: 'room', sourceObjectId: 'source',
    strength: 'hard', exposes: ['alternate-access'], class: 'undercutting',
    defeats: { ruleId: 'sole-copresent-candidate@1', premiseId: 'p4-no-alternate-access' },
    reachability: { prerequisiteObjectIds: [], presentation: {
      objectId: 'presentation', toNpcId: 'npc',
    } },
  }],
}

const actionCommand = {
  schemaVersion: 1 as const, type: 'npc-action-committed' as const,
  npcId: 'npc', roomId: 'room', action: 'bar-exit' as const, targetObjectId: 'exit',
}
const retractionCommand = { ...actionCommand, type: 'npc-action-retracted' as const }

function harness() {
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = {
    newId: () => `40000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return { store, session: new WorldSession(store, clock, ids, logger) }
}

async function start(value: ReturnType<typeof harness>) {
  const result = await value.session.startSession({
    schemaVersion: 1, worldId: '50000000-0000-4000-8000-000000000000',
    name: 'World', startingRoomId: 'room',
    initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

async function inferredReady(value: ReturnType<typeof harness>) {
  const started = await start(value)
  const truth = await value.session.commitOffstageTruth(
    started.sessionId,
    { roomId: 'room', triggerObjectId: 'truth-trigger' },
    started.revision,
    { room, binding },
  )
  if (!truth.ok) throw new Error(truth.error.code)
  const attention = await value.session.setRoomState(
    started.sessionId,
    'room',
    { flags: { 'interaction:attention': true } },
    truth.state.revision,
  )
  if (!attention.ok) throw new Error(attention.error.code)
  return attention.state
}

async function discoverAndPresent(value: ReturnType<typeof harness>, revision: number) {
  const state = await value.store.getSnapshot('40000000-0000-4000-8000-000000000001')
  if (!state) throw new Error('missing state')
  const discovered = await value.session.commitEvidenceDiscovered(
    state.sessionId,
    { roomId: 'room', sourceObjectId: 'source' },
    revision,
    { room, binding },
  )
  if (!discovered.ok) throw new Error(discovered.error.code)
  const presented = await value.session.commitEvidencePresented(
    state.sessionId,
    { roomId: 'room', presentationObjectId: 'presentation' },
    discovered.state.revision,
    { room, binding },
  )
  if (!presented.ok) throw new Error(presented.error.code)
  return { discovered, presented }
}

describe('WorldSession defeasible authority', () => {
  it('derives concealed offstage truth, rejects caller actor input, and rejects duplicates', async () => {
    const value = harness()
    const state = await start(value)
    const injected = await value.session.commitOffstageTruth(
      state.sessionId,
      { roomId: 'room', triggerObjectId: 'truth-trigger', actorId: 'caller' },
      state.revision,
      { room, binding },
    )
    expect(injected.ok).toBe(false)

    const committed = await value.session.commitOffstageTruth(
      state.sessionId,
      { roomId: 'room', triggerObjectId: 'truth-trigger' },
      state.revision,
      { room, binding },
    )
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    expect(committed.event).toMatchObject({ type: 'offstage-item-taken', payload: {
      roomId: 'room', containerId: 'container', itemId: 'item', actorId: 'concealed-actor',
      ruleId: 'offstage-truth/rule@1', concealed: true,
    } })
    const duplicate = await value.session.commitOffstageTruth(
      state.sessionId,
      { roomId: 'room', triggerObjectId: 'truth-trigger' },
      committed.state.revision,
      { room, binding },
    )
    expect(duplicate.ok).toBe(false)
  })

  it('derives evidence identity, requires discovery, and rejects caller provenance fields', async () => {
    const value = harness()
    const state = await start(value)
    const premature = await value.session.commitEvidencePresented(
      state.sessionId,
      { roomId: 'room', presentationObjectId: 'presentation' },
      state.revision,
      { room, binding },
    )
    expect(premature.ok).toBe(false)
    const injected = await value.session.commitEvidenceDiscovered(
      state.sessionId,
      { roomId: 'room', sourceObjectId: 'source', evidenceId: 'caller' },
      state.revision,
      { room, binding },
    )
    expect(injected.ok).toBe(false)
    const discovered = await value.session.commitEvidenceDiscovered(
      state.sessionId,
      { roomId: 'room', sourceObjectId: 'source' },
      state.revision,
      { room, binding },
    )
    if (!discovered.ok) throw new Error(discovered.error.code)
    const injectedPresentation = await value.session.commitEvidencePresented(
      state.sessionId,
      {
        roomId: 'room', presentationObjectId: 'presentation',
        evidenceId: 'caller', toNpcId: 'caller',
      },
      discovered.state.revision,
      { room, binding },
    )
    expect(injectedPresentation.ok).toBe(false)
    const presented = await value.session.commitEvidencePresented(
      state.sessionId,
      { roomId: 'room', presentationObjectId: 'presentation' },
      discovered.state.revision,
      { room, binding },
    )
    if (!presented.ok) throw new Error(presented.error.code)
    expect(discovered.event).toMatchObject({ type: 'evidence-discovered', payload: {
      roomId: 'room', evidenceId: 'p4-evidence', sourceObjectId: 'source',
    } })
    expect(presented.event).toMatchObject({ type: 'evidence-presented', payload: {
      roomId: 'room', evidenceId: 'p4-evidence', toNpcId: 'npc',
      presentationObjectId: 'presentation', discoveryEventId: discovered.event.eventId,
    } })
    expect(JSON.stringify([discovered.event, presented.event])).not.toContain('concealed-actor')
    const duplicate = await value.session.commitEvidenceDiscovered(
      state.sessionId,
      { roomId: 'room', sourceObjectId: 'source' },
      presented.state.revision,
      { room, binding },
    )
    expect(duplicate.ok).toBe(false)
  })

  it('commits inferred V2 only through commitDefeasibleNpcAction', async () => {
    const value = harness()
    const state = await inferredReady(value)
    const result = await value.session.commitDefeasibleNpcAction(
      state.sessionId, actionCommand, state.revision, { room, binding },
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.event.type !== 'npc-action-committed') return
    expect(result.event.payload.belief).toMatchObject({
      beliefSchemaVersion: 2, confidence: 'low',
      warrant: { ruleId: 'sole-copresent-candidate@1' },
    })
  })

  it('blocks inferred commitment when p4 evidence is already presented', async () => {
    const value = harness()
    const state = await inferredReady(value)
    const evidence = await discoverAndPresent(value, state.revision)
    const result = await value.session.commitDefeasibleNpcAction(
      state.sessionId, actionCommand, evidence.presented.state.revision, { room, binding },
    )
    expect(result.ok).toBe(false)
  })

  it('keeps direct witness V1 byte-compatible and unaffected by the p4 undercutter', async () => {
    const value = harness()
    const started = await start(value)
    const added = await value.session.addItem(
      started.sessionId, { itemId: 'item', name: 'Item', quantity: 1 }, started.revision,
    )
    if (!added.ok) throw new Error(added.error.code)
    const witnessed = await value.session.appendEvent(
      started.sessionId,
      { schemaVersion: 1, type: 'item-discovered', roomId: 'room', itemId: 'item' },
      added.state.revision,
    )
    if (!witnessed.ok) throw new Error(witnessed.error.code)
    const evidence = await discoverAndPresent(value, witnessed.state.revision)
    const result = await value.session.commitDefeasibleNpcAction(
      started.sessionId, actionCommand, evidence.presented.state.revision, { room, binding },
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.event.type !== 'npc-action-committed') return
    expect(result.event.payload.belief).toEqual({
      predicate: 'player-took-item', itemId: 'item', roomId: 'room', confidence: 'high',
    })
  })

  it('rejects generic retraction and commits an authority-planned retraction with exact provenance', async () => {
    const value = harness()
    const ready = await inferredReady(value)
    const committed = await value.session.commitDefeasibleNpcAction(
      ready.sessionId, actionCommand, ready.revision, { room, binding },
    )
    if (!committed.ok) throw new Error(committed.error.code)
    const original = JSON.stringify(committed.event)
    const evidence = await discoverAndPresent(value, committed.state.revision)

    const generic = await value.session.appendEvent(
      ready.sessionId, retractionCommand, evidence.presented.state.revision,
    )
    expect(generic.ok).toBe(false)
    const retracted = await value.session.commitNpcActionRetraction(
      ready.sessionId, retractionCommand, evidence.presented.state.revision, { room, binding },
    )
    expect(retracted.ok).toBe(true)
    if (!retracted.ok || retracted.event.type !== 'npc-action-retracted') return
    expect(retracted.event.payload.supersedesEventId).toBe(committed.event.eventId)
    expect(retracted.event.payload.supportingEventIds).toEqual([
      evidence.presented.event.eventId,
      evidence.discovered.event.eventId,
    ])
    expect(retracted.state.roomStates.room?.flags?.['npc-action:npc:bar-exit:exit']).toBe(false)
    expect(evaluateNpcActionExitGate({
      room, fromRoomId: 'room', toRoomId: 'other', state: retracted.state,
      npcActionEnabled: true,
    })).toEqual({ gated: false })
    const log = await value.store.listEvents(ready.sessionId)
    expect(JSON.stringify(log.find((event) => event.eventId === committed.event.eventId)))
      .toBe(original)
    expect(projectWorldState(log)).toEqual(retracted.state)

    const duplicate = await value.session.commitNpcActionRetraction(
      ready.sessionId, retractionCommand, retracted.state.revision, { room, binding },
    )
    expect(duplicate.ok).toBe(false)
  })
})
