import { beliefA1, beliefD1 } from './evidenceScenario'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import { beliefC2 } from './hierarchyScenario'
import { beliefB1, claimRegistry, conflictUniverse, nightTick, REVISION_VALID_FROM, TRANSITION_ID } from './conflictScenario'
import { clawEvidence } from './scenario'
import { applyEvidenceCorrection } from './beliefUpdate'
import type { Belief, Evidence, Observation, Confidence } from './contracts'
import type { CanonicalClaim, ClaimRegistry, ValidExtent, WorldInstant } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION, OVERTURN_BY_HARD_EVIDENCE_RULE_ID, TRANSITION_RULE_VERSION } from './conflictContracts'
import { commitBelief, commitRevision, initConflictStore, mintEdge } from './conflictStore'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { AttributedBeliefProposition, AttributionTargetProposition, EventParticipationProposition, InnerKey, TrustRegistry, UnderstandingResult, WorldProposition } from './attributionContracts'
import { ASCRIPTION_RULE_VERSION } from './attributionContracts'
import { attributedBeliefProposition, innerCanonicalKeyOf } from './attributionBuilder'
import {
  ascribeFromAcknowledgment,
  ascribeFromApology,
  ascribeFromAssertion,
  ascribeFromEvidencePresentation,
  ascribeFromRetractionDeny,
  ascribeFromRetractionWithdraw,
  ascriptionDecay,
  epRecipientParticipation,
  epSpeakerAct,
  occurrenceOnlyParticipation,
} from './attributionRules'
import type { AscriptionOutcome } from './attributionRules'
import { understandDefault, understandDistracted } from './attributionUnderstanding'
import { commitAscriptionSupersession, commitFirstMint } from './attributionStore'
import type { AttributionStore } from './attributionStore'

/**
 * Fixture for Attributed-Belief Staleness Replay v0 (research vault
 * ADR-0011, spec attributed-belief-staleness-replay-v0.md §2/§8), built
 * additively on the already-committed conflict scenario base (Bel_A1,
 * Bel_B1, Bel_C1/Bel_C1', Bel_C2, Bel_D1, E_claw, R_B_to_C, BT_0001,
 * CE_0001, all reused byte-identically -- no existing fixture file is
 * edited). Because a `ConflictStore`'s ClaimRegistry is fixed at
 * initialization (design plan I3/I4), and every branch in this spec must be
 * its own independent store instance (§2.4), every fork below RE-RUNS the
 * identical base commit sequence `conflictScenario.ts`'s own
 * `buildConflictScenario` performs, against a per-proof-wide merged claim
 * registry that additionally covers every attribution belief this rig ever
 * mints -- never a change to `claimRegistry`/`conflictUniverse` themselves.
 */

export const BORIN = 'NPC_B'
export const CORA = 'NPC_C'
export const DAREN = 'NPC_D'
export const NPC_A = 'NPC_A'
export const NPC_R = 'NPC_R'
export const NPC_E = 'NPC_E'

// ---- Proposition and world-time anchors ------------------------------------

export const propW1: WorldProposition = { kind: 'world', subject: 'player', predicate: 'attacked', object: 'guard_malik', at: nightTick('night_3') }
export const propW1Key: InnerKey = innerCanonicalKeyOf(propW1)

const zombieAttackClaimValidity: ValidExtent = { kind: 'instant', at: nightTick('night_3') }

export const T_ACCUSE = nightTick('night_4', 2)
export const T_FORM = nightTick('night_4', 3)
export const T_PRESENT = nightTick('night_5', 0)
export const T_ACK = nightTick('night_5', 1)
export const T_APOLOGY_RETRACT = nightTick('night_6', 0)
export const T_DECAY = nightTick('night_7', 0)
export const T_INDEP_PRESENT = nightTick('night_4', 4)

// ---- Trust registry (reused calculus dimension -- hand-registered, D7) ----

export const trustRegistry: TrustRegistry = new Map<string, ReadonlyMap<string, Confidence>>([
  [CORA, new Map([[BORIN, 'medium']])],
  [DAREN, new Map([[BORIN, 'low']])],
  [NPC_E, new Map([[BORIN, 'medium']])],
])

// ---- Observations (communication receipt ladder, §5/§8 Phase 1) -----------
//
// Rung encoding (attributionUnderstanding.ts): sight-only, no `perceived.act`
// => rungs 1-2 (occurrence only, NPC_R); sight+sound with `perceived.act`
// (+`propositionKey` for content-bearing acts) => rung 5 (NPC_A/Cora/Daren/
// NPC_E all reach this); a POSITIVE UnderstandingResult (derived, never
// stored) => rung 6.

function accusationObservation(id: string, observer: string): Observation {
  return {
    schemaVersion: 1,
    id,
    observer,
    truthRef: 'TE_B_accuse1',
    channels: ['sight', 'sound'],
    perceived: { speaker: BORIN, addressee: 'public', act: 'assert', propositionKey: propW1Key },
    missing: [],
    fidelity: 'full',
    time: 'night_4a',
  }
}

