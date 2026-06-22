import { describe, expect, it } from 'vitest'
import { EncounterSpecSchema } from './encounterSpec'
import { planEncounter } from './planEncounter'
import type { EncounterSpec } from './encounterSpec'
import type { WorldState } from '../world/worldState'

const baseState = (overrides: Partial<WorldState> = {}): WorldState => ({
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  currentRoomId: 'safehouse',
  player: { health: { current: 50, max: 100 }, status: [] },
  inventory: [{ itemId: 'coin', name: 'SECRET COIN NAME', quantity: 2 }],
  roomStates: { safehouse: { visited: true } },
  revision: 1,
  updatedAt: '2026-06-22T10:00:00.000Z',
  ...overrides,
})

const encounter = (overrides: Partial<EncounterSpec> = {}): EncounterSpec =>
  EncounterSpecSchema.parse({
    id: 'threat-1',
    title: 'A Threat',
    description: 'Something blocks the way.',
    choices: [
      {
        id: 'c-fight',
        action: 'fight',
        label: 'Fight it off',
        outcome: {
          effects: [
            { kind: 'damage', amount: 15 },
            { kind: 'add-status', status: 'infected' },
          ],
          resultText: 'SECRET RESULT TEXT',
        },
      },
    ],
    ...overrides,
  })

