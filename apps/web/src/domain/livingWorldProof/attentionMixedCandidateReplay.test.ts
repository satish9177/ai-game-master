import { describe, expect, it } from 'vitest'
import { normalizeAttentionCandidates } from './attentionCandidate'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import {
  appendAttentionLedgerRecord,
  createAttentionLedger,
  evaluateAttentionPatternPresentationPolicy,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
} from './attentionLedger'
import { ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION } from './attentionDirectEvidenceAssertion'
import { ATTENTION_EXPOSURE_POLICY_VERSION } from './attentionCandidatePolicy'
import { ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION } from './attentionNarrativePatternResourcePolicy'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import { applyNarrativePatternStructuralRetention } from './attentionNarrativePatternResourcePolicy'
import { mintPatternEvidenceViews, aidRecord } from './attentionNarrativePatternScenario'
import { constructAttentionReadableSurface, ATTENTION_READABLE_SURFACE_SCHEMA_VERSION } from './attentionReadableBoundary'
import {
  attemptAttentionQuestPresentation,
  canonicalAttentionTraceBytes,
  deriveAttentionPatternPrimeCandidates,
  runAttentionMixedFamilyEvaluation,
  runAttentionQuestCandidatePrimePipeline,
  runAttentionQuestCandidateReplayPass,
  stableWorldReplayPassInput,
} from './attentionReplay'
import {
  buildB6MixedEvaluationFixture,
  buildB6StageASingleQuestCandidate,
  buildAttentionReplayQuestCandidateOnlyWorld,
  buildAttentionReplayTwoQuestCandidateWorld,
} from './attentionReplayScenario'
import { buildAttentionQuestCandidateTwoVisibleCandidates } from './attentionQuestCandidateScenario'
import { ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN } from './attentionStageAQuestOnlyGolden'
import { attentionLedgerFeatures } from './attentionLedger'
import { canonicalSerialize } from './canonicalSerialization'
import { ATTENTION_TEMPLATE_VERSION } from './attentionCandidatePolicy'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import { buildAttentionTrace } from './attentionTrace'

const EMPTY_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

function patternFixture() {
  const views = mintPatternEvidenceViews([
    aidRecord('aid-a-b', 10, 'a', 'b'),
    aidRecord('aid-b-a', 12, 'b', 'a'),
  ])
  const monitor = reconstructNarrativePatternInstances({ patternEvidenceViews: views, evaluationSnapshotLsn: 20 })
  if (monitor.kind !== 'ok') throw new Error('expected monitor result')
  const retention = applyNarrativePatternStructuralRetention(monitor.instances)
  const surface = constructAttentionReadableSurface({
    surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 20,
  }, Object.freeze([]), Object.freeze([]), views)
  if (surface.kind !== 'ok') throw new Error('expected surface')
  const normalized = normalizeAttentionCandidates(surface.surface, retention.retainedRankableInstances)
  if (normalized.kind !== 'ok') throw new Error('expected pattern candidate')
  const candidate = normalized.attentionCandidates[0]
  const instance = retention.retainedRankableInstances.find((value) => value.patternInstanceId === candidate?.sourceId)
  if (candidate?.sourceKind !== 'narrative_pattern_instance' || instance === undefined) throw new Error('expected pattern candidate')
  return { views, candidate, instance }
}

function emptyLedger() {
  const result = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (result.kind !== 'ok') throw new Error('expected ledger')
  return result.ledger
}

function pairedPatternFixture() {
  const views = mintPatternEvidenceViews([
    aidRecord('aid-a-b', 10, 'a', 'b'),
    aidRecord('aid-b-a', 12, 'b', 'a'),
    aidRecord('aid-c-d', 14, 'c', 'd'),
    aidRecord('aid-d-c', 16, 'd', 'c'),
  ])
  const monitor = reconstructNarrativePatternInstances({ patternEvidenceViews: views, evaluationSnapshotLsn: 20 })
  if (monitor.kind !== 'ok') throw new Error('expected paired monitor result')
  const retention = applyNarrativePatternStructuralRetention(monitor.instances)
  const surface = constructAttentionReadableSurface({
    surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 20,
  }, Object.freeze([]), Object.freeze([]), views)
  if (surface.kind !== 'ok') throw new Error('expected paired surface')
  const normalized = normalizeAttentionCandidates(surface.surface, retention.retainedRankableInstances)
  if (normalized.kind !== 'ok') throw new Error('expected paired pattern candidates')
  const candidates = normalized.attentionCandidates.filter((candidate) => candidate.sourceKind === 'narrative_pattern_instance')
  const instances = candidates.map((candidate) => retention.retainedRankableInstances.find((instance) => instance.patternInstanceId === candidate.sourceId))
  if (candidates.length < 2 || instances.some((instance) => instance === undefined)) throw new Error('expected at least two retained pattern candidates')
  return { views, candidates, instances }
}

function appendPatternHistory(
  ledger: ReturnType<typeof emptyLedger>,
  candidate: ReturnType<typeof pairedPatternFixture>['candidates'][number],
  presentationLsn: number,
  outcome: 'presentation-ready' | 'revalidation-failed',
  candidateId = candidate.candidateId,
) {
  const appended = appendAttentionLedgerRecord(ledger, {
    attentionCandidate: { ...candidate, candidateId, sourceId: `${candidateId}-source`, rankingSnapshotLsn: presentationLsn },
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    templateChannelPolicyVersion: 'attention-template-channel-policy-v1',
    templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
    outcome,
    ...(outcome === 'presentation-ready' ? { renderedOutputIdentity: `history-output-${candidateId}-${presentationLsn}` } : {}),
    patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
    presentationLsn,
    resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  })
  if (appended.kind !== 'ok') throw new Error('expected sanctioned pattern-history append: ' + appended.reason)
  return appended.ledger
}

/**
 * One real quest-branch ledger record, appended through the committed route.
 * Plan §11.6 item 10 requires the incoming ledger to hold **both** families'
 * history; every lifecycle case below therefore starts from this seed.
 */
function questSeededLedger() {
  const world = buildAttentionReplayQuestCandidateOnlyWorld()
  const prime = runAttentionQuestCandidatePrimePipeline(world)
  if (prime.kind !== 'ok') throw new Error('expected primed quest world')
  const normalized = normalizeAttentionCandidates(prime.surface)
  if (normalized.kind !== 'ok') throw new Error('expected a normalized quest candidate')
  const candidate = normalized.attentionCandidates[0]
  if (candidate?.sourceKind !== 'quest_candidate') throw new Error('expected a quest candidate')
  const appended = appendAttentionLedgerRecord(emptyLedger(), {
    attentionCandidate: candidate,
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    templateChannelPolicyVersion: 'attention-template-channel-policy-v1',
    templateVersion: ATTENTION_TEMPLATE_VERSION,
    outcome: 'presentation-ready',
    renderedOutputIdentity: 'b6-quest-history-output',
  })
  if (appended.kind !== 'ok') throw new Error('expected a sanctioned quest-history append: ' + appended.reason)
  return Object.freeze({
    ledger: appended.ledger,
    questCandidateId: candidate.candidateId,
    questFeatureBytes: canonicalSerialize(attentionLedgerFeatures(appended.ledger, candidate.candidateId)),
  })
}

/**
 * RN019 §9.7 / plan §11.6 item 10 — the isolation obligation every one of the
 * six incoming-ledger lifecycle cases carries. Both comparison ledgers are built
 * only through `createAttentionLedger` plus the committed append route; nothing
 * here assembles or filters a record array by hand.
 */
function expectIncomingMixedLedgerIsolation(input: {
  readonly seeded: ReturnType<typeof questSeededLedger>
  readonly incomingWithQuestRecord: ReturnType<typeof emptyLedger>
  readonly incomingWithoutQuestRecord: ReturnType<typeof emptyLedger>
  readonly patternCandidateId: string
  readonly evaluationLsn: number
  readonly resultLedger: ReturnType<typeof emptyLedger>
  readonly satisfiedCompletionLsn?: number
}) {
  // The incoming ledger genuinely holds both families.
  expect(input.incomingWithQuestRecord.records.some((record) => record.sourceKind === 'quest_candidate')).toBe(true)

  // The quest record contributes zero to pattern density, exposure, cooldown,
  // and retirement: the complete policy decision is byte-identical with and
  // without it, so every one of the four bookkeeping counters is unmoved.
  const policyOf = (ledger: ReturnType<typeof emptyLedger>) => evaluateAttentionPatternPresentationPolicy({
    ledger, candidateId: input.patternCandidateId, evaluationLsn: input.evaluationLsn,
    ...(input.satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn: input.satisfiedCompletionLsn }),
  })
  expect(canonicalSerialize(policyOf(input.incomingWithQuestRecord)))
    .toBe(canonicalSerialize(policyOf(input.incomingWithoutQuestRecord)))

  // Symmetrically, pattern records -- both the incoming history and anything
  // this evaluation appended -- alter no quest-only Stage A feature projection.
  expect(canonicalSerialize(attentionLedgerFeatures(input.incomingWithQuestRecord, input.seeded.questCandidateId)))
    .toBe(input.seeded.questFeatureBytes)
  expect(canonicalSerialize(attentionLedgerFeatures(input.resultLedger, input.seeded.questCandidateId)))
    .toBe(input.seeded.questFeatureBytes)
}

