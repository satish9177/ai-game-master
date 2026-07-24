/**
 * Stage B / B4 — the single immutable, versioned proof-rig resource policy for
 * narrative-pattern instances and the deterministic structural-retention it
 * governs. Proof-local to `domain/livingWorldProof`; not a production module,
 * reducer, event, persistence contract, or a claim of production-tuned values.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §8 the complete proof-rig resource/candidate/presentation policy,
 *    §8.3 the versioned retention class and the exact cap sequence);
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D16 structural and post-ranking bounds; identity is disjoint from
 *    resource policy);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§4.4 the pinned bound matrix, §9 B4 obligations).
 *
 * Every value here is a pinned, deeply immutable, versioned proof-rig constant.
 * None is a production-tuned claim. Resource decisions are trusted,
 * deterministic, and non-authoritative: retention reads instances and returns a
 * projection plus an engine-only `resource_limit_exceeded` trace; it never
 * mutates an instance, admitted evidence, the authoritative log, or any B3
 * monitor output.
 *
 * The two-child conflict fork cap is authored B3 monitor semantics
 * (`ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP`) and the newest-32
 * evidence lookback is the B1 window limit; this policy pins its own copies and
 * refuses at load rather than silently choosing one value if either disagrees.
 *
 * The policy participates in the derivation/ranking cache identity through its
 * version and hash (see `attentionCandidateCacheKey.ts`); it is excluded from
 * `NarrativePatternInstance` identity by construction, because nothing here is
 * an input to `computeNarrativePatternInstanceId`.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import { ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT } from './attentionPatternEvidenceContracts'
import { ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP } from './attentionNarrativePatternMonitor'
import { NARRATIVE_PATTERN_TYPES } from './attentionNarrativePatternIdentity'
import type { NarrativePatternType } from './attentionNarrativePatternIdentity'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'

/** The version this rig's resource/candidate policy is pinned under (plan §3.1). */
export const ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION = 'attention-stage-b-resource-policy-v1' as const

/**
 * The experiment-owned, versioned structural retention class (RN019 §8.3).
 * The leftmost class is retained first; the order is policy, not a claim of
 * narrative value. Only `satisfied`, `active`, and `stalled` are rankable.
 */
export type NarrativePatternRetentionClass =
  | 'satisfied'
  | 'active'
  | 'stalled'
  | 'violated'
  | 'expired'
  | 'abandoned'

export const NARRATIVE_PATTERN_RETENTION_CLASS_ORDER: readonly NarrativePatternRetentionClass[] =
  Object.freeze([
    'satisfied',
    'active',
    'stalled',
    'violated',
    'expired',
    'abandoned',
  ])

/** The rankable classes: satisfied and inconclusive active/stalled only. */
export const NARRATIVE_PATTERN_RANKABLE_CLASSES: readonly NarrativePatternRetentionClass[] =
  Object.freeze(['satisfied', 'active', 'stalled'])

/**
 * The complete pinned proof-rig policy surface (RN019 §8 / plan §4.4). Every
 * value is a proof-rig default. The record is deeply frozen and its canonical
 * bytes are the `patternPolicyHash` the cache keys fold in, so a value edit is
 * a visible version/hash change rather than a silent drift.
 */
export interface AttentionStageBResourcePolicy {
  readonly resourcePolicyVersion: string
  readonly newestAdmittedEvidenceViews: number
  readonly reconstructedInstancesPerPatternType: number
  readonly activeStalledPartialsPerPatternType: number
  readonly reconstructedInstancesGlobal: number
  readonly conflictChildrenPerParent: number
  readonly evidenceItemsPerInstance: number
  readonly patternSteps: number
  readonly mixedFamilyCandidatesAfterOrdering: number
  readonly revealPackageAssertions: number
  readonly presentationsPerEvaluation: number
  readonly successfulPresentationsInWindow: number
  readonly retentionClassOrder: readonly NarrativePatternRetentionClass[]
}

