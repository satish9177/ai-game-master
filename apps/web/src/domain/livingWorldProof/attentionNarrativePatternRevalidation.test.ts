import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import type { AttentionPatternCandidate } from './attentionCandidate'
import { ATTENTION_CANDIDATE_ORDERING_VERSION, ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION } from './attentionDirectEvidenceAssertion'
import {
  appendAttentionLedgerRecord,
  createAttentionLedger,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
} from './attentionLedger'
import type { AttentionLedger } from './attentionLedger'
import { revalidateAttentionPatternPresentation } from './attentionReplay'
import {
  attentionCandidateDerivationDependencyBundle,
  attentionCandidateRankingEligibilityResourceState,
  deriveAttentionCandidateRankingCacheKey,
} from './attentionCandidateCacheKey'
import type { AttentionCandidateRankingDependencyBundle } from './attentionCandidateCacheKey'

function candidate(overrides: Partial<AttentionPatternCandidate> = {}): AttentionPatternCandidate {
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'pattern-source', candidateId: 'pattern-candidate',
    eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
    canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
    rankingSnapshotLsn: 20, legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
    canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
    canonicalSupportingRecordIdentityTuple: Object.freeze([Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', 10] as const)]),
    lastProgressLsn: 10, ...overrides,
  })
}

const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
if (created.kind !== 'ok') throw new Error('expected ledger')

