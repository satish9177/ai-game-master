import { describe, expect, it } from 'vitest'
import {
  SerializedBeliefV2Schema,
  SerializedWarrantSchema,
  type SerializedBelief,
} from '../world/events'
import { normalizeCommittedBeliefWarrant } from './beliefVersions'

const OBSERVATION_ID = '30000000-0000-4000-8000-000000000003'
const SECOND_OBSERVATION_ID = '30000000-0000-4000-8000-000000000004'

const validWarrant = {
  ruleId: 'sole-copresent-candidate@1' as const,
  premises: [
    {
      id: 'p1-before' as const,
      kind: 'observed' as const,
      observationEventIds: [OBSERVATION_ID],
      defeasible: false,
    },
    {
      id: 'p2-after' as const,
      kind: 'observed' as const,
      observationEventIds: [SECOND_OBSERVATION_ID],
      defeasible: false,
    },
    {
      id: 'p3-sole-candidate' as const,
      kind: 'default' as const,
      observationEventIds: [],
      defeasible: true,
    },
    {
      id: 'p4-no-alternate-access' as const,
      kind: 'default' as const,
      observationEventIds: [],
      defeasible: true,
    },
  ],
  defeasiblePremiseIds: ['p3-sole-candidate', 'p4-no-alternate-access'] as const,
}

describe('serialized belief warrant validation', () => {
  it('EV4 accepts a valid ordered, non-empty warrant', () => {
    expect(SerializedWarrantSchema.parse(validWarrant)).toEqual(validWarrant)
  })

  it.each([
    {
      name: 'a default premise with observations',
      warrant: {
        ...validWarrant,
        premises: validWarrant.premises.map((premise) => premise.id === 'p3-sole-candidate'
          ? { ...premise, observationEventIds: [OBSERVATION_ID] }
          : premise),
      },
    },
    {
      name: 'an observed premise without observations',
      warrant: {
        ...validWarrant,
        premises: validWarrant.premises.map((premise) => premise.id === 'p1-before'
          ? { ...premise, observationEventIds: [] }
          : premise),
      },
    },
    {
      name: 'duplicate premise ids',
      warrant: {
        ...validWarrant,
        premises: [validWarrant.premises[0], validWarrant.premises[0]],
        defeasiblePremiseIds: [],
      },
    },
    {
      name: 'an omitted defeasible premise id',
      warrant: {
        ...validWarrant,
        defeasiblePremiseIds: ['p3-sole-candidate'],
      },
    },
    {
      name: 'an extra defeasible premise id',
      warrant: {
        ...validWarrant,
        defeasiblePremiseIds: [
          'p1-before',
          'p3-sole-candidate',
          'p4-no-alternate-access',
        ],
      },
    },
    {
      name: 'duplicate defeasible premise ids',
      warrant: {
        ...validWarrant,
        defeasiblePremiseIds: [
          'p3-sole-candidate',
          'p3-sole-candidate',
          'p4-no-alternate-access',
        ],
      },
    },
    {
      name: 'an empty premise list',
      warrant: { ...validWarrant, premises: [], defeasiblePremiseIds: [] },
    },
    {
      name: 'an unknown rule id',
      warrant: { ...validWarrant, ruleId: 'unknown-rule@1' },
    },
    {
      name: 'an unknown premise id',
      warrant: {
        ...validWarrant,
        premises: [{
          id: 'unknown-premise',
          kind: 'observed',
          observationEventIds: [OBSERVATION_ID],
          defeasible: false,
        }],
        defeasiblePremiseIds: [],
      },
    },
    {
      name: 'non-UUID observation provenance',
      warrant: {
        ...validWarrant,
        premises: validWarrant.premises.map((premise) => premise.id === 'p1-before'
          ? { ...premise, observationEventIds: ['not-a-uuid'] }
          : premise),
      },
    },
    {
      name: 'an extra field',
      warrant: { ...validWarrant, extra: true },
    },
  ])('EV4 rejects $name', ({ warrant }) => {
    expect(SerializedWarrantSchema.safeParse(warrant).success).toBe(false)
  })
})

describe('normalizeCommittedBeliefWarrant', () => {
  it('COMPAT-N1 converts V1 committed provenance to an indefeasible direct-witness warrant', () => {
    const input: {
      belief: SerializedBelief
      supportingEventIds: readonly string[]
    } = {
      belief: {
        predicate: 'player-took-item',
        itemId: 'gold-coin',
        roomId: 'throne-room',
        confidence: 'high',
      },
      supportingEventIds: [OBSERVATION_ID, SECOND_OBSERVATION_ID],
    }

    expect(normalizeCommittedBeliefWarrant(input)).toEqual({
      ruleId: 'direct-witness@1',
      premises: [{
        id: 'p1-witnessed-take',
        kind: 'observed',
        observationEventIds: input.supportingEventIds,
        defeasible: false,
      }],
      defeasiblePremiseIds: [],
    })
  })

  it('COMPAT-N2 does not mutate V1 committed provenance', () => {
    const input = {
      belief: {
        predicate: 'player-took-item' as const,
        itemId: 'gold-coin',
        roomId: 'throne-room',
        confidence: 'high' as const,
      },
      supportingEventIds: [OBSERVATION_ID],
    }
    const before = JSON.parse(JSON.stringify(input)) as unknown

    normalizeCommittedBeliefWarrant(input)

    expect(input).toEqual(before)
  })

  it('COMPAT-N3 returns the validated serialized V2 warrant without replacing provenance', () => {
    const belief = SerializedBeliefV2Schema.parse({
      beliefSchemaVersion: 2,
      predicate: 'player-took-item',
      itemId: 'gold-coin',
      roomId: 'throne-room',
      confidence: 'low',
      warrant: validWarrant,
    })

    expect(normalizeCommittedBeliefWarrant({
      belief,
      supportingEventIds: [OBSERVATION_ID],
    })).toEqual(validWarrant)
  })
})
