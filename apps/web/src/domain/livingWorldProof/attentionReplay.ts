/**
 * Stage A / A5 — the proof-local deterministic replay/scenario harness: runs
 * A1 → A2 → A3 → A4 in the approved order against pinned inputs, revalidates
 * at a second (presentation-time) coordinate, builds the complete
 * `AttentionTrace`, and separately composes director-off/director-on
 * authoritative passes for the P2 noninterference proof. Proof-local to
 * `domain/livingWorldProof`; not a production replay engine, runtime
 * integration, or persistence layer.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D12 the fixed pipeline order and its revalidation exception, D15
 *    two-clock revalidation, D19 P2/P3);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§9 P2, §10/§11 the P3 premise check and hidden-candidate pair, §13
 *    full-pipeline determinism);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "2. REPLAY HARNESS", "3. P2", "4. P3"; §9 A5 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **What runs here.** `runAttentionQuestCandidatePrimePipeline` invokes only
 * A1 → A2, the shared premise-check input every P3 fixture needs.
 * `runAttentionQuestCandidateReplayPass` invokes the complete A1 → A2 → A3 →
 * A4 pipeline plus revalidation and trace assembly for one world.
 * `runAttentionP3PairedWorldCheck` composes two calls to the prime pipeline,
 * performs the mandatory A′-equivalence premise check first (replay spec
 * §10), and only on success runs the full pass for both worlds so their
 * player-observable subtraces can be compared. `runAttentionDirectorOffPass`
 * and `runAttentionDirectorOnPass` compose the proof-local authoritative
 * commit fold from `attentionReplayResources.ts` with (director-on) or
 * without (director-off) a genuine call into this same attention pipeline,
 * for the P2 noninterference proof.
 *
 * **Never mutates authoritative candidates or logs.** Every function here
 * either reads an already-frozen `ProofQuestCandidateSnapshot` (never
 * writing it) or threads an `AttentionReplayAuthoritativeResources` value
 * through pure, resource-returning steps (never a shared mutable object).
 * The authoritative committed log stays a value returned alongside the
 * attention trace, never referenced from inside it — `AttentionTraceInput`
 * only ever receives its two digest strings, so "the authoritative log" and
 * "the attention trace" remain two independently inspectable values, exactly
 * as the controlling REPLAY HARNESS instruction requires.
 *
 * **No persistence, no production runtime integration, no LLM/provider
 * path.** This module imports no store, port, session, or provider; the only
 * generative seam anywhere in the path is `attentionZeroModelProbe.ts`'s
 * probe, and nothing here calls it — a caller that wants the corroborating
 * zero-call evidence constructs a probe, runs a pass, and asserts its count
 * afterward, exactly as `attentionZeroModelProbe.test.ts` already does for
 * A4's shorter path.
 */
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
} from './attentionQuestCandidateContracts'
import type { ProofQuestCandidateSnapshot } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import type {
  AttentionReadableSurface,
  AttentionReadableSurfaceRequest,
} from './attentionReadableBoundary'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import type { AttentionPatternCandidate } from './attentionCandidate'
import {
  ATTENTION_CANDIDATE_PROOF_SCORE,
  attentionCandidateOrderingKeyValue,
  orderAttentionCandidates,
} from './attentionCandidateOrdering'
import type { AttentionCandidateOrderingComparison } from './attentionCandidateOrdering'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_EXPOSURE_POLICY_VERSION,
  ATTENTION_LEDGER_POLICY_VERSION,
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
} from './attentionCandidatePolicy'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import {
  appendAttentionLedgerRecord,
  createAttentionLedger,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
} from './attentionLedger'
import type { AttentionLedger } from './attentionLedger'
import { evaluateAttentionPatternPresentationPolicy } from './attentionLedger'
import type {
  AttentionPatternPresentationPolicyDecision,
  AttentionPatternPresentationPolicyReason,
} from './attentionLedger'
import {
  ATTENTION_TRACE_ORDERING_KEYS,
  attentionTraceResourceLimitEntry,
  buildAttentionTrace,
  canonicalAttentionObservableTraceBytes,
  canonicalAttentionTraceBytes,
} from './attentionTrace'
import type {
  AttentionTrace,
  AttentionTraceCandidateEntry,
  AttentionTraceOrderingComparisonEntry,
  AttentionTraceOrderingKeyValue,
  AttentionTraceP3PremiseCheck,
  AttentionTracePatternPresentationDecision,
  AttentionTracePatternPresentationOutcome,
  AttentionTracePresentationEntry,
  AttentionTraceResourceLimitEntry,
  AttentionTraceRevalidationEntry,
} from './attentionTrace'
import {
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  applyMixedFamilyCandidateCap,
  attentionStageBResourcePolicy,
} from './attentionNarrativePatternResourcePolicy'
import type { AttentionStageBResourcePolicy } from './attentionNarrativePatternResourcePolicy'
import {
  ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
  buildAttentionDirectEvidenceAssertions,
} from './attentionDirectEvidenceAssertion'
import { evaluateAttentionAggregateLegitimacy } from './attentionAggregateLegitimacy'
import type { AggregateLegitimacyPolicyRef, AttentionAggregateSource } from './attentionAggregateLegitimacy'
import { PUBLIC_AID_LINK_EXTENSION_V1 } from './attentionInferenceRuleLibrary'
import type { AttentionDeclaredScoreFeatures, ScorePolicyRef } from './attentionScorePolicy'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import { applyNarrativePatternStructuralRetention } from './attentionNarrativePatternResourcePolicy'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'
import {
  commitAttentionReplayAuthoritativeCommand,
  digestAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'
import type {
  AttentionReplayAuthoritativeResources,
  AttentionReplayWallClockInput,
} from './attentionReplayResources'
import { canonicalSerialize } from './canonicalSerialization'

export { canonicalAttentionTraceBytes, canonicalAttentionObservableTraceBytes }

/**
 * B5's explicit, exact-ID revalidation result vocabulary; it never repairs a
 * sibling. The six identity/cache literals are this function's own structural
 * checks; the remaining seven are exactly
 * `AttentionPatternPresentationPolicyReason`'s refusal literals (every member
 * except `'eligible'`), preserved verbatim rather than collapsed into one
 * generic reason -- a density refusal must stay distinguishable from an
 * exposure retirement in every caller that reads this result, including the
 * trusted trace.
 */
export type AttentionPatternPresentationRevalidationReason =
  | 'still-legal'
  | 'candidate-disappeared'
  | 'candidate-identity-mismatch'
  | 'source-identity-mismatch'
  | 'supporting-record-identity-mismatch'
  | 'cache-key-mismatch'
  | 'pattern-presentation-ledger-policy-mismatch'
  | Exclude<AttentionPatternPresentationPolicyReason, 'eligible'>

/**
 * `policyDecision` is the exact `evaluateAttentionPatternPresentationPolicy`
 * result whenever the policy check actually ran (both on success and on a
 * policy-reason refusal); it is `null` for a refusal decided before the
 * policy check (an identity, ledger-policy, or cache-key mismatch), because
 * no policy decision exists yet for those. Carrying the decision itself, not
 * just its `reason`, lets a caller read `successfulExposureCount` to compute
 * the post-presentation retirement outcome on success.
 */
export type AttentionPatternPresentationRevalidationResult =
  | {
      readonly ok: true
      readonly reason: 'still-legal'
      readonly policyDecision: AttentionPatternPresentationPolicyDecision
    }
  | {
      readonly ok: false
      readonly reason: Exclude<AttentionPatternPresentationRevalidationReason, 'still-legal'>
      readonly policyDecision: AttentionPatternPresentationPolicyDecision | null
    }

/**
 * Revalidates only an already selected pattern candidate at the later committed
 * coordinate.  The caller supplies the independently reconstructed candidate
 * and complete cache keys; a mismatch is a deterministic refusal, never a
 * remap to an overlap sibling or regeneration under old policy.
 */
export function revalidateAttentionPatternPresentation(input: {
  readonly selectedCandidate: AttentionPatternCandidate
  readonly revalidatedCandidate: AttentionPatternCandidate | undefined
  readonly rankingCacheKey: string
  readonly revalidationCacheKey: string
  readonly patternPresentationLedgerPolicyVersion?: string
  readonly ledger: AttentionLedger
  readonly evaluationLsn: number
  readonly satisfiedCompletionLsn?: number
  readonly policy?: AttentionStageBResourcePolicy
}): AttentionPatternPresentationRevalidationResult {
  const deny = (
    reason: Exclude<AttentionPatternPresentationRevalidationReason, 'still-legal'>,
    policyDecision: AttentionPatternPresentationPolicyDecision | null = null,
  ) => Object.freeze({ ok: false as const, reason, policyDecision })
  const current = input.revalidatedCandidate
  if (current === undefined) return deny('candidate-disappeared')
  if (current.candidateId !== input.selectedCandidate.candidateId) return deny('candidate-identity-mismatch')
  if (current.sourceId !== input.selectedCandidate.sourceId) return deny('source-identity-mismatch')
  if (
    canonicalSerialize(current.canonicalSupportingRecordIdentityTuple)
      !== canonicalSerialize(input.selectedCandidate.canonicalSupportingRecordIdentityTuple)
  ) return deny('supporting-record-identity-mismatch')
  if (input.patternPresentationLedgerPolicyVersion !== ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION) {
    return deny('pattern-presentation-ledger-policy-mismatch')
  }
  if (input.rankingCacheKey !== input.revalidationCacheKey) return deny('cache-key-mismatch')
  const policy = evaluateAttentionPatternPresentationPolicy({
    ledger: input.ledger,
    candidateId: current.candidateId,
    evaluationLsn: input.evaluationLsn,
    policy: input.policy,
    ...(input.satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn: input.satisfiedCompletionLsn }),
  })
  if (!policy.eligible) {
    // `evaluateAttentionPatternPresentationPolicy` returns `reason: 'eligible'`
    // exactly when `eligible` is true, so `policy.reason` here is always one
    // of the seven refusal literals -- preserved exactly, never collapsed.
    return deny(policy.reason as Exclude<AttentionPatternPresentationPolicyReason, 'eligible'>, policy)
  }
  return Object.freeze({ ok: true as const, reason: 'still-legal' as const, policyDecision: policy })
}

