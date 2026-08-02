import { describe, expect, it } from 'vitest'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import type { DefeasibleNpcActionBinding } from './defeasibleBindings'
import { activeCommittedNpcAction, foldConsequenceStatus } from './foldConsequenceStatus'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const binding: DefeasibleNpcActionBinding = {
  roomId: 'room', npcId: 'npc', targetObjectId: 'exit', triggerItemId: 'item',
  containerId: 'container', initialContainerContents: 'present', attentionObjectIds: [],
  minConfidence: 'low', evidenceArtifacts: [],
  offstageTruth: { triggerObjectId: 'trigger', actorId: 'hidden', itemId: 'item', ruleId: 'truth' },
}

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `20000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID, seq, occurredAt: `2026-01-01T00:00:0${seq}.000Z`, type, payload,
  })
}

function commit(seq: number, overrides: Record<string, unknown> = {}): WorldEvent {
  return event(seq, 'npc-action-committed', {
    npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
    ruleId: 'action', belief: {
      predicate: 'player-took-item', itemId: 'item', roomId: 'room', confidence: 'high',
    }, supportingEventIds: ['30000000-0000-4000-8000-000000000001'], ...overrides,
  })
}

function retract(seq: number, supersedesEventId: string): WorldEvent {
  return event(seq, 'npc-action-retracted', {
    npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit', ruleId: 'retract',
    defeatedPremiseId: 'p4-no-alternate-access', evidenceId: 'evidence', supersedesEventId,
    supportingEventIds: ['30000000-0000-4000-8000-000000000001'],
  })
}

describe('foldConsequenceStatus', () => {
  it('folds none, active, and a matching later retraction from the log only', () => {
    const first = commit(1)
    expect(foldConsequenceStatus([], binding)).toBe('none')
    expect(foldConsequenceStatus([first], binding)).toBe('active')
    expect(foldConsequenceStatus([first, retract(2, first.eventId)], binding)).toBe('retracted')
  })

  it('ignores unrelated, duplicate, and unknown-supersedes retractions', () => {
    const first = commit(1)
    const unknown = retract(2, '90000000-0000-4000-8000-000000000000')
    expect(foldConsequenceStatus([first, unknown], binding)).toBe('active')
    const matching = retract(3, first.eventId)
    expect(foldConsequenceStatus([first, matching, matching], binding)).toBe('retracted')
    expect(activeCommittedNpcAction([first, unknown], binding)).toEqual(first)
  })

  it('returns active after a later matching recommit and matches all four identity fields', () => {
    const first = commit(1)
    const second = commit(3)
    expect(foldConsequenceStatus([first, retract(2, first.eventId), second], binding)).toBe('active')
    expect(foldConsequenceStatus([commit(1, { roomId: 'other' })], binding)).toBe('none')
  })
})
