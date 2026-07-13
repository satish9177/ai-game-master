import { commitBelief, commitRevision, initConflictStore } from './conflictStore'
import type { CommitBeliefOutcome, CommitTransitionOutcome, ConflictStore } from './conflictStore'
import type { ClaimRegistry, WorldInstant } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import type { TransitionCause } from './conflictContracts'
import { readable } from './evidenceRecords'
import type { ReadableRecord } from './evidenceRecords'
import type { AttributionTransitionSupport, AttributionTransitionSupportMap } from './attributionContracts'

/**
 * The append-only attribution store: the unmodified `ConflictStore` plus an
 * additive `AttributionTransitionSupport` sidecar map, keyed 1:1 to its
 * owning `BeliefTransition`'s id (research vault ADR-0011 D8 amendment).
 * `commitFirstMint` wraps `commitBelief` unchanged for every first-ever
 * attribution/event-participation belief (no predecessor, no transition, no
 * sidecar entry -- exactly the Bel_A1/Bel_D1 pattern). `commitAscription
 * Supersession` wraps `commitRevision` unchanged, always passing
 * `inputEvidenceIds: []` (P110/D8's second amendment) and, when the rule
 * recorded understanding/support provenance, attaching one sidecar entry --
 * but ONLY after `validateSupportRecords` below accepts every id in that
 * sidecar's `input_record_ids` (F62 amendment: this is the one commit-time
 * invariant this wrapper enforces itself, since `conflictStore.ts`'s own
 * `inputEvidenceIds` validation has no notion of an attribution sidecar).
 * Every other accept/reject decision remains the unmodified
 * `conflictStore.ts` primitives'.
 */

/**
 * F62 amendment: the closed vocabulary of `ReadableRecord` kinds each
 * ascription-supersession rule may cite as sidecar support. `ascription_decay`
 * allows none at all -- its own rule always passes `inputRecordIds: []`
 * (decay is driven only by a committed world-time gap, never a record
 * citation). Any `ruleId` absent from this table allows nothing (closed
 * vocabulary default: reject unless explicitly admitted).
 */
const ALLOWED_SUPPORT_KINDS: Readonly<Record<string, ReadonlySet<ReadableRecord['kind']>>> = {
  ascribe_from_evidence_presentation: new Set(['observation', 'belief']),
  ascribe_from_apology: new Set(['observation', 'belief']),
  ascribe_from_acknowledgment: new Set(['observation', 'belief']),
  ascribe_from_retraction_withdraw: new Set(['observation', 'belief']),
  ascribe_from_retraction_deny: new Set(['observation', 'belief']),
  ascription_decay: new Set(),
}

export type SupportRecordFault =
  | 'unresolved-support-record'
  | 'disallowed-support-record-kind'
  | 'support-record-not-holder-readable'
  | 'support-record-not-yet-committed'

/**
 * F62's actual commit-path boundary: every id in a candidate sidecar's
 * `input_record_ids` must (1) resolve to a record present in the `universe`
 * given to this call, (2) be one of the kinds this specific rule is allowed
 * to cite, (3) be holder-readable to the ascriber via the unmodified
 * `readable()` gate (which structurally also excludes any OTHER holder's
 * private state -- a modeled holder's own Belief/Observation is never in
 * the ascriber's own `readable(holder, ...)` set), and (4) for a Belief-kind
 * citation specifically, already carry a timing entry in THIS store (the
 * one record kind this store tracks with a genuine commit-order marker) --
 * an untimed Belief is a "future" citation relative to this commit,
 * rejected even though it is present in `universe`.
 */
function validateSupportRecords(store: AttributionStore, universe: readonly ReadableRecord[], input: AscriptionSupersessionInput): SupportRecordFault | null {
  const allowedKinds = ALLOWED_SUPPORT_KINDS[input.ruleId] ?? new Set<ReadableRecord['kind']>()
  const readableToHolder = readable(input.holder, universe)

  for (const recordId of input.inputRecordIds) {
    const entry = universe.find((candidate) => candidate.record.id === recordId)
    if (entry === undefined) {
      return 'unresolved-support-record'
    }
    if (!allowedKinds.has(entry.kind)) {
      return 'disallowed-support-record-kind'
    }
    if (!readableToHolder.some((candidate) => candidate.record.id === recordId)) {
      return 'support-record-not-holder-readable'
    }
    if (entry.kind === 'belief' && !store.conflict.timing.has(entry.record.id)) {
      return 'support-record-not-yet-committed'
    }
  }
  return null
}