/**
 * Exhaustive, per-field mapping from a real revalidation outcome into the
 * trusted trace's four decision fields (RN019 SS9.6's discriminated evidence).
 * Reflects `evaluateAttentionPatternPresentationPolicy`'s own check order
 * (attentionLedger.ts): a reason earlier in that sequence means every later
 * check never ran, so a field for a check that never ran reports
 * `'not-attempted'` rather than fabricating `'eligible'`; a field for a check
 * that ran and passed reports its real passing value. The `default` arm is
 * unreachable for any current literal and fails to compile if a new
 * `AttentionPatternPresentationRevalidationReason` is added without a case
 * here (`assertNever`), so an unmapped reason cannot silently fall through to
 * a broadcast placeholder the way `presentation-policy-ineligible` once did.
 */
function assertNeverPatternPresentationReason(reason: never): never {
  throw new Error(`unmapped attention pattern-presentation revalidation reason: ${String(reason)}`)
}

interface PatternPresentationTraceOutcomes {
  readonly revalidationOutcome: AttentionTracePatternPresentationOutcome
  readonly exposureCooldownOutcome: AttentionTracePatternPresentationOutcome
  readonly densityOutcome: AttentionTracePatternPresentationOutcome
  readonly retirementOutcome: AttentionTracePatternPresentationOutcome
}

function patternPresentationRefusalTraceOutcomes(
  reason: Exclude<AttentionPatternPresentationRevalidationReason, 'still-legal'>,
): PatternPresentationTraceOutcomes {
  switch (reason) {
    // Structural/identity refusals: decided before the policy check ever ran.
    case 'candidate-disappeared':
    case 'candidate-identity-mismatch':
    case 'source-identity-mismatch':
    case 'supporting-record-identity-mismatch':
    case 'cache-key-mismatch':
    case 'pattern-presentation-ledger-policy-mismatch':
      return {
        revalidationOutcome: reason,
        exposureCooldownOutcome: 'not-attempted',
        densityOutcome: 'not-attempted',
        retirementOutcome: 'not-attempted',
      }
    // The policy's own structural gate: no cooldown/density/retirement check ran.
    case 'malformed-ledger-history':
      return {
        revalidationOutcome: 'malformed-ledger-history',
        exposureCooldownOutcome: 'not-attempted',
        densityOutcome: 'not-attempted',
        retirementOutcome: 'not-attempted',
      }
    // Retirement checks run first inside the policy; a retirement refusal
    // means identity/cache checks and the retirement gate itself all passed,
    // but cooldown/density were never reached.
    case 'retired-satisfied-age':
    case 'retired-exposure':
    case 'retired-revalidation-failure':
      return {
        revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'not-attempted',
        densityOutcome: 'not-attempted',
        retirementOutcome: reason,
      }
    // Cooldown checks run after retirement passes, so retirement is genuinely
    // not-retired here; density is never reached.
    case 'successful-cooldown':
    case 'revalidation-failure-cooldown':
      return {
        revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: reason,
        densityOutcome: 'not-attempted',
        retirementOutcome: 'not-retired',
      }
    // Density is the last check: retirement and both cooldowns already passed.
    case 'density-window-full':
      return {
        revalidationOutcome: 'still-legal',
        exposureCooldownOutcome: 'eligible',
        densityOutcome: 'density-window-full',
        retirementOutcome: 'not-retired',
      }
    default:
      return assertNeverPatternPresentationReason(reason)
  }
}

/**
 * The trace outcomes for a candidate that passed revalidation -- meaning
 * retirement, both cooldowns, and density all genuinely evaluated and
 * passed -- but was then refused at an independent later stage (assertion
 * build, package build, render, or ledger append). Those later stages have no
 * bearing on exposure/cooldown/density/retirement, so this reports their real
 * passing state rather than `'not-attempted'`, which would misreport a check
 * that actually ran.
 */
const REVALIDATED_ELIGIBLE_TRACE_OUTCOMES: PatternPresentationTraceOutcomes = Object.freeze({
  revalidationOutcome: 'still-legal',
  exposureCooldownOutcome: 'eligible',
  densityOutcome: 'eligible',
  retirementOutcome: 'not-retired',
})

/** One candidate's real per-attempt outcome inside a pattern presentation pass. */
export type AttentionPatternPresentationAttemptOutcome =
  | 'presented'
  | 'revalidation-refused'
  | 'assertion-build-refused'
  | 'package-refused'
  | 'render-refused'
  | 'ledger-append-refused'

export interface AttentionPatternPresentationAttemptResult {
  readonly candidateId: string
  readonly outcome: AttentionPatternPresentationAttemptOutcome
  readonly revalidationReason: AttentionPatternPresentationRevalidationReason
  readonly assertionIds: readonly string[]
  readonly refusalDetail: string | null
}

export interface AttentionPatternPresentationPassCandidateInput {
  readonly candidate: AttentionPatternCandidate
  readonly revalidatedCandidate: AttentionPatternCandidate | undefined
  readonly directEvidenceAssertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[]
  readonly satisfiedCompletionLsn?: number
  readonly rankingCacheKey: string
  readonly revalidationCacheKey: string
  /** C1 only: permits the one licensed nested aggregate source pair. */
  readonly aggregateSources?: readonly AttentionAggregateSource[]
}

export interface AttentionPatternPresentationPassResult {
  readonly ledger: AttentionLedger
  readonly presentation: AttentionTracePresentationEntry | null
  readonly attempts: readonly AttentionPatternPresentationAttemptResult[]
  readonly decisions: readonly AttentionTracePatternPresentationDecision[]
}

/**
 * The real, wired B5 pattern-presentation composition: for each ordered
 * pattern candidate in turn, revalidate -> build direct assertions -> build
 * the pattern `RevealPackage` -> render -> append the ledger success record,
 * stopping at the first successful presentation (RN019 §8.2's presentation
 * cap of one). A refusal at any stage consumes no successful-presentation
 * slot and moves on to the next candidate, exactly as RN019 §7 requires. This
 * makes `buildAttentionDirectEvidenceAssertions`,
 * `evaluateAttentionPatternPresentationPolicy` (via
 * `revalidateAttentionPatternPresentation`), `revalidateAttentionPatternPresentation`,
 * the pattern `RevealPackage`/template branch, and the ledger's pattern append
 * genuinely reachable from one real pipeline entry point rather than test-only.
 *
 * Scope note: this composes the pattern family only. It does not decide
 * between a quest and a pattern candidate competing for the same evaluation's
 * single presentation slot -- that full mixed-family selection is the B6
 * "mixed replay" integration RN019 assigns there, and is out of B5's bounded
 * scope. The existing quest-only replay path is untouched by this function.
 *
 * `patternPresentationLedgerPolicyVersion` is a **required** input rather than
 * a constant this function reaches for itself. RN019 §9.7 makes the
 * pattern-presentation ledger identity the ranking-only B5 dependency a
 * revalidation must actually check, and §9.3's rule applies to it directly: a
 * dependency a test cannot vary is a dependency the suite cannot prove
 * participates. Hardcoding it here made
 * `'pattern-presentation-ledger-policy-mismatch'` unreachable through this
 * composition, so a stale identity could only ever be caught by calling
 * `revalidateAttentionPatternPresentation` directly. The supplied value is
 * handed to revalidation verbatim -- never defaulted, normalised, or replaced
 * with the pinned constant -- so a caller presenting under a stale ledger
 * identity refuses here exactly as it would at the revalidation boundary.
 */
export interface AttentionPatternPresentationAttemptExecution {
  readonly ledger: AttentionLedger
  readonly attempt: AttentionPatternPresentationAttemptResult
  readonly decision: AttentionTracePatternPresentationDecision
  readonly presentation: AttentionTracePresentationEntry | null
}