function pairedPatternEvaluation(
  replayCaseId: string,
  ledger: ReturnType<typeof emptyLedger>,
  satisfiedCompletionLsn?: number,
) {
  const patterns = pairedPatternFixture()
  const world = buildAttentionReplayQuestCandidateOnlyWorld()
  const snapshot = { ...world.snapshot, candidates: Object.freeze([]) }
  return {
    patterns,
    input: {
      replayCaseId, snapshot, request: world.request,
      patternEvidenceViews: patterns.views, revalidationSnapshot: snapshot, revalidationSnapshotLsn: 20,
      revalidationPatternEvidenceViews: patterns.views, ledger,
      patternPresentationInputs: Object.freeze(patterns.candidates.map((candidate, index) => Object.freeze({
        candidateId: candidate.candidateId,
        directEvidenceAssertionInputs: patterns.instances[index]!.directEvidenceAssertionInputs,
        rankingCacheKey: `paired-pattern-cache-${index}`,
        revalidationCacheKey: `paired-pattern-cache-${index}`,
        ...(index === 0 && satisfiedCompletionLsn !== undefined ? { satisfiedCompletionLsn } : {}),
      }))),
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    },
  }
}

describe('B6 — mixed candidate replay', () => {
  it('orders a legal quest before a legal pattern, appends one quest record, and never attempts the pattern', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const pattern = patternFixture()
    const result = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-quest-first', snapshot: world.snapshot, request: world.request,
      patternEvidenceViews: pattern.views, revalidationSnapshot: world.snapshot, revalidationSnapshotLsn: world.request.rankingSnapshotLsn,
      revalidationPatternEvidenceViews: pattern.views, ledger: emptyLedger(),
      patternPresentationInputs: Object.freeze([{ candidateId: pattern.candidate.candidateId,
        directEvidenceAssertionInputs: pattern.instance.directEvidenceAssertionInputs,
        rankingCacheKey: 'pattern-cache', revalidationCacheKey: 'pattern-cache' }]),
      patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v1',
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected mixed evaluation')
    expect(result.result.presentation?.candidateId).toBe(result.result.retainedCandidates[0]?.candidateId)
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.arbitrationAttempts[1]?.outcome).toBe('not-attempted')
    expect(result.result.trace.playerObservable).not.toHaveProperty('mixedFamilyArbitration')
  })

  it('presents a pattern-only candidate through the real monitor and appends exactly one pattern record', () => {
    const pattern = patternFixture()
    const emptyWorld = buildAttentionReplayQuestCandidateOnlyWorld()
    const noQuestSnapshot = { ...emptyWorld.snapshot, candidates: Object.freeze([]) }
    const result = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-pattern-only', snapshot: noQuestSnapshot, request: emptyWorld.request,
      patternEvidenceViews: pattern.views, revalidationSnapshot: noQuestSnapshot, revalidationSnapshotLsn: 20,
      revalidationPatternEvidenceViews: pattern.views, ledger: emptyLedger(),
      patternPresentationInputs: Object.freeze([{ candidateId: pattern.candidate.candidateId,
        directEvidenceAssertionInputs: pattern.instance.directEvidenceAssertionInputs,
        rankingCacheKey: 'pattern-cache', revalidationCacheKey: 'pattern-cache' }]),
      patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v1',
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected mixed evaluation')
    expect(result.result.presentation?.candidateId).toBe(pattern.candidate.candidateId)
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.ledger.records[0]?.sourceKind).toBe('narrative_pattern_instance')
    expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(1)
  })

  it('continues from a stale quest revalidation into the next legal pattern', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const pattern = patternFixture()
    const emptyQuestSnapshot = { ...world.snapshot, candidates: Object.freeze([]) }
    const result = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-stale-quest-then-pattern', snapshot: world.snapshot, request: world.request,
      patternEvidenceViews: pattern.views, revalidationSnapshot: emptyQuestSnapshot, revalidationSnapshotLsn: world.request.rankingSnapshotLsn,
      revalidationPatternEvidenceViews: pattern.views, ledger: emptyLedger(),
      patternPresentationInputs: Object.freeze([{ candidateId: pattern.candidate.candidateId,
        directEvidenceAssertionInputs: pattern.instance.directEvidenceAssertionInputs,
        rankingCacheKey: 'pattern-cache', revalidationCacheKey: 'pattern-cache' }]),
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected stale-quest continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ sourceKind: 'quest_candidate', outcome: 'revalidation-refused', refusalReason: 'candidate-disappeared', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ sourceKind: 'narrative_pattern_instance', outcome: 'presented', ledgerAppend: 'appended' })
  })

  it('refuses hand-built malformed trusted arbitration without requiring an impossible pipeline path', () => {
    const pattern = patternFixture()
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const noQuestSnapshot = { ...world.snapshot, candidates: Object.freeze([]) }
    const result = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-defensive-trace', snapshot: noQuestSnapshot, request: world.request,
      patternEvidenceViews: pattern.views, revalidationSnapshot: noQuestSnapshot, revalidationSnapshotLsn: 20,
      revalidationPatternEvidenceViews: pattern.views, ledger: emptyLedger(),
      patternPresentationInputs: Object.freeze([{ candidateId: pattern.candidate.candidateId,
        directEvidenceAssertionInputs: pattern.instance.directEvidenceAssertionInputs,
        rankingCacheKey: 'pattern-cache', revalidationCacheKey: 'pattern-cache' }]),
      patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v1',
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    })
    if (result.kind !== 'ok' || result.result.trace.mixedFamilyArbitration === undefined) throw new Error('expected trace')
    const malformed = buildAttentionTrace({
      ...result.result.trace,
      mixedFamilyArbitration: { ...result.result.trace.mixedFamilyArbitration, successfulPresentationCount: 2 },
    })
    expect(malformed).toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })
  })

  /**
   * Plan §11.4 / §11.6 "Trace well-formedness evidence" — all four structural
   * clauses of `invalid-mixed-family-arbitration`, each over a **hand-built**
   * arbitration record passed straight to `buildAttentionTrace`.
   *
   * This literal is **defensive-only**. A correct `runAttentionMixedFamilyEvaluation`
   * cannot emit it — §11.2D makes two successes impossible by construction and
   * every other clause is an invariant the evaluator maintains — so no case here
   * requires a real-pipeline path to it, exactly as the committed B5 literal
   * `invalid-pattern-presentation-decision` is proven today. Nothing is added to
   * production to make these reachable.
   */
  describe('B6 — the four defensive mixed-arbitration well-formedness clauses', () => {
    function baselineTrace() {
      const fixture = buildB6MixedEvaluationFixture({
        replayCaseId: 'b6-trace-wellformedness', ledger: emptyLedger(),
        patternEvidenceViews: mintPatternEvidenceViews([
          aidRecord('wf-aid-a-b', 10, 'a', 'b'), aidRecord('wf-aid-b-a', 12, 'b', 'a'),
          aidRecord('wf-aid-c-d', 14, 'c', 'd'), aidRecord('wf-aid-d-c', 16, 'd', 'c'),
        ]),
      })
      const result = runAttentionMixedFamilyEvaluation(fixture.input)
      if (result.kind !== 'ok' || result.result.trace.mixedFamilyArbitration === undefined) throw new Error('expected a baseline trace')
      const arbitration = result.result.trace.mixedFamilyArbitration
      expect(arbitration.attempts).toHaveLength(2)
      expect(arbitration.attempts[0]?.outcome).toBe('presented')
      expect(arbitration.attempts[1]?.outcome).toBe('not-attempted')
      // The unmodified baseline is accepted, so each refusal below is caused by
      // the one field that case changes and by nothing else.
      expect(buildAttentionTrace({ ...result.result.trace }).kind).toBe('ok')
      return { trace: result.result.trace, arbitration }
    }

    it('1 — successfulPresentationCount greater than 1 refuses', () => {
      const { trace, arbitration } = baselineTrace()
      expect(buildAttentionTrace({ ...trace, mixedFamilyArbitration: { ...arbitration, successfulPresentationCount: 2 } }))
        .toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })
    })

    it('2 — a winner named without a presented attempt refuses', () => {
      const { trace, arbitration } = baselineTrace()
      const withoutPresentedAttempt = {
        ...arbitration,
        attempts: Object.freeze(arbitration.attempts.map((attempt, index) => (
          index === 0
            ? { ...attempt, outcome: 'revalidation-refused' as const, refusalReason: 'candidate-disappeared', ledgerAppend: 'not-appended' as const, continued: true }
            : attempt
        ))),
      }
      // The winner fields still name a winner, but no attempt reports `presented`.
      expect(withoutPresentedAttempt.winnerCandidateId).not.toBeNull()
      expect(buildAttentionTrace({ ...trace, mixedFamilyArbitration: withoutPresentedAttempt }))
        .toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })
    })

    it('3 — a rankPosition outside or inconsistent with rankedCandidateIds refuses', () => {
      const { trace, arbitration } = baselineTrace()
      // (a) outside the ranked list entirely.
      const outOfRange = {
        ...arbitration,
        attempts: Object.freeze(arbitration.attempts.map((attempt, index) => (
          index === 1 ? { ...attempt, rankPosition: arbitration.rankedCandidateIds.length } : attempt
        ))),
      }
      expect(buildAttentionTrace({ ...trace, mixedFamilyArbitration: outOfRange }))
        .toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })

      // (b) inside the list, but indexing a different candidate than the attempt names.
      const inconsistent = {
        ...arbitration,
        attempts: Object.freeze(arbitration.attempts.map((attempt, index) => (
          index === 1 ? { ...attempt, rankPosition: 0 } : attempt
        ))),
      }
      expect(buildAttentionTrace({ ...trace, mixedFamilyArbitration: inconsistent }))
        .toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })
    })

    it('4 — a post-winner attempt not marked not-attempted refuses', () => {
      const { trace, arbitration } = baselineTrace()
      const postWinnerAttempted = {
        ...arbitration,
        attempts: Object.freeze(arbitration.attempts.map((attempt, index) => (
          index === 1
            ? { ...attempt, outcome: 'revalidation-refused' as const, refusalReason: 'candidate-disappeared', continued: true }
            : attempt
        ))),
      }
      expect(buildAttentionTrace({ ...trace, mixedFamilyArbitration: postWinnerAttempted }))
        .toEqual({ kind: 'refused', reason: 'invalid-mixed-family-arbitration' })
    })

    it('every refusal uses the closed vocabulary and leaks nothing observable', () => {
      const { trace, arbitration } = baselineTrace()
      const refused = buildAttentionTrace({ ...trace, mixedFamilyArbitration: { ...arbitration, successfulPresentationCount: 2 } })
      expect(refused.kind).toBe('refused')
      if (refused.kind !== 'refused') throw new Error('expected a refusal')
      // A closed literal from the trace's own refusal union -- never free text.
      expect(refused.reason).toBe('invalid-mixed-family-arbitration')
      expect(Object.keys(refused)).toEqual(['kind', 'reason'])
      // A refused build produces no trace at all, so nothing can be projected.
      expect(refused).not.toHaveProperty('trace')
    })
  })

  it.each([
    ['successful-cooldown', (ledger: ReturnType<typeof emptyLedger>, candidate: ReturnType<typeof pairedPatternFixture>['candidates'][number]) =>
      appendPatternHistory(ledger, candidate, 19, 'presentation-ready')],
    ['retired-exposure', (ledger: ReturnType<typeof emptyLedger>, candidate: ReturnType<typeof pairedPatternFixture>['candidates'][number]) =>
      appendPatternHistory(appendPatternHistory(ledger, candidate, 1, 'presentation-ready'), candidate, 3, 'presentation-ready')],
    ['retired-revalidation-failure', (ledger: ReturnType<typeof emptyLedger>, candidate: ReturnType<typeof pairedPatternFixture>['candidates'][number]) =>
      appendPatternHistory(appendPatternHistory(ledger, candidate, 1, 'revalidation-failed'), candidate, 3, 'revalidation-failed')],
  ] as const)('continues after candidate-local %s and presents the next legal pattern', (reason, history) => {
    const fixture = pairedPatternFixture()
    const seeded = questSeededLedger()
    const ledger = history(seeded.ledger, fixture.candidates[0]!)
    const { input } = pairedPatternEvaluation(`b6-${reason}`, ledger)
    const result = runAttentionMixedFamilyEvaluation(input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected candidate-local continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: reason, continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'presented', continued: false, ledgerAppend: 'appended' })
    expect(result.result.presentation?.candidateId).toBe(result.result.arbitrationAttempts[1]?.candidateId)
    expect(result.result.ledger.records).toHaveLength(ledger.records.length + 1)

    expectIncomingMixedLedgerIsolation({
      seeded,
      incomingWithQuestRecord: ledger,
      incomingWithoutQuestRecord: history(emptyLedger(), fixture.candidates[0]!),
      patternCandidateId: fixture.candidates[0]!.candidateId,
      evaluationLsn: input.revalidationSnapshotLsn,
      resultLedger: result.result.ledger,
    })
  })

  it('continues after candidate-local retired-satisfied-age and presents the next legal pattern', () => {
    const fixture = pairedPatternFixture()
    const seeded = questSeededLedger()
    const { input } = pairedPatternEvaluation('b6-retired-satisfied-age', seeded.ledger, 12)
    const result = runAttentionMixedFamilyEvaluation(input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected satisfied-age continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'retired-satisfied-age', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'presented', ledgerAppend: 'appended' })
    expect(result.result.presentation?.candidateId).toBe(fixture.candidates[1]?.candidateId)

    expectIncomingMixedLedgerIsolation({
      seeded,
      incomingWithQuestRecord: seeded.ledger,
      incomingWithoutQuestRecord: emptyLedger(),
      patternCandidateId: fixture.candidates[0]!.candidateId,
      evaluationLsn: input.revalidationSnapshotLsn,
      resultLedger: result.result.ledger,
      satisfiedCompletionLsn: 12,
    })
  })

  it('continues after a candidate-local direct-evidence assertion refusal and presents the next legal pattern', () => {
    const { input } = pairedPatternEvaluation('b6-assertion-build', emptyLedger())
    const first = input.patternPresentationInputs[0]!
    const malformedFirstAssertion = Object.freeze({ ...first.directEvidenceAssertionInputs[0]!, actorId: 'a\nb' })
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      patternPresentationInputs: Object.freeze([
        Object.freeze({ ...first, directEvidenceAssertionInputs: Object.freeze([malformedFirstAssertion, ...first.directEvidenceAssertionInputs.slice(1)]) }),
        ...input.patternPresentationInputs.slice(1),
      ]),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected assertion continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'assertion-build-refused', refusalReason: 'invalid-direct-evidence-field-character', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'presented', ledgerAppend: 'appended' })
  })

  it('continues after a candidate-local direct-evidence package refusal and presents the next legal pattern', () => {
    const { input } = pairedPatternEvaluation('b6-package', emptyLedger())
    const first = input.patternPresentationInputs[0]!
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      patternPresentationInputs: Object.freeze([
        Object.freeze({ ...first, directEvidenceAssertionInputs: Object.freeze([...first.directEvidenceAssertionInputs].reverse()) }),
        ...input.patternPresentationInputs.slice(1),
      ]),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected package continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'package-refused', refusalReason: 'pattern-assertion-out-of-order', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'presented', ledgerAppend: 'appended' })
  })

  it('continues after a candidate-local template refusal and presents the next legal pattern', () => {
    const { input } = pairedPatternEvaluation('b6-template', emptyLedger())
    const first = input.patternPresentationInputs[0]!
    const firstAssertion = first.directEvidenceAssertionInputs[0]
    if (firstAssertion?.assertionKind !== 'public_aid') throw new Error('expected aid assertion input')
    // The assertion builder validates visible field characters while the
    // renderer independently validates this closed enum. The package therefore
    // remains structurally valid and the real template owns the refusal.
    const rendererInvalidAssertion = Object.freeze({
      assertionKind: 'public_harm_severity' as const,
      sourceRecordId: firstAssertion.sourceRecordId,
      visibilityProvenanceId: firstAssertion.visibilityProvenanceId,
      actorId: firstAssertion.actorId,
      targetId: firstAssertion.targetId,
      publicSeverityBand: 'not-a-severity-band' as unknown as 'minor',
    })
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      patternPresentationInputs: Object.freeze([
        Object.freeze({ ...first, directEvidenceAssertionInputs: Object.freeze([rendererInvalidAssertion, ...first.directEvidenceAssertionInputs.slice(1)]) }),
        ...input.patternPresentationInputs.slice(1),
      ]),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected template continuation')
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'render-refused', refusalReason: 'malformed-pattern-assertion', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'presented', ledgerAppend: 'appended' })
  })

  it('truthfully repeats a globally invalid incoming-ledger header append refusal with no winner', () => {
    // Records remain the immutable empty history created by createAttentionLedger.
    // Only the ledger header is deliberately stale, which the append boundary
    // owns and validates after policy revalidation has completed.
    const staleLedgerHeader = Object.freeze({ ...emptyLedger(), ledgerPolicyVersion: 'attention-ledger-policy-v9' })
    const { input } = pairedPatternEvaluation('b6-ledger-append', staleLedgerHeader)
    const result = runAttentionMixedFamilyEvaluation(input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ledger-append continuation')
    expect(result.result.arbitrationAttempts.length).toBeGreaterThanOrEqual(2)
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'ledger-append-refused', refusalReason: 'unsupported-ledger-policy-version', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'ledger-append-refused', refusalReason: 'unsupported-ledger-policy-version', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger).toBe(staleLedgerHeader)
  })

  it('item 10 — an incoming ledger holding both families keeps each family\'s bookkeeping wholly isolated', () => {
    const fixture = pairedPatternFixture()
    const seeded = questSeededLedger()
    // One quest record and one pattern record, both through the committed route.
    const mixedIncoming = appendPatternHistory(seeded.ledger, fixture.candidates[0]!, 19, 'presentation-ready')
    expect(mixedIncoming.records.map((record) => record.sourceKind))
      .toEqual(['quest_candidate', 'narrative_pattern_instance'])

    const { input } = pairedPatternEvaluation('b6-mixed-ledger-isolation', mixedIncoming)
    const result = runAttentionMixedFamilyEvaluation(input)
    if (result.kind !== 'ok') throw new Error('expected the mixed-history evaluation')

    expectIncomingMixedLedgerIsolation({
      seeded,
      incomingWithQuestRecord: mixedIncoming,
      incomingWithoutQuestRecord: appendPatternHistory(emptyLedger(), fixture.candidates[0]!, 19, 'presentation-ready'),
      patternCandidateId: fixture.candidates[0]!.candidateId,
      evaluationLsn: input.revalidationSnapshotLsn,
      resultLedger: result.result.ledger,
    })

    // The quest record is invisible to the pattern branch's own reads, and the
    // pattern records are invisible to the quest-only feature projection.
    expect(attentionLedgerFeatures(result.result.ledger, seeded.questCandidateId).exposureCount).toBe(1)
    expect(attentionLedgerFeatures(result.result.ledger, fixture.candidates[0]!.candidateId).exposureCount).toBe(0)
  })

  it('truthfully repeats the global density refusal for the next pattern and leaves the incoming ledger unchanged', () => {
    const fixture = pairedPatternFixture()
    const seeded = questSeededLedger()
    let ledger = seeded.ledger
    let withoutQuest = emptyLedger()
    for (const [index, lsn] of [5, 6, 7, 8].entries()) {
      ledger = appendPatternHistory(ledger, fixture.candidates[index % 2]!, lsn, 'presentation-ready', `density-history-${index}`)
      withoutQuest = appendPatternHistory(withoutQuest, fixture.candidates[index % 2]!, lsn, 'presentation-ready', `density-history-${index}`)
    }
    const beforeRecords = ledger.records
    const { input } = pairedPatternEvaluation('b6-density-window-full', ledger)
    const result = runAttentionMixedFamilyEvaluation(input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected global density continuation')
    expect(result.result.arbitrationAttempts.length).toBeGreaterThanOrEqual(2)
    expect(result.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'density-window-full', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.arbitrationAttempts[1]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'density-window-full', continued: true, ledgerAppend: 'not-appended' })
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger).toBe(ledger)
    expect(result.result.ledger.records).toBe(beforeRecords)
    expect(result.result.trace.playerObservable).not.toHaveProperty('mixedFamilyArbitration')

    expectIncomingMixedLedgerIsolation({
      seeded,
      incomingWithQuestRecord: ledger,
      incomingWithoutQuestRecord: withoutQuest,
      patternCandidateId: fixture.candidates[0]!.candidateId,
      evaluationLsn: input.revalidationSnapshotLsn,
      resultLedger: result.result.ledger,
    })
  })

  /**
   * Plan §11.6 item 4(f) — `malformed-ledger-history`, driven through the real
   * evaluator by its **named reachable lever**: "the evaluation coordinate the
   * policy read range-checks, not a hand-corrupted record array".
   *
   * Why that is the only legal lever, recorded so it is never re-derived:
   *
   *  - `evaluateAttentionPatternPresentationPolicy` (attentionLedger.ts) returns
   *    this literal for exactly three conditions: an evaluation coordinate
   *    outside `isAttentionRankingSnapshotLsnInRange`, a **duplicate record
   *    identity**, or a **wrong-branch record**;
   *  - the committed append route refuses `duplicate-record-identity` and
   *    `mixed-ledger-record-branch`, so neither of the latter two can be created
   *    through `createAttentionLedger` + `appendAttentionLedgerRecord`. Their
   *    contract evidence is owned by the committed, frozen
   *    `attentionLedger.test.ts` ("a duplicate record id anywhere in the ledger
   *    is treated as malformed history"), which forges a two-identical-record
   *    array directly at the policy read. B6 does not repeat that forgery: an
   *    arbitrary record array is not an evaluator input;
   *  - the coordinate lever, by contrast, is a genuine `runAttentionMixedFamilyEvaluation`
   *    input. `Number.MAX_SAFE_INTEGER + 1` passes the boundary's
   *    `isNonNegativeInteger` gate (it is a non-negative integer) but fails the
   *    policy's `Number.isSafeInteger` range check, so it reaches the policy read
   *    as a real evaluation coordinate.
   *
   * **Outcome: no legal evaluator input reaches the literal**, so item 4(f)'s
   * single named escape applies. The precise reason is measured, not assumed:
   * the coordinate lever is genuinely out of range for the policy read, but the
   * **B3 monitor range-checks the very same coordinate strictly earlier in the
   * evaluator**. RN019 §9.4 step 1 (reconstruct at the revalidation coordinate)
   * runs before step 3 (policy/resource check), and
   * `reconstructNarrativePatternInstances` refuses `invalid-evaluation-snapshot`
   * for any non-safe-integer coordinate. The pattern is therefore absent from
   * the revalidation-coordinate lookup and refuses `candidate-disappeared`
   * before the policy read is ever consulted.
   *
   * The three parts of the discharge are asserted below, in order: the lever is
   * real at the owning function; the earlier gate is what intercepts it; and the
   * retained structural obligation still holds — the evaluator surfaces this
   * whole class as an evaluation-global row-2 continue with no append, an
   * unconsumed slot, the next ranked pattern attempted, and no winner.
   */
  it('discharges malformed-ledger-history: the coordinate lever is real at the policy read but intercepted by the earlier monitor gate', () => {
    const outOfRangeCoordinate = Number.MAX_SAFE_INTEGER + 1
    // (i) The lever is genuine at the owning function. `attentionLedger.ts`'s
    //     policy read range-checks the evaluation coordinate, and this value is
    //     a non-negative integer (so upstream `isNonNegativeInteger` gates admit
    //     it) that is not a safe integer (so the policy read refuses it). This
    //     re-anchors, at the owning function, the same literal the committed and
    //     frozen `attentionLedger.test.ts` pins for duplicate-record history.
    expect(Number.isInteger(outOfRangeCoordinate) && outOfRangeCoordinate >= 0).toBe(true)
    expect(Number.isSafeInteger(outOfRangeCoordinate)).toBe(false)
    expect(evaluateAttentionPatternPresentationPolicy({
      ledger: emptyLedger(), candidateId: 'any-candidate', evaluationLsn: outOfRangeCoordinate,
    }).reason).toBe('malformed-ledger-history')

    // (ii) The earlier gate. The B3 monitor rejects the identical coordinate,
    //      and the evaluator reconstructs before it revalidates, so the policy
    //      read is unreachable from this input.
    const views = mintPatternEvidenceViews([aidRecord('discharge-a-b', 10, 'a', 'b'), aidRecord('discharge-b-a', 12, 'b', 'a')])
    expect(reconstructNarrativePatternInstances({
      patternEvidenceViews: views, evaluationSnapshotLsn: outOfRangeCoordinate,
    })).toEqual({ kind: 'refused', reason: 'invalid-evaluation-snapshot' })
  })

  it('discharges malformed-ledger-history: duplicate and wrong-branch history cannot be created through the committed append route', () => {
    const fixture = pairedPatternFixture()

    // (iii-a) Duplicate record identity -- the condition `attentionLedger.test.ts`
    //         forges directly at the policy read by building a two-identical-record
    //         array. The committed append route cannot produce it: `recordId` is
    //         derived from the appended `sequence`, so appending byte-identical
    //         content twice yields two *distinct* identities rather than a
    //         duplicate. There is no legal route to that history, which is why B6
    //         supplies no such ledger as evaluator input and adds no test-only
    //         append route to manufacture one.
    const once = appendPatternHistory(emptyLedger(), fixture.candidates[0]!, 5, 'presentation-ready')
    const twice = appendPatternHistory(once, fixture.candidates[0]!, 5, 'presentation-ready')
    expect(twice.records).toHaveLength(2)
    expect(twice.records[0]?.recordId).not.toBe(twice.records[1]?.recordId)
    expect(new Set(twice.records.map((record) => record.recordId)).size).toBe(twice.records.length)

    // (iii-b) Wrong-branch record. A pattern candidate offered without its
    //         pattern-branch fields is refused by the append route, so a
    //         structurally mixed record cannot enter a legally built ledger.
    const wrongBranch = appendAttentionLedgerRecord(emptyLedger(), {
      attentionCandidate: fixture.candidates[0]!,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: 'attention-template-channel-policy-v1',
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      outcome: 'presentation-ready',
      renderedOutputIdentity: 'history-output-wrong-branch',
    })
    expect(wrongBranch.kind).toBe('refused')
    if (wrongBranch.kind !== 'refused') throw new Error('expected a wrong-branch refusal')
    expect(wrongBranch.reason).toBe('missing-pattern-presentation-ledger-policy-version')
  })

  it('discharges malformed-ledger-history: the retained structural obligation is an evaluation-global row-2 continue with no winner', () => {
    const seeded = questSeededLedger()
    const ledger = seeded.ledger
    const { input } = pairedPatternEvaluation('b6-malformed-ledger-history-obligation', ledger)
    const result = runAttentionMixedFamilyEvaluation({ ...input, revalidationSnapshotLsn: Number.MAX_SAFE_INTEGER + 1 })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected an evaluation-global continue')

    // Whatever row-2 literal the class produces, the *shape* is the contract:
    // every ranked pattern is attempted and refused, nothing is appended, the
    // slot stays unconsumed, and the evaluation legitimately ends with no winner.
    expect(result.result.arbitrationAttempts.length).toBeGreaterThanOrEqual(2)
    for (const attempt of result.result.arbitrationAttempts) {
      expect(attempt).toMatchObject({ outcome: 'revalidation-refused', continued: true, ledgerAppend: 'not-appended' })
      expect(attempt.outcome).not.toBe('not-attempted')
    }
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger).toBe(ledger)
    expect(result.result.ledger.records).toBe(ledger.records)
    expect(result.result.trace.mixedFamilyArbitration?.presentationSlotConsumed).toBe(false)
    expect(result.result.trace.mixedFamilyArbitration?.winnerCandidateId).toBeNull()
    expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(0)

    // The sixth lifecycle case carries the same isolation obligation.
    expect(canonicalSerialize(attentionLedgerFeatures(result.result.ledger, seeded.questCandidateId)))
      .toBe(seeded.questFeatureBytes)
  })

  /**
   * The forged-header case below is deliberately **not** incoming lifecycle
   * history. Its `records` are the immutable empty array `createAttentionLedger`
   * produced; only the container's `ledgerPolicyVersion` header is stale. That
   * makes it row-6 **append**-refusal input (`unsupported-ledger-policy-version`
   * at `appendAttentionLedgerRecord`), reached only after policy revalidation
   * has already passed — it is not, and must not be read as, a
   * `malformed-ledger-history` history fixture.
   */
  it('classifies the forged ledger header as row-6 append-refusal input, not as incoming lifecycle history', () => {
    const created = emptyLedger()
    const staleLedgerHeader = Object.freeze({ ...created, ledgerPolicyVersion: 'attention-ledger-policy-v9' })
    // The records are literally the immutable array `createAttentionLedger`
    // produced -- by reference, not merely by value. Only the header is stale.
    expect(staleLedgerHeader.records).toBe(created.records)
    expect(staleLedgerHeader.records).toEqual([])
    expect(staleLedgerHeader.ledgerPolicyVersion).not.toBe(ATTENTION_LEDGER_POLICY_VERSION)

    const { input } = pairedPatternEvaluation('b6-forged-header-classification', staleLedgerHeader)
    const result = runAttentionMixedFamilyEvaluation(input)
    if (result.kind !== 'ok') throw new Error('expected append-refusal continuation')
    // The refusal is the append stage's own literal, never the policy read's.
    expect(result.result.arbitrationAttempts[0]?.outcome).toBe('ledger-append-refused')
    expect(result.result.arbitrationAttempts[0]?.refusalReason).toBe('unsupported-ledger-policy-version')
    expect(result.result.arbitrationAttempts[0]?.refusalReason).not.toBe('malformed-ledger-history')
  })
})

