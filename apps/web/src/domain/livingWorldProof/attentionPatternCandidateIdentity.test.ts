import { describe, expect, it } from 'vitest'
import {
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_INPUT_KEYS,
  canonicalPatternAttentionCandidateIdentityBytes,
  canonicalPatternAttentionCandidateIdentityInput,
  computeAttentionCandidateIdentity,
} from './attentionCandidateIdentity'
import type {
  AttentionPatternCandidateIdentityInput,
  AttentionQuestCandidateIdentityInput,
} from './attentionCandidateIdentity'
import {
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
} from './attentionCandidatePolicy'

/**
 * Stage B / B4 — the disjoint pattern candidate identity branch (plan §6). It
 * pins pattern determinism, insertion/property-order independence,
 * identity-affecting inputs, branch disjointness, ranking/resource/presentation
 * exclusion, and the typed refusals for mixed/missing/cross-family inputs.
 */

const BASE: AttentionPatternCandidateIdentityInput = {
  sourceKind: 'narrative_pattern_instance',
  sourceId: 'attention-narrative-pattern-identity-schema-v1:fnv1a64-v1:0000000000000abc',
  patternSemanticVersion: 1,
  canonicalBindingTuple: [
    ['initiator', 'ally-a'],
    ['counterparty', 'ally-b'],
  ],
  canonicalSupportingRecordIdentityTuple: [
    ['aid-start', 'observable_action', 'rec-1', 'public-rec-1', 10],
    ['aid-return', 'observable_action', 'rec-2', 'public-rec-2', 12],
  ],
}

describe('B4 — the pattern candidate identity is deterministic and order-independent', () => {
  it('mints an ID prefixed with the pattern candidate identity schema version', () => {
    const id = computeAttentionCandidateIdentity(BASE)
    expect(id).toMatch(
      new RegExp(`^${ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION}:fnv1a64-v1:[0-9a-f]{16}$`),
    )
    expect(id).toBe(computeAttentionCandidateIdentity(BASE))
  })

  it('ignores the property-insertion order of the input object literal', () => {
    const shuffled: AttentionPatternCandidateIdentityInput = {
      canonicalSupportingRecordIdentityTuple: BASE.canonicalSupportingRecordIdentityTuple,
      patternSemanticVersion: BASE.patternSemanticVersion,
      sourceKind: 'narrative_pattern_instance',
      canonicalBindingTuple: BASE.canonicalBindingTuple,
      sourceId: BASE.sourceId,
    }
    expect(computeAttentionCandidateIdentity(shuffled)).toBe(computeAttentionCandidateIdentity(BASE))
  })

  it('hashes exactly the seven-key canonical pattern input and nothing else', () => {
    const canonical = canonicalPatternAttentionCandidateIdentityInput(BASE)
    expect(Object.keys(canonical).sort()).toEqual([...ATTENTION_PATTERN_CANDIDATE_IDENTITY_INPUT_KEYS].sort())
    expect(ATTENTION_PATTERN_CANDIDATE_IDENTITY_INPUT_KEYS).toEqual([
      'canonicalBindingTuple',
      'canonicalSupportingRecordIdentityTuple',
      'canonicalizationVersion',
      'patternCandidateIdentitySchemaVersion',
      'patternSemanticVersion',
      'sourceId',
      'sourceKind',
    ])
  })
})

describe('B4 — every identity-affecting pattern input moves the ID', () => {
  const id = computeAttentionCandidateIdentity(BASE)

  it('moves the ID when the source id (patternInstanceId) changes', () => {
    expect(computeAttentionCandidateIdentity({ ...BASE, sourceId: 'other-instance' })).not.toBe(id)
  })

  it('moves the ID when the pattern semantic version changes', () => {
    expect(computeAttentionCandidateIdentity({ ...BASE, patternSemanticVersion: 2 })).not.toBe(id)
  })

  it('moves the ID when the canonical binding tuple changes', () => {
    expect(computeAttentionCandidateIdentity({
      ...BASE,
      canonicalBindingTuple: [['initiator', 'ally-a'], ['counterparty', 'ally-c']],
    })).not.toBe(id)
  })

  it('moves the ID when the canonical supporting-record tuple changes', () => {
    expect(computeAttentionCandidateIdentity({
      ...BASE,
      canonicalSupportingRecordIdentityTuple: [
        ['aid-start', 'observable_action', 'rec-1', 'public-rec-1', 10],
        ['aid-return', 'observable_action', 'rec-9', 'public-rec-9', 12],
      ],
    })).not.toBe(id)
  })
})

describe('B4 — the quest and pattern branches are disjoint and cross-family fields refuse', () => {
  it('mints different IDs for a quest and a pattern candidate that share a source id', () => {
    const sharedId = 'shared-source-id'
    const questId = computeAttentionCandidateIdentity({
      sourceKind: 'quest_candidate',
      sourceId: sharedId,
      openingProvenanceId: 'consequence-public-30',
    })
    const patternId = computeAttentionCandidateIdentity({ ...BASE, sourceId: sharedId })

    expect(questId.startsWith(ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION)).toBe(true)
    expect(patternId.startsWith(ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION)).toBe(true)
    expect(questId).not.toBe(patternId)
  })

  it('refuses a quest opening-provenance field on the pattern branch', () => {
    const mixed = { ...BASE, openingProvenanceId: 'consequence-public-30' } as unknown as AttentionPatternCandidateIdentityInput
    expect(() => computeAttentionCandidateIdentity(mixed)).toThrow(/must not carry the quest opening-provenance field/)
  })

  it('refuses a pattern field on the quest branch', () => {
    const mixed = {
      sourceKind: 'quest_candidate',
      sourceId: 'q',
      openingProvenanceId: 'consequence-public-30',
      patternSemanticVersion: 1,
    } as unknown as AttentionQuestCandidateIdentityInput
    expect(() => computeAttentionCandidateIdentity(mixed)).toThrow(/must not carry pattern fields/)
  })

  it('refuses a missing branch-specific field', () => {
    expect(() => computeAttentionCandidateIdentity({ ...BASE, sourceId: '   ' })).toThrow(/source id/)
    expect(() => computeAttentionCandidateIdentity(
      { ...BASE, canonicalBindingTuple: [] },
    )).toThrow(/non-empty binding tuple/)
    expect(() => computeAttentionCandidateIdentity(
      { ...BASE, canonicalSupportingRecordIdentityTuple: [] },
    )).toThrow(/non-empty supporting tuple/)
  })

  it('refuses an ambiguous/unsupported source kind', () => {
    const bad = { ...BASE, sourceKind: 'mystery_family' } as unknown as AttentionPatternCandidateIdentityInput
    expect(() => computeAttentionCandidateIdentity(bad)).toThrow()
  })
})

describe('B4 — the canonical pattern bytes are exposed and stable', () => {
  it('serializes identically for two independently written equivalent inputs', () => {
    const a = canonicalPatternAttentionCandidateIdentityBytes(BASE)
    const b = canonicalPatternAttentionCandidateIdentityBytes({
      sourceId: BASE.sourceId,
      sourceKind: 'narrative_pattern_instance',
      patternSemanticVersion: 1,
      canonicalSupportingRecordIdentityTuple: BASE.canonicalSupportingRecordIdentityTuple,
      canonicalBindingTuple: BASE.canonicalBindingTuple,
    })
    expect(a).toBe(b)
  })
})
