import type { Observation } from './contracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { ActionConsequence, AttemptVerdict, ObservedResult, ProofActionAttempt } from './intentionContracts'
import type { IntentionStore, OutcomeCommitResult, OutcomeRequest } from './intentionStore'
import { commitOutcome } from './intentionStore'

/**
 * The proof-local deterministic action authority (ADR-0002/0003 reused at
 * proof scale, spec §2.9): every dispatched ActionAttempt -- intention-
 * driven or routine -- is decided here and only here. A plan emits
 * attempts; it never mutates world state and never self-verifies success.
 * An impossible or forbidden attempt returns a typed failure and mints NO
 * consequence (P16 -- no fabricated consequence); the actor perceives only
 * a scope-computed observation (`observedResult` / an Observation record),
 * never the validator's truth-derived internal reason, which persists
 * engine-side for audit only (D12). No LLM, no I/O.
 */

/** Deterministic per-tick world facts, authored by the fixture -- the validator's only truth input. */
export interface WorldActionFacts {
  /** Targets whose path is transiently blocked this tick (a retryable in-fiction failure). */
  blockedTargets: ReadonlySet<string>
  /** Targets not present where the actor expects them (plan-inapplicability discovered in fiction). */
  absentTargets: ReadonlySet<string>
  /** Targets that cannot be affected at all (e.g. a door barred from inside). */
  lockedTargets: ReadonlySet<string>
  /** `${action}:${target}` pairs the rules of the world forbid outright. */
  forbiddenPairs: ReadonlySet<string>
}

export function worldFacts(partial?: Partial<WorldActionFacts>): WorldActionFacts {
  return {
    blockedTargets: partial?.blockedTargets ?? new Set(),
    absentTargets: partial?.absentTargets ?? new Set(),
    lockedTargets: partial?.lockedTargets ?? new Set(),
    forbiddenPairs: partial?.forbiddenPairs ?? new Set(),
  }
}

/** Actions that, when they succeed, mint a world consequence; movement and routine patrols do not. */
const CONSEQUENTIAL_ACTIONS: ReadonlySet<string> = new Set(['speak-accusation', 'speak-warning', 'speak-correction'])

export interface AttemptDecision {
  verdict: AttemptVerdict
  observedResult: ObservedResult
  /** Engine-side audit only -- never enters the observation or any explanation (D12). */
  engineReason?: string
  mintsConsequence: boolean
  effects?: Record<string, string>
}

/**
 * The deterministic validator: forbidden and impossible attempts are
 * rejected with no consequence; a transient block or absent target is a
 * typed in-fiction failure; everything else succeeds, minting a
 * consequence only for consequential actions.
 */
export function validateAttempt(attempt: ProofActionAttempt, facts: WorldActionFacts): AttemptDecision {
  if (facts.forbiddenPairs.has(`${attempt.action}:${attempt.target}`)) {
    return { verdict: 'rejected-forbidden', observedResult: 'no-effect', engineReason: 'forbidden-by-world-rule', mintsConsequence: false }
  }
  if (facts.lockedTargets.has(attempt.target)) {
    return {
      verdict: 'rejected-impossible',
      observedResult: 'no-effect',
      engineReason: 'barred-from-inside-by-unseen-actor',
      mintsConsequence: false,
    }
  }
  if (facts.blockedTargets.has(attempt.target)) {
    return { verdict: 'failed', observedResult: 'blocked', engineReason: 'path-transiently-blocked', mintsConsequence: false }
  }
  if (facts.absentTargets.has(attempt.target)) {
    return { verdict: 'failed', observedResult: 'target-absent', engineReason: 'target-not-at-location', mintsConsequence: false }
  }
  return {
    verdict: 'succeeded',
    observedResult: 'done',
    mintsConsequence: CONSEQUENTIAL_ACTIONS.has(attempt.action),
    ...(CONSEQUENTIAL_ACTIONS.has(attempt.action) ? { effects: { [`${attempt.action}:${attempt.target}`]: 'delivered' } } : {}),
  }
}

/** The scope-computed observation the actor perceives -- result only, never the engine reason (D12). */
function observationFor(attempt: ProofActionAttempt, decision: AttemptDecision, time: string): Observation {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: `O_${attempt.actor}_${attempt.id}`,
    observer: attempt.actor,
    truthRef: attempt.id,
    channels: ['sight'],
    perceived: { action: attempt.action, target: attempt.target, result: decision.observedResult },
    missing: [],
    fidelity: 'full',
    time,
  }
}

/**
 * Runs the validator over an already-dispatched attempt and commits the
 * resulting ActionOutcome (possibly long after dispatch -- the D10 delayed
 * path uses exactly this function). Consequences exist only where the
 * validator succeeded on a consequential action; the outcome commit itself
 * can never reopen a closed intention.
 */
export function executeAttempt(
  store: IntentionStore,
  attemptId: string,
  facts: WorldActionFacts,
  time: string,
): { store: IntentionStore; outcome: OutcomeCommitResult } {
  const attempt = store.attempts.find((candidate) => candidate.id === attemptId)
  if (attempt === undefined) {
    return commitOutcome(store, { attemptId, verdict: 'failed', observedResult: 'no-effect' })
  }

  const decision = validateAttempt(attempt, facts)
  const consequence: ActionConsequence | undefined = decision.mintsConsequence
    ? {
        schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
        id: `AC_${attempt.id}`,
        attemptId: attempt.id,
        effects: decision.effects ?? {},
      }
    : undefined

  const request: OutcomeRequest = {
    attemptId: attempt.id,
    verdict: decision.verdict,
    observedResult: decision.observedResult,
    observation: observationFor(attempt, decision, time),
    ...(decision.engineReason !== undefined ? { engineReason: decision.engineReason } : {}),
    ...(consequence !== undefined ? { consequence } : {}),
  }

  return commitOutcome(store, request)
}
