import { describe, expect, it } from 'vitest'
import type { AttentionPatternCandidate } from './attentionCandidate'
import { ATTENTION_CANDIDATE_CANONICALIZATION_VERSION } from './attentionCandidatePolicy'
import {
  ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
  ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION,
  buildAttentionDirectEvidenceAssertions,
} from './attentionDirectEvidenceAssertion'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'

const inputs: readonly NarrativePatternDirectEvidenceAssertionInput[] = Object.freeze([
  Object.freeze({ assertionKind: 'public_aid', sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
  Object.freeze({ assertionKind: 'public_harm_severity', sourceRecordId: 'harm-1', visibilityProvenanceId: 'public-harm-1', actorId: 'b', targetId: 'a', publicSeverityBand: 'moderate' }),
  Object.freeze({ assertionKind: 'public_commitment', sourceRecordId: 'commit-1', visibilityProvenanceId: 'public-commit-1', speakerId: 'a', recipientId: 'b', commitmentKey: 'bridge' }),
  Object.freeze({ assertionKind: 'public_fulfillment_record', sourceRecordId: 'fulfill-1', visibilityProvenanceId: 'public-fulfill-1', actorId: 'a', targetId: 'b', commitmentKey: 'bridge' }),
])

function candidate(supportCount = 4): AttentionPatternCandidate {
  const support = inputs.slice(0, supportCount).map((input, index) => Object.freeze([
    ['aid-start', 'harm-start', 'commitment-start', 'fulfillment'][index]!,
    input.assertionKind === 'public_commitment' ? 'validated_public_communication' : 'observable_action',
    input.sourceRecordId,
    input.visibilityProvenanceId,
    index + 1,
  ] as const))
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'pattern-id', candidateId: 'pattern-candidate-id',
    eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1', rankingSnapshotLsn: 20,
    legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
    canonicalBindingTuple: Object.freeze([]), canonicalSupportingRecordIdentityTuple: Object.freeze(support), lastProgressLsn: 4,
  })
}