export const O_Cora_accuse1 = accusationObservation('O_Cora_accuse1', CORA)
export const O_Daren_accuse1 = accusationObservation('O_Daren_accuse1', DAREN)
export const O_E_accuse1 = accusationObservation('O_E_accuse1', NPC_E)
export const O_A_accuse1 = accusationObservation('O_A_accuse1', NPC_A)

/** NPC_A's simultaneous competing-attention Observation (§2.2/§5.3) -- the deterministic `understand_distracted` rule's second input. */
export const O_A_competing1: Observation = {
  schemaVersion: 1,
  id: 'O_A_competing1',
  observer: NPC_A,
  truthRef: 'TE_merchant_argument1',
  channels: ['sight', 'sound'],
  perceived: { speaker: 'merchant', act: 'assert' },
  missing: [],
  fidelity: 'full',
  time: 'night_4a',
}

/** NPC_R: sight only, no sound channel at all -- rungs 1-2 (occurrence_observers-only), never content_recipients (P6/P9). */
export const O_R_accuse1: Observation = {
  schemaVersion: 1,
  id: 'O_R_accuse1',
  observer: NPC_R,
  truthRef: 'TE_B_accuse1',
  channels: ['sight'],
  perceived: { speaker: BORIN },
  missing: ['act', 'propositionKey'],
  fidelity: 'partial',
  time: 'night_4a',
}

export const understandingCora1: UnderstandingResult = understandDefault(CORA, O_Cora_accuse1)
export const understandingDaren1: UnderstandingResult = understandDefault(DAREN, O_Daren_accuse1)
export const understandingE1: UnderstandingResult = understandDefault(NPC_E, O_E_accuse1)
export const understandingA1: UnderstandingResult = understandDistracted(NPC_A, O_A_accuse1, O_A_competing1)

// ---- Precomputed ascription outcomes (pure -- no store dependency) --------
// Every attribution/event-participation belief this narrative ever mints is
// computed here, ONCE, so its CanonicalClaim (if any) can be folded into one
// merged ClaimRegistry before any store is initialized (a ConflictStore's
// claims are fixed at init, design plan I3/I4).

function requireMint(outcome: AscriptionOutcome): Extract<AscriptionOutcome, { verdict: 'mint' }> {
  if (outcome.verdict !== 'mint') throw new Error(`attributionScenario: expected mint, got ${outcome.verdict}`)
  return outcome
}

function requireSupersede(outcome: AscriptionOutcome): Extract<AscriptionOutcome, { verdict: 'supersede' }> {
  if (outcome.verdict !== 'supersede') throw new Error(`attributionScenario: expected supersede, got ${outcome.verdict}`)
  return outcome
}

// Tier-1 ledger (§8 Phase 1): five recipients, two canonical shapes each
// (speaker-act, recipient-participation) where rung reached permits.
export const Bel_CoraSA1 = requireMint(epSpeakerAct({ beliefId: 'Bel_CoraSA1', holder: CORA, speaker: BORIN, eventId: 'TE_B_accuse1', act: 'assert', propositionRef: propW1Key, observation: O_Cora_accuse1, time: 'night_4a' })).belief
export const Bel_CoraRP1 = requireMint(epRecipientParticipation({ beliefId: 'Bel_CoraRP1', holder: CORA, eventId: 'TE_B_accuse1', observation: O_Cora_accuse1, time: 'night_4a' })).belief
export const Bel_DarenSA1 = requireMint(epSpeakerAct({ beliefId: 'Bel_DarenSA1', holder: DAREN, speaker: BORIN, eventId: 'TE_B_accuse1', act: 'assert', propositionRef: propW1Key, observation: O_Daren_accuse1, time: 'night_4a' })).belief
export const Bel_DarenRP1 = requireMint(epRecipientParticipation({ beliefId: 'Bel_DarenRP1', holder: DAREN, eventId: 'TE_B_accuse1', observation: O_Daren_accuse1, time: 'night_4a' })).belief
export const Bel_ESA1 = requireMint(epSpeakerAct({ beliefId: 'Bel_ESA1', holder: NPC_E, speaker: BORIN, eventId: 'TE_B_accuse1', act: 'assert', propositionRef: propW1Key, observation: O_E_accuse1, time: 'night_4a' })).belief
export const Bel_ERP1 = requireMint(epRecipientParticipation({ beliefId: 'Bel_ERP1', holder: NPC_E, eventId: 'TE_B_accuse1', observation: O_E_accuse1, time: 'night_4a' })).belief
export const Bel_ASA1 = requireMint(epSpeakerAct({ beliefId: 'Bel_ASA1', holder: NPC_A, speaker: BORIN, eventId: 'TE_B_accuse1', act: 'assert', propositionRef: propW1Key, observation: O_A_accuse1, time: 'night_4a' })).belief
export const Bel_ARP1 = requireMint(epRecipientParticipation({ beliefId: 'Bel_ARP1', holder: NPC_A, eventId: 'TE_B_accuse1', observation: O_A_accuse1, time: 'night_4a' })).belief
export const Bel_ROccurrence1 = requireMint(occurrenceOnlyParticipation({ beliefId: 'Bel_ROccurrence1', holder: NPC_R, speaker: BORIN, eventId: 'TE_B_accuse1', observation: O_R_accuse1, time: 'night_4a' })).belief

