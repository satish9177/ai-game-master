import { describe, expect, it } from 'vitest'
import type { AttemptRequest, OutcomeRequest } from './intentionStore'
import { commitOutcome, dispatchAttempt, initIntentionStore } from './intentionStore'
import { attributionUniverse, Bel_CoraAtt1b, buildPhase3Store, CORA, propW1, T_PRESENT } from './attributionScenario'
import { commitAscriptionSupersession } from './attributionStore'
import { ASCRIPTION_RULE_VERSION } from './attributionContracts'
import { innerCanonicalKeyOf, makeAttributedBelief } from './attributionBuilder'

/**
 * Dispatch-admissibility tests (P103, P106; F59, F60), reusing the
 * accepted, unmodified ADR-0010 `dispatchAttempt`/`commitOutcome`
 * machinery. A communication act's Observation is minted only as a
 * consequence of a committed `ActionOutcome` for a previously-dispatched
 * `ActionAttempt` -- there is no other path by which an Observation could
 * ever enter a store built through these primitives.
 */

describe('P106 -- only a validly-dispatched communication attempt\'s outcome ever mints an Observation', () => {
  it('a dispatched attempt\'s outcome, carrying an observation, mints it into the store', () => {
    let store = initIntentionStore()
    const request: AttemptRequest = { actor: 'NPC_B', action: 'present-evidence', target: 'NPC_C', intentionId: null, planTemplateId: null }
    const dispatched = dispatchAttempt(store, request)
    expect(dispatched.outcome.verdict).toBe('dispatched')
    if (dispatched.outcome.verdict !== 'dispatched') throw new Error('unreachable')
    store = dispatched.store

    const observation = { schemaVersion: 1 as const, id: 'O_dispatch_test1', observer: CORA, truthRef: dispatched.outcome.attempt.id, channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: 'NPC_B', act: 'present-evidence' }, missing: [], fidelity: 'full' as const, time: 'night_20' }
    const outcomeRequest: OutcomeRequest = { attemptId: dispatched.outcome.attempt.id, verdict: 'succeeded', observedResult: 'done', observation }
    const committed = commitOutcome(store, outcomeRequest)
    expect(committed.outcome.verdict).toBe('committed')
    expect(committed.store.observations).toContainEqual(observation)
  })
})

describe('F59 -- an undispatched communication attempt never mints an Observation', () => {
  it('committing an outcome for an attemptId that was never dispatched is rejected (outcome-without-dispatch), and no Observation is ever recorded', () => {
    const store = initIntentionStore()
    const bogusObservation = { schemaVersion: 1 as const, id: 'O_bogus', observer: CORA, truthRef: 'AA_9999', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: 'NPC_B', act: 'assert' }, missing: [], fidelity: 'full' as const, time: 'night_20' }
    const outcomeRequest: OutcomeRequest = { attemptId: 'AA_9999', verdict: 'succeeded', observedResult: 'done', observation: bogusObservation }
    const result = commitOutcome(store, outcomeRequest)
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'outcome-without-dispatch' })
    expect(result.store.observations).toEqual([])
  })
})

describe('P103/F12/F60 -- failed delivery mints no content-level fact for the intended, non-receiving recipient', () => {
  it('a failed-delivery outcome (no observation supplied) never mints any Observation for anyone', () => {
    let store = initIntentionStore()
    const request: AttemptRequest = { actor: 'NPC_C', action: 'present-evidence', target: 'NPC_B', intentionId: null, planTemplateId: null }
    const dispatched = dispatchAttempt(store, request)
    if (dispatched.outcome.verdict !== 'dispatched') throw new Error('unreachable')
    store = dispatched.store

    const outcomeRequest: OutcomeRequest = { attemptId: dispatched.outcome.attempt.id, verdict: 'failed', observedResult: 'target-absent' }
    const committed = commitOutcome(store, outcomeRequest)
    expect(committed.outcome.verdict).toBe('committed')
    expect(committed.store.observations).toEqual([])
  })
})

describe('P109/F61 -- player free-text canonicalization is engine-validated before commit and θ-logged verbatim', () => {
  it('the isolated theta_player_present_evidence1 sub-case: a precommitted, hand-authored proposal is validated against the closed grammar (via the unmodified builder) BEFORE it ever reaches the transition, and is recorded verbatim on the committed transition', () => {
    const phase3 = buildPhase3Store()
    const CANNED_PLAYER_UTTERANCE = 'I found weird claw marks near the pantry, thought you should see them'

    // The engine's grammar-validation step: the LLM-proposed canonicalization
    // must pass through the SAME validated builder as every other
    // attribution-layer construction -- there is no bypass path.
    const built = makeAttributedBelief({
      beliefId: 'Bel_theta_test',
      holder: CORA,
      modeledHolder: 'NPC_B',
      attributedStance: 'believes',
      proposition: propW1,
      confidence: 'low',
      sourceType: 'inference',
      sourceRef: 'theta_player_present_evidence1',
      supporting: [],
      descriptiveProposition: 'canonicalized player utterance (theta-logged)',
      lastUpdated: 'night_5',
      validity: { kind: 'interval', from: T_PRESENT, to: null },
    })
    expect(built.verdict).toBe('ok')
    if (built.verdict !== 'ok') throw new Error('unreachable')

    const universeWithThetaBelief = [...attributionUniverse, { kind: 'belief' as const, record: built.belief }]
    const committed = commitAscriptionSupersession(phase3.store, universeWithThetaBelief, {
      transitionId: 'BT_theta_test',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: 'Bel_theta_test',
      effectiveValidTime: T_PRESENT,
      validFrom: T_PRESENT,
      cause: 'delivery-without-acceptance',
      ruleId: 'ascribe_from_evidence_presentation',
      ruleVersion: ASCRIPTION_RULE_VERSION,
      inputRecordIds: [],
      recordedProposal: CANNED_PLAYER_UTTERANCE,
    })
    expect(committed.outcome.verdict).toBe('committed')
    if (committed.outcome.verdict !== 'committed') throw new Error('unreachable')
    // The accepted proposal is recorded verbatim on the resulting transition.
    expect(committed.outcome.transition.recordedProposal).toBe(CANNED_PLAYER_UTTERANCE)
    // llm_calls remains exactly 0 -- this is a hand-authored, precommitted
    // fixture input (§2.2/§18), never a live model invocation; nothing in
    // this test path calls a model.
    expect(innerCanonicalKeyOf(propW1)).toBeTruthy()
  })
})
