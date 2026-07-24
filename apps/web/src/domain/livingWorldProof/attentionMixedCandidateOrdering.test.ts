import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_PROOF_SCORE,
  ATTENTION_CANDIDATE_ORDERING_KEYS,
  orderAttentionCandidates,
  resolveAttentionCandidateOrderingKey,
} from './attentionCandidateOrdering'
import { applyMixedFamilyCandidateCap } from './attentionNarrativePatternResourcePolicy'
import type {
  AttentionCandidate,
  AttentionPatternCandidate,
  AttentionQuestCandidate,
} from './attentionCandidate'

/**
 * Stage B / B4 — the complete nine-key two-family total order (RN019 §9.2; plan
 * §7). Every key is forced independently: each pair ties on every earlier key
 * and differs only at the key under test, so the acceptance suite proves the
 * comparator consults that key and that no unique identifier masks a prior one.
 * Candidates are built directly from the exported union types because the caps
 * this order feeds are proven separately in the resource-policy suite.
 */

function quest(fields: {
  readonly sourceId: string
  readonly candidateId: string
  readonly openingProvenanceId: string
  readonly openedAtLsn?: number
  readonly eligibility?: 'eligible' | 'ineligible'
}): AttentionQuestCandidate {
  return Object.freeze({
    sourceKind: 'quest_candidate',
    sourceAuthority: 'authoritative',
    sourceId: fields.sourceId,
    candidateId: fields.candidateId,
    eligibility: fields.eligibility ?? 'eligible',
    accessorContractVersion: 'attention-quest-candidate-accessor-v1',
    canonicalizationVersion: 'attention-candidate-canonicalization-v1',
    identitySchemaVersion: 'attention-candidate-identity-schema-v1',
    rankingSnapshotLsn: 41,
    legallyVisibleParties: Object.freeze(['player']),
    openingProvenanceId: fields.openingProvenanceId,
    openedAtLsn: fields.openedAtLsn ?? 30,
  })
}

function pattern(fields: {
  readonly sourceId: string
  readonly candidateId: string
  readonly patternSemanticVersion?: number
  readonly binding?: readonly (readonly [string, string])[]
  readonly support?: readonly (readonly [string, string, string, string, number])[]
  readonly lastProgressLsn?: number
  readonly eligibility?: 'eligible' | 'ineligible'
}): AttentionPatternCandidate {
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance',
    sourceAuthority: 'derived',
    sourceId: fields.sourceId,
    candidateId: fields.candidateId,
    eligibility: fields.eligibility ?? 'eligible',
    accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
    canonicalizationVersion: 'attention-candidate-canonicalization-v1',
    identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
    rankingSnapshotLsn: 41,
    legallyVisibleParties: Object.freeze(['ally-a', 'ally-b']),
    patternType: 'reciprocal_public_aid',
    patternSemanticVersion: fields.patternSemanticVersion ?? 1,
    canonicalBindingTuple: Object.freeze(
      (fields.binding ?? [['initiator', 'ally-a'], ['counterparty', 'ally-b']]).map((entry) => Object.freeze(entry)),
    ),
    canonicalSupportingRecordIdentityTuple: Object.freeze(
      (fields.support ?? [['aid-start', 'observable_action', 'rec-1', 'prov-1', 10]]).map((entry) => Object.freeze(entry)),
    ),
    lastProgressLsn: fields.lastProgressLsn ?? 12,
  })
}

function orderedIds(candidates: readonly AttentionCandidate[]): readonly string[] {
  const result = orderAttentionCandidates(candidates)
  if (result.kind !== 'ok') throw new Error(`expected a total order, got: ${result.reason}`)
  return result.orderedCandidates.map((candidate) => candidate.candidateId)
}

describe('B4 — the nine-key tuple is declared complete and in sequence', () => {
  it('declares the exact nine keys', () => {
    expect(ATTENTION_CANDIDATE_ORDERING_KEYS).toEqual([
      'eligibility',
      'proof-score',
      'source-kind',
      'semantic-version',
      'canonical-binding-tuple',
      'canonical-supporting-record-identity-tuple',
      'source-committed-lsn',
      'source-id',
      'candidate-id',
    ])
  })
})

