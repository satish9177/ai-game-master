import { describe, expect, it } from 'vitest'
import { beliefC1 } from './evidenceScenario'
import {
  buildInteriorDigest,
  checkDigestFreshness,
  entitledArcMemberIds,
  provenanceOracle,
  validateArcMembership,
  validateInteriorDigestCitations,
} from './hierarchy'
import { ArcRecordSchema } from './hierarchyContracts'
import {
  arcCellarPostEvidence,
  arcCellarPreEvidence,
  arcGate,
  arcPantry,
  observationC_T2,
  postEvidenceHierarchyRecords,
  preEvidenceHierarchyRecords,
} from './hierarchyScenario'

describe('ArcRecordSchema', () => {
  it('parses all real committed arcs', () => {
    for (const arc of [arcCellarPreEvidence, arcCellarPostEvidence, arcPantry, arcGate]) {
      expect(ArcRecordSchema.safeParse(arc).success).toBe(true)
    }
  })

  it('rejects an unknown proposedBy value', () => {
    const malformed = { ...arcPantry, proposedBy: 'narrator' }
    expect(ArcRecordSchema.safeParse(malformed).success).toBe(false)
  })

  it('rejects unknown extra fields (strict schema)', () => {
    const malformed = { ...arcPantry, hiddenField: 'nope' }
    expect(ArcRecordSchema.safeParse(malformed).success).toBe(false)
  })
})

describe('validateArcMembership', () => {
  it('reports no issues for the real committed arcs', () => {
    expect(validateArcMembership(arcCellarPreEvidence, preEvidenceHierarchyRecords)).toEqual([])
    expect(validateArcMembership(arcCellarPostEvidence, postEvidenceHierarchyRecords)).toEqual([])
    expect(validateArcMembership(arcPantry, preEvidenceHierarchyRecords)).toEqual([])
    expect(validateArcMembership(arcGate, preEvidenceHierarchyRecords)).toEqual([])
  })

  it('F1 -- rejects a pantry-incident record proposed as a cellar-arc member (time-out-of-span)', () => {
    const misrouted = { ...arcCellarPreEvidence, memberIds: [...arcCellarPreEvidence.memberIds, observationC_T2.id] }
    const issues = validateArcMembership(misrouted, preEvidenceHierarchyRecords)
    expect(issues).toContainEqual({ arcId: 'arc_cellar', recordId: 'O_NPC_C_T2', reason: 'time-out-of-span' })
  })

  it('rejects a TruthEvent proposed as a member -- structurally forbidden', () => {
    const withTruth = { ...arcCellarPreEvidence, memberIds: [...arcCellarPreEvidence.memberIds, 'T1'] }
    const issues = validateArcMembership(withTruth, preEvidenceHierarchyRecords)
    expect(issues).toContainEqual({ arcId: 'arc_cellar', recordId: 'T1', reason: 'truth-event-forbidden' })
  })

  it('rejects an unknown record id', () => {
    const bogus = { ...arcCellarPreEvidence, memberIds: [...arcCellarPreEvidence.memberIds, 'NOT_A_RECORD'] }
    const issues = validateArcMembership(bogus, preEvidenceHierarchyRecords)
    expect(issues).toContainEqual({ arcId: 'arc_cellar', recordId: 'NOT_A_RECORD', reason: 'unknown-record' })
  })
})

