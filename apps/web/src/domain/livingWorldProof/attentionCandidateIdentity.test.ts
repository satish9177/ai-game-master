import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
} from './attentionCandidatePolicy'
import {
  ATTENTION_CANDIDATE_IDENTITY_INPUT_KEYS,
  canonicalAttentionCandidateIdentityBytes,
  canonicalAttentionCandidateIdentityInput,
  canonicalizeAttentionCandidateStringList,
  computeAttentionCandidateIdentity,
} from './attentionCandidateIdentity'
import type { AttentionCandidateIdentityInput } from './attentionCandidateIdentity'

/**
 * A3 — deterministic candidate identity and the canonicalization it is computed
 * over.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D6 — identity is a pure function of versioned canonical identity-affecting
 *    inputs; identity-affecting inputs are disjoint from ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§14 I1-I7, §4 forbidden input dependencies);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 identity obligations, §9 A3 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 */

const BASE_INPUT: AttentionCandidateIdentityInput = {
  sourceKind: 'quest_candidate',
  sourceId: 'quest-public-open',
  openingProvenanceId: 'consequence-public-37',
}

describe('A3 / D6 — the identity input set is closed, versioned, and disjoint from ranking policy', () => {
  it('canonicalizes to exactly the declared identity fields and nothing else', () => {
    const canonical = canonicalAttentionCandidateIdentityInput(BASE_INPUT)

    expect(Object.keys(canonical).sort()).toEqual([...ATTENTION_CANDIDATE_IDENTITY_INPUT_KEYS].sort())
    expect(canonical).toEqual({
      canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
      identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      openingProvenanceId: 'consequence-public-37',
      sourceId: 'quest-public-open',
      sourceKind: 'quest_candidate',
    })
  })

  it('excludes every non-identity input the surface also carries', () => {
    // ADR-0013 D6: ranking-only policy, the pinned snapshot coordinate, the
    // accessor-contract version, and the remaining legal fields must not reach
    // identity, or exposure history stops joining across a policy change.
    const bytes = canonicalAttentionCandidateIdentityBytes(BASE_INPUT)

    for (const excluded of [
      ATTENTION_CANDIDATE_ORDERING_VERSION,
      'rankingSnapshotLsn',
      'accessorContractVersion',
      'legallyVisibleParties',
      'legallyVisiblePublicStakes',
      'legallyVisibleOriginConsequenceReference',
    ]) {
      expect({ excluded, present: bytes.includes(excluded) }).toEqual({ excluded, present: false })
    }
  })

  it('folds both versions into the bytes and prefixes the identity-schema version onto the ID', () => {
    const bytes = canonicalAttentionCandidateIdentityBytes(BASE_INPUT)
    const identity = computeAttentionCandidateIdentity(BASE_INPUT)

    expect(bytes).toContain(ATTENTION_CANDIDATE_CANONICALIZATION_VERSION)
    expect(bytes).toContain(ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION)
    expect(identity.startsWith(ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION + ':')).toBe(true)
    // The reused proof hash is itself version-prefixed, so the ID records the
    // byte format as well as the identity schema.
    expect(identity).toMatch(/^attention-candidate-identity-schema-v1:fnv1a64-v1:[0-9a-f]{16}$/)
  })

  it('keeps the canonicalization and identity-schema versions distinct, never collapsed', () => {
    expect(ATTENTION_CANDIDATE_CANONICALIZATION_VERSION).not.toBe(ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION)
  })

  it('freezes the canonical identity input', () => {
    expect(Object.isFrozen(canonicalAttentionCandidateIdentityInput(BASE_INPUT))).toBe(true)
  })
})