describe('B4 — every ordering key is forced independently', () => {
  it('key 1 — eligibility: eligible before ineligible', () => {
    const eligible = quest({ sourceId: 's', candidateId: 'c-1', openingProvenanceId: 'p', eligibility: 'eligible' })
    const ineligible = quest({ sourceId: 's', candidateId: 'c-1', openingProvenanceId: 'p', eligibility: 'ineligible' })
    expect(resolveAttentionCandidateOrderingKey(eligible, ineligible)).toBe('eligibility')
    expect(orderedIds([ineligible, eligible])).toEqual(['c-1', 'c-1'])
    const first = orderAttentionCandidates([ineligible, eligible])
    if (first.kind !== 'ok') throw new Error('expected order')
    expect(first.orderedCandidates[0]?.eligibility).toBe('eligible')
  })

  it('key 2 — proof score is fixed to 0 and never decides', () => {
    expect(ATTENTION_CANDIDATE_PROOF_SCORE).toBe(0)
    const left = quest({ sourceId: 'a', candidateId: 'c-a', openingProvenanceId: 'p', openedAtLsn: 30 })
    const right = quest({ sourceId: 'b', candidateId: 'c-b', openingProvenanceId: 'p', openedAtLsn: 30 })
    // With everything else forced to differ only later, the decider is never the
    // fixed-zero proof score.
    expect(resolveAttentionCandidateOrderingKey(left, right)).not.toBe('proof-score')
  })

  it('key 3 — source kind: quest_candidate before narrative_pattern_instance', () => {
    const q = quest({ sourceId: 'q', candidateId: 'c-q', openingProvenanceId: 'p' })
    const p = pattern({ sourceId: 'p', candidateId: 'c-p' })
    expect(resolveAttentionCandidateOrderingKey(q, p)).toBe('source-kind')
    expect(orderAttentionCandidates([p, q]).kind).toBe('ok')
    const result = orderAttentionCandidates([p, q])
    if (result.kind !== 'ok') throw new Error('expected order')
    expect(result.orderedCandidates.map((c) => c.sourceKind))
      .toEqual(['quest_candidate', 'narrative_pattern_instance'])
  })

  it('key 4 — semantic version (patterns only; quest uses a fixed sentinel)', () => {
    const v1 = pattern({ sourceId: 'p1', candidateId: 'c-1', patternSemanticVersion: 1 })
    const v2 = pattern({ sourceId: 'p2', candidateId: 'c-2', patternSemanticVersion: 2 })
    expect(resolveAttentionCandidateOrderingKey(v1, v2)).toBe('semantic-version')
    expect(orderedIds([v2, v1])).toEqual(['c-1', 'c-2'])
  })

  it('key 5 — canonical binding tuple', () => {
    const a = pattern({ sourceId: 'p1', candidateId: 'c-1', binding: [['initiator', 'ally-a'], ['counterparty', 'ally-b']] })
    const b = pattern({ sourceId: 'p2', candidateId: 'c-2', binding: [['initiator', 'ally-a'], ['counterparty', 'ally-c']] })
    expect(resolveAttentionCandidateOrderingKey(a, b)).toBe('canonical-binding-tuple')
    expect(orderedIds([b, a])).toEqual(['c-1', 'c-2'])
  })

  it('key 6 — canonical supporting-record identity tuple', () => {
    const a = pattern({ sourceId: 'p1', candidateId: 'c-1', support: [['aid-start', 'observable_action', 'rec-1', 'prov-1', 10]] })
    const b = pattern({ sourceId: 'p2', candidateId: 'c-2', support: [['aid-start', 'observable_action', 'rec-2', 'prov-2', 10]] })
    expect(resolveAttentionCandidateOrderingKey(a, b)).toBe('canonical-supporting-record-identity-tuple')
    expect(orderedIds([b, a])).toEqual(['c-1', 'c-2'])
  })

  it('key 7 — source committed LSN: patterns compare lastProgressLsn numerically', () => {
    const earlier = pattern({ sourceId: 'p1', candidateId: 'c-1', lastProgressLsn: 9 })
    const later = pattern({ sourceId: 'p2', candidateId: 'c-2', lastProgressLsn: 20 })
    expect(resolveAttentionCandidateOrderingKey(earlier, later)).toBe('source-committed-lsn')
    // 9 < 20 numerically (not lexicographically, which would order "20" before "9").
    expect(orderedIds([later, earlier])).toEqual(['c-1', 'c-2'])
  })

  it('key 7 — source committed LSN: quests compare the numeric openedAtLsn', () => {
    const earlier = quest({
      sourceId: 's1', candidateId: 'c-1', openingProvenanceId: 'consequence-public-a', openedAtLsn: 9,
    })
    const later = quest({
      sourceId: 's2', candidateId: 'c-2', openingProvenanceId: 'consequence-public-b', openedAtLsn: 20,
    })
    expect(resolveAttentionCandidateOrderingKey(earlier, later)).toBe('source-committed-lsn')
    // 9 < 20 numerically, not lexicographically — "20" sorts before "9" as text.
    expect(orderedIds([later, earlier])).toEqual(['c-1', 'c-2'])
  })

  it('key 8 — source id, using two quests with an identical numeric opening coordinate', () => {
    const a = quest({
      sourceId: 'quest-a', candidateId: 'c-1', openingProvenanceId: 'consequence-public-alpha', openedAtLsn: 30,
    })
    const b = quest({
      sourceId: 'quest-b', candidateId: 'c-2', openingProvenanceId: 'consequence-public-beta', openedAtLsn: 30,
    })
    // Key 7 ties on the *equal numeric coordinate*, so source-id is the first
    // key that can decide — the provenance strings differ and are irrelevant.
    expect(resolveAttentionCandidateOrderingKey(a, b)).toBe('source-id')
    expect(orderedIds([b, a])).toEqual(['c-1', 'c-2'])
  })

  it('key 9 — candidate id is the final total-order guard when every prior key ties', () => {
    const a = quest({
      sourceId: 'quest-shared',
      candidateId: 'candidate-a',
      openingProvenanceId: 'consequence-public-shared',
      openedAtLsn: 30,
    })
    const b = quest({
      sourceId: 'quest-shared',
      candidateId: 'candidate-b',
      openingProvenanceId: 'consequence-public-shared',
      openedAtLsn: 30,
    })
    expect(resolveAttentionCandidateOrderingKey(a, b)).toBe('candidate-id')
    expect(orderedIds([b, a])).toEqual(['candidate-a', 'candidate-b'])
  })
})