/**
 * Plan §11.6 items 6-13 — evaluator-level evidence for the remaining mixed
 * matrix. Every expectation is an independent literal or an independently
 * computed byte string; nothing is generated from the implementation under test.
 */
describe('B6 — mixed evaluator matrix items 6-13', () => {
  const TWO_PATTERN_RECORDS = [
    aidRecord('matrix-aid-a-b', 10, 'a', 'b'),
    aidRecord('matrix-aid-b-a', 12, 'b', 'a'),
    aidRecord('matrix-aid-c-d', 14, 'c', 'd'),
    aidRecord('matrix-aid-d-c', 16, 'd', 'c'),
  ]
  const TWO_PATTERN_VIEWS = mintPatternEvidenceViews(TWO_PATTERN_RECORDS)
  const TWO_PATTERN_VIEWS_FROM_REVERSED_RECORDS = mintPatternEvidenceViews([...TWO_PATTERN_RECORDS].reverse())

  function mixedFixture(replayCaseId: string, order: 'authored' | 'reversed', ledger = emptyLedger()) {
    const { first, second } = buildAttentionQuestCandidateTwoVisibleCandidates()
    return buildB6MixedEvaluationFixture({
      replayCaseId, ledger, order,
      questCandidates: [first, second],
      // The pattern side reverses one layer earlier, at the raw records, because
      // an accessor-minted view collection is canonically ordered by contract.
      patternEvidenceViews: order === 'authored' ? TWO_PATTERN_VIEWS : TWO_PATTERN_VIEWS_FROM_REVERSED_RECORDS,
    })
  }

  function observableBytesOf(result: { readonly trace: { readonly playerObservable: unknown } }) {
    return canonicalSerialize(result.trace.playerObservable)
  }

  it('item 6 — reversed genuinely mixed input produces an identical evaluation in every recorded dimension', () => {
    // Both families' inputs are genuinely permuted: the quest snapshot order is
    // reversed, and the pattern views are minted from a reversed record list.
    expect(canonicalSerialize(TWO_PATTERN_VIEWS_FROM_REVERSED_RECORDS)).toBe(canonicalSerialize(TWO_PATTERN_VIEWS))
    expect(TWO_PATTERN_VIEWS_FROM_REVERSED_RECORDS).not.toBe(TWO_PATTERN_VIEWS)

    const authored = runAttentionMixedFamilyEvaluation(mixedFixture('b6-matrix-reversed', 'authored').input)
    const reversed = runAttentionMixedFamilyEvaluation(mixedFixture('b6-matrix-reversed', 'reversed').input)
    if (authored.kind !== 'ok' || reversed.kind !== 'ok') throw new Error('expected two mixed evaluations')

    expect(canonicalSerialize(reversed.result.surface)).toBe(canonicalSerialize(authored.result.surface))

    // The fixture is genuinely mixed: both families are retained and ranked.
    expect(authored.result.retainedCandidates.map((candidate) => candidate.sourceKind))
      .toEqual(['quest_candidate', 'quest_candidate', 'narrative_pattern_instance', 'narrative_pattern_instance'])

    // Ordered candidate identities.
    expect(canonicalSerialize(reversed.result.orderedCandidates.map((candidate) => candidate.candidateId)))
      .toBe(canonicalSerialize(authored.result.orderedCandidates.map((candidate) => candidate.candidateId)))
    // Attempts, winner, presentation.
    expect(canonicalSerialize(reversed.result.arbitrationAttempts))
      .toBe(canonicalSerialize(authored.result.arbitrationAttempts))
    expect(reversed.result.trace.mixedFamilyArbitration?.winnerCandidateId)
      .toBe(authored.result.trace.mixedFamilyArbitration?.winnerCandidateId)
    expect(canonicalSerialize(reversed.result.presentation)).toBe(canonicalSerialize(authored.result.presentation))
    // Ledger, trusted trace, and observable bytes.
    expect(canonicalSerialize(reversed.result.ledger)).toBe(canonicalSerialize(authored.result.ledger))
    expect(canonicalAttentionTraceBytes(reversed.result.trace)).toBe(canonicalAttentionTraceBytes(authored.result.trace))
    expect(observableBytesOf(reversed.result)).toBe(observableBytesOf(authored.result))
  })

  it('item 7 — a same-family quest pair takes exactly one success, unlike the uncapped Stage A harness', () => {
    const { first, second } = buildAttentionQuestCandidateTwoVisibleCandidates()
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-matrix-quest-pair', ledger: emptyLedger(), questCandidates: [first, second],
    })
    const mixed = runAttentionMixedFamilyEvaluation(fixture.input)
    if (mixed.kind !== 'ok') throw new Error('expected a quest-pair evaluation')

    expect(mixed.result.retainedCandidates).toHaveLength(2)
    expect(mixed.result.arbitrationAttempts.map((attempt) => attempt.outcome)).toEqual(['presented', 'not-attempted'])
    expect(mixed.result.ledger.records).toHaveLength(1)
    expect(mixed.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(1)

    // RN019 §8.2.1 A -- the Stage A harness over the *same two candidates* is
    // exempt from step 7 and presents both. Read here through the committed
    // harness, without editing it or any frozen golden.
    const stageA = runAttentionQuestCandidateReplayPass(stableWorldReplayPassInput(
      'b6-matrix-quest-pair-stage-a', buildAttentionReplayTwoQuestCandidateWorld(), EMPTY_DIGEST,
    ))
    if (stageA.kind !== 'ok') throw new Error('expected the Stage A harness to pass')
    expect(stageA.result.ledger.records).toHaveLength(2)
    expect(stageA.result.trace.presentations).toHaveLength(2)
    // The visible difference between the two execution contracts.
    expect(mixed.result.trace.presentations.length).toBeLessThan(stageA.result.trace.presentations.length)
  })

  it('item 8 — a same-family pattern pair presents the first and never revalidates or attempts the second', () => {
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-matrix-pattern-pair', ledger: emptyLedger(), patternEvidenceViews: TWO_PATTERN_VIEWS,
    })
    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected a pattern-pair evaluation')

    expect(result.result.retainedCandidates.map((candidate) => candidate.sourceKind))
      .toEqual(['narrative_pattern_instance', 'narrative_pattern_instance'])
    expect(result.result.arbitrationAttempts.map((attempt) => attempt.outcome)).toEqual(['presented', 'not-attempted'])
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.ledger.records[0]?.sourceKind).toBe('narrative_pattern_instance')

    // "Not revalidated" is observable in the trusted trace: exactly one pattern
    // presentation decision exists, for the winner only.
    expect(result.result.trace.patternPresentationDecisions).toHaveLength(1)
    expect(result.result.trace.patternPresentationDecisions?.[0]?.candidateId)
      .toBe(result.result.arbitrationAttempts[0]?.candidateId)
    expect(result.result.arbitrationAttempts[1]).toMatchObject({
      outcome: 'not-attempted', refusalReason: null, continued: false, ledgerAppend: 'not-appended',
    })
  })

  it('item 9 — no legal candidate: no presentation, the incoming ledger unchanged by reference and bytes, and a truthful trace', () => {
    const ledger = emptyLedger()
    const beforeBytes = canonicalSerialize(ledger)
    const fixture = buildB6MixedEvaluationFixture({ replayCaseId: 'b6-matrix-empty', ledger })
    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected an empty evaluation')

    expect(result.result.retainedCandidates).toEqual([])
    expect(result.result.trace.mixedFamilyArbitration?.winnerCandidateId).toBeNull()
    expect(result.result.trace.mixedFamilyArbitration?.presentationSlotConsumed).toBe(false)
    expect(result.result.trace.presentations).toEqual([])
    expect(result.result.presentation).toBeNull()
    expect(result.result.arbitrationAttempts).toEqual([])
    expect(result.result.ledger).toBe(ledger)
    expect(result.result.ledger.records).toBe(ledger.records)
    expect(canonicalSerialize(result.result.ledger)).toBe(beforeBytes)
    // No leakage: the observable projection names no arbitration internal.
    expect(observableBytesOf(result.result)).not.toContain('mixedFamilyArbitration')
  })

  it('item 11 — genuinely mixed cold and warm replay agree in every recorded dimension', () => {
    const cold = runAttentionMixedFamilyEvaluation(mixedFixture('b6-matrix-replay', 'authored').input)
    // A warm run reuses the identical already-constructed input value rather
    // than rebuilding it, so any dependence on fixture construction would show.
    const warmInput = mixedFixture('b6-matrix-replay', 'authored').input
    const warmFirst = runAttentionMixedFamilyEvaluation(warmInput)
    const warmSecond = runAttentionMixedFamilyEvaluation(warmInput)
    if (cold.kind !== 'ok' || warmFirst.kind !== 'ok' || warmSecond.kind !== 'ok') throw new Error('expected three evaluations')

    for (const other of [warmFirst, warmSecond]) {
      expect(canonicalSerialize(other.result.orderedCandidates.map((candidate) => candidate.candidateId)))
        .toBe(canonicalSerialize(cold.result.orderedCandidates.map((candidate) => candidate.candidateId)))
      expect(canonicalSerialize(other.result.arbitrationAttempts)).toBe(canonicalSerialize(cold.result.arbitrationAttempts))
      expect(other.result.trace.mixedFamilyArbitration?.winnerCandidateId)
        .toBe(cold.result.trace.mixedFamilyArbitration?.winnerCandidateId)
      expect(canonicalSerialize(other.result.presentation)).toBe(canonicalSerialize(cold.result.presentation))
      expect(canonicalSerialize(other.result.ledger)).toBe(canonicalSerialize(cold.result.ledger))
      expect(canonicalAttentionTraceBytes(other.result.trace)).toBe(canonicalAttentionTraceBytes(cold.result.trace))
      expect(observableBytesOf(other.result)).toBe(observableBytesOf(cold.result))
    }
  })

  it('item 12 — the frozen single-candidate quest fixture through the mixed evaluator reproduces the Stage A golden bytes', () => {
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-matrix-stage-a-single', ledger: emptyLedger(),
      questCandidates: [buildB6StageASingleQuestCandidate()],
    })
    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected the single-quest evaluation')

    const golden = ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single
    const candidate = result.result.retainedCandidates[0]
    if (candidate?.sourceKind !== 'quest_candidate') throw new Error('expected one quest candidate')

    // Package and rendered bytes, rebuilt from the evaluator's own retained
    // candidate under the same pinned template version its helper uses.
    const built = buildAttentionRevealPackage(candidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (built.kind !== 'ok') throw new Error('expected a quest package')
    expect(canonicalSerialize(built.revealPackage)).toBe(golden.revealPackageBytes)
    const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (rendered.kind !== 'ok') throw new Error('expected a rendered quest package')
    expect(canonicalSerialize({ lines: rendered.lines, output: rendered.output })).toBe(golden.renderedTemplateBytes)

    // The evaluator's *own* render, ledger record, and observable projection.
    expect(result.result.presentation?.outputIdentity).toBe(golden.renderedOutputIdentity)
    expect(canonicalSerialize(result.result.ledger.records)).toBe(golden.ledgerRecordsBytes)
    expect(canonicalSerialize(attentionLedgerFeatures(result.result.ledger, candidate.candidateId)))
      .toBe(golden.ledgerFeaturesBytes)
    expect(observableBytesOf(result.result)).toBe(golden.playerObservableTraceBytes)
  })

  it('item 13 — the observable projection leaks no arbitration, ranking, resource, policy, or private pattern material', () => {
    const ledger = appendPatternHistory(emptyLedger(), pairedPatternFixture().candidates[0]!, 5, 'presentation-ready', 'leak-history')
    const result = runAttentionMixedFamilyEvaluation(mixedFixture('b6-matrix-leakage', 'authored', ledger).input)
    if (result.kind !== 'ok') throw new Error('expected the leakage fixture to evaluate')
    const observable = observableBytesOf(result.result)

    // The arbitration field name itself, and every arbitration internal.
    for (const forbidden of [
      'mixedFamilyArbitration', 'rankedCandidateIds', 'arbitrationAttempts', 'winnerCandidateId',
      'winnerSourceKind', 'presentationSlotConsumed', 'successfulPresentationCount',
      'not-attempted', 'revalidation-refused', 'package-refused', 'render-refused',
      'ledger-append-refused', 'assertion-build-refused', 'ledgerAppend', 'refusalReason', 'continued',
      'orderingTrace', 'orderingKeyValues', 'decidingKey', 'structuralRetention', 'resourceLimits',
      'boundId', 'configuredValue', 'observedValue', 'droppedIds', 'retainedIds',
      'patternPresentationDecisions', 'patternInstanceId', 'canonicalBindingTuple',
      'canonicalSupportingRecordIdentityTuple', 'lastProgressLsn', 'monitorVerdict', 'narrativeAnnotation',
      'attention-stage-b-resource-policy-v1', 'attention-pattern-presentation-ledger-policy-v1',
      'attention-ledger-policy-v1', 'attention-candidate-ordering-v2', 'attention-trace-schema-v2',
      'derivationCacheKeySchemaVersion', 'rankingCacheKeySchemaVersion',
    ]) {
      expect({ forbidden, present: observable.includes(forbidden) }).toEqual({ forbidden, present: false })
    }

    // Rejected/dropped candidate identities never appear either.
    const winner = result.result.trace.mixedFamilyArbitration?.winnerCandidateId
    for (const rejected of result.result.orderedCandidates
      .map((candidate) => candidate.candidateId)
      .filter((candidateId) => candidateId !== winner)) {
      // A retained-but-unpresented candidate legitimately appears in the
      // observable ordered list; only its *outcome* must not. The rejected
      // identities that must be wholly absent are the ones the cap dropped.
      if (result.result.retainedCandidates.some((candidate) => candidate.candidateId === rejected)) continue
      expect(observable.includes(rejected)).toBe(false)
    }
  })
})

