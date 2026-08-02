import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { DefeasibleNpcActionBinding } from './defeasibleBindings'
import type { DefeasibleNpcObservation } from './observationScopeV2'
import {
  DEFEASIBLE_NPC_ACTION_RULE_ID,
  planDefeasibleNpcAction,
} from './planDefeasibleNpcAction'

const ROOM_ID = 'fixture-room'
const NPC_ID = 'fixture-npc'
const ITEM_ID = 'fixture-item'

function loadedRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: ROOM_ID,
    name: 'Fixture Room',
    shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
    spawn: { position: [0, 0, 0] },
    objects,
  })
}

const room = loadedRoom([
  {
    type: 'npc', id: NPC_ID, name: 'Fixture NPC', position: [0, 0, 0],
    interaction: { key: 'F', prompt: 'Attend', effect: { kind: 'inspect' } },
  },
  {
    type: 'arch', id: 'gated-exit', position: [2, 0, 0],
    interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'other-room' } },
  },
])

const binding: DefeasibleNpcActionBinding = {
  roomId: ROOM_ID,
  npcId: NPC_ID,
  targetObjectId: 'gated-exit',
  triggerItemId: ITEM_ID,
  containerId: 'fixture-container',
  initialContainerContents: 'present',
  attentionObjectIds: ['fixture-container'],
  minConfidence: 'low',
  evidenceArtifacts: [],
  offstageTruth: {
    triggerObjectId: 'fixture-trigger', actorId: 'concealed-actor',
    itemId: ITEM_ID, ruleId: 'fixture-offstage-rule',
  },
}

const direct: DefeasibleNpcObservation = {
  schemaVersion: 1,
  observerNpcId: NPC_ID,
  kind: 'item-taken-from-room',
  roomId: ROOM_ID,
  itemId: ITEM_ID,
  fidelity: 'full',
  sourceEventId: '30000000-0000-4000-8000-000000000002',
  sourceSeq: 2,
  occurredAt: '2026-01-01T00:00:02.000Z',
}

const inferred: readonly DefeasibleNpcObservation[] = [
  {
    schemaVersion: 1, observerNpcId: NPC_ID, kind: 'container-state-read',
    fidelity: 'partial', roomId: ROOM_ID, containerId: 'fixture-container',
    contents: 'present', missing: ['actor', 'action'],
    sourceEventId: '30000000-0000-4000-8000-000000000001', sourceSeq: 1,
    occurredAt: '2026-01-01T00:00:01.000Z',
  },
  {
    schemaVersion: 1, observerNpcId: NPC_ID, kind: 'container-state-read',
    fidelity: 'partial', roomId: ROOM_ID, containerId: 'fixture-container',
    contents: 'absent', missing: ['actor', 'action'],
    sourceEventId: '30000000-0000-4000-8000-000000000004', sourceSeq: 4,
    occurredAt: '2026-01-01T00:00:04.000Z',
  },
  {
    schemaVersion: 1, observerNpcId: NPC_ID, kind: 'actor-co-present',
    fidelity: 'full', roomId: ROOM_ID, actorId: 'player', fromSeq: 1, toSeq: 4,
    sourceEventId: '30000000-0000-4000-8000-000000000003', sourceSeq: 1,
    occurredAt: '2026-01-01T00:00:01.000Z',
  },
]

function plan(overrides: Partial<Parameters<typeof planDefeasibleNpcAction>[0]> = {}) {
  return planDefeasibleNpcAction({
    room,
    observations: [direct],
    consequenceStatus: 'none',
    binding,
    ...overrides,
  })
}

