import { describe, expect, it } from 'vitest'
import { beliefFromRumor } from './beliefUpdate'
import { buildDigest, renderExplanation, validateDigestCitations } from './digest'
import { readable, readEvidence } from './evidenceRecords'
import { beliefC1, postEvidenceRecords, preEvidenceRecords } from './evidenceScenario'
import { buildIndexMap } from './indexMap'
import { clawEvidence, rumorBToC } from './scenario'

/**
 * The fused bounded-evidence-recovery pass: NPC_C answers "why do you
 * believe the player attacked the guard?" from a bounded, cited digest and
 * permission-checked ReadEvidence, before and after E_claw is presented.
 * Builds directly on the already-proven observation-scope + belief-update
 * pipeline (evidenceScenario.ts). No LLM anywhere in this file.
 */
describe('bounded evidence recovery -- NPC_C challenge', () => {
  it('pre-evidence: answers only from what she perceived and was told, naming no actor', () => {
    const npcCReadableIds = readable('NPC_C', preEvidenceRecords)
      .map((entry) => entry.record.id)
      .sort()
    expect(npcCReadableIds).toEqual(['Bel_C1', 'O_NPC_C_T1', 'R_B_to_C'].sort())

    const digest = buildDigest('NPC_C', buildIndexMap('NPC_C', preEvidenceRecords))
    expect(validateDigestCitations(digest, preEvidenceRecords)).toEqual([])

    const explanation = renderExplanation(digest)
    expect(explanation).not.toContain('zombie_17')
    expect(explanation).toContain(rumorBToC.proposition)
  })

  it('the pre-evidence challenge dereferences R_B_to_C to justify the accusation, and the read is logged', () => {
    const outcome = readEvidence('NPC_C', rumorBToC.id, preEvidenceRecords)
    expect(outcome.verdict).toBe('granted')
    if (outcome.verdict !== 'granted') throw new Error('unreachable')
    expect(outcome.record.record).toEqual(rumorBToC)
    expect(outcome.call).toEqual({ reader: 'NPC_C', recordId: 'R_B_to_C', verdict: 'granted' })
  })

  it('the pre-evidence challenge cannot dereference T1 to fill in the missing actor', () => {
    const outcome = readEvidence('NPC_C', 'T1', preEvidenceRecords)
    expect(outcome.verdict).toBe('denied')
    expect(outcome.call).toEqual({ reader: 'NPC_C', recordId: 'T1', verdict: 'denied' })
  })

  it('post-evidence: E_claw becomes readable, and the corrected explanation cites it', () => {
    const readOutcome = readEvidence('NPC_C', clawEvidence.id, postEvidenceRecords)
    expect(readOutcome.verdict).toBe('granted')
    if (readOutcome.verdict !== 'granted') throw new Error('unreachable')
    expect(readOutcome.record.record).toEqual(clawEvidence)

    const digest = buildDigest('NPC_C', buildIndexMap('NPC_C', postEvidenceRecords))
    expect(validateDigestCitations(digest, postEvidenceRecords)).toEqual([])

    const explanation = renderExplanation(digest)
    expect(explanation).toContain('zombie_17')
    expect(digest.clauses.some((clause) => clause.citations.includes('E_claw'))).toBe(true)
  })

  it('anti-time-travel: re-reading R_B_to_C after correction does not resurrect the old belief', () => {
    const preOutcome = readEvidence('NPC_C', rumorBToC.id, preEvidenceRecords)
    const postOutcome = readEvidence('NPC_C', rumorBToC.id, postEvidenceRecords)

    expect(preOutcome.verdict).toBe('granted')
    expect(postOutcome.verdict).toBe('granted')
    if (preOutcome.verdict !== 'granted' || postOutcome.verdict !== 'granted') throw new Error('unreachable')

    // The record itself is unchanged by the reread...
    expect(postOutcome.record.record).toEqual(preOutcome.record.record)

    // ...and re-deriving a belief from it again is idempotent: still the
    // same low-confidence, still-false proposition -- rereading never
    // upgrades confidence or overrides the correction already on record.
    const rereadBelief = beliefFromRumor(rumorBToC, 'Bel_C1')
    expect(rereadBelief).toEqual(beliefC1)
    expect(rereadBelief.confidence).toBe('low')
  })
})