// Phase 2: independent stance formation (Cora medium, Daren low -- differing trust, P17).
const coraAtt1Mint = requireMint(
  ascribeFromAssertion({ beliefId: 'Bel_CoraAtt1', holder: CORA, modeledHolder: BORIN, proposition: propW1, understanding: understandingCora1, trust: trustRegistry, speaker: BORIN, validity: { kind: 'interval', from: T_FORM, to: null }, time: 'night_4a' }),
)
export const Bel_CoraAtt1 = coraAtt1Mint.belief
export const Bel_CoraAtt1_claim = coraAtt1Mint.claim!

const darenAtt1Mint = requireMint(
  ascribeFromAssertion({ beliefId: 'Bel_DarenAtt1', holder: DAREN, modeledHolder: BORIN, proposition: propW1, understanding: understandingDaren1, trust: trustRegistry, speaker: BORIN, validity: { kind: 'interval', from: T_FORM, to: null }, time: 'night_4a' }),
)
export const Bel_DarenAtt1 = darenAtt1Mint.belief
export const Bel_DarenAtt1_claim = darenAtt1Mint.claim!

// Phase 3: Cora's delivery-without-acceptance erosion (medium -> low, stance unchanged, P22).
// `deliveryOutcomeId` cites Cora's OWN committed Observation of her act of
// dispatching present-evidence -- a genuine, holder-owned, universe-resident
// record (F62 amendment: the sidecar commit path now validates this
// citation, so a bare uncommitted-id placeholder can no longer be used here).
export const O_Cora_present1: Observation = {
  schemaVersion: 1,
  id: 'O_Cora_present1',
  observer: CORA,
  truthRef: 'TE_B_present1',
  channels: ['sight', 'sound'],
  perceived: { speaker: CORA, addressee: BORIN, act: 'present-evidence' },
  missing: [],
  fidelity: 'full',
  time: 'night_5',
}

const coraAtt1bSupersede = requireSupersede(
  ascribeFromEvidencePresentation({ toBeliefId: 'Bel_CoraAtt1b', fromBelief: Bel_CoraAtt1, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, deliveryOutcomeId: O_Cora_present1.id, time: 'night_5', validity: { kind: 'interval', from: T_PRESENT, to: null } }),
)
export const Bel_CoraAtt1b = coraAtt1bSupersede.toBelief
export const Bel_CoraAtt1b_claim = coraAtt1bSupersede.toClaim!

// ---- Phase 4 acknowledgment observations + outcomes -----------------------

function acknowledgmentObservation(id: string, observer: string, eventId: string, contentSatisfying: boolean): Observation {
  return {
    schemaVersion: 1,
    id,
    observer,
    truthRef: eventId,
    channels: ['sight', 'sound'],
    perceived: { speaker: BORIN, addressee: CORA, act: 'acknowledge', ...(contentSatisfying ? { propositionKey: propW1Key, incompatible: 'true' } : {}) },
    missing: [],
    fidelity: 'full',
    time: 'night_5b',
  }
}

export const O_Cora_ack1 = acknowledgmentObservation('O_Cora_ack1', CORA, 'TE_B_ack1', true)
export const understandingCoraAck1: UnderstandingResult = understandDefault(CORA, O_Cora_ack1)
const coraAtt2Supersede = requireSupersede(
  ascribeFromAcknowledgment({ toBeliefId: 'Bel_CoraAtt2', fromBelief: Bel_CoraAtt1b, modeledHolder: BORIN, proposition: propW1, understanding: understandingCoraAck1, contentSatisfying: true, time: 'night_5b', validity: { kind: 'interval', from: T_ACK, to: null } }),
)
export const Bel_CoraAtt2 = coraAtt2Supersede.toBelief
export const Bel_CoraAtt2_claim = coraAtt2Supersede.toClaim!

export const O_Cora_ackContentFree1 = acknowledgmentObservation('O_Cora_ackContentFree1', CORA, 'TE_B_ackContentFree1', false)
export const understandingCoraAckFree1: UnderstandingResult = understandDefault(CORA, O_Cora_ackContentFree1)
const coraAtt2PrimeSupersede = requireSupersede(
  ascribeFromAcknowledgment({ toBeliefId: 'Bel_CoraAtt2Prime', fromBelief: Bel_CoraAtt1b, modeledHolder: BORIN, proposition: propW1, understanding: understandingCoraAckFree1, contentSatisfying: false, time: 'night_5b', validity: { kind: 'interval', from: T_ACK, to: null } }),
)
export const Bel_CoraAtt2Prime = coraAtt2PrimeSupersede.toBelief
export const Bel_CoraAtt2Prime_claim = coraAtt2PrimeSupersede.toClaim!

// ---- Phase 5: apology + retraction (retract-deny and retract-withdraw) ----