describe('EncounterSpecSchema', () => {
  it('parses every action and every effect-atom kind', () => {
    const parsed = EncounterSpecSchema.parse({
      id: 'all',
      description: 'A many-sided threat.',
      choices: [
        { id: 'a', action: 'fight', label: 'Fight', outcome: { effects: [{ kind: 'damage', amount: 5 }] } },
        { id: 'b', action: 'hide', label: 'Tend', outcome: { effects: [{ kind: 'heal', amount: 5 }] } },
        {
          id: 'c',
          action: 'run',
          label: 'Hide',
          outcome: { effects: [{ kind: 'add-status', status: 'hidden' }] },
        },
        {
          id: 'd',
          action: 'distract',
          label: 'Run',
          outcome: { effects: [{ kind: 'clear-status', status: 'hidden' }] },
        },
        {
          id: 'e',
          action: 'negotiate',
          label: 'Distract',
          outcome: { effects: [{ kind: 'remove-item', itemId: 'coin', quantity: 1 }] },
        },
        {
          id: 'f',
          action: 'fight',
          label: 'Negotiate',
          outcome: {
            effects: [{ kind: 'add-item', item: { itemId: 'token', name: 'Token', quantity: 1 } }],
          },
        },
      ],
    })
    expect(parsed.choices).toHaveLength(6)
    // Effects default to [] when omitted (e.g. a 'hide' that does nothing).
    expect(
      EncounterSpecSchema.parse({
        description: 'x',
        choices: [{ id: 'h', action: 'hide', label: 'Hide', outcome: {} }],
      }).choices[0]?.outcome.effects,
    ).toEqual([])
  })

  it('rejects malformed encounters', () => {
    // Empty choices.
    expect(EncounterSpecSchema.safeParse({ description: 'x', choices: [] }).success).toBe(false)
    // Duplicate choice ids.
    expect(
      EncounterSpecSchema.safeParse({
        description: 'x',
        choices: [
          { id: 'dup', action: 'fight', label: 'A', outcome: {} },
          { id: 'dup', action: 'hide', label: 'B', outcome: {} },
        ],
      }).success,
    ).toBe(false)
    // Empty description / empty label.
    expect(
      EncounterSpecSchema.safeParse({
        description: '',
        choices: [{ id: 'a', action: 'fight', label: 'A', outcome: {} }],
      }).success,
    ).toBe(false)
    expect(
      EncounterSpecSchema.safeParse({
        description: 'x',
        choices: [{ id: 'a', action: 'fight', label: '', outcome: {} }],
      }).success,
    ).toBe(false)
    // Unknown action and unknown effect-atom kind.
    expect(
      EncounterSpecSchema.safeParse({
        description: 'x',
        choices: [{ id: 'a', action: 'flee', label: 'A', outcome: {} }],
      }).success,
    ).toBe(false)
    expect(
      EncounterSpecSchema.safeParse({
        description: 'x',
        choices: [{ id: 'a', action: 'fight', label: 'A', outcome: { effects: [{ kind: 'explode' }] } }],
      }).success,
    ).toBe(false)
    // Non-positive damage amount.
    expect(
      EncounterSpecSchema.safeParse({
        description: 'x',
        choices: [
          { id: 'a', action: 'fight', label: 'A', outcome: { effects: [{ kind: 'damage', amount: 0 }] } },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('planEncounter', () => {
  it('maps a chosen action to its effect commands with the resolution flag last', () => {
    const plan = planEncounter({
      encounter: encounter(),
      choiceId: 'c-fight',
      ref: undefined,
      state: baseState(),
    })
    expect(plan).toEqual({
      status: 'apply',
      commands: [
        { schemaVersion: 1, type: 'health-changed', delta: -15 },
        { schemaVersion: 1, type: 'status-changed', status: 'infected', op: 'add' },
        {
          schemaVersion: 1,
          type: 'room-state-changed',
          roomId: 'safehouse',
          flags: { 'encounter:threat-1': true },
        },
      ],
      outcome: { kind: 'resolved', action: 'fight', choiceId: 'c-fight' },
    })
  })

  it('maps every effect atom to its single existing command', () => {
    const atoms = encounter({
      choices: [
        {
          id: 'all',
          action: 'negotiate',
          label: 'All',
          outcome: {
            effects: [
              { kind: 'damage', amount: 7 },
              { kind: 'heal', amount: 9 },
              { kind: 'add-status', status: 'cursed' },
              { kind: 'clear-status', status: 'blessed' },
              { kind: 'remove-item', itemId: 'coin', quantity: 1 },
              { kind: 'add-item', item: { itemId: 'key', name: 'Iron Key', quantity: 1 } },
            ],
          },
        },
      ],
    })
    const plan = planEncounter({ encounter: atoms, choiceId: 'all', ref: undefined, state: baseState() })
    expect(plan.status).toBe('apply')
    if (plan.status !== 'apply') return
    expect(plan.commands).toEqual([
      { schemaVersion: 1, type: 'health-changed', delta: -7 },
      { schemaVersion: 1, type: 'health-changed', delta: 9 },
      { schemaVersion: 1, type: 'status-changed', status: 'cursed', op: 'add' },
      { schemaVersion: 1, type: 'status-changed', status: 'blessed', op: 'clear' },
      { schemaVersion: 1, type: 'item-removed', itemId: 'coin', quantity: 1 },
      { schemaVersion: 1, type: 'item-added', item: { itemId: 'key', name: 'Iron Key', quantity: 1 } },
      {
        schemaVersion: 1,
        type: 'room-state-changed',
        roomId: 'safehouse',
        flags: { 'encounter:threat-1': true },
      },
    ])
  })

  it('emits only the resolution flag for an empty-effects outcome (e.g. hide)', () => {
    const enc = encounter({
      choices: [{ id: 'c-hide', action: 'hide', label: 'Hide', outcome: { effects: [] } }],
    })
    expect(planEncounter({ encounter: enc, choiceId: 'c-hide', ref: undefined, state: baseState() })).toEqual({
      status: 'apply',
      commands: [
        {
          schemaVersion: 1,
          type: 'room-state-changed',
          roomId: 'safehouse',
          flags: { 'encounter:threat-1': true },
        },
      ],
      outcome: { kind: 'resolved', action: 'hide', choiceId: 'c-hide' },
    })
  })

  it('returns already-resolved (no commands) when the flag is already set', () => {
    const resolved = baseState({
      roomStates: { safehouse: { visited: true, flags: { 'encounter:threat-1': true } } },
    })
    expect(planEncounter({ encounter: encounter(), choiceId: 'c-fight', ref: undefined, state: resolved })).toEqual({
      status: 'already-resolved',
      outcome: { kind: 'nothing' },
    })
  })

  it('falls back to the object ref for the flag key, and rejects when neither id nor ref exists', () => {
    const noId = encounter({ id: undefined })
    expect(planEncounter({ encounter: noId, choiceId: 'c-fight', ref: 'guard-malik', state: baseState() })).toMatchObject({
      status: 'apply',
      commands: [
        { type: 'health-changed', delta: -15 },
        { type: 'status-changed' },
        { type: 'room-state-changed', flags: { 'encounter:guard-malik': true } },
      ],
    })
    expect(planEncounter({ encounter: noId, choiceId: 'c-fight', ref: undefined, state: baseState() })).toEqual({
      status: 'rejected',
      reason: 'missing-id',
    })
  })

  it('rejects an unknown choice id', () => {
    expect(planEncounter({ encounter: encounter(), choiceId: 'nope', ref: undefined, state: baseState() })).toEqual({
      status: 'rejected',
      reason: 'unknown-choice',
    })
  })

  it('gates a choice on possession: rejects below the requirement, passes at the exact boundary', () => {
    const gated = encounter({
      choices: [
        {
          id: 'c-bribe',
          action: 'negotiate',
          label: 'Bribe',
          requires: { itemId: 'coin', quantity: 2 },
          outcome: { effects: [{ kind: 'remove-item', itemId: 'coin', quantity: 2 }] },
        },
      ],
    })
    // Held == required (2 == 2) passes.
    expect(planEncounter({ encounter: gated, choiceId: 'c-bribe', ref: undefined, state: baseState() }).status).toBe(
      'apply',
    )
    // Held < required rejects, nothing else.
    const poorer = baseState({ inventory: [{ itemId: 'coin', name: 'Coin', quantity: 1 }] })
    expect(planEncounter({ encounter: gated, choiceId: 'c-bribe', ref: undefined, state: poorer })).toEqual({
      status: 'rejected',
      reason: 'insufficient-item',
    })
  })

  it('is deterministic and never mutates its encounter or state inputs', () => {
    const enc = encounter()
    const state = baseState()
    const encBefore = structuredClone(enc)
    const stateBefore = structuredClone(state)
    const first = planEncounter({ encounter: enc, choiceId: 'c-fight', ref: 'guard', state })
    const second = planEncounter({ encounter: enc, choiceId: 'c-fight', ref: 'guard', state })
    expect(first).toEqual(second)
    expect(enc).toEqual(encBefore)
    expect(state).toEqual(stateBefore)
  })
})
