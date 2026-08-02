import { describe, expect, it } from 'vitest'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import type { EvidenceHolderScope } from './evidenceObservation'
import {
  classifyEvidencePresentations,
  deriveDefeaterObservations,
} from './evidenceObservation'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const DISCOVERY_ID = '20000000-0000-4000-8000-000000000001'
const PRESENTATION_ID = '20000000-0000-4000-8000-000000000002'

function event(
  seq: number,
  eventId: string,
  type: WorldEvent['type'],
  payload: unknown,
): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1, eventId, sessionId: SESSION_ID, seq,
    occurredAt: `2026-01-01T00:00:0${seq}.000Z`, type, payload,
  })
}

const discovery = event(1, DISCOVERY_ID, 'evidence-discovered', {
  roomId: 'room', evidenceId: 'p4-evidence', sourceObjectId: 'source',
})
const presentation = event(2, PRESENTATION_ID, 'evidence-presented', {
  roomId: 'room', evidenceId: 'p4-evidence', toNpcId: 'holder',
  presentationObjectId: 'presentation', discoveryEventId: DISCOVERY_ID,
})
const scope: EvidenceHolderScope = {
  npcId: 'holder',
  npcRoomId: 'room',
  evidenceArtifacts: [{
    evidenceId: 'p4-evidence', roomId: 'room', sourceObjectId: 'source',
    strength: 'hard', exposes: ['alternate-access'], class: 'undercutting',
    defeats: { ruleId: 'sole-copresent-candidate@1', premiseId: 'p4-no-alternate-access' },
    reachability: {
      prerequisiteObjectIds: [],
      presentation: { objectId: 'presentation', toNpcId: 'holder' },
    },
  }],
}

describe('holder-scoped evidence observation', () => {
  it('discovery alone creates neither receipt nor defeater observation', () => {
    expect(classifyEvidencePresentations([discovery], scope)).toEqual([])
    expect(deriveDefeaterObservations([discovery], scope)).toEqual([])
  })

  it.each([
    ['wrong NPC', { toNpcId: 'other' }],
    ['wrong room', { roomId: 'other-room' }],
  ])('classifies %s as out-of-scope', (_name, replacement) => {
    const wrong = event(2, PRESENTATION_ID, 'evidence-presented', {
      ...presentation.payload, ...replacement,
    })
    expect(classifyEvidencePresentations([discovery, wrong], scope)[0]?.status)
      .toBe('out-of-scope')
    expect(deriveDefeaterObservations([discovery, wrong], scope)).toEqual([])
  })

  it('classifies mismatched and future discovery provenance as invalid', () => {
    const mismatchedDiscovery = event(1, DISCOVERY_ID, 'evidence-discovered', {
      ...discovery.payload, evidenceId: 'other-evidence',
    })
    expect(classifyEvidencePresentations([mismatchedDiscovery, presentation], scope)[0]?.status)
      .toBe('invalid-discovery-provenance')
    expect(classifyEvidencePresentations([presentation, discovery], scope)[0]?.status)
      .toBe('invalid-discovery-provenance')
    expect(deriveDefeaterObservations([mismatchedDiscovery, presentation], scope)).toEqual([])
  })

  it('creates exactly one full holder-scoped defeater observation', () => {
    expect(deriveDefeaterObservations([discovery, presentation], scope)).toEqual([{
      schemaVersion: 1,
      observerNpcId: 'holder',
      kind: 'defeater-received',
      fidelity: 'full',
      roomId: 'room',
      evidenceId: 'p4-evidence',
      defeatsRuleId: 'sole-copresent-candidate@1',
      defeatsPremiseId: 'p4-no-alternate-access',
      presentedEventId: PRESENTATION_ID,
      discoveredEventId: DISCOVERY_ID,
      sourceEventId: PRESENTATION_ID,
      sourceSeq: 2,
      occurredAt: presentation.occurredAt,
    }])
    expect(JSON.stringify([
      discovery,
      presentation,
      ...deriveDefeaterObservations([discovery, presentation], scope),
    ])).not.toContain('concealed-actor')
  })

  it('classifies inert evidence as received without emitting a defeater observation', () => {
    const inertScope: EvidenceHolderScope = {
      ...scope,
      evidenceArtifacts: [{
        evidenceId: 'p4-evidence', roomId: 'room', sourceObjectId: 'source',
        strength: 'soft', exposes: [], class: 'inert', defeats: null,
        presentation: { objectId: 'presentation', toNpcId: 'holder' },
      }],
    }
    expect(classifyEvidencePresentations([discovery, presentation], inertScope)[0]?.status)
      .toBe('received')
    expect(deriveDefeaterObservations([discovery, presentation], inertScope)).toEqual([])
  })
})