describe('A3 / I1-I2 — identity does not depend on construction or property order', () => {
  it('is byte-identical across repeated runs from independently built inputs', () => {
    const identities = new Set<string>()
    const byteForms = new Set<string>()

    for (let run = 0; run < 5; run += 1) {
      const rebuilt: AttentionCandidateIdentityInput = {
        sourceKind: 'quest_candidate',
        sourceId: 'quest-public-open',
        openingProvenanceId: 'consequence-public-37',
      }
      identities.add(computeAttentionCandidateIdentity(rebuilt))
      byteForms.add(canonicalAttentionCandidateIdentityBytes(rebuilt))
    }

    expect(identities.size).toBe(1)
    expect(byteForms.size).toBe(1)
  })

  it('ignores the order the input object literal was written in', () => {
    const written: AttentionCandidateIdentityInput = {
      openingProvenanceId: 'consequence-public-37',
      sourceKind: 'quest_candidate',
      sourceId: 'quest-public-open',
    }

    expect(canonicalAttentionCandidateIdentityBytes(written)).toBe(
      canonicalAttentionCandidateIdentityBytes(BASE_INPUT),
    )
    expect(computeAttentionCandidateIdentity(written)).toBe(computeAttentionCandidateIdentity(BASE_INPUT))
  })

  it('serializes the canonical input with deep key sorting, whatever order it is rebuilt in', () => {
    const canonical = canonicalAttentionCandidateIdentityInput(BASE_INPUT)
    const rebuiltInReverse = {
      sourceKind: canonical.sourceKind,
      sourceId: canonical.sourceId,
      openingProvenanceId: canonical.openingProvenanceId,
      identitySchemaVersion: canonical.identitySchemaVersion,
      canonicalizationVersion: canonical.canonicalizationVersion,
    }

    expect(canonicalSerialize(rebuiltInReverse)).toBe(canonicalSerialize(canonical))
  })
})

describe('A3 / I5-I7 — only an identity-affecting change moves the ID', () => {
  it('changes the ID when the source candidate ID changes', () => {
    expect(computeAttentionCandidateIdentity({ ...BASE_INPUT, sourceId: 'quest-other-open' }))
      .not.toBe(computeAttentionCandidateIdentity(BASE_INPUT))
  })

  it('changes the ID when the accepted opening-provenance identity changes', () => {
    expect(computeAttentionCandidateIdentity({ ...BASE_INPUT, openingProvenanceId: 'declassification-39' }))
      .not.toBe(computeAttentionCandidateIdentity(BASE_INPUT))
  })

  it('gives semantically distinct inputs distinct IDs across the fixture family', () => {
    const inputs: readonly AttentionCandidateIdentityInput[] = [
      BASE_INPUT,
      { ...BASE_INPUT, sourceId: 'quest-other-open' },
      { ...BASE_INPUT, sourceId: 'quest-third-open' },
      { ...BASE_INPUT, openingProvenanceId: 'declassification-39' },
      { sourceKind: 'quest_candidate', sourceId: 'quest-other-open', openingProvenanceId: 'declassification-39' },
    ]

    const identities = inputs.map((input) => computeAttentionCandidateIdentity(input))

    expect(new Set(identities).size).toBe(inputs.length)
  })
})

describe('A3 — the identity boundary refuses malformed input instead of repairing it', () => {
  it('rejects an empty or blank source candidate ID', () => {
    expect(() => computeAttentionCandidateIdentity({ ...BASE_INPUT, sourceId: '' })).toThrow(/source id/)
    expect(() => computeAttentionCandidateIdentity({ ...BASE_INPUT, sourceId: '   ' })).toThrow(/source id/)
  })

  it('rejects an empty or blank opening-provenance identity', () => {
    expect(() => computeAttentionCandidateIdentity({ ...BASE_INPUT, openingProvenanceId: '' }))
      .toThrow(/opening provenance id/)
    expect(() => computeAttentionCandidateIdentity({ ...BASE_INPUT, openingProvenanceId: '  ' }))
      .toThrow(/opening provenance id/)
  })
})

describe('A3 / I3 — the collection canonical form is stated, stable, and locale-independent', () => {
  it('sorts by UTF-16 code unit rather than by host collation', () => {
    const canonical = canonicalizeAttentionCandidateStringList(['player', 'Warden', 'merchant'])

    // Code-unit order puts every uppercase letter before every lowercase one.
    // A locale collator returns ['merchant', 'player', 'Warden'] instead, so
    // this fixture fails if the rule ever drifts to `localeCompare`. The
    // expectation is written as the literal code-unit result rather than
    // compared against a live collator, because a collator's own answer depends
    // on the host's ICU data — which is exactly the dependency being excluded.
    expect(canonical).toEqual(['Warden', 'merchant', 'player'])
  })

  it('is order-independent and preserves multiplicity', () => {
    expect(canonicalizeAttentionCandidateStringList(['b', 'a', 'b'])).toEqual(['a', 'b', 'b'])
    expect(canonicalizeAttentionCandidateStringList(['b', 'b', 'a'])).toEqual(['a', 'b', 'b'])
  })

  it('never sorts the caller\'s array in place, and freezes what it returns', () => {
    const input = ['player', 'Warden', 'merchant']
    const canonical = canonicalizeAttentionCandidateStringList(input)

    expect(input).toEqual(['player', 'Warden', 'merchant'])
    expect(Object.isFrozen(canonical)).toBe(true)
  })
})
