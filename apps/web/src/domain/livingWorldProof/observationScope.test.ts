import { describe, expect, it } from 'vitest'
import type { SceneEvent, Topology } from './contracts'
import { computeObservations } from './observationScope'
import { events, positions, topology } from './scenario'

function observationFor(observations: ReturnType<typeof computeObservations>, observer: string, truthRef: string) {
  return observations.find((o) => o.observer === observer && o.truthRef === truthRef)
}

describe('computeObservations', () => {
  const observations = computeObservations(events, topology, positions)

  it('produces exactly the observations the cellar scenario implies, and nothing else', () => {
    expect(observations).toHaveLength(5)
    expect(observations.map((o) => o.id).sort()).toEqual(
      ['O_NPC_A_T0', 'O_NPC_A_T1', 'O_NPC_C_T1', 'O_NPC_D_T0', 'O_NPC_D_T1'].sort(),
    )
  })

  it('NPC_A sees the player enter (full) but only hears the attack (partial)', () => {
    const seesEntry = observationFor(observations, 'NPC_A', 'T0')
    expect(seesEntry?.fidelity).toBe('full')
    expect(seesEntry?.channels).toEqual(['sight'])
    expect(seesEntry?.perceived).toEqual({ actor: 'player', action: 'entered', target: 'cellar', location: 'cellar' })
    expect(seesEntry?.missing).toEqual([])

    const hearsAttack = observationFor(observations, 'NPC_A', 'T1')
    expect(hearsAttack?.fidelity).toBe('partial')
    expect(hearsAttack?.channels).toEqual(['sound'])
    expect(hearsAttack?.perceived).toEqual({ sound_signature: 'scream', direction: 'cellar' })
    expect(hearsAttack?.missing).toEqual(['actor', 'action', 'target', 'location'])
  })

  it('NPC_B in the tavern perceives nothing from either event', () => {
    expect(observationFor(observations, 'NPC_B', 'T0')).toBeUndefined()
    expect(observationFor(observations, 'NPC_B', 'T1')).toBeUndefined()
  })

  it('NPC_C upstairs hears only a muffled scream from the attack, and nothing from the entry', () => {
    expect(observationFor(observations, 'NPC_C', 'T0')).toBeUndefined()

    const hearsAttack = observationFor(observations, 'NPC_C', 'T1')
    expect(hearsAttack?.fidelity).toBe('partial')
    expect(hearsAttack?.channels).toEqual(['sound'])
  })

  it('NPC_D inside the cellar directly sees both events in full', () => {
    const seesEntry = observationFor(observations, 'NPC_D', 'T0')
    expect(seesEntry?.fidelity).toBe('full')

    const seesAttack = observationFor(observations, 'NPC_D', 'T1')
    expect(seesAttack?.fidelity).toBe('full')
    expect(seesAttack?.channels).toEqual(['sight', 'sound'])
    expect(seesAttack?.perceived).toEqual({
      actor: 'zombie_17',
      action: 'attacked',
      target: 'guard_malik',
      location: 'cellar',
      sound_signature: 'scream',
      direction: 'cellar',
    })
  })

  it('never perceives a field the delivered channels did not expose (anti-leakage invariant)', () => {
    for (const observation of observations) {
      const event = events.find((e) => e.id === observation.truthRef)
      expect(event).toBeDefined()
      const exposedFields = new Set<string>(
        (event as SceneEvent).emissions
          .filter((emission) => observation.channels.includes(emission.channel))
          .flatMap((emission) => emission.exposes as readonly string[]),
      )
      for (const key of Object.keys(observation.perceived)) {
        expect(exposedFields.has(key)).toBe(true)
      }
    }
  })

  it('is deterministic and does not mutate its inputs', () => {
    const eventsSnapshot = structuredClone(events)
    const topologySnapshot = structuredClone(topology)
    const positionsSnapshot = structuredClone(positions)

    const first = computeObservations(events, topology, positions)
    const second = computeObservations(events, topology, positions)

    expect(first).toEqual(second)
    expect(events).toEqual(eventsSnapshot)
    expect(topology).toEqual(topologySnapshot)
    expect(positions).toEqual(positionsSnapshot)
  })
})

describe('computeObservations edge cases', () => {
  const twoNodeTopology: Topology = {
    nodes: ['a', 'b'],
    edges: [{ a: 'a', b: 'b', sight: 'blocked', sound: 'blocked' }],
  }

  const sightOnlyEvent: SceneEvent = {
    schemaVersion: 1,
    id: 'X1',
    actor: 'someone',
    action: 'did',
    target: 'something',
    location: { node: 'a' },
    time: 't0',
    emissions: [{ channel: 'sight', exposes: ['actor', 'action', 'target', 'location'] }],
  }

  it('defaults an unlisted node pair to fully blocked', () => {
    const isolatedTopology: Topology = { nodes: ['a', 'b', 'c'], edges: [] }
    const observations = computeObservations(
      [sightOnlyEvent],
      isolatedTopology,
      [{ npc: 'watcher', node: 'c' }],
    )
    expect(observations).toHaveLength(0)
  })

  it('grants full observation to a same-node observer even with no topology edge', () => {
    const observations = computeObservations([sightOnlyEvent], twoNodeTopology, [{ npc: 'watcher', node: 'a' }])
    expect(observations).toHaveLength(1)
    expect(observations[0]?.fidelity).toBe('full')
  })

  it('respects an explicitly blocked edge for a different-node observer', () => {
    const observations = computeObservations([sightOnlyEvent], twoNodeTopology, [{ npc: 'watcher', node: 'b' }])
    expect(observations).toHaveLength(0)
  })

  it('doorway_only sight delivers at the doorway but not the interior', () => {
    const doorwayTopology: Topology = {
      nodes: ['outside', 'inside'],
      edges: [{ a: 'outside', b: 'inside', sight: 'doorway_only', sound: 'blocked' }],
    }
    const atDoorway: SceneEvent = { ...sightOnlyEvent, location: { node: 'inside', area: 'doorway' } }
    const atInterior: SceneEvent = { ...sightOnlyEvent, location: { node: 'inside', area: 'interior' } }
    const watcher = [{ npc: 'watcher', node: 'outside' }]

    expect(computeObservations([atDoorway], doorwayTopology, watcher)).toHaveLength(1)
    expect(computeObservations([atInterior], doorwayTopology, watcher)).toHaveLength(0)
  })
})
