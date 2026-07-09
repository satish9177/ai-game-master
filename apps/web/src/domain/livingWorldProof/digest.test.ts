import { describe, expect, it } from 'vitest'
import { buildDigest, renderExplanation, validateDigestCitations } from './digest'
import { buildIndexMap } from './indexMap'
import { postEvidenceRecords, preEvidenceRecords } from './evidenceScenario'

describe('buildDigest', () => {
  it('produces one clause per index-map entry, each self-cited', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    const digest = buildDigest('NPC_C', indexMap)
    expect(digest.clauses).toHaveLength(indexMap.length)
    for (const clause of digest.clauses) {
      expect(clause.citations).toHaveLength(1)
    }
  })
})

describe('validateDigestCitations', () => {
  it('passes a digest built directly from a valid index map', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    const digest = buildDigest('NPC_C', indexMap)
    expect(validateDigestCitations(digest, preEvidenceRecords)).toEqual([])
  })

  it('rejects an uncited factual clause smuggled into the digest', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    const digest = buildDigest('NPC_C', indexMap)
    const corrupted = { ...digest, clauses: [...digest.clauses, { text: 'the guard is dead', citations: [] }] }

    const issues = validateDigestCitations(corrupted, preEvidenceRecords)
    expect(issues).toContainEqual({ clauseIndex: digest.clauses.length, reason: 'uncited-clause' })
  })

  it('rejects a citation pointing outside the readable scope', () => {
    const indexMap = buildIndexMap('NPC_C', preEvidenceRecords)
    const digest = buildDigest('NPC_C', indexMap)
    const corrupted = { ...digest, clauses: [...digest.clauses, { text: 'planted claim', citations: ['T1'] }] }

    const issues = validateDigestCitations(corrupted, preEvidenceRecords)
    expect(issues).toContainEqual({ clauseIndex: digest.clauses.length, reason: 'citation-out-of-scope', recordId: 'T1' })
  })
})

describe('renderExplanation', () => {
  it("NPC_C's pre-evidence explanation never mentions zombie_17", () => {
    const digest = buildDigest('NPC_C', buildIndexMap('NPC_C', preEvidenceRecords))
    expect(renderExplanation(digest)).not.toContain('zombie_17')
  })

  it("NPC_C's post-evidence explanation cites the correction", () => {
    const digest = buildDigest('NPC_C', buildIndexMap('NPC_C', postEvidenceRecords))
    const explanation = renderExplanation(digest)
    expect(explanation).toContain('zombie_17')
    expect(digest.clauses.some((c) => c.citations.includes('E_claw'))).toBe(true)
  })
})