const POLICY: AttentionStageBResourcePolicy = Object.freeze({
  resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  newestAdmittedEvidenceViews: 32,
  reconstructedInstancesPerPatternType: 6,
  activeStalledPartialsPerPatternType: 4,
  reconstructedInstancesGlobal: 12,
  conflictChildrenPerParent: 2,
  evidenceItemsPerInstance: 3,
  patternSteps: 3,
  mixedFamilyCandidatesAfterOrdering: 4,
  revealPackageAssertions: 4,
  presentationsPerEvaluation: 1,
  successfulPresentationsInWindow: 4,
  retentionClassOrder: NARRATIVE_PATTERN_RETENTION_CLASS_ORDER,
})

/**
 * The single accessor to the pinned policy. It returns the deeply frozen
 * record so no caller can mutate a bound; a caller wanting a bound reads a
 * named field rather than an index.
 */
export function attentionStageBResourcePolicy(): AttentionStageBResourcePolicy {
  return POLICY
}

/**
 * Load-time agreement guards. The two-child fork cap is authored B3 monitor
 * semantics and the newest-32 lookback is the B1 window; a disagreement refuses
 * at load rather than silently choosing one value (plan §1, §2).
 */
if (POLICY.conflictChildrenPerParent !== ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP) {
  throw new Error(
    'attentionNarrativePatternResourcePolicy: conflict fork cap disagrees with authored B3 monitor semantics',
  )
}
if (POLICY.newestAdmittedEvidenceViews !== ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT) {
  throw new Error(
    'attentionNarrativePatternResourcePolicy: evidence lookback disagrees with the B1 admission window limit',
  )
}

/** The pattern-policy hash the derivation cache key folds in (plan §8). */
export const ATTENTION_NARRATIVE_PATTERN_POLICY_HASH = mintHash(canonicalSerialize(POLICY))

// ---------------------------------------------------------------------------
// Deterministic structural retention.
// ---------------------------------------------------------------------------

/** The engine-only bound identifiers a `resource_limit_exceeded` entry names. */
export type NarrativePatternResourceBoundId =
  | 'per-type-reconstructed'
  | 'per-type-active-stalled'
  | 'global-reconstructed'
  | 'mixed-family-candidate'

/**
 * One engine-only `resource_limit_exceeded` result (RN019 §8.3). It carries the
 * bound id, configured and observed values, and the retained/dropped identity
 * sets. It is trusted-trace evidence only and consumes no player-visible budget.
 */
export interface NarrativePatternResourceLimitExceeded {
  readonly boundId: NarrativePatternResourceBoundId
  readonly patternType: NarrativePatternType | null
  readonly configuredValue: number
  readonly observedValue: number
  readonly retainedIdentities: readonly string[]
  readonly droppedIdentities: readonly string[]
}

export interface NarrativePatternStructuralRetentionResult {
  readonly retainedInstances: readonly NarrativePatternInstance[]
  readonly retainedRankableInstances: readonly NarrativePatternInstance[]
  readonly droppedInstanceIds: readonly string[]
  readonly resourceTrace: readonly NarrativePatternResourceLimitExceeded[]
}

function classOf(instance: NarrativePatternInstance): NarrativePatternRetentionClass {
  if (instance.monitorVerdict === 'inconclusive') return instance.narrativeAnnotation
  return instance.monitorVerdict
}

/** Whether an instance is rankable (satisfied/active/stalled only). */
export function isNarrativePatternInstanceRankable(instance: NarrativePatternInstance): boolean {
  return (NARRATIVE_PATTERN_RANKABLE_CLASSES as readonly string[]).includes(classOf(instance))
}

function classRank(instance: NarrativePatternInstance): number {
  return NARRATIVE_PATTERN_RETENTION_CLASS_ORDER.indexOf(classOf(instance))
}

function patternTypeRank(patternType: NarrativePatternType): number {
  return NARRATIVE_PATTERN_TYPES.indexOf(patternType)
}

