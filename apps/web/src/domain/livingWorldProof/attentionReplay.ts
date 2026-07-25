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
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
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
export function runAttentionPatternPresentationPass(input: {
  readonly orderedCandidates: readonly AttentionPatternPresentationPassCandidateInput[]
  readonly ledger: AttentionLedger
  readonly evaluationLsn: number
  /** The ledger identity this presentation attempt runs under; passed through unchanged. */
  readonly patternPresentationLedgerPolicyVersion: string
  readonly policy?: AttentionStageBResourcePolicy
}): AttentionPatternPresentationPassResult {
  const policy = input.policy ?? attentionStageBResourcePolicy()
  let ledger = input.ledger
  const attempts: AttentionPatternPresentationAttemptResult[] = []
  const decisions: AttentionTracePatternPresentationDecision[] = []
  let presentation: AttentionTracePresentationEntry | null = null

  for (const entry of input.orderedCandidates) {
    if (presentation !== null) break

    const revalidation = revalidateAttentionPatternPresentation({
      selectedCandidate: entry.candidate,
      revalidatedCandidate: entry.revalidatedCandidate,
      rankingCacheKey: entry.rankingCacheKey,
      revalidationCacheKey: entry.revalidationCacheKey,
      // Verbatim: a stale supplied identity must reach revalidation as-is.
      patternPresentationLedgerPolicyVersion: input.patternPresentationLedgerPolicyVersion,
      ledger,
      evaluationLsn: input.evaluationLsn,
      policy,
      ...(entry.satisfiedCompletionLsn === undefined ? {} : { satisfiedCompletionLsn: entry.satisfiedCompletionLsn }),
    })
    if (!revalidation.ok) {
      attempts.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'revalidation-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze([]),
        refusalDetail: revalidation.reason,
      }))
      decisions.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze([]),
        ...patternPresentationRefusalTraceOutcomes(revalidation.reason),
        ledgerAppend: 'not-appended',
      }))
      continue
    }

    const assertions = buildAttentionDirectEvidenceAssertions(entry.directEvidenceAssertionInputs)
    if (assertions.kind !== 'ok') {
      attempts.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'assertion-build-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze([]),
        refusalDetail: assertions.reason,
      }))
      decisions.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze([]),
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      }))
      continue
    }

    const built = buildAttentionRevealPackage(entry.candidate, {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
      directEvidenceAssertions: assertions.assertions,
      policy,
    })
    if (built.kind !== 'ok') {
      attempts.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'package-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        refusalDetail: built.reason,
      }))
      decisions.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      }))
      continue
    }

    const rendered = renderAttentionRevealPackage(built.revealPackage, {
      templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
    })
    if (rendered.kind !== 'ok') {
      attempts.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'render-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        refusalDetail: rendered.reason,
      }))
      decisions.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      }))
      continue
    }

    const appended = appendAttentionLedgerRecord(ledger, {
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
      attempts.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        outcome: 'ledger-append-refused',
        revalidationReason: revalidation.reason,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        refusalDetail: appended.reason,
      }))
      decisions.push(Object.freeze({
        candidateId: entry.candidate.candidateId,
        assertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
        ...REVALIDATED_ELIGIBLE_TRACE_OUTCOMES,
        ledgerAppend: 'not-appended',
      }))
      continue
    }

    ledger = appended.ledger
    const assertionIds = Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId))
    attempts.push(Object.freeze({
      candidateId: entry.candidate.candidateId,
      outcome: 'presented',
      revalidationReason: revalidation.reason,
      assertionIds,
      refusalDetail: null,
    }))
    // The presentation that just appended is itself one more successful
    // exposure: retirement is derived from the post-append count, not the
    // pre-presentation `revalidation.policyDecision` count, so the exposure
    // that crosses the threshold is the one that reports retirement -- never
    // a hard-coded `'not-retired'` on the append that actually retires it
    // (RN019 SS8.4: "the second successful exposure retires ... immediately
    // after the ledger append").
    const postAppendExposureCount = revalidation.policyDecision.successfulExposureCount + 1
    const retirementOutcome: AttentionTracePatternPresentationOutcome =
      postAppendExposureCount >= policy.maxSuccessfulExposuresPerCandidateId ? 'retired-exposure' : 'not-retired'
    decisions.push(Object.freeze({
      candidateId: entry.candidate.candidateId,
      assertionIds,
      revalidationOutcome: 'still-legal',
      exposureCooldownOutcome: 'eligible',
      densityOutcome: 'eligible',
      retirementOutcome,
      ledgerAppend: 'appended',
    }))
    presentation = Object.freeze({
      candidateId: entry.candidate.candidateId,
      resultTag: rendered.resultTag,
      output: rendered.output,
      outputIdentity: rendered.outputIdentity,
      ledgerOutcome: appended.record.outcome,
      ledgerRecordId: appended.record.recordId,
    })
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
function orderingKeyValuesOf(candidate: AttentionCandidate): readonly AttentionTraceOrderingKeyValue[] {
  return Object.freeze(ATTENTION_TRACE_ORDERING_KEYS.map((key) => Object.freeze({
    key,
    value: attentionCandidateOrderingKeyValue(candidate, key),
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
function toTraceCandidateEntry(candidate: AttentionCandidate): AttentionTraceCandidateEntry {
  const orderingKeyValues = orderingKeyValuesOf(candidate)
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

    const built = buildAttentionRevealPackage(candidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (built.kind !== 'ok') {
      return { kind: 'refused', refusal: { stage: 'package', candidateId: candidate.candidateId, reason: built.reason } }
    }
    const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (rendered.kind !== 'ok') {
      return { kind: 'refused', refusal: { stage: 'template', candidateId: candidate.candidateId, reason: rendered.reason } }
    }

    const appended = appendAttentionLedgerRecord(ledger, {
      attentionCandidate: candidate,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_TEMPLATE_VERSION,
      outcome: rendered.resultTag,
      renderedOutputIdentity: rendered.outputIdentity,
    })
    if (appended.kind !== 'ok') {
      return { kind: 'refused', refusal: { stage: 'ledger', candidateId: candidate.candidateId, reason: appended.reason } }
    }
    ledger = appended.ledger

    presentations.push(Object.freeze({
      candidateId: candidate.candidateId,
      resultTag: rendered.resultTag,
      output: rendered.output,
      outputIdentity: rendered.outputIdentity,
      ledgerOutcome: appended.record.outcome,
      ledgerRecordId: appended.record.recordId,
    }))
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
  readonly attention: AttentionQuestCandidateReplayPassOutcome
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

  let attention: AttentionQuestCandidateReplayPassOutcome
  let finalResources: AttentionReplayAuthoritativeResources

  if (input.runAttentionFirst === true) {
    attention = runAttentionQuestCandidateReplayPass(input.replayPassInput)
    finalResources = runAuthoritative()
  } else {
    finalResources = runAuthoritative()
    attention = runAttentionQuestCandidateReplayPass(input.replayPassInput)
  }

  return {
    attention,
    authoritativeResources: finalResources,
    authoritativeDigest: digestAttentionReplayAuthoritativeLog(finalResources.log),
  }
}

/** Convenience: the accessor-contract version constant every replay-scenario builder pins its requests to. */
export const REPLAY_ACCESSOR_CONTRACT_VERSION = ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION
