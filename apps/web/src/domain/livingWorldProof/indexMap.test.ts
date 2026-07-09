import { describe, expect, it } from 'vitest'
import { buildIndexMap, validateIndexMap } from './indexMap'
import { postEvidenceRecords, preEvidenceRecords } from './evidenceScenario'

describe('buildIndexMap', () => {
  it("builds exactly NPC_C's pre-evidence readable catalog", () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    expect(indexMap.map((e) => e.recordId).sort()).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'].sort())
    for (const entry of indexMap) {
      expect(entry.holder).toBe('NPC_C')
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('adds E_claw to the catalog once presented', () => {
    expect(buildIndexMap('NPC_C', postEvidenceRecords).map((e) => e.recordId)).toContain('E_claw')
  })

  it('descriptions are deterministic and regenerable', () => {
    expect(buildIndexMap('NPC_C', preEvidenceRecords)).toEqual(buildIndexMap('NPC_C', preEvidenceRecords))
  })
})

describe('validateIndexMap', () => {
  it('reports no issues for an uncorrupted index map', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    expect(validateIndexMap('NPC_C', indexMap, preEvidenceRecords)).toEqual([])
  })

  it('detects a corrupted description -- the lying card catalog', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    const corrupted = indexMap.map((entry) =>
      entry.recordId === 'R_B_to_C'
        ? { ...entry, description: "retelling received from NPC_A, night_3: fabricated" }
        : entry,
    )

    const issues = validateIndexMap('NPC_C', corrupted, preEvidenceRecords)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.recordId).toBe('R_B_to_C')
  })
})