/** One B5 pattern candidate only; loops, selection slots, traces, and ledger creation remain caller-owned. */
export function attemptAttentionPatternPresentation(input: {
  readonly entry: AttentionPatternPresentationPassCandidateInput
  readonly ledger: AttentionLedger
  readonly evaluationLsn: number
  readonly patternPresentationLedgerPolicyVersion: string
  readonly policy: AttentionStageBResourcePolicy
  /** C1 activation is explicit; callers must choose disabled or the registered C1 policy. */
  readonly aggregateLegitimacyPolicyRef: AggregateLegitimacyPolicyRef
}): AttentionPatternPresentationAttemptExecution {
    const entry = input.entry
    const revalidation = revalidateAttentionPatternPresentation({
      selectedCandidate: entry.candidate,
      revalidatedCandidate: entry.revalidatedCandidate,
      rankingCacheKey: entry.rankingCacheKey,
      revalidationCacheKey: entry.revalidationCacheKey,
      // Verbatim: a stale supplied identity must reach revalidation as-is.
      patternPresentationLedgerPolicyVersion: input.patternPresentationLedgerPolicyVersion,
      ledger: input.ledger,
      evaluationLsn: input.evaluationLsn,
      policy: input.policy,
      ...(entry.satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn: entry.satisfiedCompletionLsn }),
    })
    if (!revalidation.ok) {
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'revalidation-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze([]),
        refusalDetail: revalidation.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze([]),
        ...patternPresentationRefusalTraceOutcomes(revalidation.reason),
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const assertions = buildAttentionDirectEvidenceAssertions(entry.directEvidenceAssertionInputs)
    if (assertions.kind !== 'ok') {
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'assertion-build-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze([]),
        refusalDetail: assertions.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze([]),
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const legitimacy = evaluateAttentionAggregateLegitimacy({
      policyRef: input.aggregateLegitimacyPolicyRef,
      sourceKind: 'narrative_pattern_instance',
      sources: entry.aggregateSources ?? assertions.assertions,
      ...(entry.aggregateSources?.some((source) => source.assertionKind === 'aggregate')
        ? { ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId }
        : {}),
    })
    if (legitimacy.kind === 'refused') {
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'assertion-build-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        refusalDetail: legitimacy.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: attempt.assertionIds,
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const built = buildAttentionRevealPackage(entry.candidate, {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      directEvidenceAssertions: assertions.assertions,
      ...(legitimacy.kind === 'ok' ? { aggregateAssertion: legitimacy.aggregate } : {}),
      policy: input.policy,
    })
    if (built.kind !== 'ok') {
      const assertionIds = Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId))
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'package-refused',
        revalidationReason: revalidation.reason,
        assertionIds,
        refusalDetail: built.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds,
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const rendered = renderAttentionRevealPackage(built.revealPackage, {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
    })
    if (rendered.kind !== 'ok') {
      const assertionIds = Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId))
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'render-refused',
        revalidationReason: revalidation.reason,
        assertionIds,
        refusalDetail: rendered.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds,
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const appended = appendAttentionLedgerRecord(input.ledger, {
      attentionCandidate: entry.candidate,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      outcome: rendered.resultTag,
      renderedOutputIdentity: rendered.outputIdentity,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      presentationLsn: input.evaluationLsn,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    })
    if (appended.kind !== 'ok') {
      const assertionIds = Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId))
      const attempt = Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'ledger-append-refused',
        revalidationReason: revalidation.reason,
        assertionIds,
        refusalDetail: appended.reason,
      } as const)
      const decision = Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds,
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      } as const)
      return Object.freeze({ ledger: input.ledger, attempt, decision, presentation: null })
    }

    const assertionIds = Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId))
    const attempt = Object.freeze({
      candidateId: entry.candidate.candidateId,
      outcome: 'presented',
      revalidationReason: revalidation.reason,
      assertionIds,
      refusalDetail: null,
    } as const)
    // The presentation that just appended is itself one more successful
    // exposure: retirement is derived from the post-append count, not the
    // pre-presentation `revalidation.policyDecision` count, so the exposure
    // that crosses the threshold is the one that reports retirement -- never
    // a hard-coded `'not-retired'` on the append that actually retires it
    // (RN019 SS8.4: "the second successful exposure retires ... immediately
    // after the ledger append").
    const postAppendExposureCount = revalidation.policyDecision.successfulExposureCount + 1
    const retirementOutcome: AttentionTracePatternPresentationOutcome =
      postAppendExposureCount >= input.policy.maxSuccessfulExposuresPerCandidateId ? 'retired-exposure' : 'not-retired'
    const decision = Object.freeze({
      candidateId: entry.candidate.candidateId,
      assertionIds,
      revalidationOutcome: 'still-legal',
      exposureCooldownOutcome: 'eligible',
      densityOutcome: 'eligible',
      retirementOutcome,
      ledgerAppend: 'appended',
    } as const)
    const presentation = Object.freeze({
      candidateId: entry.candidate.candidateId,
      resultTag: rendered.resultTag,
      output: rendered.output,
      outputIdentity: rendered.outputIdentity,
      ledgerOutcome: appended.record.outcome,
      ledgerRecordId: appended.record.recordId,
    })
    return Object.freeze({ ledger: appended.ledger, attempt, decision, presentation })
}

export function runAttentionPatternPresentationPass(input: {
  readonly orderedCandidates: readonly AttentionPatternPresentationPassCandidateInput[]
  readonly ledger: AttentionLedger
  readonly evaluationLsn: number
  /** The ledger identity this presentation attempt runs under; passed through unchanged. */
  readonly patternPresentationLedgerPolicyVersion: string
  readonly policy?: AttentionStageBResourcePolicy
  /** C1 activation is explicit; callers must choose disabled or the registered C1 policy. */
  readonly aggregateLegitimacyPolicyRef: AggregateLegitimacyPolicyRef
}): AttentionPatternPresentationPassResult {
  const policy = input.policy ?? attentionStageBResourcePolicy()
  let ledger = input.ledger
  const attempts: AttentionPatternPresentationAttemptResult[] = []
  const decisions: AttentionTracePatternPresentationDecision[] = []
  let presentation: AttentionTracePresentationEntry | null = null
  for (const entry of input.orderedCandidates) {
    if (presentation !== null) break
    const result = attemptAttentionPatternPresentation({
      entry,
      ledger,
      evaluationLsn: input.evaluationLsn,
      patternPresentationLedgerPolicyVersion: input.patternPresentationLedgerPolicyVersion,
      policy,
      aggregateLegitimacyPolicyRef: input.aggregateLegitimacyPolicyRef,
    })
    ledger = result.ledger
    attempts.push(result.attempt)
    decisions.push(result.decision)
    presentation = result.presentation
  }

  return Object.freeze({
    ledger,
    presentation,
    attempts: Object.freeze(attempts),
    decisions: Object.freeze(decisions),
  })
}

// ---------------------------------------------------------------------------
// A1 -> A2 only: the shared premise-pipeline every P3 fixture needs
// ---------------------------------------------------------------------------

export interface AttentionQuestCandidateWorldInput {
  readonly snapshot: ProofQuestCandidateSnapshot
  readonly request: { readonly accessorContractVersion: string; readonly rankingSnapshotLsn: number }
}

export type AttentionQuestCandidatePrimeRefusal =
  | { readonly stage: 'accessor'; readonly reason: string }
  | { readonly stage: 'boundary'; readonly reason: string }

export type AttentionQuestCandidatePrimeResult =
  | { readonly kind: 'ok'; readonly surface: AttentionReadableSurface }
  | { readonly kind: 'refused'; readonly refusal: AttentionQuestCandidatePrimeRefusal }

/** A1 -> A2 only: the pinned accessor read plus A-prime construction. */
export function runAttentionQuestCandidatePrimePipeline(
  input: AttentionQuestCandidateWorldInput,
): AttentionQuestCandidatePrimeResult {
  const access = readAttentionReadableQuestCandidateViews(input.snapshot, input.request)
  if (access.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'accessor', reason: access.reason } }

  const surface = constructAttentionReadableSurface(
    commonSurfaceRequest(input.request),
    access.views,
    access.openingCoordinateViews,
    Object.freeze([]),
  )
  if (surface.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'boundary', reason: surface.reason } }

  return { kind: 'ok', surface: surface.surface }
}

/** The A-prime canonical digest — the exact byte comparison the P3 premise check requires. */
export function attentionPrimeSurfaceDigest(surface: AttentionReadableSurface): string {
  return canonicalSerialize(surface)
}

export interface AttentionPrimeViewIdentities {
  readonly questCandidateViewIdentities: readonly string[]
  readonly questOpeningCoordinateViewIdentities: readonly string[]
  readonly patternEvidenceViewIdentities: readonly string[]
}

/**
 * The three A-prime identity premises remain disjoint and independently
 * comparable (RN019 §10.3). The sidecar identity folds in the numeric committed
 * coordinate as well as the stable candidate identity, so two worlds whose
 * quest views match but whose opening coordinates differ are correctly *not*
 * Stage B-readable-equivalent.
 */
export function attentionPrimeViewIdentities(surface: AttentionReadableSurface): AttentionPrimeViewIdentities {
  return Object.freeze({
    questCandidateViewIdentities: Object.freeze(surface.questCandidateViews.map((view) => view.candidateId)),
    questOpeningCoordinateViewIdentities: Object.freeze(surface.questOpeningCoordinateViews.map((sidecar) => (
      canonicalSerialize([sidecar.candidateId, sidecar.openedAtLsn])
    ))),
    patternEvidenceViewIdentities: Object.freeze(surface.patternEvidenceViews.map((view) => (
      canonicalSerialize([view.commitLsn, view.recordId])
    ))),
  })
}

function commonSurfaceRequest(
  request: AttentionQuestCandidateWorldInput['request'],
): AttentionReadableSurfaceRequest {
  return Object.freeze({
    surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    accessorContractVersion: request.accessorContractVersion,
    rankingSnapshotLsn: request.rankingSnapshotLsn,
  })
}

function sortedIdentitySetEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return canonicalSerialize(leftSorted) === canonicalSerialize(rightSorted)
}

/**
 * Map the ordering module's adjacent-pair comparisons (the B4 nine-key tuple)
 * into the trusted trace's ordering-comparison entries.
 * `orderAttentionCandidates` already computed the complete adjacent-pair
 * order/tie-break path (D14; replay spec §13.1) and refused any surviving tie,
 * so every entry here is strictly ordered left-before-right by construction.
 * This module never recomputes the tie-break path and never reads a
 * branch-specific candidate field here, so it stays agnostic to the two-family
 * candidate union.
 */
function toOrderingTrace(
  comparisons: readonly AttentionCandidateOrderingComparison[],
): readonly AttentionTraceOrderingComparisonEntry[] {
  return Object.freeze(comparisons.map((comparison) => Object.freeze({
    leftCandidateId: comparison.leftCandidateId,
    rightCandidateId: comparison.rightCandidateId,
    evaluatedKeys: comparison.evaluatedKeys,
    decidingKey: comparison.decidingKey,
    leftValue: comparison.leftValue,
    rightValue: comparison.rightValue,
    result: 'left-first' as const,
  })))
}

/**
 * All nine ordering-key values for one candidate, in the comparator's own key
 * sequence. Trusted trace v2 records the complete tuple per candidate, not only
 * the key that happened to decide an adjacent comparison.
 */
function orderingKeyValuesOf(
  candidate: AttentionCandidate,
  proofScore = ATTENTION_CANDIDATE_PROOF_SCORE,
): readonly AttentionTraceOrderingKeyValue[] {
  return Object.freeze(ATTENTION_TRACE_ORDERING_KEYS.map((key) => Object.freeze({
    key,
    value: key === 'proof-score' ? String(proofScore) : attentionCandidateOrderingKeyValue(candidate, key),
  })))
}

/**
 * Build the `sourceKind`-discriminated trusted candidate entry (RN019 §9.6).
 * The quest branch carries `openingProvenanceId` and the numeric `openedAtLsn`;
 * the pattern branch carries its pattern-named fields and its own
 * `lastProgressLsn`. A pattern `sourceId` is never written into
 * `openingProvenanceId` or any other quest-named field, and no quest value is
 * written into a pattern-named one — the union is the mechanism, not a
 * convention.
 */
function toTraceCandidateEntry(candidate: AttentionCandidate, proofScore = ATTENTION_CANDIDATE_PROOF_SCORE): AttentionTraceCandidateEntry {
  const orderingKeyValues = orderingKeyValuesOf(candidate, proofScore)
  if (candidate.sourceKind === 'quest_candidate') {
    return Object.freeze({
      sourceKind: 'quest_candidate' as const,
      sourceId: candidate.sourceId,
      candidateId: candidate.candidateId,
      sourceCommittedLsn: candidate.openedAtLsn,
      orderingKeyValues,
      openingProvenanceId: candidate.openingProvenanceId,
      openedAtLsn: candidate.openedAtLsn,
    })
  }
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance' as const,
    sourceId: candidate.sourceId,
    candidateId: candidate.candidateId,
    sourceCommittedLsn: candidate.lastProgressLsn,
    orderingKeyValues,
    patternInstanceId: candidate.sourceId,
    patternSemanticVersion: candidate.patternSemanticVersion,
    canonicalBindingTuple: candidate.canonicalBindingTuple,
    canonicalSupportingRecordIdentityTuple: candidate.canonicalSupportingRecordIdentityTuple,
    lastProgressLsn: candidate.lastProgressLsn,
  })
}

// ---------------------------------------------------------------------------
// Full A1 -> A2 -> A3 -> A4 pipeline for one world, plus revalidation and trace
// ---------------------------------------------------------------------------

export interface AttentionQuestCandidateReplayPassInput {
  readonly replayCaseId: string
  readonly snapshot: ProofQuestCandidateSnapshot
  readonly request: { readonly accessorContractVersion: string; readonly rankingSnapshotLsn: number }
  readonly revalidationSnapshot: ProofQuestCandidateSnapshot
  readonly revalidationSnapshotLsn: number
  readonly authoritativeLogDigestBefore: string
  readonly authoritativeLogDigestAfter: string
  readonly p3PremiseCheck?: AttentionTraceP3PremiseCheck
}

export type AttentionQuestCandidateReplayPassRefusal =
  | { readonly stage: 'accessor' | 'boundary' | 'normalization' | 'ordering' | 'trace'; readonly reason: string }
  | { readonly stage: 'package' | 'template' | 'ledger'; readonly candidateId: string; readonly reason: string }

export interface AttentionQuestCandidateReplayPassResult {
  readonly trace: AttentionTrace
  readonly ledger: AttentionLedger
  readonly surface: AttentionReadableSurface
  readonly orderedCandidates: readonly AttentionCandidate[]
}

export type AttentionQuestCandidateReplayPassOutcome =
  | { readonly kind: 'ok'; readonly result: AttentionQuestCandidateReplayPassResult }
  | { readonly kind: 'refused'; readonly refusal: AttentionQuestCandidateReplayPassRefusal }

/** One Stage A quest candidate only; callers retain ownership of loops and ledger lifecycle. */
export function attemptAttentionQuestPresentation(input: {
  readonly candidate: Extract<AttentionCandidate, { readonly sourceKind: 'quest_candidate' }>
  readonly ledger: AttentionLedger
}):
  | { readonly kind: 'ok'; readonly ledger: AttentionLedger; readonly presentation: AttentionTracePresentationEntry }
  | { readonly kind: 'refused'; readonly stage: 'package' | 'template' | 'ledger'; readonly candidateId: string; readonly reason: string } {
  const built = buildAttentionRevealPackage(input.candidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (built.kind !== 'ok') return { kind: 'refused', stage: 'package', candidateId: input.candidate.candidateId, reason: built.reason }
  const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (rendered.kind !== 'ok') return { kind: 'refused', stage: 'template', candidateId: input.candidate.candidateId, reason: rendered.reason }
  const appended = appendAttentionLedgerRecord(input.ledger, {
    attentionCandidate: input.candidate,
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
    templateVersion: ATTENTION_TEMPLATE_VERSION,
    outcome: rendered.resultTag,
    renderedOutputIdentity: rendered.outputIdentity,
  })
  if (appended.kind !== 'ok') return { kind: 'refused', stage: 'ledger', candidateId: input.candidate.candidateId, reason: appended.reason }
  return Object.freeze({
    kind: 'ok' as const,
    ledger: appended.ledger,
    presentation: Object.freeze({
      candidateId: input.candidate.candidateId,
      resultTag: rendered.resultTag,
      output: rendered.output,
      outputIdentity: rendered.outputIdentity,
      ledgerOutcome: appended.record.outcome,
      ledgerRecordId: appended.record.recordId,
    }),
  })
}

/**
 * The complete Stage A pipeline for one world: A1 accessor, A2 boundary, A3
 * normalization and total order, revalidation at the presentation-time
 * coordinate, A4 package/template/ledger per still-legal candidate in the
 * total order, and trace assembly. Every stage's own refusal is surfaced
 * verbatim (re-tagged with its stage), never repaired or approximated.
 */
export function runAttentionQuestCandidateReplayPass(
  input: AttentionQuestCandidateReplayPassInput,
): AttentionQuestCandidateReplayPassOutcome {
  const access = readAttentionReadableQuestCandidateViews(input.snapshot, input.request)
  if (access.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'accessor', reason: access.reason } }

  const surface = constructAttentionReadableSurface(
    commonSurfaceRequest(input.request),
    access.views,
    access.openingCoordinateViews,
    Object.freeze([]),
  )
  if (surface.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'boundary', reason: surface.reason } }

  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'normalization', reason: normalized.reason } }

  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'ordering', reason: ordered.reason } }

  // RN019 §8.3 step 6: the global mixed-family candidate cap applies *after* the
  // complete order, so it always retains the top of the final total order rather
  // than an independently-ordered truncation. Its decision is a resource
  // decision like any other and is recorded in the trusted trace below — never
  // in the player-observable projection.
  const capped = applyMixedFamilyCandidateCap(ordered.orderedCandidates)
  const retainedCandidates = capped.retainedCandidates
  const resourceLimits: AttentionTraceResourceLimitEntry[] = []
  if (capped.resourceTrace !== null) {
    resourceLimits.push(attentionTraceResourceLimitEntry({
      boundId: capped.resourceTrace.boundId,
      patternType: capped.resourceTrace.patternType,
      configuredValue: capped.resourceTrace.configuredValue,
      observedValue: capped.resourceTrace.observedValue,
      retainedIds: capped.resourceTrace.retainedIdentities,
      droppedIds: capped.resourceTrace.droppedIdentities,
    }))
  }

  // D12 step 11: revalidate at the presentation-time coordinate. The sole
  // stage permitted to invalidate an earlier eligibility result, and it does
  // so explicitly via a typed outcome per candidate, never silently.
  const revalidationAccess = readAttentionReadableQuestCandidateViews(input.revalidationSnapshot, {
    accessorContractVersion: input.request.accessorContractVersion,
    rankingSnapshotLsn: input.revalidationSnapshotLsn,
  })
  const revalidations: AttentionTraceRevalidationEntry[] = revalidationAccess.kind !== 'ok'
    ? retainedCandidates.map((candidate) => (
      Object.freeze({ candidateId: candidate.candidateId, outcome: 'stale-snapshot' as const })
    ))
    : (() => {
      const admittedAtRevalidation = new Set(revalidationAccess.views.map((view) => view.candidateId))
      return retainedCandidates.map((candidate) => Object.freeze({
        candidateId: candidate.candidateId,
        outcome: admittedAtRevalidation.has(candidate.sourceId)
          ? 'still-legal' as const
          : 'candidate-disappeared' as const,
      }))
    })()

  const createdLedger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (createdLedger.kind !== 'ok') {
    return { kind: 'refused', refusal: { stage: 'ledger', candidateId: '', reason: createdLedger.reason } }
  }

  let ledger = createdLedger.ledger
  const candidateEntries: AttentionTraceCandidateEntry[] = []
  const presentations: AttentionTracePresentationEntry[] = []

  for (const candidate of retainedCandidates) {
    candidateEntries.push(toTraceCandidateEntry(candidate))

    const revalidation = revalidations.find((entry) => entry.candidateId === candidate.candidateId)
    if (revalidation === undefined || revalidation.outcome !== 'still-legal') {
      // D12 step 11's typed exception: presentation never proceeds for a
      // candidate revalidation has explicitly invalidated.
      continue
    }

    // This Stage A harness constructs a surface with no pattern views; retain
    // the narrowing explicitly so its extracted helper stays quest-only.
    if (candidate.sourceKind !== 'quest_candidate') continue

    const attempted = attemptAttentionQuestPresentation({ candidate, ledger })
    if (attempted.kind !== 'ok') {
      return { kind: 'refused', refusal: { stage: attempted.stage, candidateId: attempted.candidateId, reason: attempted.reason } }
    }
    ledger = attempted.ledger
    presentations.push(attempted.presentation)
  }

  const trace = buildAttentionTrace({
    replayCaseId: input.replayCaseId,
    accessorContractVersion: input.request.accessorContractVersion,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
    derivationCacheKeySchemaVersion: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
    rankingCacheKeySchemaVersion: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
    templateVersion: ATTENTION_TEMPLATE_VERSION,
    templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION,
    rankingSnapshotLsn: input.request.rankingSnapshotLsn,
    revalidationSnapshotLsn: input.revalidationSnapshotLsn,
    admittedQuestCandidateSourceIds:
      attentionPrimeViewIdentities(surface.surface).questCandidateViewIdentities,
    orderedAttentionCandidates: Object.freeze(candidateEntries),
    orderingTrace: toOrderingTrace(ordered.comparisons),
    structuralRetention: Object.freeze({
      // The B4 replay pass normalizes quest candidates only; the mixed-family
      // pass is B6, so no pattern instance is reconstructed or retained here.
      // The mixed-family cap decision below is a real B4 resource decision and
      // reaches the trusted trace on every pass.
      retainedPatternInstanceIds: Object.freeze([]),
      droppedPatternInstanceIds: Object.freeze([]),
      mixedFamilyRetainedCandidateIds: Object.freeze(retainedCandidates.map((c) => c.candidateId)),
      mixedFamilyDroppedCandidateIds: Object.freeze(
        ordered.orderedCandidates
          .filter((candidate) => !retainedCandidates.includes(candidate))
          .map((candidate) => candidate.candidateId),
      ),
      resourceLimits: Object.freeze(resourceLimits),
    }),
    presentations: Object.freeze(presentations),
    revalidations: Object.freeze(revalidations),
    authoritativeLogDigestBefore: input.authoritativeLogDigestBefore,
    authoritativeLogDigestAfter: input.authoritativeLogDigestAfter,
    ...(input.p3PremiseCheck === undefined ? {} : { p3PremiseCheck: input.p3PremiseCheck }),
  })
  if (trace.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'trace', reason: trace.reason } }

  return {
    kind: 'ok',
    result: { trace: trace.trace, ledger, surface: surface.surface, orderedCandidates: ordered.orderedCandidates },
  }
}

