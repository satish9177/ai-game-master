import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_OBSERVABLE_TRACE_SCHEMA_VERSION,
  ATTENTION_TRACE_SCHEMA_VERSION,
  buildAttentionTrace,
  canonicalAttentionObservableTraceBytes,
  emptyAttentionTraceStructuralRetention,
} from './attentionTrace'
import {
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
  appendAttentionLedgerRecord,
  createAttentionLedger,
} from './attentionLedger'
import type { AttentionLedger } from './attentionLedger'
import { ATTENTION_EXPOSURE_POLICY_VERSION, ATTENTION_LEDGER_POLICY_VERSION, ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION } from './attentionCandidatePolicy'
import { runAttentionPatternPresentationPass } from './attentionReplay'
import type { AttentionPatternCandidate } from './attentionCandidate'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
import { ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION } from './attentionNarrativePatternResourcePolicy'

describe('B5 — trusted pattern presentation trace', () => {
  it('keeps direct assertion and policy evidence trusted-only', () => {
    const base = {
      replayCaseId: 'b5-trace', accessorContractVersion: 'accessor-v1', canonicalizationVersion: 'canon-v1', identitySchemaVersion: 'identity-v1',
      orderingVersion: 'order-v2', derivationCacheKeySchemaVersion: 'derive-v2', rankingCacheKeySchemaVersion: 'rank-v2',
      templateVersion: 'attention-pattern-direct-evidence-template-v1', templateChannelPolicyVersion: 'channel-v1', exposurePolicyVersion: 'exposure-v1', ledgerPolicyVersion: 'ledger-v1',
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      rankingSnapshotLsn: 10, revalidationSnapshotLsn: 12, admittedQuestCandidateSourceIds: Object.freeze([]),
      orderedAttentionCandidates: Object.freeze([]), orderingTrace: Object.freeze([]), structuralRetention: emptyAttentionTraceStructuralRetention(),
      presentations: Object.freeze([]), revalidations: Object.freeze([]), authoritativeLogDigestBefore: 'before', authoritativeLogDigestAfter: 'after',
    }
    const without = buildAttentionTrace(base)
    const withDecision = buildAttentionTrace({
      ...base,
      patternPresentationDecisions: Object.freeze([Object.freeze({
        candidateId: 'pattern-candidate', assertionIds: Object.freeze(['assertion-1']), revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'eligible', densityOutcome: 'eligible', retirementOutcome: 'not-retired', ledgerAppend: 'appended' as const,
      })]),
    })
    expect(without.kind).toBe('ok')
    expect(withDecision.kind).toBe('ok')
    if (without.kind !== 'ok' || withDecision.kind !== 'ok') throw new Error('expected traces')
    expect(withDecision.trace.schemaVersion).toBe(ATTENTION_TRACE_SCHEMA_VERSION)
    expect(withDecision.trace.observableTraceSchemaVersion).toBe(ATTENTION_OBSERVABLE_TRACE_SCHEMA_VERSION)
    expect(canonicalAttentionObservableTraceBytes(withDecision.trace))
      .toBe(canonicalAttentionObservableTraceBytes(without.trace))
  })

  const base = {
    replayCaseId: 'b5-trace-malformed', accessorContractVersion: 'accessor-v1', canonicalizationVersion: 'canon-v1', identitySchemaVersion: 'identity-v1',
    orderingVersion: 'order-v2', derivationCacheKeySchemaVersion: 'derive-v2', rankingCacheKeySchemaVersion: 'rank-v2',
    templateVersion: 'attention-pattern-direct-evidence-template-v1', templateChannelPolicyVersion: 'channel-v1', exposurePolicyVersion: 'exposure-v1', ledgerPolicyVersion: 'ledger-v1',
    patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
    rankingSnapshotLsn: 10, revalidationSnapshotLsn: 12, admittedQuestCandidateSourceIds: Object.freeze([]),
    orderedAttentionCandidates: Object.freeze([]), orderingTrace: Object.freeze([]), structuralRetention: emptyAttentionTraceStructuralRetention(),
    presentations: Object.freeze([]), revalidations: Object.freeze([]), authoritativeLogDigestBefore: 'before', authoritativeLogDigestAfter: 'after',
  }

  it('refuses a decision carrying an outcome value outside the closed vocabulary', () => {
    const result = buildAttentionTrace({
      ...base,
      patternPresentationDecisions: Object.freeze([Object.freeze({
        candidateId: 'pattern-candidate', assertionIds: Object.freeze(['assertion-1']), revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'made-up-outcome' as never, densityOutcome: 'eligible', retirementOutcome: 'not-retired', ledgerAppend: 'appended' as const,
      })]),
    })
    expect(result).toEqual({ kind: 'refused', reason: 'invalid-pattern-presentation-decision' })
  })

  it('refuses an appended decision with zero grounding assertion ids', () => {
    const result = buildAttentionTrace({
      ...base,
      patternPresentationDecisions: Object.freeze([Object.freeze({
        candidateId: 'pattern-candidate', assertionIds: Object.freeze([]), revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'eligible', densityOutcome: 'eligible', retirementOutcome: 'not-retired', ledgerAppend: 'appended' as const,
      })]),
    })
    expect(result).toEqual({ kind: 'refused', reason: 'invalid-pattern-presentation-decision' })
  })

  it('refuses a decision with a blank candidate id', () => {
    const result = buildAttentionTrace({
      ...base,
      patternPresentationDecisions: Object.freeze([Object.freeze({
        candidateId: '   ', assertionIds: Object.freeze(['assertion-1']), revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'eligible', densityOutcome: 'eligible', retirementOutcome: 'not-retired', ledgerAppend: 'appended' as const,
      })]),
    })
    expect(result).toEqual({ kind: 'refused', reason: 'invalid-pattern-presentation-decision' })
  })

  it('accepts a well-formed non-appended decision with zero assertion ids (a revalidation refusal grounds nothing)', () => {
    const result = buildAttentionTrace({
      ...base,
      patternPresentationDecisions: Object.freeze([Object.freeze({
        candidateId: 'pattern-candidate', assertionIds: Object.freeze([]), revalidationOutcome: 'candidate-disappeared',
        exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted', retirementOutcome: 'not-attempted', ledgerAppend: 'not-appended' as const,
      })]),
    })
    expect(result.kind).toBe('ok')
  })

  it('builds the trusted trace from the real pattern-presentation pipeline output, not a hand-recomputed literal', () => {
    const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (created.kind !== 'ok') throw new Error('expected an empty ledger')

    const assertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[] = Object.freeze([
      Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
    ])
    const candidate: AttentionPatternCandidate = Object.freeze({
      sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'pattern-source', candidateId: 'pattern-candidate-real',
      eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
      canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
      rankingSnapshotLsn: 10, legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
      canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
      canonicalSupportingRecordIdentityTuple: Object.freeze([Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', 10] as const)]),
      lastProgressLsn: 10,
    })

    const pass = runAttentionPatternPresentationPass({
      orderedCandidates: [{
        candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs,
        rankingCacheKey: 'cache-real', revalidationCacheKey: 'cache-real',
      }],
      ledger: created.ledger,
      evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(pass.presentation).not.toBeNull()

    // The trace is built directly from the pass's own real decisions -- this
    // test never hand-writes a decision literal.
    const result = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected a trace')
    expect(result.trace.patternPresentationDecisions).toEqual(pass.decisions)
    expect(pass.decisions[0]?.ledgerAppend).toBe('appended')
    expect(pass.decisions[0]?.assertionIds.length).toBeGreaterThan(0)
  })

  describe('B5 -- every real revalidation-policy reason reaches the trusted trace with its exact value, not a collapsed placeholder', () => {
    const assertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[] = Object.freeze([
      Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
    ])

    function patternCandidate(candidateId: string, sourceId: string, rankingSnapshotLsn: number): AttentionPatternCandidate {
      return Object.freeze({
        sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId, candidateId,
        eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
        canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
        rankingSnapshotLsn, legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
        canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
        canonicalSupportingRecordIdentityTuple: Object.freeze([
          Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', rankingSnapshotLsn] as const),
        ]),
        lastProgressLsn: rankingSnapshotLsn,
      })
    }

    function emptyLedgerOrThrow(): AttentionLedger {
      const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
      if (created.kind !== 'ok') throw new Error('expected an empty ledger')
      return created.ledger
    }

    /** Drives one real presentation attempt through the actual pipeline. */
    function presentOrThrow(ledger: AttentionLedger, candidate: AttentionPatternCandidate, evaluationLsn: number) {
      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{
          candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs,
          rankingCacheKey: `cache-${candidate.candidateId}`, revalidationCacheKey: `cache-${candidate.candidateId}`,
        }],
        ledger, evaluationLsn,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      if (pass.presentation === null) throw new Error('expected a real presentation to build ledger history')
      return pass.ledger
    }

    /** Hand-builds one revalidation-failed pattern-branch record: B5's pipeline itself never appends this outcome. */
    function appendRevalidationFailureOrThrow(ledger: AttentionLedger, candidate: AttentionPatternCandidate, presentationLsn: number): AttentionLedger {
      const result = appendAttentionLedgerRecord(ledger, {
        attentionCandidate: candidate,
        exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
        templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
        templateVersion: 'attention-pattern-direct-evidence-template-v1',
        outcome: 'revalidation-failed',
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        presentationLsn,
        resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      })
      if (result.kind !== 'ok') throw new Error('expected a revalidation-failed append: ' + result.reason)
      return result.ledger
    }

    it('the first successful exposure is not retired; the second is reported retired; a third attempt refuses with the exact retired-exposure reason', () => {
      const candidate = patternCandidate('trace-exposure-candidate', 'trace-exposure-source', 10)
      const attempt = (ledger: AttentionLedger, evaluationLsn: number) => runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-exposure', revalidationCacheKey: 'cache-exposure' }],
        ledger, evaluationLsn,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })

      const firstPass = attempt(emptyLedgerOrThrow(), 10)
      expect(firstPass.decisions[0]).toMatchObject({ ledgerAppend: 'appended', retirementOutcome: 'not-retired' })

      const secondPass = attempt(firstPass.ledger, 14)
      expect(secondPass.decisions[0]).toMatchObject({ ledgerAppend: 'appended', retirementOutcome: 'retired-exposure' })
      expect(secondPass.ledger.records).toHaveLength(2)

      const thirdPass = attempt(secondPass.ledger, 18)
      expect(thirdPass.presentation).toBeNull()
      expect(thirdPass.ledger.records).toHaveLength(2)
      expect(thirdPass.decisions[0]).toEqual({
        candidateId: 'trace-exposure-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted',
        retirementOutcome: 'retired-exposure', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: thirdPass.decisions })
      expect(traced.kind).toBe('ok')
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(thirdPass.decisions)
      // The trusted-only reason never reaches the frozen observable projection.
      const withoutDecisions = buildAttentionTrace(base)
      if (withoutDecisions.kind !== 'ok') throw new Error('expected a trace')
      expect(canonicalAttentionObservableTraceBytes(traced.trace))
        .toBe(canonicalAttentionObservableTraceBytes(withoutDecisions.trace))
    })

    it('a successful-presentation cooldown refuses with its exact reason while retirement correctly reports not-retired', () => {
      const candidate = patternCandidate('trace-cooldown-candidate', 'trace-cooldown-source', 10)
      const afterFirst = presentOrThrow(emptyLedgerOrThrow(), candidate, 10)

      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-cooldown', revalidationCacheKey: 'cache-cooldown' }],
        ledger: afterFirst, evaluationLsn: 12,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger.records).toHaveLength(1)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-cooldown-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'successful-cooldown', densityOutcome: 'not-attempted',
        retirementOutcome: 'not-retired', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })

    it('four successes for other candidates fill the density window; a fifth distinct candidate refuses with density-window-full', () => {
      let ledger = emptyLedgerOrThrow()
      for (const index of [1, 2, 3, 4]) {
        ledger = presentOrThrow(ledger, patternCandidate(`density-filler-${index}`, `density-filler-source-${index}`, 10), 10)
      }
      expect(ledger.records).toHaveLength(4)

      const testCandidate = patternCandidate('trace-density-candidate', 'trace-density-source', 10)
      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate: testCandidate, revalidatedCandidate: testCandidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-density', revalidationCacheKey: 'cache-density' }],
        ledger, evaluationLsn: 10,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger.records).toHaveLength(4)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-density-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'eligible', densityOutcome: 'density-window-full',
        retirementOutcome: 'not-retired', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })

    it('two consecutive revalidation failures retire the candidate with the exact retired-revalidation-failure reason', () => {
      const candidate = patternCandidate('trace-failure-retired-candidate', 'trace-failure-retired-source', 0)
      let ledger = emptyLedgerOrThrow()
      ledger = appendRevalidationFailureOrThrow(ledger, candidate, 0)
      ledger = appendRevalidationFailureOrThrow(ledger, candidate, 5)

      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-fail-retired', revalidationCacheKey: 'cache-fail-retired' }],
        ledger, evaluationLsn: 20,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger.records).toHaveLength(2)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-failure-retired-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted',
        retirementOutcome: 'retired-revalidation-failure', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })

    it('one revalidation failure inside its cooldown refuses with the exact revalidation-failure-cooldown reason', () => {
      const candidate = patternCandidate('trace-failure-cooldown-candidate', 'trace-failure-cooldown-source', 10)
      const ledger = appendRevalidationFailureOrThrow(emptyLedgerOrThrow(), candidate, 10)

      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-failure-cooldown', revalidationCacheKey: 'cache-failure-cooldown' }],
        ledger, evaluationLsn: 11,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger.records).toHaveLength(1)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-failure-cooldown-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'revalidation-failure-cooldown', densityOutcome: 'not-attempted',
        retirementOutcome: 'not-retired', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })

    it('a satisfied instance past its retirement age refuses with the exact retired-satisfied-age reason', () => {
      const candidate = patternCandidate('trace-satisfied-age-candidate', 'trace-satisfied-age-source', 0)
      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{
          candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs,
          rankingCacheKey: 'cache-satisfied-age', revalidationCacheKey: 'cache-satisfied-age', satisfiedCompletionLsn: 0,
        }],
        ledger: emptyLedgerOrThrow(), evaluationLsn: 8,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger.records).toHaveLength(0)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-satisfied-age-candidate', assertionIds: [],
        revalidationOutcome: 'still-legal', exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted',
        retirementOutcome: 'retired-satisfied-age', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })

    it('a stale pattern ledger-policy identity refuses through the real pass and reaches the trusted trace with its exact reason', () => {
      // The pass takes the ledger identity as an explicit input, so a stale one
      // reaches revalidation verbatim. This is the composition-level half of
      // the reachability proof for
      // `'pattern-presentation-ledger-policy-mismatch'`: its direct half lives
      // in attentionNarrativePatternRevalidation.test.ts.
      const candidate = patternCandidate('trace-stale-ledger-candidate', 'trace-stale-ledger-source', 10)
      const ledger = emptyLedgerOrThrow()

      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{
          candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs,
          rankingCacheKey: 'cache-stale-ledger', revalidationCacheKey: 'cache-stale-ledger',
        }],
        ledger,
        evaluationLsn: 10,
        patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v0',
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })

      // Nothing was presented, and the append-only ledger is untouched -- same
      // reference, same record count, no successful pattern record.
      expect(pass.presentation).toBeNull()
      expect(pass.ledger).toBe(ledger)
      expect(pass.ledger.records).toHaveLength(0)
      expect(pass.ledger.records.filter((record) => record.sourceKind === 'narrative_pattern_instance')).toHaveLength(0)

      // Revalidation failed first, so no assertion, package, or render work
      // ran: the attempt stops at `revalidation-refused` with no assertion ids.
      expect(pass.attempts).toHaveLength(1)
      expect(pass.attempts[0]).toEqual({
        candidateId: 'trace-stale-ledger-candidate',
        outcome: 'revalidation-refused',
        revalidationReason: 'pattern-presentation-ledger-policy-mismatch',
        assertionIds: [],
        refusalDetail: 'pattern-presentation-ledger-policy-mismatch',
      })

      // The exhaustive mapping's structural/identity arm: the policy check
      // never ran, so all three later fields are truthfully `not-attempted`.
      expect(pass.decisions).toHaveLength(1)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-stale-ledger-candidate', assertionIds: [],
        revalidationOutcome: 'pattern-presentation-ledger-policy-mismatch',
        exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted',
        retirementOutcome: 'not-attempted', ledgerAppend: 'not-appended',
      })

      // The trusted trace carries the pass's own decision byte-for-byte.
      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      expect(traced.kind).toBe('ok')
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
      expect(canonicalSerialize(traced.trace.patternPresentationDecisions))
        .toBe(canonicalSerialize(pass.decisions))

      // ...and the frozen observable projection neither moves nor leaks the
      // engine-only reason.
      const withoutDecisions = buildAttentionTrace(base)
      if (withoutDecisions.kind !== 'ok') throw new Error('expected a trace')
      const observable = canonicalAttentionObservableTraceBytes(traced.trace)
      expect(observable).toBe(canonicalAttentionObservableTraceBytes(withoutDecisions.trace))
      expect(observable).not.toContain('pattern-presentation-ledger-policy-mismatch')
      expect(observable).not.toContain('trace-stale-ledger-candidate')
    })

    it('a structurally malformed ledger (duplicate record identity) refuses with the exact malformed-ledger-history reason', () => {
      const filler = patternCandidate('trace-malformed-filler', 'trace-malformed-filler-source', 0)
      const clean = presentOrThrow(emptyLedgerOrThrow(), filler, 0)
      const [record] = clean.records
      if (record === undefined) throw new Error('expected one real record')
      // A structurally impossible duplicate-identity ledger no legitimate
      // append path could ever produce.
      const malformed: AttentionLedger = Object.freeze({
        ledgerPolicyVersion: clean.ledgerPolicyVersion,
        records: Object.freeze([record, record]),
      })

      const candidate = patternCandidate('trace-malformed-candidate', 'trace-malformed-source', 10)
      const pass = runAttentionPatternPresentationPass({
        orderedCandidates: [{ candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-malformed', revalidationCacheKey: 'cache-malformed' }],
        ledger: malformed, evaluationLsn: 10,
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      })
      expect(pass.presentation).toBeNull()
      expect(pass.ledger).toBe(malformed)
      expect(pass.decisions[0]).toEqual({
        candidateId: 'trace-malformed-candidate', assertionIds: [],
        revalidationOutcome: 'malformed-ledger-history', exposureCooldownOutcome: 'not-attempted', densityOutcome: 'not-attempted',
        retirementOutcome: 'not-attempted', ledgerAppend: 'not-appended',
      })

      const traced = buildAttentionTrace({ ...base, patternPresentationDecisions: pass.decisions })
      if (traced.kind !== 'ok') throw new Error('expected a trace')
      expect(traced.trace.patternPresentationDecisions).toEqual(pass.decisions)
    })
  })
})