describe('B5 — pattern presentation revalidation', () => {
  const selected = candidate()
  const base = {
    selectedCandidate: selected,
    ledger: created.ledger,
    evaluationLsn: 20,
    rankingCacheKey: 'cache-a',
    revalidationCacheKey: 'cache-a',
    patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
  }

  it('permits only an unchanged exact candidate under matching cache and policy inputs, carrying the real eligible policy decision', () => {
    const result = revalidateAttentionPatternPresentation({ ...base, revalidatedCandidate: candidate() })
    expect(result).toMatchObject({ ok: true, reason: 'still-legal' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.policyDecision).toMatchObject({ eligible: true, reason: 'eligible' })
  })

  it.each([
    ['missing candidate', undefined, 'cache-a', 'candidate-disappeared'],
    ['candidate identity', candidate({ candidateId: 'another' }), 'cache-a', 'candidate-identity-mismatch'],
    ['source identity', candidate({ sourceId: 'another-source' }), 'cache-a', 'source-identity-mismatch'],
    ['supporting record', candidate({ canonicalSupportingRecordIdentityTuple: Object.freeze([Object.freeze(['aid-start', 'observable_action', 'aid-2', 'public-aid-2', 10] as const)]) }), 'cache-a', 'supporting-record-identity-mismatch'],
    ['cache version', candidate(), 'cache-b', 'cache-key-mismatch'],
  ])('refuses %s without a ledger write', (_label, current, cache, reason) => {
    const before = created.ledger.records.length
    expect(revalidateAttentionPatternPresentation({ ...base, revalidatedCandidate: current, revalidationCacheKey: cache }).reason)
      .toBe(reason)
    expect(created.ledger.records).toHaveLength(before)
  })

  it('B5 -- a genuinely changed premise: a real cache-dependency change moves the constructed ranking key, and revalidation against the stale key refuses', () => {
    // Built from the actual cache constructors, not hand-picked literal
    // strings: the "at ranking time" key and the "at revalidation time" key
    // differ because a real derivation dependency (snapshotLsn) advanced
    // between the two coordinates -- exactly the premise a real revalidation
    // pass would reconstruct and compare.
    const rankingTimeBundle: AttentionCandidateRankingDependencyBundle = {
      derivation: attentionCandidateDerivationDependencyBundle({ snapshotLsn: 20, aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0' }),
      orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
      rankingPolicyHash: 'ranking-policy-hash-v1',
      eligibilityResourceState: attentionCandidateRankingEligibilityResourceState(),
    }
    const revalidationTimeBundle: AttentionCandidateRankingDependencyBundle = {
      ...rankingTimeBundle,
      derivation: attentionCandidateDerivationDependencyBundle({ snapshotLsn: 24, aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0' }),
    }
    const rankingTimeKey = deriveAttentionCandidateRankingCacheKey(rankingTimeBundle)
    const revalidationTimeKey = deriveAttentionCandidateRankingCacheKey(revalidationTimeBundle)
    if (rankingTimeKey.kind !== 'ok' || revalidationTimeKey.kind !== 'ok') throw new Error('expected two real cache keys')
    expect(rankingTimeKey.rankingCacheKey).not.toBe(revalidationTimeKey.rankingCacheKey)

    const result = revalidateAttentionPatternPresentation({
      ...base,
      revalidatedCandidate: candidate(),
      rankingCacheKey: rankingTimeKey.rankingCacheKey,
      revalidationCacheKey: revalidationTimeKey.rankingCacheKey,
    })
    // Decided before the policy check ever runs, so no policy decision exists yet.
    expect(result).toEqual({ ok: false, reason: 'cache-key-mismatch', policyDecision: null })
  })

  it('B5 -- an unchanged premise: the identical real cache key at both coordinates permits revalidation to proceed to the policy check', () => {
    const bundle: AttentionCandidateRankingDependencyBundle = {
      derivation: attentionCandidateDerivationDependencyBundle({ snapshotLsn: 20, aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0' }),
      orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
      rankingPolicyHash: 'ranking-policy-hash-v1',
      eligibilityResourceState: attentionCandidateRankingEligibilityResourceState(),
    }
    const key = deriveAttentionCandidateRankingCacheKey(bundle)
    if (key.kind !== 'ok') throw new Error('expected a real cache key')

    const result = revalidateAttentionPatternPresentation({
      ...base,
      revalidatedCandidate: candidate(),
      rankingCacheKey: key.rankingCacheKey,
      revalidationCacheKey: key.rankingCacheKey,
    })
    expect(result).toMatchObject({ ok: true, reason: 'still-legal' })
  })

  it('B5 -- an exposure-retired candidate refuses with the exact preserved policy reason, not a collapsed generic literal', () => {
    const secondSuccess = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (secondSuccess.kind !== 'ok') throw new Error('expected an empty ledger')
    // Retirement-by-exposure requires two real ledger success records for the
    // exact candidate id, appended through the real ledger module.
    let ledger = secondSuccess.ledger
    for (const lsn of [0, 4]) {
      const appended = ledgerAppendPresentationReady(ledger, lsn)
      ledger = appended
    }
    const result = revalidateAttentionPatternPresentation({
      selectedCandidate: selected,
      revalidatedCandidate: candidate(),
      rankingCacheKey: 'cache-a',
      revalidationCacheKey: 'cache-a',
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      ledger,
      evaluationLsn: 20,
    })
    // The exact policy reason (attentionLedger.ts's own closed vocabulary)
    // survives into the revalidation result verbatim -- never collapsed into
    // a generic "ineligible" placeholder that a caller (and the trusted
    // trace) could not distinguish from a density or cooldown refusal.
    expect(result).toMatchObject({ ok: false, reason: 'retired-exposure' })
    if (result.ok) throw new Error('expected a refusal')
    expect(result.policyDecision).toMatchObject({ eligible: false, reason: 'retired-exposure', successfulExposureCount: 2 })
  })

  it('B5 -- a revalidation-failure-retired candidate refuses with its own exact policy reason, distinct from exposure retirement', () => {
    const created2 = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (created2.kind !== 'ok') throw new Error('expected an empty ledger')
    let ledger = created2.ledger
    for (const lsn of [0, 2]) {
      const appended = appendAttentionLedgerRecord(ledger, {
        attentionCandidate: candidate({ rankingSnapshotLsn: lsn }),
        exposurePolicyVersion: 'attention-exposure-policy-v1',
        templateChannelPolicyVersion: 'attention-template-channel-policy-v1',
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        outcome: 'revalidation-failed',
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        presentationLsn: lsn,
        resourcePolicyVersion: 'attention-stage-b-resource-policy-v1',
      })
      if (appended.kind !== 'ok') throw new Error('expected append: ' + appended.reason)
      ledger = appended.ledger
    }
    const result = revalidateAttentionPatternPresentation({
      selectedCandidate: selected,
      revalidatedCandidate: candidate(),
      rankingCacheKey: 'cache-a',
      revalidationCacheKey: 'cache-a',
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      ledger,
      evaluationLsn: 20,
    })
    expect(result).toMatchObject({ ok: false, reason: 'retired-revalidation-failure' })
    if (result.ok) throw new Error('expected a refusal')
    expect(result.policyDecision).toMatchObject({ eligible: false, reason: 'retired-revalidation-failure', consecutiveRevalidationFailureCount: 2 })
  })

  /**
   * RN019 §9.7 makes `attention-pattern-presentation-ledger-policy-v1` a
   * disjoint per-branch record identity, and §9.3 makes it the ranking-only B5
   * cache dependency. A revalidation carried out under a *different* ledger
   * identity than the one the selected candidate was ranked and recorded under
   * is therefore reading history whose shape it cannot vouch for, and must
   * refuse before it reads that history at all -- never fall through to a
   * policy answer computed over records of an unverified branch identity.
   *
   * Each case below pairs the refusal with a **control** call that differs only
   * in the supplied identity and does reach the policy, so the refusal is
   * proved to be the ledger-identity gate rather than a policy outcome wearing
   * a different label.
   */
  describe('B5 -- the disjoint pattern-presentation ledger identity is checked before any policy read', () => {
    /**
     * Two real successes for the exact candidate id, so the policy -- if it
     * were ever reached -- would return a genuine non-null `retired-exposure`
     * decision. That makes every refusal below non-vacuous: a collapsed or
     * mis-ordered implementation would surface `retired-exposure` here.
     */
    function exposureRetiredLedger(): AttentionLedger {
      // `base.ledger` rather than `created.ledger`: the module-level refusal
      // guard narrows `created` at module scope only, so reading it inside a
      // function body loses the narrowing and fails `tsc -b`.
      let ledger: AttentionLedger = base.ledger
      for (const lsn of [0, 4]) ledger = ledgerAppendPresentationReady(ledger, lsn)
      return ledger
    }

    /**
     * A legitimate overlap sibling sharing the binding but carrying its own
     * identity and its own supporting record. RN019 §9.4 forbids substituting
     * it; it exists here so "no sibling was substituted" is a claim about a
     * sibling that actually exists rather than a vacuous one.
     */
    const overlapSibling = candidate({
      candidateId: 'overlap-sibling-candidate',
      sourceId: 'overlap-sibling-source',
      canonicalSupportingRecordIdentityTuple: Object.freeze([
        Object.freeze(['aid-start', 'observable_action', 'aid-2', 'public-aid-2', 12] as const),
      ]),
    })

    const STALE_PATTERN_LEDGER_POLICY_VERSION = 'attention-pattern-presentation-ledger-policy-v0'

    /**
     * `base` minus the ledger identity, spelled out field by field rather than
     * spread-and-deleted, so the omission is visible in the source: this object
     * has no `patternPresentationLedgerPolicyVersion` key at all.
     */
    const baseWithoutLedgerIdentity = {
      selectedCandidate: base.selectedCandidate,
      evaluationLsn: base.evaluationLsn,
      rankingCacheKey: base.rankingCacheKey,
      revalidationCacheKey: base.revalidationCacheKey,
    }

    /** The exact refusal shape: three keys, no candidate, no policy decision. */
    function expectExactLedgerPolicyMismatch(result: ReturnType<typeof revalidateAttentionPatternPresentation>): void {
      expect(result).toEqual({
        ok: false,
        reason: 'pattern-presentation-ledger-policy-mismatch',
        policyDecision: null,
      })
      // No sibling, no remapped binding, no substituted identity can hide in
      // the result, because the refusal carries exactly these three keys.
      expect(Object.keys(result).sort()).toEqual(['ok', 'policyDecision', 'reason'])
      expect(Object.isFrozen(result)).toBe(true)
    }

    it('A -- a stale pattern ledger-policy identity refuses exactly, before the policy check, and writes nothing', () => {
      const ledger = exposureRetiredLedger()
      const ledgerBytesBefore = canonicalSerialize(ledger.records)
      const selectedBytesBefore = canonicalSerialize(selected)
      const siblingBytesBefore = canonicalSerialize(overlapSibling)
      const current = candidate()

      // Control: identical call, current identity -> the policy really runs.
      const control = revalidateAttentionPatternPresentation({ ...base, ledger, revalidatedCandidate: current })
      expect(control).toMatchObject({ ok: false, reason: 'retired-exposure' })
      expect(control.policyDecision).not.toBeNull()

      const result = revalidateAttentionPatternPresentation({
        ...base,
        ledger,
        revalidatedCandidate: current,
        patternPresentationLedgerPolicyVersion: STALE_PATTERN_LEDGER_POLICY_VERSION,
      })

      expectExactLedgerPolicyMismatch(result)
      // The refusal is not the policy's answer relabelled: the control proves
      // the policy would have said `retired-exposure` with a non-null decision.
      expect(result.reason).not.toBe(control.reason)

      // No candidate, instance, or authoritative identity moved, and the
      // append-only ledger is byte-identical and record-count identical.
      expect(canonicalSerialize(selected)).toBe(selectedBytesBefore)
      expect(canonicalSerialize(overlapSibling)).toBe(siblingBytesBefore)
      expect(canonicalSerialize(current)).toBe(selectedBytesBefore)
      expect(canonicalSerialize(ledger.records)).toBe(ledgerBytesBefore)
      expect(ledger.records).toHaveLength(2)
    })

    it('A -- the committed *quest* ledger identity is never accepted as the pattern identity', () => {
      const ledger = exposureRetiredLedger()

      const result = revalidateAttentionPatternPresentation({
        ...base,
        ledger,
        revalidatedCandidate: candidate(),
        // The quest branch's own frozen identity: structurally a real ledger
        // policy string, but the wrong branch (RN019 §9.7's "no quest-named
        // sentinel for a pattern record, in either direction").
        patternPresentationLedgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION,
      })

      expectExactLedgerPolicyMismatch(result)
      expect(ledger.records).toHaveLength(2)
    })

    it('A -- a sibling with its own valid identity is not substituted to rescue the refusal', () => {
      const ledger = exposureRetiredLedger()

      const result = revalidateAttentionPatternPresentation({
        ...base,
        ledger,
        // A structurally legal, currently-present overlap sibling offered as
        // the reconstructed candidate: it must not be accepted in place of the
        // selected identity, and the ledger-identity refusal must still win.
        revalidatedCandidate: overlapSibling,
        patternPresentationLedgerPolicyVersion: STALE_PATTERN_LEDGER_POLICY_VERSION,
      })

      // The candidate-identity mismatch is detected first, so this proves the
      // sibling is rejected on its own identity and never silently adopted.
      expect(result).toEqual({ ok: false, reason: 'candidate-identity-mismatch', policyDecision: null })
      expect(ledger.records).toHaveLength(2)
    })

    it('B -- omitting the optional pattern ledger-policy identity entirely refuses identically', () => {
      const ledger = exposureRetiredLedger()
      const ledgerBytesBefore = canonicalSerialize(ledger.records)

      // This call supplies no ledger identity at all -- the optional input is
      // absent, not set to a wrong value.
      const result = revalidateAttentionPatternPresentation({
        ...baseWithoutLedgerIdentity,
        ledger,
        revalidatedCandidate: candidate(),
      })
      expect('patternPresentationLedgerPolicyVersion' in baseWithoutLedgerIdentity).toBe(false)

      // Exactly the stale-value refusal -- an absent identity is not treated as
      // "assume the current one", and is not collapsed into a generic
      // stale-cache or policy refusal.
      expectExactLedgerPolicyMismatch(result)
      expect(result.reason).not.toBe('cache-key-mismatch')
      expect(result.reason).not.toBe('retired-exposure')
      expect(canonicalSerialize(ledger.records)).toBe(ledgerBytesBefore)
      expect(ledger.records).toHaveLength(2)
    })

    it('B -- the omitted-identity and stale-identity refusals are byte-identical results', () => {
      const ledger = exposureRetiredLedger()

      const omitted = revalidateAttentionPatternPresentation({
        ...baseWithoutLedgerIdentity, ledger, revalidatedCandidate: candidate(),
      })
      const stale = revalidateAttentionPatternPresentation({
        ...base,
        ledger,
        revalidatedCandidate: candidate(),
        patternPresentationLedgerPolicyVersion: STALE_PATTERN_LEDGER_POLICY_VERSION,
      })

      expect(canonicalSerialize(omitted)).toBe(canonicalSerialize(stale))
    })
  })
})

function ledgerAppendPresentationReady(ledger: AttentionLedger, lsn: number): AttentionLedger {
  const result = appendAttentionLedgerRecord(ledger, {
    attentionCandidate: {
      sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'pattern-source', candidateId: 'pattern-candidate',
      eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
      canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
      rankingSnapshotLsn: lsn, legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
      canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
      canonicalSupportingRecordIdentityTuple: Object.freeze([Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', 10] as const)]),
      lastProgressLsn: 10,
    },
    exposurePolicyVersion: 'attention-exposure-policy-v1',
    templateChannelPolicyVersion: 'attention-template-channel-policy-v1',
    templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
    outcome: 'presentation-ready',
    renderedOutputIdentity: `output-${lsn}`,
    patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
    presentationLsn: lsn,
    resourcePolicyVersion: 'attention-stage-b-resource-policy-v1',
  })
  if (result.kind !== 'ok') throw new Error('expected append: ' + result.reason)
  return result.ledger
}