/** A world whose ranking and revalidation coordinates coincide — no drift between the two clocks. */
export function stableWorldReplayPassInput(
  replayCaseId: string,
  world: AttentionQuestCandidateWorldInput,
  authoritativeLogDigest: string,
): AttentionQuestCandidateReplayPassInput {
  return Object.freeze({
    replayCaseId,
    snapshot: world.snapshot,
    request: world.request,
    revalidationSnapshot: world.snapshot,
    revalidationSnapshotLsn: world.request.rankingSnapshotLsn,
    authoritativeLogDigestBefore: authoritativeLogDigest,
    authoritativeLogDigestAfter: authoritativeLogDigest,
  })
}

// ---------------------------------------------------------------------------
// B6 pattern-prime derivation: the one pure normalized-pattern-id producer
// ---------------------------------------------------------------------------

/*
 * One normalized pattern candidate paired with the direct-evidence assertion
 * inputs of the retained instance it was normalized from -- the pattern-prime
 * half of plan section 11.3 input 7. The caller attaches the remaining
 * per-candidate scenario values (both opaque cache keys, and any satisfied
 * completion coordinate) onto these candidate ids; this type holds neither.
 *
 * Comments in this module are deliberately written without backtick code spans:
 * attentionLedgerStaticClosure.test.ts scans this file with a token scanner that
 * mis-pairs backticks after a template literal, so backticked prose can leak
 * into what that scan reads as code.
 */
export interface AttentionPatternPrimeCandidate {
  readonly candidateId: string
  readonly directEvidenceAssertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[]
}

export type AttentionPatternPrimeDerivationOutcome =
  | { readonly kind: 'ok'; readonly candidates: readonly AttentionPatternPrimeCandidate[] }
  | {
      readonly kind: 'refused'
      readonly stage: 'boundary' | 'monitor' | 'normalization' | 'association'
      readonly reason: string
    }

/*
 * B6 / plan section 11.3 -- the one PURE pattern-prime derivation function.
 *
 * It exists because input 7 is keyed by the normalized pattern candidate id only
 * the one common normalizer can mint, while inputs 3 and 5 are accessor-minted
 * evidence views that carry no such identity, and the closed section 11.7
 * allowlist gives no scenario module a path to the chain that bridges them. It
 * lives in this module because this is the only authorized module that already
 * holds every remaining dependency the chain needs at the committed baseline.
 *
 * It runs the committed section 11.2A steps 3-7 in EXACTLY that order:
 *
 *  1. the one common A-prime surface construction, over the accessor-minted
 *     evidence views;
 *  2. reconstruction over the surface's re-emitted accepted evidence views --
 *     never over the raw input list;
 *  3. committed structural retention;
 *  4. the one common candidate normalization;
 *  5. association of each normalized pattern candidate id with the retained
 *     instance's existing direct-evidence assertion inputs.
 *
 * STEP 1 PRECEDES STEP 2 FOR A LOAD-BEARING REASON. The A-prime boundary is what
 * validates accessor-mint, the evidence view contract version, record id
 * uniqueness, and the canonical commit-lsn/record-id evidence ordering, and only
 * then re-emits the accepted list. Reconstructing from the raw, unvalidated
 * input list instead would let this derivation succeed on input the evaluator's
 * own A-prime construction refuses -- so it would refuse at a different step,
 * under a different reason, than the evaluator does over the same views.
 *
 * IT IS NOT A SECOND ORCHESTRATION SEAM. It attempts no candidate, holds no
 * success slot, decides no continuation, touches no ledger, owns no ordering or
 * cap, assembles no trace, reaches no generative seam, and mints no identity of
 * any kind -- including neither of input 7's two cache keys. The mixed-family
 * evaluator remains the sole mixed-family orchestration seam and still runs
 * steps 3-7 itself over its own mixed inputs rather than delegating any part of
 * an evaluation here.
 *
 * WHY A PATTERN-ONLY SURFACE YIELDS THE EVALUATOR'S IDS. The committed pattern
 * identity construction in attentionCandidate.ts derives a pattern candidate id
 * from four instance-local values alone: the source id, the pattern semantic
 * version, the canonical binding tuple, and the canonical supporting-record
 * identity tuple. The mixed surface's extra quest views, its opening-coordinate
 * sidecars, and the ranking snapshot lsn do not participate in pattern candidate
 * identity, so pattern identity is independent of mixed-family membership. That
 * equality is proven, not assumed -- see attentionLedgerStaticClosure.test.ts
 * and attentionMixedCandidateReplay.test.ts.
 */