describe('entitledArcMemberIds', () => {
  it("NPC_C is entitled under arc_cellar and arc_pantry, never arc_gate", () => {
    expect(entitledArcMemberIds('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords).sort()).toEqual(
      ['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'].sort(),
    )
    expect(entitledArcMemberIds('NPC_C', arcPantry, preEvidenceHierarchyRecords).sort()).toEqual(['Bel_C2', 'O_NPC_C_T2'].sort())
    expect(entitledArcMemberIds('NPC_C', arcGate, preEvidenceHierarchyRecords)).toEqual([])
  })

  it("NPC_D is entitled under arc_cellar and arc_gate, never arc_pantry", () => {
    expect(entitledArcMemberIds('NPC_D', arcCellarPreEvidence, preEvidenceHierarchyRecords).sort()).toEqual(
      ['Bel_D1', 'O_NPC_D_T0', 'O_NPC_D_T1'].sort(),
    )
    expect(entitledArcMemberIds('NPC_D', arcGate, preEvidenceHierarchyRecords)).toEqual(['O_NPC_D_T3'])
    expect(entitledArcMemberIds('NPC_D', arcPantry, preEvidenceHierarchyRecords)).toEqual([])
  })

  it('post-evidence: E_claw joins arc_cellar for NPC_C only', () => {
    expect(entitledArcMemberIds('NPC_C', arcCellarPostEvidence, postEvidenceHierarchyRecords).sort()).toEqual(
      ['Bel_C1', 'E_claw', 'O_NPC_C_T1', 'R_B_to_C'].sort(),
    )
    expect(entitledArcMemberIds('NPC_D', arcCellarPostEvidence, postEvidenceHierarchyRecords)).not.toContain('E_claw')
  })
})

describe('buildInteriorDigest / checkDigestFreshness', () => {
  it('F2 -- a digest built pre-evidence is stale post-evidence, missing exactly E_claw', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    expect(digest.asOf).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'])

    const freshBeforeChange = checkDigestFreshness(digest, arcCellarPreEvidence, preEvidenceHierarchyRecords)
    expect(freshBeforeChange).toEqual({ stale: false, missingFromDigest: [], removedFromScope: [] })

    const freshnessAfterEvidence = checkDigestFreshness(digest, arcCellarPostEvidence, postEvidenceHierarchyRecords)
    expect(freshnessAfterEvidence.stale).toBe(true)
    expect(freshnessAfterEvidence.missingFromDigest).toEqual(['E_claw'])
    expect(freshnessAfterEvidence.removedFromScope).toEqual([])
  })

  it('a regenerated digest is fresh again', () => {
    const regenerated = buildInteriorDigest('NPC_C', arcCellarPostEvidence, postEvidenceHierarchyRecords)
    expect(checkDigestFreshness(regenerated, arcCellarPostEvidence, postEvidenceHierarchyRecords).stale).toBe(false)
  })

  it('every clause is auto-cited to exactly one record, and every citation is covered by asOf', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    for (const clause of digest.clauses) {
      expect(clause.citations).toHaveLength(1)
      expect(digest.asOf).toContain(clause.citations[0])
    }
  })
})

describe('validateInteriorDigestCitations', () => {
  it('reports no issues for an uncorrupted digest', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    expect(validateInteriorDigestCitations(digest, digest.asOf)).toEqual([])
  })

  it('F5 -- rejects a path-shaped citation as malformed, because it is simply not a real id', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    const corrupted = {
      ...digest,
      clauses: [...digest.clauses, { text: 'planted', citations: ['root/arc_cellar/E_claw'] }],
    }
    const issues = validateInteriorDigestCitations(corrupted, digest.asOf)
    expect(issues).toContainEqual({ clauseIndex: 3, reason: 'citation-unknown', citation: 'root/arc_cellar/E_claw' })
  })

  it('rejects an uncited clause -- a factual claim with no grounded backing', () => {
    const digest = buildInteriorDigest('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    const corrupted = { ...digest, clauses: [...digest.clauses, { text: 'the guard is dead', citations: [] }] }
    expect(validateInteriorDigestCitations(corrupted, digest.asOf)).toContainEqual({ clauseIndex: 3, reason: 'uncited-clause' })
  })
})

describe('provenanceOracle', () => {
  it("is exactly the one-hop rumor chain NPC_C would cite when explaining Bel_C1 specifically (precision = recall = 1.0 against that claim)", () => {
    const oracle = provenanceOracle('NPC_C', beliefC1, preEvidenceHierarchyRecords)
    expect(oracle).toEqual(['Bel_C1', 'R_B_to_C'])
  })

  it("is a sound subset of NPC_C's broader arc_cellar entitlement -- narrower than the topic-level set on purpose, since O_NPC_C_T1 grounds no part of Bel_C1's chain", () => {
    const oracle = provenanceOracle('NPC_C', beliefC1, preEvidenceHierarchyRecords)
    const topicLevelSet = entitledArcMemberIds('NPC_C', arcCellarPreEvidence, preEvidenceHierarchyRecords)
    expect(oracle.every((id) => topicLevelSet.includes(id))).toBe(true)
    expect(oracle).not.toContain('O_NPC_C_T1')
  })

  it('never includes a record outside the holder-readable set', () => {
    const oracle = provenanceOracle('NPC_C', beliefC1, preEvidenceHierarchyRecords)
    expect(oracle).not.toContain('T1')
    expect(oracle).not.toContain('R_A_to_B')
  })
})