/**
 * Plan §11.6 item 5 / RN019 §9.4.1 rows 7-9 — the quest fail-closed asymmetry.
 * These states are structurally unreachable for a candidate the one common
 * normalizer produced, so the evidence is taken where each is genuinely
 * constructible and explicitly discharged where it is not. No test here demands
 * an impossible normalizer-produced fixture.
 */
describe('B6 — quest construction faults fail the whole evaluation closed', () => {
  function legalQuestCandidate() {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const prime = runAttentionQuestCandidatePrimePipeline(world)
    if (prime.kind !== 'ok') throw new Error('expected primed quest world')
    const normalized = normalizeAttentionCandidates(prime.surface)
    if (normalized.kind !== 'ok') throw new Error('expected normalized quest candidate')
    const candidate = normalized.attentionCandidates[0]
    if (candidate?.sourceKind !== 'quest_candidate') throw new Error('expected quest candidate')
    return candidate
  }

  it('row 7 — a deliberately fabricated quest candidate refuses at the package stage and appends nothing', () => {
    const ledger = emptyLedger()
    // Fabricated outside the one common normalizer -- exactly the structural
    // fault row 7 describes. The normalizer cannot emit this: a blank
    // `openingProvenanceId` is one of its own admission preconditions.
    const fabricated = Object.freeze({ ...legalQuestCandidate(), openingProvenanceId: '   ' })

    const attempted = attemptAttentionQuestPresentation({ candidate: fabricated, ledger })
    expect(attempted).toEqual({
      kind: 'refused', stage: 'package', candidateId: fabricated.candidateId, reason: 'missing-opening-provenance-id',
    })
    if (attempted.kind !== 'refused') throw new Error('expected a package refusal')
    // No append: the caller's own ledger value is returned to it untouched.
    expect(ledger.records).toHaveLength(0)
  })

  it('row 9 — a legal quest candidate against a forged ledger header refuses at the append stage and appends nothing', () => {
    const staleLedgerHeader = Object.freeze({ ...emptyLedger(), ledgerPolicyVersion: 'attention-ledger-policy-v9' })
    const attempted = attemptAttentionQuestPresentation({ candidate: legalQuestCandidate(), ledger: staleLedgerHeader })
    expect(attempted.kind).toBe('refused')
    if (attempted.kind !== 'refused') throw new Error('expected a ledger refusal')
    expect(attempted.stage).toBe('ledger')
    expect(attempted.reason).toBe('unsupported-ledger-policy-version')
    expect(staleLedgerHeader.records).toHaveLength(0)
  })

  it('row 9 through the real evaluator — the whole evaluation refuses, no pattern is attempted, and nothing is appended', () => {
    const staleLedgerHeader = Object.freeze({ ...emptyLedger(), ledgerPolicyVersion: 'attention-ledger-policy-v9' })
    const pattern = patternFixture()
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const result = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-quest-fail-closed', snapshot: world.snapshot, request: world.request,
      patternEvidenceViews: pattern.views, revalidationSnapshot: world.snapshot,
      revalidationSnapshotLsn: world.request.rankingSnapshotLsn,
      revalidationPatternEvidenceViews: pattern.views, ledger: staleLedgerHeader,
      patternPresentationInputs: Object.freeze([{ candidateId: pattern.candidate.candidateId,
        directEvidenceAssertionInputs: pattern.instance.directEvidenceAssertionInputs,
        rankingCacheKey: 'pattern-cache', revalidationCacheKey: 'pattern-cache' }]),
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      authoritativeLogDigestBefore: EMPTY_DIGEST, authoritativeLogDigestAfter: EMPTY_DIGEST,
    })

    // RN019 §9.4.1 rows 7-9: fail closed. The stage-tagged typed refusal is the
    // whole output -- there is no winner, no trace, and no arbitration record,
    // because the evaluation produced none.
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') throw new Error('expected the evaluation to fail closed')
    expect(result.refusal).toEqual({
      stage: 'ledger',
      candidateId: result.refusal.stage === 'ledger' ? result.refusal.candidateId : '',
      reason: 'unsupported-ledger-policy-version',
    })
    expect(staleLedgerHeader.records).toHaveLength(0)

    // The contrast that makes the asymmetry real: the identical forged header,
    // with the quest removed, lets the pattern family *continue* (row 6).
    const patternOnly = runAttentionMixedFamilyEvaluation({
      ...pairedPatternEvaluation('b6-quest-fail-closed-contrast', staleLedgerHeader).input,
    })
    expect(patternOnly.kind).toBe('ok')
  })

  /**
   * Row 8 (quest template/render refusal) — item 5(b) structural discharge.
   *
   * Exact reason it is unreachable: `attemptAttentionQuestPresentation` renders
   * the package **it just built**. For a normalizer-produced quest candidate,
   * `buildAttentionRevealPackage` emits `templateVersion` equal to the pinned
   * `ATTENTION_TEMPLATE_VERSION` the helper then passes to the renderer, a
   * `resultTag` the quest branch renders in both of its forms
   * (`presentation-ready` and `presentation-fallback`), a non-blank
   * `candidateId`, and slots assembled in the pinned `ATTENTION_REVEAL_SLOT_ORDER`
   * with no duplicate and no unknown id. Every quest-branch refusal in
   * `renderAttentionRevealPackage` therefore requires a package no
   * `buildAttentionRevealPackage` call can produce -- i.e. a package fabricated
   * outside the helper, which is not an `attemptAttentionQuestPresentation` input.
   *
   * Owning lower-level evidence for the literals themselves: the frozen,
   * committed `attentionTemplate.test.ts`, which passes hand-built packages
   * directly to `renderAttentionRevealPackage`. The retained structural
   * obligation is asserted positively below.
   */
  it('row 8 — every package the quest helper can build renders, so the render refusal is structurally unreachable there', () => {
    for (const world of [buildAttentionReplayQuestCandidateOnlyWorld(), buildAttentionReplayTwoQuestCandidateWorld()]) {
      const prime = runAttentionQuestCandidatePrimePipeline(world)
      if (prime.kind !== 'ok') throw new Error('expected primed quest world')
      const normalized = normalizeAttentionCandidates(prime.surface)
      if (normalized.kind !== 'ok') throw new Error('expected normalized quest candidates')
      for (const candidate of normalized.attentionCandidates) {
        if (candidate.sourceKind !== 'quest_candidate') continue
        const built = buildAttentionRevealPackage(candidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
        expect(built.kind).toBe('ok')
        if (built.kind !== 'ok') throw new Error('expected a quest package')
        expect(built.revealPackage.templateVersion).toBe(ATTENTION_TEMPLATE_VERSION)
        expect(renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION }).kind)
          .toBe('ok')
      }
    }
  })
})