export function deriveAttentionPatternPrimeCandidates(input: {
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
  readonly accessorContractVersion: string
  readonly evaluationSnapshotLsn: number
}): AttentionPatternPrimeDerivationOutcome {
  // Step 1 -- the one common A-prime boundary, before any reconstruction.
  const surface = constructAttentionReadableSurface(
    commonSurfaceRequest({
      accessorContractVersion: input.accessorContractVersion,
      rankingSnapshotLsn: input.evaluationSnapshotLsn,
    }),
    Object.freeze([]),
    Object.freeze([]),
    input.patternEvidenceViews,
  )
  if (surface.kind !== 'ok') return { kind: 'refused', stage: 'boundary', reason: surface.reason }

  // Step 2 -- reconstruction over the accepted views the boundary re-emitted,
  // never over the raw, unvalidated input list.
  const monitored = reconstructNarrativePatternInstances({
    patternEvidenceViews: surface.surface.patternEvidenceViews,
    evaluationSnapshotLsn: input.evaluationSnapshotLsn,
  })
  if (monitored.kind !== 'ok') return { kind: 'refused', stage: 'monitor', reason: monitored.reason }

  // Steps 3 and 4 -- committed structural retention, then common normalization.
  const retention = applyNarrativePatternStructuralRetention(monitored.instances)
  const normalized = normalizeAttentionCandidates(surface.surface, retention.retainedRankableInstances)
  if (normalized.kind !== 'ok') return { kind: 'refused', stage: 'normalization', reason: normalized.reason }

  // Step 5 -- the one bounded, pure association pass section 11.3 permits. It
  // reads two already-computed collections and emits one pairing: it attempts no
  // candidate, consumes no presentation slot, and decides no continuation.
  const assertionInputsByPatternInstanceId = new Map(
    retention.retainedRankableInstances.map(
      (instance) => [instance.patternInstanceId, instance.directEvidenceAssertionInputs] as const,
    ),
  )
  const derived: AttentionPatternPrimeCandidate[] = []
  for (const normalizedCandidate of normalized.attentionCandidates) {
    if (normalizedCandidate.sourceKind !== 'narrative_pattern_instance') continue
    const directEvidenceAssertionInputs = assertionInputsByPatternInstanceId.get(normalizedCandidate.sourceId)
    if (directEvidenceAssertionInputs === undefined) {
      return { kind: 'refused', stage: 'association', reason: 'missing-retained-pattern-instance' }
    }
    derived.push(Object.freeze({ candidateId: normalizedCandidate.candidateId, directEvidenceAssertionInputs }))
  }
  return { kind: 'ok', candidates: Object.freeze(derived) }
}

// ---------------------------------------------------------------------------
// B6 mixed-family evaluation: one order, one cap, one shared success slot
// ---------------------------------------------------------------------------

export interface AttentionMixedPatternPresentationInput {
  readonly candidateId: string
  readonly directEvidenceAssertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[]
  readonly rankingCacheKey: string
  readonly revalidationCacheKey: string
  readonly satisfiedCompletionLsn?: number
  readonly aggregateSources?: readonly AttentionAggregateSource[]
}

export interface AttentionMixedFamilyEvaluationInput {
  readonly replayCaseId: string
  readonly snapshot: ProofQuestCandidateSnapshot
  readonly request: { readonly accessorContractVersion: string; readonly rankingSnapshotLsn: number }
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
  readonly revalidationSnapshot: ProofQuestCandidateSnapshot
  readonly revalidationSnapshotLsn: number
  readonly revalidationPatternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
  readonly ledger: AttentionLedger
  readonly patternPresentationInputs: readonly AttentionMixedPatternPresentationInput[]
  readonly patternPresentationLedgerPolicyVersion: string
  /** C1 activation is explicit; callers must choose disabled or the registered C1 policy. */
  readonly aggregateLegitimacyPolicyRef: AggregateLegitimacyPolicyRef
  /** C9 ranking-only declared inputs; omitted only by pre-C9 compatibility paths. */
  readonly scorePolicy?: { readonly policyRef: ScorePolicyRef; readonly declaredFeatures: readonly AttentionDeclaredScoreFeatures[] }
  readonly authoritativeLogDigestBefore: string
  readonly authoritativeLogDigestAfter: string
  readonly p3PremiseCheck?: AttentionTraceP3PremiseCheck
  readonly policy?: AttentionStageBResourcePolicy
}

export type AttentionMixedFamilyEvaluationRefusal =
  | { readonly stage: 'accessor' | 'boundary' | 'monitor' | 'normalization' | 'ordering' | 'trace'; readonly reason: string }
  | { readonly stage: 'package' | 'template' | 'ledger'; readonly candidateId: string; readonly reason: string }
  | { readonly stage: 'pattern-input'; readonly candidateId: string; readonly reason: 'missing-pattern-presentation-input' }

export interface AttentionMixedFamilyArbitrationAttempt {
  readonly candidateId: string
  readonly sourceKind: 'quest_candidate' | 'narrative_pattern_instance'
  readonly rankPosition: number
  readonly outcome: 'presented' | 'revalidation-refused' | 'assertion-build-refused' | 'package-refused' | 'render-refused' | 'ledger-append-refused' | 'not-attempted'
  readonly refusalReason: string | null
  readonly continued: boolean
  readonly ledgerAppend: 'appended' | 'not-appended'
}

export interface AttentionMixedFamilyEvaluationResult {
  readonly trace: AttentionTrace
  readonly ledger: AttentionLedger
  readonly surface: AttentionReadableSurface
  readonly orderedCandidates: readonly AttentionCandidate[]
  readonly retainedCandidates: readonly AttentionCandidate[]
  readonly arbitrationAttempts: readonly AttentionMixedFamilyArbitrationAttempt[]
  readonly presentation: AttentionTracePresentationEntry | null
}

export type AttentionMixedFamilyEvaluationOutcome =
  | { readonly kind: 'ok'; readonly result: AttentionMixedFamilyEvaluationResult }
  | { readonly kind: 'refused'; readonly refusal: AttentionMixedFamilyEvaluationRefusal }

function reconstructRetainedPatterns(
  views: readonly AttentionReadablePatternEvidenceView[],
  evaluationSnapshotLsn: number,
):
  | { readonly kind: 'ok'; readonly instances: readonly NarrativePatternInstance[]; readonly retention: ReturnType<typeof applyNarrativePatternStructuralRetention> }
  | { readonly kind: 'refused'; readonly reason: string } {
  const monitored = reconstructNarrativePatternInstances({ patternEvidenceViews: views, evaluationSnapshotLsn })
  if (monitored.kind !== 'ok') return { kind: 'refused', reason: monitored.reason }
  return { kind: 'ok', instances: monitored.instances, retention: applyNarrativePatternStructuralRetention(monitored.instances) }
}

/**
 * The sole B6 mixed-family orchestration seam. It consumes caller-owned history,
 * reconstructs patterns at both coordinates, and stops after exactly one append.
 */
