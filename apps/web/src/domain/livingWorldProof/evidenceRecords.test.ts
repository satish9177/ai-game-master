import { describe, expect, it } from 'vitest'
import { readable, readEvidence } from './evidenceRecords'
import { beliefA1, beliefD1, observations, postEvidenceRecords, preEvidenceRecords } from './evidenceScenario'
import { clawEvidence, rumorAToB, rumorBToC } from './scenario'

function ids(records: ReturnType<typeof readable>): string[] {
  return records.map((entry) => entry.record.id).sort()
}

describe('readable', () => {
  it("NPC_C's pre-evidence readable set is exactly O_NPC_C_T1, R_B_to_C, Bel_C1", () => {
    expect(ids(readable('NPC_C', preEvidenceRecords))).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'].sort())
  })

  it("NPC_C's post-evidence readable set adds exactly E_claw", () => {
    expect(ids(readable('NPC_C', postEvidenceRecords))).toEqual(['Bel_C1', 'E_claw', 'O_NPC_C_T1', 'R_B_to_C'].sort())
  })

  it('never includes a TruthEvent in any readable set', () => {
    for (const npc of ['NPC_A', 'NPC_B', 'NPC_C', 'NPC_D']) {
      const kinds = readable(npc, postEvidenceRecords).map((entry) => entry.kind)
      expect(kinds).not.toContain('truth')
    }
  })

  it("excludes other NPCs' observations and beliefs from NPC_C's readable set", () => {
    const readableIds = new Set(ids(readable('NPC_C', postEvidenceRecords)))
    const npcDT1Observation = observations.find((o) => o.observer === 'NPC_D' && o.truthRef === 'T1')!
    expect(readableIds.has(beliefA1.id)).toBe(false)
    expect(readableIds.has(beliefD1.id)).toBe(false)
    expect(readableIds.has(npcDT1Observation.id)).toBe(false)
  })

  it("excludes R_A_to_B from NPC_C's readable set (not addressed to her)", () => {
    expect(readable('NPC_C', postEvidenceRecords).some((entry) => entry.record.id === rumorAToB.id)).toBe(false)
  })

  it('is deterministic and does not mutate its inputs', () => {
    const snapshot = structuredClone(postEvidenceRecords)
    expect(readable('NPC_C', postEvidenceRecords)).toEqual(readable('NPC_C', postEvidenceRecords))
    expect(postEvidenceRecords).toEqual(snapshot)
  })
})

describe('readEvidence', () => {
  it('grants a read within scope and returns the exact record byte-identically', () => {
    const outcome = readEvidence('NPC_C', rumorBToC.id, preEvidenceRecords)
    expect(outcome.verdict).toBe('granted')
    if (outcome.verdict !== 'granted') throw new Error('unreachable')
    expect(outcome.record.record).toEqual(rumorBToC)
    expect(outcome.call).toEqual({ reader: 'NPC_C', recordId: 'R_B_to_C', verdict: 'granted' })
  })

  it('a granted read returns a copy, not an alias, of the stored record', () => {
    const outcome = readEvidence('NPC_C', rumorBToC.id, preEvidenceRecords)
    if (outcome.verdict !== 'granted') throw new Error('unreachable')
    expect(outcome.record.record).not.toBe(rumorBToC)
  })

  it('denies and logs a read of a TruthEvent', () => {
    const outcome = readEvidence('NPC_C', 'T1', preEvidenceRecords)
    expect(outcome.verdict).toBe('denied')
    expect(outcome.call).toEqual({ reader: 'NPC_C', recordId: 'T1', verdict: 'denied' })
  })

  it("denies and logs a read of another NPC's observation", () => {
    const npcDT1Observation = observations.find((o) => o.observer === 'NPC_D' && o.truthRef === 'T1')!
    const outcome = readEvidence('NPC_C', npcDT1Observation.id, preEvidenceRecords)
    expect(outcome.verdict).toBe('denied')
    expect(outcome.call.verdict).toBe('denied')
  })

  it("denies and logs a read of another NPC's belief", () => {
    const outcome = readEvidence('NPC_C', beliefA1.id, preEvidenceRecords)
    expect(outcome.verdict).toBe('denied')
  })

  it('denies a read of R_A_to_B (addressed to NPC_B, not NPC_C)', () => {
    expect(readEvidence('NPC_C', rumorAToB.id, preEvidenceRecords).verdict).toBe('denied')
  })

  it('denies E_claw before it has been presented (not yet in the record universe)', () => {
    expect(readEvidence('NPC_C', clawEvidence.id, preEvidenceRecords).verdict).toBe('denied')
  })

  it('grants E_claw once presented, byte-identically', () => {
    const outcome = readEvidence('NPC_C', clawEvidence.id, postEvidenceRecords)
    expect(outcome.verdict).toBe('granted')
    if (outcome.verdict !== 'granted') throw new Error('unreachable')
    expect(outcome.record.record).toEqual(clawEvidence)
  })

  it('blocks a planted out-of-scope record id regardless of what an index map might claim -- the gate, not the map, is the boundary', () => {
    expect(readEvidence('NPC_C', 'T1', preEvidenceRecords).verdict).toBe('denied')
  })
})