/**
 * RN019 §9.2's **adversarial provenance fixture** — the standing regression
 * guard for the forbidden key-7 list. Each pair's opaque `openingProvenanceId`
 * strings sort in the exact *inverse* of their numeric `openedAtLsn` order, so
 * any implementation that compares provenance text — by UTF-16 code unit, by
 * parsing a number out of it, or by any other textual route — produces the
 * reversed sequence and fails.
 */
describe('B4 / RN019 §9.2 — numeric key 7 beats reverse-ordered provenance text', () => {
  const ADVERSARIAL_PAIRS: readonly (readonly [string, AttentionQuestCandidate, AttentionQuestCandidate])[] = [
    [
      'unrelated opaque prefixes whose lexical order contradicts the numeric LSN',
      quest({
        sourceId: 'quest-opaque-earlier',
        candidateId: 'c-opaque-earlier',
        // Lexically LAST, numerically FIRST.
        openingProvenanceId: 'z-opaque-opening-token',
        openedAtLsn: 20,
      }),
      quest({
        sourceId: 'quest-opaque-later',
        candidateId: 'c-opaque-later',
        // Lexically FIRST, numerically LAST.
        openingProvenanceId: 'a-opaque-opening-token',
        openedAtLsn: 100,
      }),
    ],
    [
      'a …-100 / …-20 pair whose lexicographic order inverts their numeric order',
      quest({
        sourceId: 'quest-suffix-earlier',
        candidateId: 'c-suffix-earlier',
        // 'consequence-public-20' sorts AFTER 'consequence-public-100' by code
        // unit, because '2' > '1' — while 20 is numerically before 100.
        openingProvenanceId: 'consequence-public-20',
        openedAtLsn: 20,
      }),
      quest({
        sourceId: 'quest-suffix-later',
        candidateId: 'c-suffix-later',
        openingProvenanceId: 'consequence-public-100',
        openedAtLsn: 100,
      }),
    ],
  ]

  it.each(ADVERSARIAL_PAIRS)('orders by numeric LSN, not provenance text: %s', (_label, earlierLsn, laterLsn) => {
    // Sanity: the fixture really is adversarial — provenance text sorts the
    // opposite way from the numeric coordinate.
    expect(earlierLsn.openedAtLsn).toBeLessThan(laterLsn.openedAtLsn)
    expect(earlierLsn.openingProvenanceId > laterLsn.openingProvenanceId).toBe(true)

    expect(resolveAttentionCandidateOrderingKey(earlierLsn, laterLsn)).toBe('source-committed-lsn')
    // Authored order and reversed input both produce the identical sequence.
    expect(orderedIds([earlierLsn, laterLsn])).toEqual([earlierLsn.candidateId, laterLsn.candidateId])
    expect(orderedIds([laterLsn, earlierLsn])).toEqual([earlierLsn.candidateId, laterLsn.candidateId])
  })

  it('records the numeric coordinate — never provenance text — as the deciding key-7 value', () => {
    const [, earlierLsn, laterLsn] = ADVERSARIAL_PAIRS[0]!
    const result = orderAttentionCandidates([laterLsn, earlierLsn])
    if (result.kind !== 'ok') throw new Error('expected a total order')

    const [comparison] = result.comparisons
    if (comparison === undefined) throw new Error('expected one adjacent comparison')
    expect(comparison.decidingKey).toBe('source-committed-lsn')
    expect([comparison.leftValue, comparison.rightValue]).toEqual(['20', '100'])
    expect(comparison.leftValue).not.toContain('opaque')
    expect(comparison.rightValue).not.toContain('opaque')
  })
})

