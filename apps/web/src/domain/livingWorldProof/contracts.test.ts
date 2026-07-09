import { describe, expect, it } from 'vitest'
import { EmissionSchema, EvidenceSchema, ObservationSchema, SceneEventSchema, TopologySchema } from './contracts'
import { events, topology } from './scenario'

describe('SceneEventSchema', () => {
  it('parses the scenario fixture events', () => {
    for (const event of events) {
      expect(SceneEventSchema.safeParse(event).success).toBe(true)
    }
  })

  it('rejects an emission exposing an undeclared field', () => {
    const malformed = {
      ...events[1],
      emissions: [{ channel: 'sight', exposes: ['actor', 'action', 'target', 'location', 'weapon'] }],
    }
    expect(SceneEventSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects an unknown location area', () => {
    const malformed = { ...events[0], location: { node: 'cellar', area: 'balcony' } }
    expect(SceneEventSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects an event with no emissions', () => {
    const malformed = { ...events[0], emissions: [] }
    expect(SceneEventSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects unknown extra fields (strict schema)', () => {
    const malformed = { ...events[0], hiddenField: 'should not parse' }
    expect(SceneEventSchema.safeParse(malformed).success).toBe(false)
  })
})

describe('EmissionSchema', () => {
  it('requires signature and loudness on a sound emission', () => {
    const malformed = { channel: 'sound', exposes: ['sound_signature', 'direction'] }
    expect(EmissionSchema.safeParse(malformed).success).toBe(false)
  })
})

describe('TopologySchema', () => {
  it('parses the scenario fixture topology', () => {
    expect(TopologySchema.safeParse(topology).success).toBe(true)
  })
})

describe('ObservationSchema', () => {
  it('rejects a fidelity value outside full/partial', () => {
    const malformed = {
      schemaVersion: 1,
      id: 'O_NPC_A_T0',
      observer: 'NPC_A',
      truthRef: 'T0',
      channels: ['sight'],
      perceived: { actor: 'player' },
      missing: [],
      fidelity: 'none',
      time: 'night_3',
    }
    expect(ObservationSchema.safeParse(malformed).success).toBe(false)
  })
})

describe('EvidenceSchema', () => {
  it('rejects a strength value outside soft/hard', () => {
    const malformed = {
      schemaVersion: 1,
      id: 'E_x',
      truthRef: 'T1',
      implies: 'a',
      contradicts: 'b',
      strength: 'overwhelming',
      presentedTo: 'NPC_C',
      time: 'night_4',
    }
    expect(EvidenceSchema.safeParse(malformed).success).toBe(false)
  })
})