/**
 * B6 / plan §11.3 and §11.6 item 15 — the premise §11.3 input 7's keying rests
 * on, proven at evaluator level rather than assumed.
 *
 * `deriveAttentionPatternPrimeCandidates` constructs a **pattern-only** A′
 * surface (no quest views, no opening-coordinate sidecars);
 * `runAttentionMixedFamilyEvaluation` constructs the **mixed** surface from all
 * three collections. Both must mint identical pattern `candidateId`s for the
 * same pattern evidence views, because the committed `normalizePatternInstance`
 * identity construction reads only four instance-local values and neither the
 * extra quest views, the sidecars, nor `rankingSnapshotLsn` participates in
 * pattern candidate identity. Nothing here edits that construction or the
 * candidate-identity contract.
 */
describe('B6 — pattern-prime derivation and mixed evaluator agree on pattern candidate identity', () => {
  const patternCandidateIdsOfTrace = (trace: { readonly orderedAttentionCandidates: readonly { readonly sourceKind: string; readonly candidateId: string }[] }) =>
    trace.orderedAttentionCandidates
      .filter((entry) => entry.sourceKind === 'narrative_pattern_instance')
      .map((entry) => entry.candidateId)

  it('the pattern-only derivation produces exactly the pattern candidateIds the mixed evaluator normalizes', () => {
    const patterns = pairedPatternFixture()
    const world = buildAttentionReplayQuestCandidateOnlyWorld()

    // The pure derivation, over a pattern-only A-prime surface.
    const derived = deriveAttentionPatternPrimeCandidates({
      patternEvidenceViews: patterns.views,
      accessorContractVersion: world.request.accessorContractVersion,
      evaluationSnapshotLsn: world.request.rankingSnapshotLsn,
    })
    expect(derived.kind).toBe('ok')
    if (derived.kind !== 'ok') throw new Error('expected pattern-prime derivation')
    const derivedIds = derived.candidates.map((candidate) => candidate.candidateId)
    expect(derivedIds.length).toBeGreaterThanOrEqual(2)

    // The mixed evaluator, over its own mixed surface, with real quest candidates
    // and their opening-coordinate sidecars genuinely present alongside.
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-identity-equality-mixed',
      ledger: emptyLedger(),
      questCandidates: [buildB6StageASingleQuestCandidate()],
      patternEvidenceViews: patterns.views,
    })
    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected a mixed evaluation')

    // The evaluator's own mixed surface admitted the quest family too, so this is
    // genuinely the mixed case and not a pattern-only one in disguise.
    expect(result.result.surface.questCandidateViews.length).toBeGreaterThan(0)
    expect(
      result.result.orderedCandidates.some((candidate) => candidate.sourceKind === 'quest_candidate'),
    ).toBe(true)

    // Identical ids, in identical normalizer order.
    const evaluatorIds = result.result.orderedCandidates
      .filter((candidate) => candidate.sourceKind === 'narrative_pattern_instance')
      .map((candidate) => candidate.candidateId)
    expect(evaluatorIds).toEqual(derivedIds)
    // The trace agrees, so the equality holds on the recorded evidence too.
    expect(patternCandidateIdsOfTrace(result.result.trace)).toEqual(derivedIds)
    // And the fixture keyed input 7 onto exactly those ids.
    expect(fixture.patternCandidateIds).toEqual(derivedIds)
    expect(fixture.input.patternPresentationInputs.map((entry) => entry.candidateId)).toEqual(derivedIds)
  })

  it('the equality is independent of quest membership: the same views yield the same ids with and without quests', () => {
    const patterns = pairedPatternFixture()
    const idsFor = (questCandidates: readonly ReturnType<typeof buildB6StageASingleQuestCandidate>[]) => {
      const fixture = buildB6MixedEvaluationFixture({
        replayCaseId: 'b6-identity-membership',
        ledger: emptyLedger(),
        questCandidates,
        patternEvidenceViews: patterns.views,
      })
      const result = runAttentionMixedFamilyEvaluation(fixture.input)
      if (result.kind !== 'ok') throw new Error('expected a mixed evaluation')
      return result.result.orderedCandidates
        .filter((candidate) => candidate.sourceKind === 'narrative_pattern_instance')
        .map((candidate) => candidate.candidateId)
    }
    expect(idsFor([buildB6StageASingleQuestCandidate()])).toEqual(idsFor([]))
  })

  it('the derivation is pure: repeated calls over the same views are byte-identical', () => {
    const patterns = pairedPatternFixture()
    const call = () => deriveAttentionPatternPrimeCandidates({
      patternEvidenceViews: patterns.views,
      accessorContractVersion: 'attention-quest-candidate-accessor-v1',
      evaluationSnapshotLsn: 20,
    })
    expect(canonicalSerialize(call())).toBe(canonicalSerialize(call()))
  })

  it('it reaches the A-prime boundary refusal at the boundary step, exactly as the evaluator does', () => {
    // A duplicate `recordId` is an A-prime boundary refusal. Reconstructing from
    // the raw view list first would reach a different step under a different
    // reason, so this pins that the boundary runs before reconstruction.
    const duplicated = mintPatternEvidenceViews([aidRecord('aid-a-b', 10, 'a', 'b'), aidRecord('aid-b-a', 12, 'b', 'a')])
    const withDuplicate = Object.freeze([...duplicated, duplicated[0]!])
    const derived = deriveAttentionPatternPrimeCandidates({
      patternEvidenceViews: withDuplicate,
      accessorContractVersion: 'attention-quest-candidate-accessor-v1',
      evaluationSnapshotLsn: 20,
    })
    expect(derived.kind).toBe('refused')
    if (derived.kind !== 'refused') throw new Error('expected a boundary refusal')
    expect(derived.stage).toBe('boundary')

    // The evaluator refuses at its own boundary stage, for the same reason.
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const evaluated = runAttentionMixedFamilyEvaluation({
      replayCaseId: 'b6-identity-boundary',
      snapshot: { ...world.snapshot, candidates: Object.freeze([]) },
      request: world.request,
      patternEvidenceViews: withDuplicate,
      revalidationSnapshot: { ...world.snapshot, candidates: Object.freeze([]) },
      revalidationSnapshotLsn: world.request.rankingSnapshotLsn,
      revalidationPatternEvidenceViews: withDuplicate,
      ledger: emptyLedger(),
      patternPresentationInputs: Object.freeze([]),
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      authoritativeLogDigestBefore: EMPTY_DIGEST,
      authoritativeLogDigestAfter: EMPTY_DIGEST,
    })
    expect(evaluated.kind).toBe('refused')
    if (evaluated.kind !== 'refused') throw new Error('expected an evaluator boundary refusal')
    expect(evaluated.refusal.stage).toBe('boundary')
    expect(evaluated.refusal.reason).toBe(derived.reason)
  })
})