function compareCodeUnit(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * The deterministic retention order (RN019 §8.3): retention class first, then
 * `patternType -> canonicalBindingTuple -> canonicalSupportingRecordIdentityTuple
 * -> patternInstanceId`. Input order never participates; the leftmost survivor
 * is retained first.
 */
function compareRetention(left: NarrativePatternInstance, right: NarrativePatternInstance): number {
  const classDelta = classRank(left) - classRank(right)
  if (classDelta !== 0) return classDelta
  const typeDelta = patternTypeRank(left.patternType) - patternTypeRank(right.patternType)
  if (typeDelta !== 0) return typeDelta
  const bindingDelta = compareCodeUnit(
    canonicalSerialize(left.bindingMap),
    canonicalSerialize(right.bindingMap),
  )
  if (bindingDelta !== 0) return bindingDelta
  const supportDelta = compareCodeUnit(
    canonicalSerialize(left.supportingRecordIdentityTuple),
    canonicalSerialize(right.supportingRecordIdentityTuple),
  )
  if (supportDelta !== 0) return supportDelta
  return compareCodeUnit(left.patternInstanceId, right.patternInstanceId)
}

function isActiveOrStalled(instance: NarrativePatternInstance): boolean {
  const cls = classOf(instance)
  return cls === 'active' || cls === 'stalled'
}

function limitExceeded(
  boundId: NarrativePatternResourceBoundId,
  patternType: NarrativePatternType | null,
  configuredValue: number,
  observed: readonly NarrativePatternInstance[],
  retained: readonly NarrativePatternInstance[],
  dropped: readonly NarrativePatternInstance[],
): NarrativePatternResourceLimitExceeded {
  return Object.freeze({
    boundId,
    patternType,
    configuredValue,
    observedValue: observed.length,
    retainedIdentities: Object.freeze(retained.map((entry) => entry.patternInstanceId)),
    droppedIdentities: Object.freeze(dropped.map((entry) => entry.patternInstanceId)),
  })
}

/**
 * Apply the exact RN019 §8.3 structural retention sequence to reconstructed
 * instances:
 *
 *  1. per-type reconstructed cap (all states);
 *  2. per-type active/stalled live-partial cap;
 *  3. global reconstructed cap.
 *
 * Normalization, ordering, the mixed-family candidate cap, and presentation
 * selection are later stages. Retention is deterministic and independent of
 * input order: everything is compared through `compareRetention` first. The
 * result carries every surviving instance (all states, for trusted trace),
 * the rankable subset (for normalization), the dropped ids, and the engine-only
 * `resource_limit_exceeded` trace.
 */
export function applyNarrativePatternStructuralRetention(
  instances: readonly NarrativePatternInstance[],
): NarrativePatternStructuralRetentionResult {
  const sorted = [...instances].sort(compareRetention)
  const resourceTrace: NarrativePatternResourceLimitExceeded[] = []
  const dropped: NarrativePatternInstance[] = []

  // Step 1 — per-type reconstructed cap (all states).
  const perTypeAll = new Map<NarrativePatternType, NarrativePatternInstance[]>()
  const afterPerType: NarrativePatternInstance[] = []
  for (const instance of sorted) {
    const kept = perTypeAll.get(instance.patternType) ?? []
    perTypeAll.set(instance.patternType, kept)
    if (kept.length < POLICY.reconstructedInstancesPerPatternType) {
      kept.push(instance)
      afterPerType.push(instance)
    } else {
      dropped.push(instance)
    }
  }
  for (const patternType of NARRATIVE_PATTERN_TYPES) {
    const forType = sorted.filter((entry) => entry.patternType === patternType)
    if (forType.length > POLICY.reconstructedInstancesPerPatternType) {
      const retained = perTypeAll.get(patternType) ?? []
      resourceTrace.push(limitExceeded(
        'per-type-reconstructed',
        patternType,
        POLICY.reconstructedInstancesPerPatternType,
        forType,
        retained,
        forType.filter((entry) => !retained.includes(entry)),
      ))
    }
  }

  // Step 2 — per-type active/stalled live-partial cap.
  const perTypeLive = new Map<NarrativePatternType, number>()
  const afterLive: NarrativePatternInstance[] = []
  for (const instance of afterPerType) {
    if (isActiveOrStalled(instance)) {
      const live = perTypeLive.get(instance.patternType) ?? 0
      if (live >= POLICY.activeStalledPartialsPerPatternType) {
        dropped.push(instance)
        continue
      }
      perTypeLive.set(instance.patternType, live + 1)
    }
    afterLive.push(instance)
  }
  for (const patternType of NARRATIVE_PATTERN_TYPES) {
    const liveForType = afterPerType.filter(
      (entry) => entry.patternType === patternType && isActiveOrStalled(entry),
    )
    if (liveForType.length > POLICY.activeStalledPartialsPerPatternType) {
      const retained = afterLive.filter(
        (entry) => entry.patternType === patternType && isActiveOrStalled(entry),
      )
      resourceTrace.push(limitExceeded(
        'per-type-active-stalled',
        patternType,
        POLICY.activeStalledPartialsPerPatternType,
        liveForType,
        retained,
        liveForType.filter((entry) => !retained.includes(entry)),
      ))
    }
  }

  // Step 3 — global reconstructed cap.
  const retainedInstances = afterLive.slice(0, POLICY.reconstructedInstancesGlobal)
  const globallyDropped = afterLive.slice(POLICY.reconstructedInstancesGlobal)
  for (const instance of globallyDropped) dropped.push(instance)
  if (afterLive.length > POLICY.reconstructedInstancesGlobal) {
    resourceTrace.push(limitExceeded(
      'global-reconstructed',
      null,
      POLICY.reconstructedInstancesGlobal,
      afterLive,
      retainedInstances,
      globallyDropped,
    ))
  }

  const retainedRankableInstances = retainedInstances.filter(isNarrativePatternInstanceRankable)

  return Object.freeze({
    retainedInstances: Object.freeze(retainedInstances),
    retainedRankableInstances: Object.freeze(retainedRankableInstances),
    droppedInstanceIds: Object.freeze(dropped.map((entry) => entry.patternInstanceId)),
    resourceTrace: Object.freeze(resourceTrace),
  })
}

export interface MixedFamilyCandidateCapResult<T> {
  readonly retainedCandidates: readonly T[]
  readonly resourceTrace: NarrativePatternResourceLimitExceeded | null
}

/**
 * Apply the global mixed-family candidate cap (RN019 §8.2, step 6): after the
 * complete two-family order, retain the first four candidates. It operates on
 * the already-ordered sequence and reads only `candidateId`, so it neither
 * re-sorts nor discriminates by family. A breach records the engine-only
 * `resource_limit_exceeded` trace with the retained top and dropped ids.
 */
export function applyMixedFamilyCandidateCap<T extends { readonly candidateId: string }>(
  orderedCandidates: readonly T[],
): MixedFamilyCandidateCapResult<T> {
  const cap = POLICY.mixedFamilyCandidatesAfterOrdering
  const retainedCandidates = orderedCandidates.slice(0, cap)
  const droppedCandidates = orderedCandidates.slice(cap)
  const resourceTrace = orderedCandidates.length > cap
    ? Object.freeze({
        boundId: 'mixed-family-candidate' as const,
        patternType: null,
        configuredValue: cap,
        observedValue: orderedCandidates.length,
        retainedIdentities: Object.freeze(retainedCandidates.map((entry) => entry.candidateId)),
        droppedIdentities: Object.freeze(droppedCandidates.map((entry) => entry.candidateId)),
      })
    : null
  return Object.freeze({
    retainedCandidates: Object.freeze([...retainedCandidates]),
    resourceTrace,
  })
}