export interface AttributionStore {
  conflict: ConflictStore
  sidecars: AttributionTransitionSupportMap
}

export function initAttributionStore(claims: ClaimRegistry): AttributionStore {
  return { conflict: initConflictStore(claims), sidecars: new Map() }
}

export function commitFirstMint(
  store: AttributionStore,
  universe: readonly ReadableRecord[],
  beliefId: string,
  validFrom: WorldInstant,
): { store: AttributionStore; outcome: CommitBeliefOutcome } {
  const { store: conflict, outcome } = commitBelief(store.conflict, universe, beliefId, validFrom)
  return { store: { conflict, sidecars: store.sidecars }, outcome }
}

export interface AscriptionSupersessionInput {
  transitionId: string
  holder: string
  fromBeliefId: string
  toBeliefId: string
  effectiveValidTime: WorldInstant
  validFrom: WorldInstant
  cause: TransitionCause
  ruleId: string
  ruleVersion: string
  understandingRuleId?: string
  understandingRuleVersion?: string
  inputRecordIds: readonly string[]
  /** Populated only when player free-text canonicalization participated (D8/P109) -- the engine-validated, precommitted proposal, logged verbatim on the resulting transition. */
  recordedProposal?: string
}

export type CommitAscriptionSupersessionOutcome = CommitTransitionOutcome | { verdict: 'rejected'; fault: SupportRecordFault }

/**
 * Commits a stance/confidence-changing transition via the unmodified
 * `commitRevision`, with `inputEvidenceIds` ALWAYS `[]` (P110): every
 * Observation-id support this rule cited rides the sidecar's
 * `input_record_ids` instead, never the transition's own evidence-id array.
 * Before ever calling `commitRevision`, `validateSupportRecords` (F62
 * amendment) checks every id in `input.inputRecordIds`; on rejection, this
 * function returns immediately -- no `BeliefTransition` is committed, no
 * `AttributionTransitionSupport` entry is written, and the store returned is
 * the UNCHANGED input store (reference-stable `conflict`, byte-identical
 * `sidecars`). A sidecar entry is written only once the transition itself
 * commits -- never independently, and never ahead of its owning transition
 * (D8/D18).
 */
export function commitAscriptionSupersession(
  store: AttributionStore,
  universe: readonly ReadableRecord[],
  input: AscriptionSupersessionInput,
): { store: AttributionStore; outcome: CommitAscriptionSupersessionOutcome } {
  const supportFault = validateSupportRecords(store, universe, input)
  if (supportFault !== null) {
    return { store, outcome: { verdict: 'rejected', fault: supportFault } }
  }

  const { store: conflict, outcome } = commitRevision(
    store.conflict,
    {
      toBeliefId: input.toBeliefId,
      validFrom: input.validFrom,
      transition: {
        transitionId: input.transitionId,
        holder: input.holder,
        fromBeliefId: input.fromBeliefId,
        toBeliefId: input.toBeliefId,
        effectiveValidTime: input.effectiveValidTime,
        cause: input.cause,
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
        ...(input.recordedProposal !== undefined ? { recordedProposal: input.recordedProposal } : {}),
      },
    },
    universe,
  )

  if (outcome.verdict !== 'committed') {
    return { store: { conflict, sidecars: store.sidecars }, outcome }
  }

  const support: AttributionTransitionSupport = {
    transitionId: outcome.transition.transitionId,
    ascriptionRuleId: input.ruleId,
    ascriptionRuleVersion: input.ruleVersion,
    ...(input.understandingRuleId !== undefined ? { understandingRuleId: input.understandingRuleId } : {}),
    ...(input.understandingRuleVersion !== undefined ? { understandingRuleVersion: input.understandingRuleVersion } : {}),
    inputRecordIds: [...input.inputRecordIds],
  }

  const sidecars = new Map(store.sidecars)
  sidecars.set(outcome.transition.transitionId, support)

  return { store: { conflict, sidecars }, outcome }
}

export function sidecarFor(store: AttributionStore, transitionId: string): AttributionTransitionSupport | undefined {
  return store.sidecars.get(transitionId)
}
