import { canonicalSerialize } from './canonicalSerialization'
import type { JudgeProbe } from './conflictReplay'
import type { IntentionCommit } from './intentionContracts'
import type { IntentionStore } from './intentionStore'
import { currentSupportOf, initIntentionStore, projectIntention } from './intentionStore'

/**
 * Deterministic intention replay (ADR-0009 D11, spec §1.2 replay rule).
 * Replay never calls deliberateAndAdopt/commitAdoption/
 * commitIntentionTransition/dispatchAttempt/commitOutcome -- the normal
 * allocators and rules are structurally unreachable here. For every
 * recorded commit it mechanically validates the recorded invariants (a
 * corrupted or tampered log is a hard failure, never a partial replay),
 * then materializes the record exactly: ids, commit sequences, rule
 * versions, plan bindings, and support sets are preserved byte-for-byte.
 * Current intention state is always the FOLD over the materialized
 * transitions (D4) -- two replays produce byte-identical projections,
 * including the projected current-dependency-support chain (P21), with
 * zero proposer/judge/stochastic calls (P22/F10).
 */

const TERMINAL_KINDS = new Set(['complete', 'fail', 'abandon'])

export interface IntentionReplayReport {
  judgeCalls: number
  replayedCommitments: number
  replayedTransitions: number
  replayedAttempts: number
  replayedOutcomes: number
}

export function replayIntentionLog(
  commits: readonly IntentionCommit[],
  judge: JudgeProbe,
): { store: IntentionStore; report: IntentionReplayReport } {
  let store = initIntentionStore()
  let maxSeq = 0

  for (const commit of commits) {
    if (commit.kind === 'adoption') {
      const { commitment, transition } = commit
      if (store.commitments.some((existing) => existing.intentionId === commitment.intentionId)) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- duplicate commitment ${commitment.intentionId}`)
      }
      if (store.transitions.some((existing) => existing.transitionId === transition.transitionId)) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- duplicate transition ${transition.transitionId}`)
      }
      if (transition.kind !== 'adopt' || transition.intentionId !== commitment.intentionId || transition.commitSeq !== commitment.commitSeq) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- broken adoption envelope for ${commitment.intentionId}`)
      }
      store = {
        ...store,
        commitments: [...store.commitments, commitment],
        transitions: [...store.transitions, transition],
        commitLog: [...store.commitLog, commit],
      }
      maxSeq = Math.max(maxSeq, commitment.commitSeq)
      continue
    }

    if (commit.kind === 'transition') {
      const transition = commit.transition
      if (store.transitions.some((existing) => existing.transitionId === transition.transitionId)) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- duplicate transition ${transition.transitionId}`)
      }
      const commitment = store.commitments.find((existing) => existing.intentionId === transition.intentionId)
      if (commitment === undefined) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- transition ${transition.transitionId} targets an unknown commitment`)
      }
      const prior = store.transitions.filter((existing) => existing.intentionId === transition.intentionId)
      if (prior.some((existing) => TERMINAL_KINDS.has(existing.kind))) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- transition ${transition.transitionId} follows a terminal transition`)
      }
      if (transition.kind === 'resume') {
        const suspensions = prior.filter((existing) => existing.kind === 'suspend' || existing.kind === 'resume')
        const last = suspensions[suspensions.length - 1]
        if (last === undefined || last.kind !== 'suspend') {
          throw new Error(`replayIntentionLog: recorded-invariant-violation -- resume ${transition.transitionId} without a preceding suspend`)
        }
      }
      store = { ...store, transitions: [...store.transitions, transition], commitLog: [...store.commitLog, commit] }
      maxSeq = Math.max(maxSeq, transition.commitSeq)
      continue
    }

    if (commit.kind === 'attempt') {
      const attempt = commit.attempt
      if (store.attempts.some((existing) => existing.id === attempt.id)) {
        throw new Error(`replayIntentionLog: recorded-invariant-violation -- duplicate attempt ${attempt.id}`)
      }
      store = { ...store, attempts: [...store.attempts, attempt], commitLog: [...store.commitLog, commit] }
      maxSeq = Math.max(maxSeq, attempt.dispatchedAtSeq)
      continue
    }

    const { outcome, consequence, observation } = commit
    if (!store.attempts.some((existing) => existing.id === outcome.attemptId)) {
      throw new Error(`replayIntentionLog: recorded-invariant-violation -- outcome ${outcome.id} for an attempt never dispatched`)
    }
    if (store.outcomes.some((existing) => existing.attemptId === outcome.attemptId)) {
      throw new Error(`replayIntentionLog: recorded-invariant-violation -- duplicate outcome for attempt ${outcome.attemptId}`)
    }
    store = {
      ...store,
      outcomes: [...store.outcomes, outcome],
      consequences: consequence !== undefined ? [...store.consequences, consequence] : store.consequences,
      observations: observation !== undefined ? [...store.observations, observation] : store.observations,
      commitLog: [...store.commitLog, commit],
    }
    maxSeq = Math.max(maxSeq, outcome.commitSeq)
  }

  store = { ...store, nextSeq: maxSeq + 1 }

  return {
    store,
    report: {
      judgeCalls: judge.calls,
      replayedCommitments: store.commitments.length,
      replayedTransitions: store.transitions.length,
      replayedAttempts: store.attempts.length,
      replayedOutcomes: store.outcomes.length,
    },
  }
}

/**
 * A deterministic, canonically-serialized snapshot of the full intention
 * surface: every record family, the commit log, and every intention's
 * derived projection -- open/suspended state, plan binding, terminal
 * transition, and the projected current-dependency-support chain -- across
 * a grid of transaction bounds. Two replays' snapshots (or replay vs.
 * original) must be byte-equal (P21).
 */
export function captureIntentionSnapshot(store: IntentionStore, txBounds: readonly number[]): string {
  const intentionIds = store.commitments.map((commitment) => commitment.intentionId).sort()
  const projections = txBounds.map((txBound) => ({
    txBound,
    perIntention: Object.fromEntries(
      intentionIds.map((intentionId) => [
        intentionId,
        {
          projection: projectIntention(store, intentionId, txBound),
          currentSupport: currentSupportOf(store, intentionId, txBound),
        },
      ]),
    ),
  }))

  return canonicalSerialize({
    commitments: store.commitments,
    transitions: store.transitions,
    attempts: store.attempts,
    outcomes: store.outcomes,
    consequences: store.consequences,
    observations: store.observations,
    commitLog: store.commitLog,
    projections,
  })
}