function apologyObservation(id: string, observer: string): Observation {
  return { schemaVersion: 1, id, observer, truthRef: 'TE_B_apology1', channels: ['sight', 'sound'], perceived: { speaker: BORIN, act: 'apologize' }, missing: [], fidelity: 'full', time: 'night_6' }
}
function retractDenyObservation(id: string, observer: string): Observation {
  return { schemaVersion: 1, id, observer, truthRef: 'TE_B_retract1', channels: ['sight', 'sound'], perceived: { speaker: BORIN, act: 'retract', actPayload: 'retract-deny', propositionKey: propW1Key }, missing: [], fidelity: 'full', time: 'night_6' }
}
function retractWithdrawObservation(id: string, observer: string): Observation {
  return { schemaVersion: 1, id, observer, truthRef: 'TE_B_retract_withdraw1', channels: ['sight', 'sound'], perceived: { speaker: BORIN, act: 'retract', actPayload: 'retract-withdraw', propositionKey: propW1Key }, missing: [], fidelity: 'full', time: 'night_6' }
}

export const O_Cora_apology1 = apologyObservation('O_Cora_apology1', CORA)
export const O_Daren_apology1 = apologyObservation('O_Daren_apology1', DAREN)
export const O_Cora_retract1 = retractDenyObservation('O_Cora_retract1', CORA)
export const O_Daren_retract1 = retractDenyObservation('O_Daren_retract1', DAREN)
export const O_Cora_retractWithdraw1 = retractWithdrawObservation('O_Cora_retractWithdraw1', CORA)
export const O_Daren_retractWithdraw1 = retractWithdrawObservation('O_Daren_retractWithdraw1', DAREN)

export const understandingCoraApology1 = understandDefault(CORA, O_Cora_apology1)
export const understandingDarenApology1 = understandDefault(DAREN, O_Daren_apology1)
export const understandingCoraRetract1 = understandDefault(CORA, O_Cora_retract1)
export const understandingDarenRetract1 = understandDefault(DAREN, O_Daren_retract1)
export const understandingCoraRetractWithdraw1 = understandDefault(CORA, O_Cora_retractWithdraw1)
export const understandingDarenRetractWithdraw1 = understandDefault(DAREN, O_Daren_retractWithdraw1)

// retract-deny fork, starting from Branch 4a's Bel_CoraAtt1b / Bel_DarenAtt1.
// Both are already at the confidence FLOOR (`low`) by this point (Cora via
// Phase 3's delivery erosion, Daren via his own low-trust cap from
// formation) -- so `ascribe_from_apology`'s erosion step is a genuine
// no-op for both (P82's floor rule, §7.1), exactly as it is for
// `ascription_decay`'s own floor sub-case (Phase 7). Apology never
// establishes `disbelieves` regardless (P86); retract-deny fires
// unconditionally on whichever belief is current.
export const coraApologyOutcome: AscriptionOutcome = ascribeFromApology({ toBeliefId: 'Bel_CoraAtt1b_apology', fromBelief: Bel_CoraAtt1b, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, understanding: understandingCoraApology1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } })
export const darenApologyOutcome: AscriptionOutcome = ascribeFromApology({ toBeliefId: 'Bel_DarenAtt1_apology', fromBelief: Bel_DarenAtt1, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, understanding: understandingDarenApology1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } })

const coraDenySupersede = requireSupersede(ascribeFromRetractionDeny({ toBeliefId: 'Bel_CoraAtt3', fromBelief: Bel_CoraAtt1b, modeledHolder: BORIN, proposition: propW1, understanding: understandingCoraRetract1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } }))
export const Bel_CoraAtt3 = coraDenySupersede.toBelief
export const Bel_CoraAtt3_claim = coraDenySupersede.toClaim!

const darenDenySupersede = requireSupersede(ascribeFromRetractionDeny({ toBeliefId: 'Bel_DarenAtt2', fromBelief: Bel_DarenAtt1, modeledHolder: BORIN, proposition: propW1, understanding: understandingDarenRetract1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } }))
export const Bel_DarenAtt2 = darenDenySupersede.toBelief
export const Bel_DarenAtt2_claim = darenDenySupersede.toClaim!

// retract-withdraw variant, forking directly from Branch 4a's Bel_CoraAtt1b / Bel_DarenAtt1 (no apology in this fork)
const coraWithdrawSupersede = requireSupersede(ascribeFromRetractionWithdraw({ toBeliefId: 'Bel_CoraAtt1b_withdraw', fromBelief: Bel_CoraAtt1b, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, understanding: understandingCoraRetractWithdraw1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } }))
export const Bel_CoraAtt1b_withdraw = coraWithdrawSupersede.toBelief
export const Bel_CoraAtt1b_withdraw_claim = coraWithdrawSupersede.toClaim!

const darenWithdrawSupersede = requireSupersede(ascribeFromRetractionWithdraw({ toBeliefId: 'Bel_DarenAtt1_withdraw', fromBelief: Bel_DarenAtt1, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, understanding: understandingDarenRetractWithdraw1, time: 'night_6', validity: { kind: 'interval', from: T_APOLOGY_RETRACT, to: null } }))
export const Bel_DarenAtt1_withdraw = darenWithdrawSupersede.toBelief
export const Bel_DarenAtt1_withdraw_claim = darenWithdrawSupersede.toClaim!

