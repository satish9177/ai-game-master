import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import type { DefeasibleNpcActionBinding, EvidenceArtifact } from './defeasibleBindings'
import { NPC_ACTION_RETRACTION_RULE_ID, planNpcActionRetraction } from './planNpcActionRetraction'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const SUPPORT_ID = '20000000-0000-4000-8000-000000000000'
const room = loadRoomSpec({
  schemaVersion: 1, id: 'room', name: 'Room',
  shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
  spawn: { position: [0, 0, 0] },
  objects: [
    { type: 'npc', id: 'npc', name: 'NPC', position: [0, 0, 0], interaction: {
      key: 'F', prompt: 'Attend', effect: { kind: 'inspect' },
    } },
    { type: 'arch', id: 'exit', position: [2, 0, 0], interaction: {
      key: 'E', prompt: 'Leave', exit: { toRoomId: 'other' },
    } },
  ],
})

function undercutter(premiseId: 'p1-before' | 'p4-no-alternate-access' = 'p4-no-alternate-access'):
EvidenceArtifact {
  return {
    evidenceId: 'evidence', roomId: 'room', sourceObjectId: 'source', strength: 'hard',
    exposes: ['alternate-access'], class: 'undercutting',
    defeats: { ruleId: 'sole-copresent-candidate@1', premiseId },
    reachability: { prerequisiteObjectIds: [], presentation: {
      objectId: 'presentation', toNpcId: 'npc',
    } },
  }
}

function binding(artifact: EvidenceArtifact = undercutter()): DefeasibleNpcActionBinding {
  return {
    roomId: 'room', npcId: 'npc', targetObjectId: 'exit', triggerItemId: 'item',
    containerId: 'container', initialContainerContents: 'present', attentionObjectIds: [],
    minConfidence: 'low', evidenceArtifacts: [artifact], offstageTruth: {
      triggerObjectId: 'trigger', actorId: 'concealed-actor', itemId: 'item', ruleId: 'truth',
    },
  }
}

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID, seq, occurredAt: `2026-01-01T00:00:0${seq}.000Z`, type, payload,
  })
}

function committed(version: 1 | 2 = 2): WorldEvent {
  const belief = version === 1 ? {
    predicate: 'player-took-item', itemId: 'item', roomId: 'room', confidence: 'high',
  } : {
    beliefSchemaVersion: 2, predicate: 'player-took-item', itemId: 'item', roomId: 'room',
    confidence: 'low', warrant: {
      ruleId: 'sole-copresent-candidate@1',
      premises: [
        { id: 'p1-before', kind: 'observed', observationEventIds: [SUPPORT_ID], defeasible: false },
        { id: 'p4-no-alternate-access', kind: 'default', observationEventIds: [], defeasible: true },
      ],
      defeasiblePremiseIds: ['p4-no-alternate-access'],
    },
  }
  return event(1, 'npc-action-committed', {
    npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
    ruleId: 'action-rule', belief, supportingEventIds: [SUPPORT_ID],
  })
}

function evidenceLog(commit = committed()): WorldEvent[] {
  const discovery = event(2, 'evidence-discovered', {
    roomId: 'room', evidenceId: 'evidence', sourceObjectId: 'source',
  })
  const presentation = event(3, 'evidence-presented', {
    roomId: 'room', evidenceId: 'evidence', toNpcId: 'npc',
    presentationObjectId: 'presentation', discoveryEventId: discovery.eventId,
  })
  return [commit, discovery, presentation]
}

function plan(artifact: EvidenceArtifact = undercutter(), log = evidenceLog()) {
  return planNpcActionRetraction({ room, binding: binding(artifact), log })
}

describe('planNpcActionRetraction', () => {
  it('retracts inferred V2 with exact ordered evidence provenance and a distinct authority rule', () => {
    const log = evidenceLog()
    const before = JSON.stringify(log[0])
    const result = plan(undercutter(), log)
    expect(result.status).toBe('retract')
    if (result.status !== 'retract') return
    expect(result.command).toEqual({
      schemaVersion: 1, type: 'npc-action-retracted', npcId: 'npc', roomId: 'room',
      action: 'bar-exit', targetObjectId: 'exit',
    })
    expect(result.ruleId).toBe(NPC_ACTION_RETRACTION_RULE_ID)
    expect(result.ruleId).not.toBe('action-rule')
    expect(result.ruleId).not.toBe('sole-copresent-candidate@1')
    expect(result.supersedesEventId).toBe(log[0]!.eventId)
    expect(result.supportingEventIds).toEqual([log[2]!.eventId, log[1]!.eventId])
    expect(JSON.stringify(log[0])).toBe(before)
    expect(JSON.stringify(result)).not.toContain('concealed-actor')
  })

  it('routes direct witness, indefeasible, inert, and rebutting artifacts through evaluateDefeat', () => {
    expect(plan(undercutter(), evidenceLog(committed(1)))).toEqual({
      status: 'refused', reason: 'defeater-targets-unknown-premise',
    })
    expect(plan(undercutter('p1-before'))).toEqual({
      status: 'refused', reason: 'defeater-targets-indefeasible-premise',
    })
    expect(plan({
      evidenceId: 'evidence', roomId: 'room', sourceObjectId: 'source', strength: 'soft',
      exposes: [], class: 'inert', defeats: null,
      presentation: { objectId: 'presentation', toNpcId: 'npc' },
    })).toEqual({ status: 'refused', reason: 'no-defeater' })
    expect(plan({
      evidenceId: 'evidence', roomId: 'room', sourceObjectId: 'source', strength: 'hard',
      exposes: ['other'], class: 'rebutting', rebuts: 'other-took-item',
      presentation: { objectId: 'presentation', toNpcId: 'npc' },
    })).toEqual({ status: 'refused', reason: 'replacement-not-reachable' })
  })

  it('refuses nothing active, duplicate retraction, absent evidence, and out-of-scope evidence', () => {
    expect(planNpcActionRetraction({ room, binding: binding(), log: [] })).toEqual({
      status: 'refused', reason: 'nothing-to-retract',
    })
    const committedEvent = committed()
    const priorRetraction = event(2, 'npc-action-retracted', {
      npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
      ruleId: 'retract', defeatedPremiseId: 'p4-no-alternate-access', evidenceId: 'evidence',
      supersedesEventId: committedEvent.eventId, supportingEventIds: [SUPPORT_ID],
    })
    expect(plan(undercutter(), [committedEvent, priorRetraction])).toEqual({
      status: 'refused', reason: 'already-retracted',
    })
    expect(plan(undercutter(), [committedEvent])).toEqual({
      status: 'refused', reason: 'no-evidence',
    })
    expect(plan(undercutter(), evidenceLog(committedEvent).slice(0, 2))).toEqual({
      status: 'refused', reason: 'no-evidence',
    })
    const wrong = evidenceLog(committedEvent)
    wrong[2] = event(3, 'evidence-presented', { ...wrong[2]!.payload, toNpcId: 'other' })
    expect(plan(undercutter(), wrong)).toEqual({
      status: 'refused', reason: 'evidence-out-of-scope',
    })
  })
})