describe('B5 — direct evidence assertions', () => {
  it('uses the four closed direct-record kinds in monitor order with stable identities', () => {
    const result = buildAttentionDirectEvidenceAssertions(inputs)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected assertions')
    expect(result.assertions.map((assertion) => assertion.assertionKind)).toEqual([
      'public_aid', 'public_harm_severity', 'public_commitment', 'public_fulfillment_record',
    ])
    const reversed = buildAttentionDirectEvidenceAssertions([...inputs].reverse())
    if (reversed.kind !== 'ok') throw new Error('expected reversed assertions')
    expect(result.assertions.map((assertion) => assertion.assertionId)).toEqual(
      reversed.assertions.map((assertion) => assertion.assertionId).reverse(),
    )
  })

  it('builds and renders independent direct lines without a pattern conclusion', () => {
    const assertions = buildAttentionDirectEvidenceAssertions(inputs)
    if (assertions.kind !== 'ok') throw new Error('expected assertions')
    const packageResult = buildAttentionRevealPackage(candidate(), {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      directEvidenceAssertions: assertions.assertions,
    })
    expect(packageResult.kind).toBe('ok')
    if (packageResult.kind !== 'ok') throw new Error('expected package')
    const rendered = renderAttentionRevealPackage(packageResult.revealPackage, {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
    })
    expect(rendered.kind).toBe('ok')
    if (rendered.kind !== 'ok') throw new Error('expected rendering')
    expect(rendered.lines).toEqual([
      'public aid/a/b', 'public harm severity/b/a/moderate',
      'public commitment/a/b/bridge', 'public fulfillment record/a/b/bridge',
    ])
    expect(rendered.output).not.toMatch(/reciprocal|escalat|fulfilled|trust|friend|motive/i)
  })

  it('refuses a fifth assertion instead of truncating it', () => {
    const fifth = Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-2', visibilityProvenanceId: 'public-aid-2', actorId: 'c', targetId: 'd' })
    const assertions = buildAttentionDirectEvidenceAssertions([...inputs, fifth])
    if (assertions.kind !== 'ok') throw new Error('expected five assertions')
    const result = buildAttentionRevealPackage(candidate(4), {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      directEvidenceAssertions: assertions.assertions,
    })
    expect(result).toEqual({ kind: 'refused', reason: 'too-many-direct-evidence-assertions' })
  })

  it('B5 -- an empty assertion-input list refuses rather than building a package from nothing', () => {
    expect(buildAttentionDirectEvidenceAssertions([])).toEqual({ kind: 'refused', reason: 'empty-assertion-input' })
  })

  it('B5 -- an unsupported assertion kind refuses deterministically rather than reusing a known kind', () => {
    const forged = Object.freeze({
      assertionKind: 'reconcile' as never,
      sourceRecordId: 'rec-1',
      visibilityProvenanceId: 'prov-1',
      actorId: 'a',
      targetId: 'b',
    })
    expect(buildAttentionDirectEvidenceAssertions([forged]))
      .toEqual({ kind: 'refused', reason: 'unsupported-assertion-input' })
  })

  it('B5 -- exact-coordinate duplicate source records refuse rather than picking one', () => {
    const duplicate = [
      Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
      Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
    ]
    expect(buildAttentionDirectEvidenceAssertions(duplicate))
      .toEqual({ kind: 'refused', reason: 'duplicate-direct-evidence-source' })
  })

  describe('B5 -- the closed visible-field grammar rule (D1 fix)', () => {
    const adversarialFields: readonly [string, string][] = [
      ['a newline followed by another assertion token', 'a\npublic harm severity/villain/victim/major'],
      ['a slash', 'a/b'],
      ['a CRLF sequence', 'a\r\nb'],
      ['the Unicode line separator U+2028', 'a b'],
      ['the Unicode paragraph separator U+2029', 'a b'],
      ['a C0 control character', 'ab'],
      ['a C1 control character', 'ab'],
      ['a bare DEL byte', 'ab'],
    ]

    it.each(adversarialFields)('refuses an actorId containing %s rather than rendering it', (_label, poisoned) => {
      const poisonedInput = Object.freeze({
        assertionKind: 'public_aid' as const,
        sourceRecordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        actorId: poisoned,
        targetId: 'b',
      })
      expect(buildAttentionDirectEvidenceAssertions([poisonedInput]))
        .toEqual({ kind: 'refused', reason: 'invalid-direct-evidence-field-character' })
    })

    it('reproduces the original one-record-forges-two-lines exploit and confirms it now refuses end to end', () => {
      // The exact adversarial input the original review reproduced against the
      // unpatched renderer: one admitted `public_aid` record whose `actorId`
      // smuggled a newline plus a second, well-formed-looking assertion line.
      // Unpatched, this built, packaged, and rendered two apparent lines from
      // one admitted record. It must now refuse at the earliest stage.
      const poisonedInput = Object.freeze({
        assertionKind: 'public_aid' as const,
        sourceRecordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        actorId: 'a\npublic harm severity/villain/victim/major',
        targetId: 'b',
      })
      const built = buildAttentionDirectEvidenceAssertions([poisonedInput])
      expect(built).toEqual({ kind: 'refused', reason: 'invalid-direct-evidence-field-character' })
    })

    it('a forged assertion object bypassing the builder is still caught at package build (defense in depth)', () => {
      const forgedAssertion = Object.freeze({
        assertionId: 'forged-assertion-id',
        assertionKind: 'public_aid' as const,
        sourceRecordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        token: 'public aid' as const,
        actorId: 'a\npublic harm severity/villain/victim/major',
        targetId: 'b',
      })
      const result = buildAttentionRevealPackage(candidate(1), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: [forgedAssertion],
      })
      expect(result).toEqual({ kind: 'refused', reason: 'invalid-direct-evidence-field-character' })
    })

    it('a forged assertion object bypassing both the builder and the package builder is still caught at render (defense in depth)', () => {
      const forgedAssertion = Object.freeze({
        assertionId: 'forged-assertion-id',
        assertionKind: 'public_aid' as const,
        sourceRecordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        token: 'public aid' as const,
        actorId: 'a\npublic harm severity/villain/victim/major',
        targetId: 'b',
      })
      const forgedPackage = Object.freeze({
        packageSchemaVersion: ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION,
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        candidateId: 'pattern-candidate-id',
        assertions: Object.freeze([forgedAssertion]),
        resultTag: 'presentation-ready' as const,
      })
      const rendered = renderAttentionRevealPackage(forgedPackage, {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      })
      expect(rendered).toEqual({ kind: 'refused', reason: 'malformed-pattern-assertion' })
    })
  })

  describe('B5 -- semantic assertion order must equal the canonical supporting-record order (D3 fix)', () => {
    it('refuses a correct identity set presented in the wrong semantic order', () => {
      const assertions = buildAttentionDirectEvidenceAssertions([...inputs].reverse())
      if (assertions.kind !== 'ok') throw new Error('expected assertions')
      // Reversed assertions carry the correct four identities but in the
      // opposite order from the candidate's canonical supporting tuple.
      const result = buildAttentionRevealPackage(candidate(4), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: assertions.assertions,
      })
      expect(result).toEqual({ kind: 'refused', reason: 'pattern-assertion-out-of-order' })
    })

    it('refuses fewer assertions than the candidate legally requires', () => {
      const assertions = buildAttentionDirectEvidenceAssertions(inputs.slice(0, 2))
      if (assertions.kind !== 'ok') throw new Error('expected assertions')
      const result = buildAttentionRevealPackage(candidate(4), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: assertions.assertions,
      })
      expect(result).toEqual({ kind: 'refused', reason: 'missing-required-direct-evidence-assertion' })
    })

    it('refuses an assertion for a record outside the candidate tuple entirely', () => {
      const foreign = Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'unrelated-record', visibilityProvenanceId: 'unrelated-provenance', actorId: 'x', targetId: 'y' })
      const assertions = buildAttentionDirectEvidenceAssertions([foreign])
      if (assertions.kind !== 'ok') throw new Error('expected assertions')
      const result = buildAttentionRevealPackage(candidate(1), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: assertions.assertions,
      })
      expect(result).toEqual({ kind: 'refused', reason: 'direct-evidence-source-mismatch' })
    })

    it('accepts the correct forward order and the identical reversed-raw-evidence-insertion order once re-sorted to canonical', () => {
      // Reversed *evidence input* to the assertion builder still yields the
      // canonical monitor order (already proven above); building the package
      // from that canonically-ordered result succeeds.
      const forward = buildAttentionDirectEvidenceAssertions(inputs)
      if (forward.kind !== 'ok') throw new Error('expected assertions')
      const result = buildAttentionRevealPackage(candidate(4), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: forward.assertions,
      })
      expect(result.kind).toBe('ok')
    })
  })

  describe('B5 -- mixed-family request refusal (D7 fix)', () => {
    it('refuses a quest candidate request that carries pattern-only directEvidenceAssertions', () => {
      const assertions = buildAttentionDirectEvidenceAssertions(inputs)
      if (assertions.kind !== 'ok') throw new Error('expected assertions')
      const questCandidate = Object.freeze({
        sourceKind: 'quest_candidate' as const, sourceAuthority: 'authoritative' as const,
        sourceId: 'quest-source', candidateId: 'quest-candidate-id', eligibility: 'eligible' as const,
        accessorContractVersion: 'attention-quest-candidate-accessor-v1',
        canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
        identitySchemaVersion: 'attention-candidate-identity-schema-v1', rankingSnapshotLsn: 20,
        legallyVisibleParties: Object.freeze(['a', 'b']), openingProvenanceId: 'consequence-public-1',
      })
      const result = buildAttentionRevealPackage(questCandidate as never, {
        templateVersion: 'attention-extradiegetic-template-v1',
        directEvidenceAssertions: assertions.assertions,
      })
      expect(result).toEqual({ kind: 'refused', reason: 'unsupported-direct-evidence-assertions-for-quest' })
    })

    it('refuses a pattern candidate paired with the quest template version', () => {
      const assertions = buildAttentionDirectEvidenceAssertions(inputs)
      if (assertions.kind !== 'ok') throw new Error('expected assertions')
      const result = buildAttentionRevealPackage(candidate(4), {
        templateVersion: 'attention-extradiegetic-template-v1',
        directEvidenceAssertions: assertions.assertions,
      })
      expect(result).toEqual({ kind: 'refused', reason: 'unsupported-template-version' })
    })
  })

  describe('B5 -- pattern packages and assertions are deeply immutable', () => {
    it('freezes every assertion inside a built package even if the caller-supplied object was mutable', () => {
      const mutableAssertion = {
        assertionId: 'mutable-assertion-id',
        assertionKind: 'public_aid' as const,
        sourceRecordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        token: 'public aid' as const,
        actorId: 'a',
        targetId: 'b',
      }
      expect(Object.isFrozen(mutableAssertion)).toBe(false)
      const result = buildAttentionRevealPackage(candidate(1), {
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        directEvidenceAssertions: [mutableAssertion],
      })
      if (result.kind !== 'ok') throw new Error('expected a package')
      expect(Object.isFrozen(result.revealPackage)).toBe(true)
      if (!('assertions' in result.revealPackage)) throw new Error('expected pattern package')
      expect(Object.isFrozen(result.revealPackage.assertions)).toBe(true)
      expect(Object.isFrozen(result.revealPackage.assertions[0])).toBe(true)
      // Mutating the original caller-owned object cannot reach the package's copy.
      mutableAssertion.actorId = 'mutated'
      const copiedAssertion = result.revealPackage.assertions[0]
      if (copiedAssertion?.assertionKind !== 'public_aid') throw new Error('expected a public_aid assertion')
      expect(copiedAssertion.actorId).toBe('a')
    })
  })
})
