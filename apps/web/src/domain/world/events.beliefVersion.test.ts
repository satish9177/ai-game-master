import { describe, expect, it } from 'vitest'
import { npcActionFlagKey } from '../npcBelief/contracts'
import { projectWorldState } from './applyEvent'
import {
  SerializedBeliefSchema,
  SerializedBeliefV1Schema,
  SerializedBeliefV2Schema,
  WorldEventSchema,
  type WorldEvent,
} from './events'
import { loadSaveGame } from '../../world-session/saveGame'

const SESSION_ID = '00000000-0000-4000-8000-000000000001'
const START_EVENT_ID = '00000000-0000-4000-8000-000000000002'
const OBSERVATION_EVENT_ID = '00000000-0000-4000-8000-000000000003'
const ACTION_EVENT_ID = '00000000-0000-4000-8000-000000000004'

const seed = {
  schemaVersion: 1 as const,
  worldId: '10000000-0000-4000-8000-000000000000',
  name: 'Old world',
  startingRoomId: 'throne-room',
  initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
}

const startEvent = WorldEventSchema.parse({
  schemaVersion: 1,
  eventId: START_EVENT_ID,
  sessionId: SESSION_ID,
  seq: 1,
  occurredAt: '2026-07-21T00:00:00.000Z',
  type: 'session-started',
  payload: { seed },
})

const v1Belief = {
  predicate: 'player-took-item' as const,
  itemId: 'gold-coin',
  roomId: 'throne-room',
  confidence: 'high' as const,
}

const warrant = {
  ruleId: 'direct-witness@1' as const,
  premises: [{
    id: 'p1-witnessed-take' as const,
    kind: 'observed' as const,
    observationEventIds: [OBSERVATION_EVENT_ID],
    defeasible: false,
  }],
  defeasiblePremiseIds: [],
}

const v2Belief = {
  beliefSchemaVersion: 2 as const,
  predicate: 'player-took-item' as const,
  itemId: 'gold-coin',
  roomId: 'throne-room',
  confidence: 'low' as const,
  warrant,
}

const v1ActionEvent = WorldEventSchema.parse({
  schemaVersion: 1,
  eventId: ACTION_EVENT_ID,
  sessionId: SESSION_ID,
  seq: 2,
  occurredAt: '2026-07-21T00:00:01.000Z',
  type: 'npc-action-committed',
  payload: {
    npcId: 'herald-asha',
    roomId: 'throne-room',
    action: 'bar-exit',
    targetObjectId: 'north-door',
    ruleId: 'witnessed-item-taken@1',
    belief: v1Belief,
    supportingEventIds: [OBSERVATION_EVENT_ID],
  },
})

function saveJson(log: readonly WorldEvent[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    seed,
    log,
    snapshot: projectWorldState(log),
  })
}

describe('serialized NPC belief event compatibility', () => {
  it('EV1 parses and reserializes an accepted V1 event byte-identically', () => {
    const original = '{"schemaVersion":1,"eventId":"00000000-0000-4000-8000-000000000004","sessionId":"00000000-0000-4000-8000-000000000001","seq":2,"occurredAt":"2026-07-21T00:00:01.000Z","type":"npc-action-committed","payload":{"npcId":"herald-asha","roomId":"throne-room","action":"bar-exit","targetObjectId":"north-door","ruleId":"witnessed-item-taken@1","belief":{"predicate":"player-took-item","itemId":"gold-coin","roomId":"throne-room","confidence":"high"},"supportingEventIds":["00000000-0000-4000-8000-000000000003"]}}'
    const parsed = WorldEventSchema.parse(JSON.parse(original))

    expect(JSON.stringify(parsed)).toBe(original)
  })

  it('EV2 keeps V1 and V2 members key-set disjoint while the plain union accepts both', () => {
    expect(SerializedBeliefV2Schema.safeParse(v1Belief).success).toBe(false)
    expect(SerializedBeliefV1Schema.safeParse(v2Belief).success).toBe(false)

    const parsedV1 = SerializedBeliefSchema.parse(v1Belief)
    const parsedV2 = SerializedBeliefSchema.parse(v2Belief)
    expect('beliefSchemaVersion' in parsedV1).toBe(false)
    expect('beliefSchemaVersion' in parsedV2 && parsedV2.beliefSchemaVersion).toBe(2)
  })

  it.each([
    ['beliefSchemaVersion alone', { ...v1Belief, beliefSchemaVersion: 2 }],
    ['warrant alone', { ...v1Belief, warrant }],
    ['an arbitrary extra key', { ...v1Belief, extra: true }],
  ])('EV3 rejects V1 with %s', (_name, belief) => {
    expect(SerializedBeliefSchema.safeParse(belief).success).toBe(false)
  })
})

describe('save, replay, and projection compatibility', () => {
  it('COMPAT-E1 loads an old save with no belief events unchanged', () => {
    const original = saveJson([startEvent])
    const loaded = loadSaveGame(original)

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.saveGame)).toBe(original)
  })

  it('COMPAT-E2 loads and replays a save containing an accepted V1 action unchanged', () => {
    const log = [startEvent, v1ActionEvent]
    const original = saveJson(log)
    const loaded = loadSaveGame(original)

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.saveGame)).toBe(original)
    expect(projectWorldState(loaded.saveGame.log)).toEqual(loaded.saveGame.snapshot)
    expect(loaded.saveGame.log[1]).toEqual(v1ActionEvent)
  })

  it('COMPAT-E3 preserves the existing applyEvent projection for a V1 action', () => {
    expect(projectWorldState([startEvent, v1ActionEvent])).toEqual({
      schemaVersion: 1,
      worldId: seed.worldId,
      sessionId: SESSION_ID,
      currentRoomId: 'throne-room',
      player: { health: { current: 100, max: 100 }, status: [] },
      inventory: [],
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            [npcActionFlagKey('herald-asha', 'bar-exit', 'north-door')]: true,
          },
        },
      },
      revision: 2,
      updatedAt: '2026-07-21T00:00:01.000Z',
    })
  })
})