describe('B4 — mixed-family ordering, reversed input, and the post-order cap', () => {
  const questFirst = quest({
    sourceId: 'q1', candidateId: 'c-q1', openingProvenanceId: 'consequence-public-10', openedAtLsn: 10,
  })
  const questSecond = quest({
    sourceId: 'q2', candidateId: 'c-q2', openingProvenanceId: 'consequence-public-20', openedAtLsn: 20,
  })
  const patternA = pattern({ sourceId: 'pa', candidateId: 'c-pa', lastProgressLsn: 5 })
  const patternB = pattern({ sourceId: 'pb', candidateId: 'c-pb', lastProgressLsn: 8 })
  const patternC = pattern({ sourceId: 'pc', candidateId: 'c-pc', lastProgressLsn: 8, binding: [['initiator', 'ally-a'], ['counterparty', 'ally-z']] })
  const all = [questFirst, questSecond, patternA, patternB, patternC]

  it('orders quests before patterns and is independent of insertion order', () => {
    const forward = orderedIds(all)
    const reversed = orderedIds([...all].reverse())
    expect(forward).toEqual(reversed)
    // Both quests (source-kind rank 0) precede all three patterns (rank 1).
    expect(forward.slice(0, 2)).toEqual(['c-q1', 'c-q2'])
    expect(forward.slice(2).sort()).toEqual(['c-pa', 'c-pb', 'c-pc'])
  })

  it('applies the mixed-family candidate cap of 4 after the complete order', () => {
    const result = orderAttentionCandidates(all)
    if (result.kind !== 'ok') throw new Error('expected order')
    const capped = applyMixedFamilyCandidateCap(result.orderedCandidates)
    expect(capped.retainedCandidates).toHaveLength(4)
    expect(capped.resourceTrace?.boundId).toBe('mixed-family-candidate')
    expect(capped.resourceTrace?.observedValue).toBe(5)
    // The dropped candidate is the last in final order, never a pre-order truncation.
    expect(capped.resourceTrace?.droppedIdentities)
      .toEqual([result.orderedCandidates[4]!.candidateId])
  })

  it('produces byte-identical order across repeated runs', () => {
    const forms = new Set<string>()
    for (let run = 0; run < 4; run += 1) forms.add(canonicalSerialize(orderedIds(all)))
    expect(forms.size).toBe(1)
  })
})