export function runAttentionMixedFamilyEvaluation(
  input: AttentionMixedFamilyEvaluationInput,
): AttentionMixedFamilyEvaluationOutcome {
  const policy = input.policy ?? attentionStageBResourcePolicy()
  const access = readAttentionReadableQuestCandidateViews(input.snapshot, input.request)
  if (access.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'accessor', reason: access.reason } }
  const surface = constructAttentionReadableSurface(
    commonSurfaceRequest(input.request), access.views, access.openingCoordinateViews, input.patternEvidenceViews,
  )
  if (surface.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'boundary', reason: surface.reason } }
  // Plan section 11.2A step 5 -- reconstruction consumes the accepted views the
  // A-prime boundary re-emitted, never the raw input list, at both coordinates.
  const derivedPatterns = reconstructRetainedPatterns(surface.surface.patternEvidenceViews, input.request.rankingSnapshotLsn)
  if (derivedPatterns.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'monitor', reason: derivedPatterns.reason } }
  const normalized = normalizeAttentionCandidates(surface.surface, derivedPatterns.retention.retainedRankableInstances)
  if (normalized.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'normalization', reason: normalized.reason } }
  const ordered = orderAttentionCandidates(normalized.attentionCandidates, input.scorePolicy)
  if (ordered.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'ordering', reason: ordered.reason } }
  const proofScoreByCandidateId = new Map((ordered.scoreComponents ?? []).map((component) => [component.candidateId, component.proofScore]))
  const capped = applyMixedFamilyCandidateCap(ordered.orderedCandidates)
  const retainedCandidates = capped.retainedCandidates

  const revalidationAccess = readAttentionReadableQuestCandidateViews(input.revalidationSnapshot, {
    accessorContractVersion: input.request.accessorContractVersion,
    rankingSnapshotLsn: input.revalidationSnapshotLsn,
  })
  // RN019 section 9.4.2 -- the revalidation-coordinate PATTERN chain, run in the
  // committed plan section 11.2A order: the A-prime boundary FIRST, then
  // reconstruction over the surface's re-emitted accepted views, then structural
  // retention, then the exact-candidateId index. The raw input list reaches the
  // boundary and nothing else, so no later step consumes unvalidated views.
  //
  // FAMILY ISOLATION. Every refusal along this chain means the same thing --
  // pattern revalidation material is unavailable at the revalidation coordinate
  // -- and RN019 section 9.4.2 assigns exactly that to row 2 of the closed
  // continuation table: each reached pattern candidate refuses through the
  // committed revalidation function, nothing is appended, the shared success
  // slot stays unconsumed, and QUEST CANDIDATES ARE UNTOUCHED. It is not an
  // evaluation-level refusal: only the quest construction rows 7-9 fail the
  // whole evaluation closed, and this is not one of them. The refusal is
  // therefore handled by omission -- the lookup simply stays empty, which is the
  // same "absent material" state an empty revalidation view list produces -- so
  // no new pattern refusal literal is exposed and the committed
  // candidate-disappeared result is what each pattern candidate receives.
  const revalidationPatternById = new Map<string, AttentionPatternCandidate>()
  const revalidatedPatternSurface = constructAttentionReadableSurface(
    commonSurfaceRequest({ accessorContractVersion: input.request.accessorContractVersion, rankingSnapshotLsn: input.revalidationSnapshotLsn }),
    Object.freeze([]), Object.freeze([]), input.revalidationPatternEvidenceViews,
  )
  if (revalidatedPatternSurface.kind === 'ok') {
    const revalidatedPatterns = reconstructRetainedPatterns(
      revalidatedPatternSurface.surface.patternEvidenceViews, input.revalidationSnapshotLsn,
    )
    if (revalidatedPatterns.kind === 'ok') {
      const revalidatedPatternCandidates = normalizeAttentionCandidates(
        revalidatedPatternSurface.surface, revalidatedPatterns.retention.retainedRankableInstances,
      )
      if (revalidatedPatternCandidates.kind === 'ok') {
        for (const candidate of revalidatedPatternCandidates.attentionCandidates) {
          if (candidate.sourceKind === 'narrative_pattern_instance') revalidationPatternById.set(candidate.candidateId, candidate)
        }
      }
    }
  }
  const presentationInputByCandidateId = new Map(input.patternPresentationInputs.map((entry) => [entry.candidateId, entry] as const))
  const admittedQuestIds = revalidationAccess.kind === 'ok'
    ? new Set(revalidationAccess.views.map((view) => view.candidateId))
    : null

  let ledger = input.ledger
  let presentation: AttentionTracePresentationEntry | null = null
  const presentations: AttentionTracePresentationEntry[] = []
  const revalidations: AttentionTraceRevalidationEntry[] = []
  const attempts: AttentionMixedFamilyArbitrationAttempt[] = []
  const patternDecisions: AttentionTracePatternPresentationDecision[] = []

  // RN019 §8.2/§8.2.1 B: the shared, family-blind success budget is the
  // versioned policy value, never a literal at this call site. B6 makes the
  // already-committed `presentationsPerEvaluation` load-bearing and adds no
  // constant of its own. A configured budget of zero deterministically attempts
  // nothing: every candidate is recorded `not-attempted`, no ledger record is
  // appended, and the slot stays unconsumed (RN019 §8.3's zero-cap rule).
  const maxSuccessfulPresentations = policy.presentationsPerEvaluation
  let successfulPresentations = 0

  for (let rankPosition = 0; rankPosition < retainedCandidates.length; rankPosition += 1) {
    const candidate = retainedCandidates[rankPosition]!
    if (successfulPresentations >= maxSuccessfulPresentations) {
      attempts.push(Object.freeze({ candidateId: candidate.candidateId, sourceKind: candidate.sourceKind, rankPosition,
        outcome: 'not-attempted', refusalReason: null, continued: false, ledgerAppend: 'not-appended' }))
      continue
    }
    if (candidate.sourceKind === 'quest_candidate') {
      const outcome = admittedQuestIds === null
        ? 'stale-snapshot' as const
        : admittedQuestIds.has(candidate.sourceId) ? 'still-legal' as const : 'candidate-disappeared' as const
      revalidations.push(Object.freeze({ candidateId: candidate.candidateId, outcome }))
      if (outcome !== 'still-legal') {
        attempts.push(Object.freeze({ candidateId: candidate.candidateId, sourceKind: candidate.sourceKind, rankPosition,
          outcome: 'revalidation-refused', refusalReason: outcome, continued: true, ledgerAppend: 'not-appended' }))
        continue
      }
      const attempted = attemptAttentionQuestPresentation({ candidate, ledger })
      if (attempted.kind !== 'ok') {
        // RN019 §9.4.1 rows 7-9: a quest construction fault is a structural
        // fault, not an ordinary candidate outcome. The whole evaluation fails
        // closed and its output is the stage-tagged refusal verbatim, so no
        // arbitration attempt record is built here -- constructing one that the
        // refusal branch cannot carry would be discarded, unreadable evidence.
        return { kind: 'refused', refusal: { stage: attempted.stage, candidateId: attempted.candidateId, reason: attempted.reason } }
      }
      ledger = attempted.ledger
      presentation = attempted.presentation
      presentations.push(attempted.presentation)
      successfulPresentations += 1
      attempts.push(Object.freeze({ candidateId: candidate.candidateId, sourceKind: candidate.sourceKind, rankPosition,
        outcome: 'presented', refusalReason: null, continued: false, ledgerAppend: 'appended' }))
      continue
    }

    const patternInput = presentationInputByCandidateId.get(candidate.candidateId)
    if (patternInput === undefined) {
      return { kind: 'refused', refusal: { stage: 'pattern-input', candidateId: candidate.candidateId, reason: 'missing-pattern-presentation-input' } }
    }
    const attempt = attemptAttentionPatternPresentation({
      // Exact candidateId lookup, never a sibling. An empty or missing entry is
      // the committed candidate-disappeared path (RN019 section 9.4.1 row 2).
      entry: Object.freeze({ candidate, revalidatedCandidate: revalidationPatternById.get(candidate.candidateId),
        directEvidenceAssertionInputs: patternInput.directEvidenceAssertionInputs, rankingCacheKey: patternInput.rankingCacheKey,
        revalidationCacheKey: patternInput.revalidationCacheKey,
        ...(patternInput.aggregateSources === undefined ? {} : { aggregateSources: patternInput.aggregateSources }),
        ...(patternInput.satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn: patternInput.satisfiedCompletionLsn }) }),
      ledger, evaluationLsn: input.revalidationSnapshotLsn,
      patternPresentationLedgerPolicyVersion: input.patternPresentationLedgerPolicyVersion, policy,
      aggregateLegitimacyPolicyRef: input.aggregateLegitimacyPolicyRef,
    })
    ledger = attempt.ledger
    patternDecisions.push(attempt.decision)
    const outcome = attempt.attempt.outcome
    const arbitrationOutcome = outcome === 'presented' ? 'presented' : outcome
    attempts.push(Object.freeze({ candidateId: candidate.candidateId, sourceKind: candidate.sourceKind, rankPosition,
      outcome: arbitrationOutcome, refusalReason: attempt.attempt.refusalDetail,
      continued: outcome !== 'presented', ledgerAppend: attempt.decision.ledgerAppend }))
    if (attempt.presentation !== null) {
      presentation = attempt.presentation
      presentations.push(attempt.presentation)
      successfulPresentations += 1
    }
  }

  const resourceLimits: AttentionTraceResourceLimitEntry[] = derivedPatterns.retention.resourceTrace.map((entry) => attentionTraceResourceLimitEntry({
    boundId: entry.boundId, patternType: entry.patternType, configuredValue: entry.configuredValue, observedValue: entry.observedValue,
    retainedIds: entry.retainedIdentities, droppedIds: entry.droppedIdentities,
  }))
  if (capped.resourceTrace !== null) resourceLimits.push(attentionTraceResourceLimitEntry({
    boundId: capped.resourceTrace.boundId, patternType: capped.resourceTrace.patternType, configuredValue: capped.resourceTrace.configuredValue,
    observedValue: capped.resourceTrace.observedValue, retainedIds: capped.resourceTrace.retainedIdentities, droppedIds: capped.resourceTrace.droppedIdentities,
  }))
  const trace = buildAttentionTrace({
    replayCaseId: input.replayCaseId, accessorContractVersion: input.request.accessorContractVersion,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION, identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION, derivationCacheKeySchemaVersion: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
    rankingCacheKeySchemaVersion: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION, templateVersion: ATTENTION_TEMPLATE_VERSION,
    templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION, exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION, patternPresentationLedgerPolicyVersion: input.patternPresentationLedgerPolicyVersion,
    rankingSnapshotLsn: input.request.rankingSnapshotLsn, revalidationSnapshotLsn: input.revalidationSnapshotLsn,
    admittedQuestCandidateSourceIds: attentionPrimeViewIdentities(surface.surface).questCandidateViewIdentities,
    orderedAttentionCandidates: Object.freeze(retainedCandidates.map((candidate) => (
      toTraceCandidateEntry(candidate, proofScoreByCandidateId.get(candidate.candidateId))
    ))), orderingTrace: toOrderingTrace(ordered.comparisons),
    structuralRetention: Object.freeze({ retainedPatternInstanceIds: Object.freeze(derivedPatterns.retention.retainedInstances.map((instance) => instance.patternInstanceId)),
      droppedPatternInstanceIds: derivedPatterns.retention.droppedInstanceIds,
      mixedFamilyRetainedCandidateIds: Object.freeze(retainedCandidates.map((candidate) => candidate.candidateId)),
      mixedFamilyDroppedCandidateIds: Object.freeze(ordered.orderedCandidates.filter((candidate) => !retainedCandidates.includes(candidate)).map((candidate) => candidate.candidateId)),
      resourceLimits: Object.freeze(resourceLimits) }),
    presentations: Object.freeze(presentations), revalidations: Object.freeze(revalidations),
    ...(patternDecisions.length === 0 ? {} : { patternPresentationDecisions: Object.freeze(patternDecisions) }),
    authoritativeLogDigestBefore: input.authoritativeLogDigestBefore, authoritativeLogDigestAfter: input.authoritativeLogDigestAfter,
    mixedFamilyArbitration: Object.freeze({ rankedCandidateIds: Object.freeze(retainedCandidates.map((candidate) => candidate.candidateId)),
      attempts: Object.freeze(attempts), winnerCandidateId: presentation?.candidateId ?? null,
      winnerSourceKind: presentation === null ? null : retainedCandidates.find((candidate) => candidate.candidateId === presentation.candidateId)!.sourceKind,
      presentationSlotConsumed: successfulPresentations > 0, successfulPresentationCount: successfulPresentations }),
    ...(input.p3PremiseCheck === undefined ? {} : { p3PremiseCheck: input.p3PremiseCheck }),
    ...(input.scorePolicy === undefined ? {} : { scorePolicyEvidence: Object.freeze({
      policyRef: input.scorePolicy.policyRef,
      declaredFeatures: Object.freeze(ordered.scoreComponents!
        .slice()
        .sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0)
        .map((component) => Object.freeze({
          candidateId: component.candidateId,
          publicStakesBand: component.publicStakesBand,
          worldTimeRecencyBand: component.worldTimeRecencyBand,
        }))),
    }) }),
  })
  if (trace.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'trace', reason: trace.reason } }
  return { kind: 'ok', result: Object.freeze({ trace: trace.trace, ledger, surface: surface.surface,
    orderedCandidates: ordered.orderedCandidates, retainedCandidates, arbitrationAttempts: Object.freeze(attempts), presentation }) }
}