describe('planDefeasibleNpcAction', () => {
  it('FB-S3-21 returns no-binding through the empty production lookup', () => {
    expect(planDefeasibleNpcAction({
      room, observations: [direct], consequenceStatus: 'none',
    })).toEqual({ status: 'refused', reason: 'no-binding' })
  })

  it('FB-S3-22 refuses when the actor is missing or non-unique', () => {
    const withoutActor = { ...room, objects: room.objects.filter((object) => object.id !== NPC_ID) }
    expect(plan({ room: withoutActor })).toEqual({
      status: 'refused', reason: 'actor-not-in-room',
    })
  })

  it('FB-S3-23 refuses when the target exit is missing', () => {
    const withoutTarget = {
      ...room,
      objects: room.objects.filter((object) => object.id !== 'gated-exit'),
    }
    expect(plan({ room: withoutTarget })).toEqual({
      status: 'refused', reason: 'target-not-in-room',
    })
  })

  it('FB-S3-24 dispatches active and retracted consequence status without a log fold', () => {
    expect(plan({ consequenceStatus: 'active' })).toEqual({
      status: 'refused', reason: 'already-acted',
    })
    expect(plan({ consequenceStatus: 'retracted' })).toEqual({
      status: 'refused', reason: 'already-retracted',
    })
  })

  it('FB-S3-25 returns explicit warrant abstention with no qualifying observation', () => {
    expect(plan({ observations: [] })).toEqual({
      status: 'refused',
      reason: 'no-qualifying-observation',
      abstention: 'no-observations',
    })
  })

  it('FB-S3-26 a high threshold refuses inferred low but accepts witnessed high', () => {
    const highBinding = { ...binding, minConfidence: 'high' as const }
    expect(plan({ observations: inferred, binding: highBinding })).toEqual({
      status: 'refused', reason: 'below-confidence-threshold',
    })
    expect(plan({ observations: [direct], binding: highBinding }).status).toBe('commit')
  })

  it('FB-S3-27 plans inferred V2 and keeps action and warrant rule IDs distinct', () => {
    const result = plan({ observations: inferred })
    expect(result.status).toBe('commit')
    if (result.status !== 'commit') return
    expect(result.basis).toBe('inferred')
    expect(result.belief.schemaVersion).toBe(2)
    expect(result.ruleId).toBe(DEFEASIBLE_NPC_ACTION_RULE_ID)
    expect(result.warrant.ruleId).toBe('sole-copresent-candidate@1')
    expect(result.ruleId).not.toBe(result.warrant.ruleId)
    expect(result.command).toEqual({
      schemaVersion: 1,
      type: 'npc-action-committed',
      npcId: NPC_ID,
      roomId: ROOM_ID,
      action: 'bar-exit',
      targetObjectId: 'gated-exit',
    })
  })

  it('FB-S3-28 plans direct witness as V1 with its normalized warrant beside it', () => {
    const result = plan()
    expect(result.status).toBe('commit')
    if (result.status !== 'commit') return
    expect(result.basis).toBe('direct-witness')
    expect(result.belief.schemaVersion).toBe(1)
    expect(result.warrant.ruleId).toBe('direct-witness@1')
    expect(result.warrant.defeasiblePremiseIds).toEqual([])
  })

  it('refuses an inferred warrant already defeated by a holder-scoped p4 undercutter', () => {
    const undercutter = {
      evidenceId: 'p4', roomId: ROOM_ID, sourceObjectId: 'source', strength: 'hard' as const,
      exposes: ['alternate-access'], class: 'undercutting' as const,
      defeats: {
        ruleId: 'sole-copresent-candidate@1' as const,
        premiseId: 'p4-no-alternate-access' as const,
      },
      reachability: { prerequisiteObjectIds: [], presentation: {
        objectId: 'presentation', toNpcId: NPC_ID,
      } },
    }
    expect(plan({ observations: inferred, presentedArtifacts: [undercutter] })).toEqual({
      status: 'refused', reason: 'warrant-defeated',
    })
    expect(plan({ observations: [direct], presentedArtifacts: [undercutter] }).status)
      .toBe('commit')
  })

  it('allows inert presented evidence to leave commitment unchanged', () => {
    expect(plan({
      observations: inferred,
      presentedArtifacts: [{
        evidenceId: 'inert', roomId: ROOM_ID, sourceObjectId: 'source',
        strength: 'soft', exposes: [], class: 'inert', defeats: null,
        presentation: { objectId: 'presentation', toNpcId: NPC_ID },
      }],
    }).status).toBe('commit')
  })
})
