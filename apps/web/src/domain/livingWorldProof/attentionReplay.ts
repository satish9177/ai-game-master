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
import { constructAttentionReadableSurface } from './attentionQuestCandidateBoundary'
import type { AttentionReadableSurface } from './attentionQuestCandidateBoundary'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import {
  ATTENTION_CANDIDATE_ORDERING_KEYS,
  orderAttentionCandidates,
  resolveAttentionCandidateOrderingKey,
} from './attentionCandidateOrdering'
import type { AttentionCandidateOrderingKey } from './attentionCandidateOrdering'
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
import { appendAttentionLedgerRecord, createAttentionLedger } from './attentionLedger'
import type { AttentionLedger } from './attentionLedger'
import { buildAttentionTrace, canonicalAttentionTraceBytes } from './attentionTrace'
import type {
  AttentionTrace,
  AttentionTraceCandidateEntry,
  AttentionTraceOrderingComparisonEntry,
  AttentionTraceP3PremiseCheck,
  AttentionTracePresentationEntry,
  AttentionTraceRevalidationEntry,
} from './attentionTrace'
import {
  commitAttentionReplayAuthoritativeCommand,
  digestAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'
import type {
  AttentionReplayAuthoritativeResources,
  AttentionReplayWallClockInput,
} from './attentionReplayResources'
import { canonicalSerialize } from './canonicalSerialization'

export { canonicalAttentionTraceBytes }

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

  const surface = constructAttentionReadableSurface(input.request, access.views)
  if (surface.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'boundary', reason: surface.reason } }

  return { kind: 'ok', surface: surface.surface }
}

/** The A-prime canonical digest — the exact byte comparison the P3 premise check requires. */
export function attentionPrimeSurfaceDigest(surface: AttentionReadableSurface): string {
  return canonicalSerialize(surface)
}

/** The A-prime view identity set, in the surface's own (stable, accessor-supplied) order. */
export function attentionPrimeViewIdentities(surface: AttentionReadableSurface): readonly string[] {
  return Object.freeze(surface.questCandidateViews.map((view) => view.candidateId))
}

function sortedIdentitySetEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return canonicalSerialize(leftSorted) === canonicalSerialize(rightSorted)
}

/** The candidate's own field value at one ordering key -- exactly what `attentionCandidateOrdering.ts`'s comparator compares, restated as a string for trace legibility. */
function attentionCandidateOrderingKeyValue(candidate: AttentionCandidate, key: AttentionCandidateOrderingKey): string {
  switch (key) {
    case 'source-kind': return candidate.sourceKind
    case 'source-id': return candidate.sourceId
    case 'opening-provenance-id': return candidate.openingProvenanceId
    case 'candidate-id': return candidate.candidateId
  }
}

/**
 * The complete adjacent-pair order/tie-break path (D14; replay spec §13.1)
 * over an already-totally-ordered candidate sequence. Adjacent-pair coverage
 * is sound by the same argument `orderAttentionCandidates` itself relies on:
 * in a sorted sequence, two entries compare equal somewhere if and only if
 * some adjacent pair does. `orderAttentionCandidates` has already refused
 * (`ordering-tie-not-total`) before this function is ever called, so every
 * adjacent pair here is guaranteed to have a non-null deciding key -- a
 * structural guarantee, not an assumption, because both this function and
 * `orderAttentionCandidates` read the same ordering-key table.
 */
function buildAttentionOrderingTrace(
  orderedCandidates: readonly AttentionCandidate[],
): readonly AttentionTraceOrderingComparisonEntry[] {
  const entries: AttentionTraceOrderingComparisonEntry[] = []
  for (let index = 0; index < orderedCandidates.length - 1; index += 1) {
    const left = orderedCandidates[index]!
    const right = orderedCandidates[index + 1]!
    const decidingKey = resolveAttentionCandidateOrderingKey(left, right)
    if (decidingKey === null) {
      throw new Error(
        'attentionReplay: adjacent ordered candidates unexpectedly tied through every key '
        + '-- orderAttentionCandidates should have already refused this input',
      )
    }
    const cutoff = ATTENTION_CANDIDATE_ORDERING_KEYS.indexOf(decidingKey)
    entries.push(Object.freeze({
      leftCandidateId: left.candidateId,
      rightCandidateId: right.candidateId,
      evaluatedKeys: Object.freeze(ATTENTION_CANDIDATE_ORDERING_KEYS.slice(0, cutoff + 1)),
      decidingKey,
      leftValue: attentionCandidateOrderingKeyValue(left, decidingKey),
      rightValue: attentionCandidateOrderingKeyValue(right, decidingKey),
      // Always 'left-first': orderAttentionCandidates has already sorted the
      // sequence and refused any surviving tie, so every adjacent pair it
      // returns is strictly ordered left-before-right by construction.
      result: 'left-first' as const,
    }))
  }
  return Object.freeze(entries)
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

  const surface = constructAttentionReadableSurface(input.request, access.views)
  if (surface.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'boundary', reason: surface.reason } }

  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'normalization', reason: normalized.reason } }

  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') return { kind: 'refused', refusal: { stage: 'ordering', reason: ordered.reason } }

  // D12 step 11: revalidate at the presentation-time coordinate. The sole
  // stage permitted to invalidate an earlier eligibility result, and it does
  // so explicitly via a typed outcome per candidate, never silently.
  const revalidationAccess = readAttentionReadableQuestCandidateViews(input.revalidationSnapshot, {
    accessorContractVersion: input.request.accessorContractVersion,
    rankingSnapshotLsn: input.revalidationSnapshotLsn,
  })
  const revalidations: AttentionTraceRevalidationEntry[] = revalidationAccess.kind !== 'ok'
    ? ordered.orderedCandidates.map((candidate) => (
      Object.freeze({ candidateId: candidate.candidateId, outcome: 'stale-snapshot' as const })
    ))
    : (() => {
      const admittedAtRevalidation = new Set(revalidationAccess.views.map((view) => view.candidateId))
      return ordered.orderedCandidates.map((candidate) => Object.freeze({
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

  for (const candidate of ordered.orderedCandidates) {
    candidateEntries.push(Object.freeze({
      candidateId: candidate.candidateId,
      sourceId: candidate.sourceId,
      openingProvenanceId: candidate.openingProvenanceId,
    }))

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
    admittedQuestCandidateSourceIds: attentionPrimeViewIdentities(surface.surface),
    orderedAttentionCandidates: Object.freeze(candidateEntries),
    orderingTrace: buildAttentionOrderingTrace(ordered.orderedCandidates),
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
  const leftViewIdentities = attentionPrimeViewIdentities(primeA.surface)
  const rightViewIdentities = attentionPrimeViewIdentities(primeB.surface)
  const equivalent = leftAPrimeDigest === rightAPrimeDigest
    && sortedIdentitySetEqual(leftViewIdentities, rightViewIdentities)

  const premiseCheck: AttentionTraceP3PremiseCheck = Object.freeze({
    leftAPrimeDigest,
    rightAPrimeDigest,
    leftViewIdentities,
    rightViewIdentities,
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