// ---- Phase 7: decay (observable step-down + floor no-op) ------------------

const coraDecaySupersede = requireSupersede(ascriptionDecay({ toBeliefId: 'Bel_CoraAtt1c', fromBelief: Bel_CoraAtt1, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, time: 'night_7', validity: { kind: 'interval', from: T_DECAY, to: null } }))
export const Bel_CoraAtt1c = coraDecaySupersede.toBelief
export const Bel_CoraAtt1c_claim = coraDecaySupersede.toClaim!

// Floor no-op: Bel_CoraAtt1b is already `low` -- ascriptionDecay must return 'no-op', never a new transition.
export const decayFloorOutcome: AscriptionOutcome = ascriptionDecay({ toBeliefId: 'Bel_CoraAtt1b_decay_attempt', fromBelief: Bel_CoraAtt1b, fromStance: 'believes', modeledHolder: BORIN, proposition: propW1, time: 'night_7', validity: { kind: 'interval', from: T_DECAY, to: null } })

// ---- Merged claim registry (every attribution claim this rig ever mints) --

// A fresh Evidence record, reusing E_claw's underlying T1 truth-referent,
// whose `contradicts` matches Borin's OWN uncorrected proposition text
// exactly (`Bel_B1`'s rumor-sourced wording differs from Cora's, since it
// traveled a different rumor hop, R_A_to_B vs. R_B_to_C) -- so
// `applyEvidenceCorrection` (the unmodified belief-update calculus) can
// actually correct Borin's belief, and `conflictReplay.ts`'s oracle
// re-derivation matches this transition byte-for-byte on replay.
export const clawEvidenceForBorin: Evidence = {
  schemaVersion: 1,
  id: 'E_claw_borin',
  truthRef: clawEvidence.truthRef,
  implies: 'zombie_17 attacked guard_malik',
  contradicts: beliefB1.proposition,
  strength: 'hard',
  presentedTo: BORIN,
  time: 'night_5',
}

const beliefB1PrimeCorrection = applyEvidenceCorrection(beliefB1, clawEvidenceForBorin, 'Bel_B1_prime')
if (beliefB1PrimeCorrection.status !== 'corrected') {
  throw new Error('attributionScenario: expected clawEvidenceForBorin to correct beliefB1 -- fixture invariant broken')
}
export const beliefB1Prime: Belief = beliefB1PrimeCorrection.corrected

const beliefB1PrimeClaim: CanonicalClaim = {
  predicate: 'attacked',
  fixedRoles: { target: 'guard_malik' },
  contestedRole: 'actor',
  contestedValue: 'zombie_17',
  polarity: 'asserts',
  validity: zombieAttackClaimValidity,
  canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
}

export const attributionClaimRegistry: ClaimRegistry = new Map<string, CanonicalClaim>([
  ...claimRegistry,
  [beliefB1Prime.id, beliefB1PrimeClaim],
  [Bel_CoraAtt1.id, Bel_CoraAtt1_claim],
  [Bel_DarenAtt1.id, Bel_DarenAtt1_claim],
  [Bel_CoraAtt1b.id, Bel_CoraAtt1b_claim],
  [Bel_CoraAtt2.id, Bel_CoraAtt2_claim],
  [Bel_CoraAtt2Prime.id, Bel_CoraAtt2Prime_claim],
  [Bel_CoraAtt3.id, Bel_CoraAtt3_claim],
  [Bel_DarenAtt2.id, Bel_DarenAtt2_claim],
  [Bel_CoraAtt1b_withdraw.id, Bel_CoraAtt1b_withdraw_claim],
  [Bel_DarenAtt1_withdraw.id, Bel_DarenAtt1_withdraw_claim],
  [Bel_CoraAtt1c.id, Bel_CoraAtt1c_claim],
])

// ---- Extended universe (Tier-1 + Tier-2 beliefs added, additive only) -----

export const attributionUniverse: ReadableRecord[] = [
  ...conflictUniverse,
  { kind: 'belief', record: Bel_CoraSA1 },
  { kind: 'belief', record: Bel_CoraRP1 },
  { kind: 'belief', record: Bel_DarenSA1 },
  { kind: 'belief', record: Bel_DarenRP1 },
  { kind: 'belief', record: Bel_ESA1 },
  { kind: 'belief', record: Bel_ERP1 },
  { kind: 'belief', record: Bel_ASA1 },
  { kind: 'belief', record: Bel_ARP1 },
  { kind: 'belief', record: Bel_ROccurrence1 },
  { kind: 'belief', record: Bel_CoraAtt1 },
  { kind: 'belief', record: Bel_DarenAtt1 },
  { kind: 'belief', record: Bel_CoraAtt1b },
  { kind: 'belief', record: Bel_CoraAtt2 },
  { kind: 'belief', record: Bel_CoraAtt2Prime },
  { kind: 'belief', record: Bel_CoraAtt3 },
  { kind: 'belief', record: Bel_DarenAtt2 },
  { kind: 'belief', record: Bel_CoraAtt1b_withdraw },
  { kind: 'belief', record: Bel_DarenAtt1_withdraw },
  { kind: 'belief', record: Bel_CoraAtt1c },
  { kind: 'belief', record: beliefB1Prime },
  { kind: 'evidence', record: clawEvidenceForBorin },
  // Every Observation an ascription-supersession sidecar cites as support
  // (F62 amendment) must itself be a universe-resident record -- these were
  // previously hand-authored fixture values never added here at all.
  { kind: 'observation', record: O_Cora_present1 },
  { kind: 'observation', record: O_Cora_ack1 },
  { kind: 'observation', record: O_Cora_ackContentFree1 },
  { kind: 'observation', record: O_Cora_retract1 },
  { kind: 'observation', record: O_Daren_retract1 },
  { kind: 'observation', record: O_Cora_retractWithdraw1 },
  { kind: 'observation', record: O_Daren_retractWithdraw1 },
]

// ---- Base store builder: replays the identical conflictScenario base -----

const BASE_BELIEF_VALID_FROM: ReadonlyMap<string, WorldInstant> = new Map([
  [beliefC2.id, nightTick('night_2')],
  [beliefA1.id, nightTick('night_3')],
  [beliefD1.id, nightTick('night_3')],
  [beliefB1.id, nightTick('night_3', 1)],
  [beliefC1.id, nightTick('night_4')],
])

/** Every fork is its own independent store instance (§2.4) -- this rebuilds the shared Phase 0-1 baseline from scratch, byte-identically, every time it is called. */
export function buildBaseAttributionStore(): AttributionStore {
  let conflict: ConflictStore = initConflictStore(attributionClaimRegistry)

  const baseBeliefEntries = conflictUniverse.filter(
    (entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief' && entry.record.id !== beliefC1Prime.id,
  )
  for (const entry of baseBeliefEntries) {
    const validFrom = BASE_BELIEF_VALID_FROM.get(entry.record.id)
    if (validFrom === undefined) {
      throw new Error(`attributionScenario: missing validFrom for ${entry.record.id} -- fixture invariant broken`)
    }
    const committed = commitBelief(conflict, conflictUniverse, entry.record.id, validFrom)
    if (committed.outcome.verdict !== 'committed') {
      throw new Error(`attributionScenario: expected ${entry.record.id} to commit -- fixture invariant broken`)
    }
    conflict = committed.store
  }

  const minted = mintEdge(conflict, beliefC1.id, clawEvidence.id)
  if (minted.outcome.verdict !== 'minted') {
    throw new Error('attributionScenario: expected CE_0001 to mint -- fixture invariant broken')
  }
  conflict = minted.store
  const conflictEdge = minted.outcome.edge

  const revised = commitRevision(
    conflict,
    {
      toBeliefId: beliefC1Prime.id,
      validFrom: REVISION_VALID_FROM,
      transition: {
        transitionId: TRANSITION_ID,
        holder: CORA,
        fromBeliefId: beliefC1.id,
        toBeliefId: beliefC1Prime.id,
        effectiveValidTime: REVISION_VALID_FROM,
        cause: 'corrected-by-evidence',
        ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [clawEvidence.id],
        conflictEdgeIds: [conflictEdge.edgeId],
      },
    },
    conflictUniverse,
  )
  if (revised.outcome.verdict !== 'committed') {
    throw new Error('attributionScenario: expected BT_0001 to commit -- fixture invariant broken')
  }
  conflict = revised.store

  return { conflict, sidecars: new Map() }
}

function mintTier1(store: AttributionStore, beliefId: string, validFrom: WorldInstant): AttributionStore {
  const { store: nextStore, outcome } = commitFirstMint(store, attributionUniverse, beliefId, validFrom)
  if (outcome.verdict !== 'committed') {
    throw new Error(`attributionScenario: expected ${beliefId} to commit -- fixture invariant broken`)
  }
  return nextStore
}

/** Phase 1 + Phase 2: the shared baseline every later phase forks from (§2.4). */
export function buildPhase2Store(): AttributionStore {
  let store = buildBaseAttributionStore()
  for (const id of [Bel_CoraSA1.id, Bel_CoraRP1.id, Bel_DarenSA1.id, Bel_DarenRP1.id, Bel_ESA1.id, Bel_ERP1.id, Bel_ASA1.id, Bel_ARP1.id, Bel_ROccurrence1.id]) {
    store = mintTier1(store, id, T_ACCUSE)
  }
  store = mintTier1(store, Bel_CoraAtt1.id, T_FORM)
  store = mintTier1(store, Bel_DarenAtt1.id, T_FORM)
  return store
}

export interface Phase3Result {
  store: AttributionStore
  btAB1TransitionId: string
}

/** Phase 3: Borin's private correction (BT_AB1, reusing the accepted unmodified machinery) + Cora's delivery-without-acceptance erosion. */
export function buildPhase3Store(base: AttributionStore = buildPhase2Store()): Phase3Result {
  const revised = commitRevision(
    base.conflict,
    {
      toBeliefId: beliefB1Prime.id,
      validFrom: T_PRESENT,
      transition: {
        transitionId: 'BT_AB1',
        holder: BORIN,
        fromBeliefId: beliefB1.id,
        toBeliefId: beliefB1Prime.id,
        effectiveValidTime: T_PRESENT,
        cause: 'corrected-by-evidence',
        ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [clawEvidenceForBorin.id],
        conflictEdgeIds: [],
      },
    },
    attributionUniverse,
  )
  if (revised.outcome.verdict !== 'committed') {
    throw new Error('attributionScenario: expected BT_AB1 to commit -- fixture invariant broken')
  }
  let store: AttributionStore = { conflict: revised.store, sidecars: base.sidecars }

  const erosion = commitAscriptionSupersession(store, attributionUniverse, {
    transitionId: 'BT_CoraAtt_erode1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1.id,
    toBeliefId: Bel_CoraAtt1b.id,
    effectiveValidTime: T_PRESENT,
    validFrom: T_PRESENT,
    cause: 'delivery-without-acceptance',
    ruleId: 'ascribe_from_evidence_presentation',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    inputRecordIds: [O_Cora_present1.id],
  })
  if (erosion.outcome.verdict !== 'committed') {
    throw new Error('attributionScenario: expected BT_CoraAtt_erode1 to commit -- fixture invariant broken')
  }
  store = erosion.store

  return { store, btAB1TransitionId: 'BT_AB1' }
}

export interface Phase4Result {
  store: AttributionStore
}

/** Branch 4a -- no acknowledgment: Bel_CoraAtt1b remains current indefinitely in this branch. */
export function buildBranch4a(base: Phase3Result = buildPhase3Store()): Phase4Result {
  return { store: base.store }
}

/** Branch 4b, content-satisfying variant -- own store instance forking from Phase 3 (§2.4). */
export function buildBranch4bContentSatisfying(base: Phase3Result = buildPhase3Store()): Phase4Result {
  const superseded = commitAscriptionSupersession(base.store, attributionUniverse, {
    transitionId: 'BT_CoraAtt_ack1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1b.id,
    toBeliefId: Bel_CoraAtt2.id,
    effectiveValidTime: T_ACK,
    validFrom: T_ACK,
    cause: 'ascribed-from-acknowledgment',
    ruleId: 'ascribe_from_acknowledgment',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingCoraAck1.understandingRuleId,
    understandingRuleVersion: understandingCoraAck1.understandingRuleVersion,
    inputRecordIds: understandingCoraAck1.inputRecordIds,
  })
  if (superseded.outcome.verdict !== 'committed') {
    throw new Error('attributionScenario: expected BT_CoraAtt_ack1 to commit -- fixture invariant broken')
  }
  return { store: superseded.store }
}

/** Branch 4b, content-free variant -- own store instance, for fault-injection contrast (F78/F79). */
export function buildBranch4bContentFree(base: Phase3Result = buildPhase3Store()): Phase4Result {
  const superseded = commitAscriptionSupersession(base.store, attributionUniverse, {
    transitionId: 'BT_CoraAtt_ackFree1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1b.id,
    toBeliefId: Bel_CoraAtt2Prime.id,
    effectiveValidTime: T_ACK,
    validFrom: T_ACK,
    cause: 'ascribed-from-acknowledgment',
    ruleId: 'ascribe_from_acknowledgment',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingCoraAckFree1.understandingRuleId,
    understandingRuleVersion: understandingCoraAckFree1.understandingRuleVersion,
    inputRecordIds: understandingCoraAckFree1.inputRecordIds,
  })
  if (superseded.outcome.verdict !== 'committed') {
    throw new Error('attributionScenario: expected BT_CoraAtt_ackFree1 to commit -- fixture invariant broken')
  }
  return { store: superseded.store }
}

export interface Phase5Result {
  store: AttributionStore
  daren: 'present' | 'absent'
}

/**
 * Phase 5, retract-deny variant -- own store, forking from Branch 4a.
 * Both Cora's and Daren's attributions are already at the confidence FLOOR
 * by this point (Cora via Phase 3's delivery erosion; Daren via his own
 * low-trust cap from formation, §7.1) -- `ascribe_from_apology`'s erosion
 * step is therefore a genuine no-op for both (P82's floor rule, mirroring
 * Phase 7's decay floor sub-case), and no `BT_*_apology1` transition is
 * committed at all; the explicit denial fires directly on the current
 * belief (P86: apology alone never establishes `disbelieves` regardless).
 */
export function buildPhase5RetractDeny(base: Phase4Result = buildBranch4a(), includeDaren = true): Phase5Result {
  let store = base.store

  const coraDeny = commitAscriptionSupersession(store, attributionUniverse, {
    transitionId: 'BT_CoraAtt_deny1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1b.id,
    toBeliefId: Bel_CoraAtt3.id,
    effectiveValidTime: T_APOLOGY_RETRACT,
    validFrom: T_APOLOGY_RETRACT,
    cause: 'ascribed-from-denial',
    ruleId: 'ascribe_from_retraction_deny',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingCoraRetract1.understandingRuleId,
    understandingRuleVersion: understandingCoraRetract1.understandingRuleVersion,
    inputRecordIds: understandingCoraRetract1.inputRecordIds,
  })
  if (coraDeny.outcome.verdict !== 'committed') throw new Error('attributionScenario: BT_CoraAtt_deny1 fixture invariant broken')
  store = coraDeny.store

  if (!includeDaren) {
    return { store, daren: 'absent' }
  }

  const darenDeny = commitAscriptionSupersession(store, attributionUniverse, {
    transitionId: 'BT_DarenAtt_deny1',
    holder: DAREN,
    fromBeliefId: Bel_DarenAtt1.id,
    toBeliefId: Bel_DarenAtt2.id,
    effectiveValidTime: T_APOLOGY_RETRACT,
    validFrom: T_APOLOGY_RETRACT,
    cause: 'ascribed-from-denial',
    ruleId: 'ascribe_from_retraction_deny',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingDarenRetract1.understandingRuleId,
    understandingRuleVersion: understandingDarenRetract1.understandingRuleVersion,
    inputRecordIds: understandingDarenRetract1.inputRecordIds,
  })
  if (darenDeny.outcome.verdict !== 'committed') throw new Error('attributionScenario: BT_DarenAtt_deny1 fixture invariant broken')
  store = darenDeny.store

  return { store, daren: 'present' }
}

/** Phase 5, retract-withdraw variant -- own store, forking directly from Branch 4a (no apology in this fork, for fault-injection contrast, F76). */
export function buildPhase5RetractWithdraw(base: Phase4Result = buildBranch4a()): Phase5Result {
  let store = base.store

  const coraWithdraw = commitAscriptionSupersession(store, attributionUniverse, {
    transitionId: 'BT_CoraAtt_withdraw1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1b.id,
    toBeliefId: Bel_CoraAtt1b_withdraw.id,
    effectiveValidTime: T_APOLOGY_RETRACT,
    validFrom: T_APOLOGY_RETRACT,
    cause: 'ascribed-from-withdrawal',
    ruleId: 'ascribe_from_retraction_withdraw',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingCoraRetractWithdraw1.understandingRuleId,
    understandingRuleVersion: understandingCoraRetractWithdraw1.understandingRuleVersion,
    inputRecordIds: understandingCoraRetractWithdraw1.inputRecordIds,
  })
  if (coraWithdraw.outcome.verdict !== 'committed') throw new Error('attributionScenario: BT_CoraAtt_withdraw1 fixture invariant broken')
  store = coraWithdraw.store

  const darenWithdraw = commitAscriptionSupersession(store, attributionUniverse, {
    transitionId: 'BT_DarenAtt_withdraw1',
    holder: DAREN,
    fromBeliefId: Bel_DarenAtt1.id,
    toBeliefId: Bel_DarenAtt1_withdraw.id,
    effectiveValidTime: T_APOLOGY_RETRACT,
    validFrom: T_APOLOGY_RETRACT,
    cause: 'ascribed-from-withdrawal',
    ruleId: 'ascribe_from_retraction_withdraw',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: understandingDarenRetractWithdraw1.understandingRuleId,
    understandingRuleVersion: understandingDarenRetractWithdraw1.understandingRuleVersion,
    inputRecordIds: understandingDarenRetractWithdraw1.inputRecordIds,
  })
  if (darenWithdraw.outcome.verdict !== 'committed') throw new Error('attributionScenario: BT_DarenAtt_withdraw1 fixture invariant broken')
  store = darenWithdraw.store

  return { store, daren: 'present' }
}

export interface Phase7Result {
  store: AttributionStore
}

/** Phase 7, observable-decay sub-case -- own store, forking from Phase 2 (no Phase-3 erosion applied). */
export function buildPhase7ObservableDecay(base: AttributionStore = buildPhase2Store()): Phase7Result {
  const decayed = commitAscriptionSupersession(base, attributionUniverse, {
    transitionId: 'BT_CoraAtt_decay1',
    holder: CORA,
    fromBeliefId: Bel_CoraAtt1.id,
    toBeliefId: Bel_CoraAtt1c.id,
    effectiveValidTime: T_DECAY,
    validFrom: T_DECAY,
    cause: 'ascription-decayed',
    ruleId: 'ascription_decay',
    ruleVersion: ASCRIPTION_RULE_VERSION,
    inputRecordIds: [],
  })
  if (decayed.outcome.verdict !== 'committed') throw new Error('attributionScenario: BT_CoraAtt_decay1 fixture invariant broken')
  return { store: decayed.store }
}

/** Phase 7, floor no-op sub-case -- the Branch-4a fork (Bel_CoraAtt1b already `low`); decay must mint no new transition at all. */
export function buildPhase7FloorNoOp(base: Phase4Result = buildBranch4a()): Phase7Result {
  return { store: base.store }
}

export { attributedBeliefProposition }
export type { AttributionTargetProposition, EventParticipationProposition, AttributedBeliefProposition }
