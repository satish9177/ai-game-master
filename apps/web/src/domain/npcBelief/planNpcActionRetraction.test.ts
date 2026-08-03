import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import {
  evidencePresentationFor,
  type DefeasibleNpcActionBinding,
  type EvidenceArtifact,
  type UndercuttingEvidenceArtifact,
} from './defeasibleBindings'
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

function binding(
  artifact: EvidenceArtifact | readonly EvidenceArtifact[] = undercutter(),
): DefeasibleNpcActionBinding {
  return {
    roomId: 'room', npcId: 'npc', targetObjectId: 'exit', triggerItemId: 'item',
    containerId: 'container', initialContainerContents: 'present', attentionObjectIds: [],
    minConfidence: 'low', evidenceArtifacts: Array.isArray(artifact) ? artifact : [artifact],
    offstageTruth: {
      triggerObjectId: 'trigger', actorId: 'concealed-actor', itemId: 'item', ruleId: 'truth',
    },
  }
}

function event(
  seq: number,
  type: WorldEvent['type'],
  payload: unknown,
  idOrdinal = seq,
): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(idOrdinal).padStart(12, '0')}`,
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

function matchingUndercutter(evidenceId: string): UndercuttingEvidenceArtifact {
  return {
    evidenceId,
    roomId: 'room',
    sourceObjectId: `source-${evidenceId}`,
    strength: 'hard',
    exposes: ['alternate-access'],
    class: 'undercutting',
    defeats: {
      ruleId: 'sole-copresent-candidate@1',
      premiseId: 'p4-no-alternate-access',
    },
    reachability: {
      prerequisiteObjectIds: [],
      presentation: { objectId: `presentation-${evidenceId}`, toNpcId: 'npc' },
    },
  }
}

function inert(evidenceId: string): EvidenceArtifact {
  return {
    evidenceId,
    roomId: 'room',
    sourceObjectId: `source-${evidenceId}`,
    strength: 'soft',
    exposes: [],
    class: 'inert',
    defeats: null,
    presentation: { objectId: `presentation-${evidenceId}`, toNpcId: 'npc' },
  }
}

function rebutting(evidenceId: string): EvidenceArtifact {
  return {
    evidenceId,
    roomId: 'room',
    sourceObjectId: `source-${evidenceId}`,
    strength: 'hard',
    exposes: ['replacement'],
    class: 'rebutting',
    rebuts: 'other-took-item',
    presentation: { objectId: `presentation-${evidenceId}`, toNpcId: 'npc' },
  }
}

function unrelatedUndercutter(evidenceId: string): UndercuttingEvidenceArtifact {
  return {
    ...matchingUndercutter(evidenceId),
    defeats: { ruleId: 'direct-witness@1', premiseId: 'p1-witnessed-take' },
  }
}

function evidenceEvents(
  artifact: EvidenceArtifact,
  discoverySeq: number,
  presentationSeq: number,
  options: Readonly<{
    discoveryOrdinal?: number
    presentationOrdinal?: number
    toNpcId?: string
    roomId?: string
  }> = {},
): readonly [WorldEvent, WorldEvent] {
  const descriptor = evidencePresentationFor(artifact)
  if (descriptor === undefined) throw new Error('missing presentation descriptor')
  const discovery = event(discoverySeq, 'evidence-discovered', {
    roomId: options.roomId ?? artifact.roomId,
    evidenceId: artifact.evidenceId,
    sourceObjectId: artifact.sourceObjectId,
  }, options.discoveryOrdinal)
  const presentation = event(presentationSeq, 'evidence-presented', {
    roomId: options.roomId ?? artifact.roomId,
    evidenceId: artifact.evidenceId,
    toNpcId: options.toNpcId ?? descriptor.toNpcId,
    presentationObjectId: descriptor.objectId,
    discoveryEventId: discovery.eventId,
  }, options.presentationOrdinal)
  return [discovery, presentation]
}

function planMany(artifacts: readonly EvidenceArtifact[], log: readonly WorldEvent[]) {
  return planNpcActionRetraction({ room, binding: binding(artifacts), log })
}

function expectProvenance(
  result: ReturnType<typeof planNpcActionRetraction>,
  presentation: WorldEvent,
  discovery: WorldEvent,
) {
  expect(result.status).toBe('retract')
  if (result.status !== 'retract') return
  expect(result.supportingEventIds).toEqual([presentation.eventId, discovery.eventId])
  expect(result.presentationEvent).toBe(presentation)
  expect(result.discoveryEvent).toBe(discovery)
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

  it.each([
    ['undercutter then inert', 'valid', 'inert'],
    ['inert then undercutter', 'inert', 'valid'],
    ['undercutter then rebutting', 'valid', 'rebutting'],
    ['rebutting then undercutter', 'rebutting', 'valid'],
  ] as const)('%s selects the actual undercutter', (_name, firstKind, secondKind) => {
    const artifacts = {
      valid: matchingUndercutter('valid'),
      inert: inert('inert'),
      rebutting: rebutting('rebutting'),
    }
    const first = artifacts[firstKind]
    const second = artifacts[secondKind]
    const firstEvents = evidenceEvents(first, 2, 3)
    const secondEvents = evidenceEvents(second, 4, 5)
    const validEvents = firstKind === 'valid' ? firstEvents : secondEvents
    const log = [secondEvents[1], committed(), firstEvents[1], secondEvents[0], firstEvents[0]]

    expectProvenance(
      planMany([first, second], log),
      validEvents[1],
      validEvents[0],
    )
  })

  it('selects the earlier presentation when the same undercutter is repeated', () => {
    const artifact = matchingUndercutter('repeated')
    const [discovery, earlier] = evidenceEvents(artifact, 2, 3)
    const descriptor = evidencePresentationFor(artifact)!
    const later = event(5, 'evidence-presented', {
      roomId: artifact.roomId,
      evidenceId: artifact.evidenceId,
      toNpcId: descriptor.toNpcId,
      presentationObjectId: descriptor.objectId,
      discoveryEventId: discovery.eventId,
    })
    const log = [later, committed(), earlier, discovery]

    const first = planMany([artifact], log)
    const replay = planMany([artifact], log)
    expectProvenance(first, earlier, discovery)
    expectProvenance(replay, earlier, discovery)
    expect(first).toEqual(replay)
  })

  it('orders two matching undercutters by sourceSeq then sourceEventId', () => {
    const lexicalLater = matchingUndercutter('lexical-later')
    const lexicalEarlier = matchingUndercutter('lexical-earlier')
    const laterEvents = evidenceEvents(lexicalLater, 2, 3, {
      discoveryOrdinal: 21, presentationOrdinal: 31,
    })
    const earlierEvents = evidenceEvents(lexicalEarlier, 2, 3, {
      discoveryOrdinal: 20, presentationOrdinal: 30,
    })
    const log = [laterEvents[1], laterEvents[0], committed(), earlierEvents[1], earlierEvents[0]]

    expectProvenance(
      planMany([lexicalLater, lexicalEarlier], log),
      earlierEvents[1],
      earlierEvents[0],
    )
  })

  it.each([
    ['wrong NPC', 'wrong-npc'],
    ['wrong room', 'wrong-room'],
    ['unrelated rule', 'unrelated-rule'],
    ['unknown evidence', 'unknown-evidence'],
  ] as const)('later %s evidence cannot shadow an earlier actual defeater', (_name, kind) => {
    const valid = matchingUndercutter('valid')
    const validEvents = evidenceEvents(valid, 2, 3)
    const other = kind === 'unrelated-rule'
      ? unrelatedUndercutter('other')
      : matchingUndercutter('other')
    let otherEvents = evidenceEvents(other, 4, 5,
      kind === 'wrong-npc' ? { toNpcId: 'other-npc' }
        : kind === 'wrong-room' ? { roomId: 'other-room' }
          : {})
    let artifacts: readonly EvidenceArtifact[] = [valid, other]
    if (kind === 'unknown-evidence') {
      const unknown = matchingUndercutter('unknown')
      otherEvents = evidenceEvents(unknown, 4, 5)
      artifacts = [valid]
    }

    expectProvenance(
      planMany(artifacts, [committed(), ...validEvents, ...otherEvents]),
      validEvents[1],
      validEvents[0],
    )
  })

  it('preserves informative non-retracting refusal precedence', () => {
    const inertArtifact = inert('inert')
    const rebuttingArtifact = rebutting('rebutting')
    const inertEvents = evidenceEvents(inertArtifact, 2, 3)
    const rebuttingEvents = evidenceEvents(rebuttingArtifact, 4, 5)
    expect(planMany([inertArtifact], [committed(), ...inertEvents])).toEqual({
      status: 'refused', reason: 'no-defeater',
    })
    expect(planMany(
      [inertArtifact, rebuttingArtifact],
      [committed(), ...inertEvents, ...rebuttingEvents],
    )).toEqual({ status: 'refused', reason: 'replacement-not-reachable' })
  })

  it('maps invalid discovery provenance separately from unknown evidence', () => {
    const artifact = matchingUndercutter('known')
    const [, presented] = evidenceEvents(artifact, 2, 3)
    expect(planMany([artifact], [committed(), presented])).toEqual({
      status: 'refused', reason: 'evidence-provenance-invalid',
    })

    const unknown = matchingUndercutter('unknown')
    const unknownEvents = evidenceEvents(unknown, 2, 3)
    expect(planMany([artifact], [committed(), ...unknownEvents])).toEqual({
      status: 'refused', reason: 'unknown-evidence-target',
    })
  })

  it('uses earliest deterministic classification for classification-only diagnostics', () => {
    const artifact = matchingUndercutter('known')
    const invalid = evidenceEvents(artifact, 2, 3)[1]
    const wrongNpc = evidenceEvents(artifact, 4, 5, { toNpcId: 'other-npc' })[1]
    expect(planMany([artifact], [committed(), wrongNpc, invalid])).toEqual({
      status: 'refused', reason: 'evidence-provenance-invalid',
    })
  })
})