/**
 * B6 / RN019 §9.4.2 — **symmetric** family isolation at the revalidation
 * coordinate, the mirror of RN019 §11.3 negative control 19.
 *
 * NC-19 already forbids a *quest* accessor refusal from marking pattern
 * candidates stale. §9.4.2's closing sentence states the other direction with
 * equal force: "Symmetrically, absent or refusing pattern revalidation material
 * refuses pattern candidates under row 2 and leaves quest candidates untouched."
 *
 * The refusing forms below are A′-**boundary** refusals on the
 * revalidation-coordinate pattern views — genuinely accessor-minted material the
 * boundary rejects for its own typed reason. Under RN019 §9.4.1's closed table
 * these are row 2 (pattern family, no append, continue); the only rows that fail
 * an evaluation closed are the quest construction rows 7–9, which these are not.
 * The monitor-refusal form is proven separately by the `malformed-ledger-history`
 * obligation case above and is deliberately kept distinct from these.
 */
describe('B6 — refusing pattern revalidation material never suppresses a legal quest', () => {
  const LEGAL_PATTERN_VIEWS = mintPatternEvidenceViews([
    aidRecord('iso-aid-a-b', 10, 'a', 'b'),
    aidRecord('iso-aid-b-a', 12, 'b', 'a'),
  ])

  /** Genuinely accessor-minted, but rejected by the A′ boundary for its own reason. */
  const REFUSING_REVALIDATION_MATERIAL = [
    ['duplicate accessor-minted recordId', Object.freeze([...LEGAL_PATTERN_VIEWS, LEGAL_PATTERN_VIEWS[0]!])],
    ['non-canonical commitLsn/recordId order', Object.freeze([...LEGAL_PATTERN_VIEWS].reverse())],
  ] as const

  it.each(REFUSING_REVALIDATION_MATERIAL)(
    'A/B — %s at the revalidation coordinate leaves the legal quest untouched and winning',
    (_label, revalidationPatternEvidenceViews) => {
      // The material really is refused by the A′ boundary, checked independently
      // at the owning function -- so this fixture exercises the real condition.
      const boundary = constructAttentionReadableSurface({
        surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
        accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 20,
      }, Object.freeze([]), Object.freeze([]), revalidationPatternEvidenceViews)
      expect(boundary.kind).toBe('refused')

      const fixture = buildB6MixedEvaluationFixture({
        replayCaseId: 'b6-revalidation-boundary-isolation',
        ledger: emptyLedger(),
        questCandidates: [buildB6StageASingleQuestCandidate()],
        patternEvidenceViews: LEGAL_PATTERN_VIEWS,
      })
      const result = runAttentionMixedFamilyEvaluation({ ...fixture.input, revalidationPatternEvidenceViews })

      // Not a whole-evaluation refusal: rows 7-9 are the only fail-closed rows.
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') throw new Error('expected pattern-side isolation, not an evaluation refusal')

      // The legal quest is untouched and wins the shared slot.
      expect(result.result.retainedCandidates.map((candidate) => candidate.sourceKind))
        .toEqual(['quest_candidate', 'narrative_pattern_instance'])
      expect(result.result.trace.mixedFamilyArbitration?.winnerSourceKind).toBe('quest_candidate')
      expect(result.result.arbitrationAttempts.map((attempt) => attempt.outcome))
        .toEqual(['presented', 'not-attempted'])

      // Exactly one quest-branch record; no pattern lifecycle record at all.
      expect(result.result.ledger.records).toHaveLength(1)
      expect(result.result.ledger.records[0]?.sourceKind).toBe('quest_candidate')
      expect(result.result.ledger.records.some((record) => record.sourceKind === 'narrative_pattern_instance')).toBe(false)

      // Truthful trace, and no pattern-boundary diagnostic reaches the player.
      expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(1)
      const observable = canonicalSerialize(result.result.trace.playerObservable)
      for (const leak of ['ambiguous-legal-identity', 'pattern-evidence-order-mismatch', 'boundary', 'candidate-disappeared']) {
        expect(observable).not.toContain(leak)
      }
    },
  )

  it.each(REFUSING_REVALIDATION_MATERIAL)(
    'C — with no quest ahead of them, reached pattern candidates refuse exactly candidate-disappeared (%s)',
    (_label, revalidationPatternEvidenceViews) => {
      // Pattern-only: nothing consumes the slot first, so both ranked patterns
      // are genuinely reached and the row-2 consequence is observable.
      const { input, patterns } = pairedPatternEvaluation('b6-revalidation-boundary-row2', emptyLedger())
      const result = runAttentionMixedFamilyEvaluation({ ...input, revalidationPatternEvidenceViews })

      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') throw new Error('expected a row-2 continuation')
      expect(patterns.candidates.length).toBeGreaterThanOrEqual(2)

      // Every reached candidate: the committed literal, no append, continue.
      expect(result.result.arbitrationAttempts.length).toBeGreaterThanOrEqual(2)
      for (const attempt of result.result.arbitrationAttempts) {
        expect(attempt).toMatchObject({
          outcome: 'revalidation-refused', refusalReason: 'candidate-disappeared',
          continued: true, ledgerAppend: 'not-appended',
        })
      }
      // The next ranked candidate really was attempted, not skipped.
      expect(result.result.arbitrationAttempts.map((attempt) => attempt.rankPosition)).toEqual([0, 1])
      // Slot unconsumed, no winner, incoming ledger unchanged by reference.
      expect(result.result.presentation).toBeNull()
      expect(result.result.trace.mixedFamilyArbitration?.presentationSlotConsumed).toBe(false)
      expect(result.result.trace.mixedFamilyArbitration?.winnerCandidateId).toBeNull()
      expect(result.result.ledger).toBe(input.ledger)
      expect(result.result.ledger.records).toHaveLength(0)
    },
  )

  it('C — no sibling substitution: legal revalidation material for a different binding still refuses candidate-disappeared', () => {
    // Legal, accessor-minted, boundary-passing revalidation views -- but for a
    // different participant pair, so the exact-candidateId lookup misses. A
    // substituting implementation would present the sibling instead.
    const siblingViews = mintPatternEvidenceViews([
      aidRecord('iso-sibling-x-y', 10, 'x', 'y'),
      aidRecord('iso-sibling-y-x', 12, 'y', 'x'),
    ])
    const { input, patterns } = pairedPatternEvaluation('b6-revalidation-sibling', emptyLedger())
    const siblingDerived = deriveAttentionPatternPrimeCandidates({
      patternEvidenceViews: siblingViews,
      accessorContractVersion: 'attention-quest-candidate-accessor-v1',
      evaluationSnapshotLsn: 20,
    })
    if (siblingDerived.kind !== 'ok') throw new Error('expected a legal sibling derivation')
    // The sibling really is a rankable candidate, and really is a different id.
    expect(siblingDerived.candidates.length).toBeGreaterThan(0)
    for (const candidate of patterns.candidates) {
      expect(siblingDerived.candidates.map((entry) => entry.candidateId)).not.toContain(candidate.candidateId)
    }

    const result = runAttentionMixedFamilyEvaluation({ ...input, revalidationPatternEvidenceViews: siblingViews })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected a row-2 continuation')
    for (const attempt of result.result.arbitrationAttempts) {
      expect(attempt).toMatchObject({
        outcome: 'revalidation-refused', refusalReason: 'candidate-disappeared',
        continued: true, ledgerAppend: 'not-appended',
      })
      // The sibling's identity never appears as an evaluated candidate.
      expect(siblingDerived.candidates.map((entry) => entry.candidateId)).not.toContain(attempt.candidateId)
    }
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger.records).toHaveLength(0)
  })
})