// ---------------------------------------------------------------------------
// P3 — the mandatory premise check, then (only on success) the full pass
// ---------------------------------------------------------------------------

export interface AttentionP3PairedWorldInput {
  readonly replayCaseId: string
  readonly worldA: AttentionQuestCandidateWorldInput
  readonly worldB: AttentionQuestCandidateWorldInput
}

export interface AttentionP3PairedWorldResult {
  readonly premiseCheck: AttentionTraceP3PremiseCheck
  readonly traceA?: AttentionTrace
  readonly traceB?: AttentionTrace
}

/**
 * Replay spec §10's mandatory premise check, run before any observable-trace
 * comparison for every P3 fixture: independently construct A-prime for each
 * world, canonically compare, compare view-identity sets, and only on
 * success run the full pass for both worlds. A pair that is not A-prime
 * equivalent returns the (failing) premise check and no traces — the fixture
 * fails as malformed, exactly as the replay spec requires, rather than
 * proceeding to an observable comparison that would prove nothing.
 */
export function runAttentionP3PairedWorldCheck(input: AttentionP3PairedWorldInput): AttentionP3PairedWorldResult {
  const primeA = runAttentionQuestCandidatePrimePipeline(input.worldA)
  const primeB = runAttentionQuestCandidatePrimePipeline(input.worldB)
  if (primeA.kind !== 'ok' || primeB.kind !== 'ok') {
    throw new Error('runAttentionP3PairedWorldCheck: both worlds must admit an A-prime surface to run the premise check')
  }

  const leftAPrimeDigest = attentionPrimeSurfaceDigest(primeA.surface)
  const rightAPrimeDigest = attentionPrimeSurfaceDigest(primeB.surface)
  const leftIdentities = attentionPrimeViewIdentities(primeA.surface)
  const rightIdentities = attentionPrimeViewIdentities(primeB.surface)
  // RN019 §10.3: P3 readable-surface equality compares all three v2 collections.
  const equivalent = leftAPrimeDigest === rightAPrimeDigest
    && sortedIdentitySetEqual(
      leftIdentities.questCandidateViewIdentities,
      rightIdentities.questCandidateViewIdentities,
    )
    && sortedIdentitySetEqual(
      leftIdentities.questOpeningCoordinateViewIdentities,
      rightIdentities.questOpeningCoordinateViewIdentities,
    )
    && sortedIdentitySetEqual(
      leftIdentities.patternEvidenceViewIdentities,
      rightIdentities.patternEvidenceViewIdentities,
    )

  const premiseCheck: AttentionTraceP3PremiseCheck = Object.freeze({
    leftAPrimeDigest,
    rightAPrimeDigest,
    leftViewIdentities: leftIdentities.questCandidateViewIdentities,
    rightViewIdentities: rightIdentities.questCandidateViewIdentities,
    leftOpeningCoordinateIdentities: leftIdentities.questOpeningCoordinateViewIdentities,
    rightOpeningCoordinateIdentities: rightIdentities.questOpeningCoordinateViewIdentities,
    equivalent,
  })

  if (!equivalent) return { premiseCheck }

  const noAuthoritativeLogDigest = digestAttentionReplayAuthoritativeLog({ commits: Object.freeze([]) })

  const passA = runAttentionQuestCandidateReplayPass({
    ...stableWorldReplayPassInput(input.replayCaseId + ':world-a', input.worldA, noAuthoritativeLogDigest),
    p3PremiseCheck: premiseCheck,
  })
  const passB = runAttentionQuestCandidateReplayPass({
    ...stableWorldReplayPassInput(input.replayCaseId + ':world-b', input.worldB, noAuthoritativeLogDigest),
    p3PremiseCheck: premiseCheck,
  })
  if (passA.kind !== 'ok' || passB.kind !== 'ok') {
    throw new Error('runAttentionP3PairedWorldCheck: an A-prime-equivalent pair must complete a full replay pass for both worlds')
  }

  return { premiseCheck, traceA: passA.result.trace, traceB: passB.result.trace }
}

// ---------------------------------------------------------------------------
// P2 — director-off / director-on authoritative composition
// ---------------------------------------------------------------------------

/**
 * Director-off: the authoritative commit fold alone. Attention never runs.
 */
export function runAttentionDirectorOffPass(
  initialResources: AttentionReplayAuthoritativeResources,
  commandIds: readonly string[],
  wallClockInputs: readonly AttentionReplayWallClockInput[],
): { readonly resources: AttentionReplayAuthoritativeResources; readonly digest: string } {
  let resources = initialResources
  commandIds.forEach((commandId, index) => {
    resources = commitAttentionReplayAuthoritativeCommand(resources, commandId, wallClockInputs[index] ?? 0)
  })
  return { resources, digest: digestAttentionReplayAuthoritativeLog(resources.log) }
}

export interface AttentionDirectorOnInput {
  readonly replayPassInput: AttentionQuestCandidateReplayPassInput
  /** B6 P2 uses the real mixed evaluator; omitted preserves the Stage A driver. */
  readonly mixedFamilyEvaluationInput?: AttentionMixedFamilyEvaluationInput
  readonly initialAuthoritativeResources: AttentionReplayAuthoritativeResources
  readonly commandIds: readonly string[]
  readonly wallClockInputs: readonly AttentionReplayWallClockInput[]
  /** Timing perturbation (P2-4): attention may run before or after the authoritative commits — neither reads the other. */
  readonly runAttentionFirst?: boolean
  /**
   * Negative-control use only: deliberately perturbs one authoritative
   * resource before the commits run, simulating the coupling Stage A's real
   * code structurally cannot commit. Never supplied by a positive fixture.
   */
  readonly coupling?: (resources: AttentionReplayAuthoritativeResources) => AttentionReplayAuthoritativeResources
}

export interface AttentionDirectorOnResult {
  readonly attention: AttentionQuestCandidateReplayPassOutcome | AttentionMixedFamilyEvaluationOutcome
  readonly authoritativeResources: AttentionReplayAuthoritativeResources
  readonly authoritativeDigest: string
}

/**
 * Director-on: both the authoritative commit fold and a genuine call into
 * this module's own attention replay pass. `runAttentionQuestCandidateReplayPass`
 * accepts no authoritative resource of any kind, so the attention call below
 * structurally cannot touch `initialAuthoritativeResources` — isolation is a
 * property of the function signatures involved, not an assertion about their
 * bodies. `coupling`, when supplied, is the sole way this harness lets a test
 * simulate the forbidden alternative.
 */
export function runAttentionDirectorOnPass(input: AttentionDirectorOnInput): AttentionDirectorOnResult {
  const runAuthoritative = (): AttentionReplayAuthoritativeResources => {
    let resources = input.coupling === undefined
      ? input.initialAuthoritativeResources
      : input.coupling(input.initialAuthoritativeResources)
    input.commandIds.forEach((commandId, index) => {
      resources = commitAttentionReplayAuthoritativeCommand(resources, commandId, input.wallClockInputs[index] ?? 0)
    })
    return resources
  }

  let attention: AttentionQuestCandidateReplayPassOutcome | AttentionMixedFamilyEvaluationOutcome
  let finalResources: AttentionReplayAuthoritativeResources

  if (input.runAttentionFirst === true) {
    attention = input.mixedFamilyEvaluationInput === undefined
      ? runAttentionQuestCandidateReplayPass(input.replayPassInput)
      : runAttentionMixedFamilyEvaluation(input.mixedFamilyEvaluationInput)
    finalResources = runAuthoritative()
  } else {
    finalResources = runAuthoritative()
    attention = input.mixedFamilyEvaluationInput === undefined
      ? runAttentionQuestCandidateReplayPass(input.replayPassInput)
      : runAttentionMixedFamilyEvaluation(input.mixedFamilyEvaluationInput)
  }

  return {
    attention,
    authoritativeResources: finalResources,
    authoritativeDigest: digestAttentionReplayAuthoritativeLog(finalResources.log),
  }
}

/** Convenience: the accessor-contract version constant every replay-scenario builder pins its requests to. */
export const REPLAY_ACCESSOR_CONTRACT_VERSION = ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION
