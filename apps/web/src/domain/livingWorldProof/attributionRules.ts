import type { Belief, Confidence, Observation } from './contracts'
import type { CanonicalClaim, TransitionCause, ValidExtent } from './conflictContracts'
import type {
  AscriptionRejectReason,
  AttributedStance,
  AttributionTargetProposition,
  CommunicativeAct,
  EventParticipationProposition,
  InnerKey,
  RetractPayload,
} from './attributionContracts'
import { ASCRIPTION_RULE_VERSION, EVENT_PARTICIPATION_RULE_VERSION, trustOf } from './attributionContracts'
import type { TrustRegistry } from './attributionContracts'
import { eventPayloadRef, makeAttributedBelief, makeEventParticipationBelief } from './attributionBuilder'
import { receiptRungOf } from './attributionUnderstanding'
import type { UnderstandingResult } from './attributionContracts'

/**
 * Deterministic ascription rules (research vault ADR-0011 D6-D9, spec §7).
 * Every rule is a pure, versioned, deterministic function whose input
 * signature is closed to the ascriber's own scoped Observations, current
 * Beliefs, and permitted trust state -- it cannot name a modeled holder's
 * private Belief, confidence, transition history, receipt history, memory,
 * or engine truth (D8/D13; static source-contract closure, F21/F22/F23/F26).
 *
 * `ascribe_*` rules require rung 6+ (a positive UnderstandingResult, §5.3)
 * to fire at all -- P83/P84/F64. `ep_*` rules require only rung 5+.
 *
 * `AscriptionMint` covers a FIRST-EVER attribution/event-participation
 * belief for a (holder, modeled_holder | event) pair -- no predecessor
 * exists, so it commits via the unmodified `commitBelief` (exactly the
 * Bel_A1/Bel_D1 pattern, D21 amendment: a synthetic "no-opinion" placeholder
 * predecessor is never minted, P44). `AscriptionSupersede` covers every
 * later stance/confidence change -- it commits via `commitRevision`,
 * carrying `inputEvidenceIds: []` and an `AttributionTransitionSupport`
 * sidecar entry (D8's second amendment, P110).
 */

export interface AscriptionMint {
  verdict: 'mint'
  belief: Belief
  claim?: CanonicalClaim
  innerKey: InnerKey
}

export interface AscriptionSupersede {
  verdict: 'supersede'
  toBelief: Belief
  toClaim?: CanonicalClaim
  cause: TransitionCause
  ruleId: string
  ruleVersion: string
  understandingRuleId?: string
  understandingRuleVersion?: string
  inputRecordIds: readonly string[]
}

export type AscriptionNoOp = { verdict: 'no-op' }
export type AscriptionRejected = { verdict: 'rejected'; reason: AscriptionRejectReason }

export type AscriptionOutcome = AscriptionMint | AscriptionSupersede | AscriptionNoOp | AscriptionRejected

const CONFIDENCE_LADDER: Readonly<Record<Confidence, Confidence>> = { high: 'medium', medium: 'low', low: 'low' }

/** §7.1's deterministic erosion ladder: high->medium->low->low(no-op). Every step mints a NEW, distinctly-named successor id -- never a mutated/reused predecessor id (caller's job, P82). */
export function erodeOneStep(confidence: Confidence): Confidence {
  return CONFIDENCE_LADDER[confidence]
}

export function isAtConfidenceFloor(confidence: Confidence): boolean {
  return confidence === 'low'
}

// ---- Tier-1 event-participation rules (ep_v0; rung 5+, unconditional) -----

function speakerActPredicate(act: CommunicativeAct, retractStrength?: RetractPayload): EventParticipationProposition['predicate'] {
  switch (act) {
    case 'assert':
    case 'present-evidence':
      return 'asserted'
    case 'acknowledge':
      return 'asserted'
    case 'apologize':
      return 'performed'
    case 'retract':
      return retractStrength === 'retract-deny' ? 'denied' : 'retracted'
    case 'express-ignorance':
      return 'expressed-ignorance-about'
    case 'warn':
      return 'asserted'
  }
}

const CONTENT_BEARING_ACTS: ReadonlySet<CommunicativeAct> = new Set(['assert', 'present-evidence', 'retract', 'express-ignorance', 'warn'])

export interface SpeakerActInput {
  beliefId: string
  holder: string
  speaker: string
  eventId: string
  act: CommunicativeAct
  retractStrength?: RetractPayload
  /** Populated only when the act carries content of its own AND the observer's Observation reached rung 5 with content fragments (acknowledge's content-satisfying variant sets this too). */
  propositionRef?: InnerKey
  observation: Observation
  time: string
}

/**
 * ep_speaker_act/ep_v0 (D6 item 1): mints unconditionally on any committed
 * Observation reaching rung 5+ -- canonicalization alone suffices; no
 * understanding/trust/sincerity gate. Never registers a CanonicalClaim
 * (event-participation facts never enter conflict detection, D5).
 */
export function epSpeakerAct(input: SpeakerActInput): AscriptionOutcome {
  if (receiptRungOf(input.observation) === 'below-rung-5') {
    return { verdict: 'rejected', reason: 'not-rung-5' }
  }

  const predicate = speakerActPredicate(input.act, input.retractStrength)
  const contentBearing = CONTENT_BEARING_ACTS.has(input.act)
  const proposition: EventParticipationProposition = contentBearing
    ? { kind: 'event-participation', subject: input.speaker, predicate, eventRef: eventPayloadRef(input.eventId), contentRef: input.propositionRef }
    : { kind: 'event-participation', subject: input.speaker, predicate, eventRef: eventPayloadRef(input.eventId) }

  const built = makeEventParticipationBelief({
    beliefId: input.beliefId,
    holder: input.holder,
    proposition,
    confidence: 'high',
    sourceRef: input.observation.id,
    supporting: [input.observation.id],
    descriptiveProposition: `${input.speaker} ${predicate} (${input.eventId})`,
    lastUpdated: input.time,
  })
  if (built.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'wrong-act' }
  }
  return { verdict: 'mint', belief: built.belief, innerKey: built.innerKey }
}

export interface RecipientParticipationInput {
  beliefId: string
  holder: string
  eventId: string
  observation: Observation
  time: string
}

/** ep_recipient_participation/ep_v0 (D6 item 1's twin): "A heard TE" -- no content_ref, distinct canonical shape from the speaker-act fact (P91). */
export function epRecipientParticipation(input: RecipientParticipationInput): AscriptionOutcome {
  if (receiptRungOf(input.observation) === 'below-rung-5') {
    return { verdict: 'rejected', reason: 'not-rung-5' }
  }
  const proposition: EventParticipationProposition = { kind: 'event-participation', subject: input.holder, predicate: 'heard', eventRef: eventPayloadRef(input.eventId) }
  const built = makeEventParticipationBelief({
    beliefId: input.beliefId,
    holder: input.holder,
    proposition,
    confidence: 'high',
    sourceRef: input.observation.id,
    supporting: [input.observation.id],
    descriptiveProposition: `I heard ${input.eventId}`,
    lastUpdated: input.time,
  })
  if (built.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'wrong-act' }
  }
  return { verdict: 'mint', belief: built.belief, innerKey: built.innerKey }
}

export interface OccurrenceOnlyInput {
  beliefId: string
  holder: string
  eventId: string
  speaker: string
  observation: Observation
  time: string
}

/** Rungs 1-4: occurrence-level participation only (D9's occurrence_observers-only fact) -- never a content_ref, never the speaker-act/recipient-participation shape (P93). */
export function occurrenceOnlyParticipation(input: OccurrenceOnlyInput): AscriptionOutcome {
  const proposition: EventParticipationProposition = { kind: 'event-participation', subject: input.holder, predicate: 'witnessed', eventRef: eventPayloadRef(input.eventId) }
  const built = makeEventParticipationBelief({
    beliefId: input.beliefId,
    holder: input.holder,
    proposition,
    confidence: 'medium',
    sourceRef: input.observation.id,
    supporting: [input.observation.id],
    descriptiveProposition: `${input.speaker} and someone were speaking (${input.eventId})`,
    lastUpdated: input.time,
  })
  if (built.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'wrong-act' }
  }
  return { verdict: 'mint', belief: built.belief, innerKey: built.innerKey }
}

// ---- Tier-2 stance-ascription rules (aab_v0; rung 6+ required) ------------

export interface AscribeFromAssertionInput {
  beliefId: string
  holder: string
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  trust: TrustRegistry
  speaker: string
  validity: ValidExtent
  time: string
}

const TRUST_TO_CAP: Readonly<Record<Confidence, Confidence>> = { high: 'medium', medium: 'medium', low: 'low' }

/** ascribe_from_assertion/aab_v0 (D8 table row 1): requires rung 6+; caps at medium, further capped by the ascriber's own trust in the speaker (reused calculus dimension, never duplicated, D7/P15). First mint only (no predecessor exists yet, P16/P44). */
export function ascribeFromAssertion(input: AscribeFromAssertionInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  const cap = TRUST_TO_CAP[trustOf(input.trust, input.holder, input.speaker)]
  const built = makeAttributedBelief({
    beliefId: input.beliefId,
    holder: input.holder,
    modeledHolder: input.modeledHolder,
    attributedStance: 'believes',
    proposition: input.proposition,
    confidence: cap,
    sourceType: 'inference',
    sourceRef: input.understanding.observationId,
    supporting: [...input.understanding.inputRecordIds],
    descriptiveProposition: `${input.modeledHolder} believes: the accusation`,
    lastUpdated: input.time,
    validity: input.validity,
  })
  if (built.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'wrong-act' }
  }
  return { verdict: 'mint', belief: built.belief, claim: built.claim, innerKey: built.innerKey }
}

interface SupersedeStanceInput {
  toBeliefId: string
  fromBelief: Belief
  modeledHolder: string
  proposition: AttributionTargetProposition
  newStance: AttributedStance
  newConfidence: Confidence
  cause: TransitionCause
  ruleId: string
  understandingRuleId?: string
  understandingRuleVersion?: string
  inputRecordIds: readonly string[]
  descriptiveProposition: string
  validity: ValidExtent
  time: string
}

function supersedeStance(input: SupersedeStanceInput): AscriptionSupersede {
  const built = makeAttributedBelief({
    beliefId: input.toBeliefId,
    holder: input.fromBelief.holder,
    modeledHolder: input.modeledHolder,
    attributedStance: input.newStance,
    proposition: input.proposition,
    confidence: input.newConfidence,
    sourceType: 'inference',
    sourceRef: input.inputRecordIds[0] ?? input.fromBelief.id,
    supporting: input.inputRecordIds,
    descriptiveProposition: input.descriptiveProposition,
    lastUpdated: input.time,
    validity: input.validity,
  })
  if (built.verdict !== 'ok') {
    throw new Error(`attributionRules: supersedeStance builder rejected -- ${built.fault}`)
  }
  return {
    verdict: 'supersede',
    toBelief: built.belief,
    toClaim: built.claim,
    cause: input.cause,
    ruleId: input.ruleId,
    ruleVersion: ASCRIPTION_RULE_VERSION,
    understandingRuleId: input.understandingRuleId,
    understandingRuleVersion: input.understandingRuleVersion,
    inputRecordIds: input.inputRecordIds,
  }
}

export interface ErosionInput {
  toBeliefId: string
  fromBelief: Belief
  fromStance: AttributedStance
  modeledHolder: string
  proposition: AttributionTargetProposition
  cause: TransitionCause
  ruleId: string
  understanding?: UnderstandingResult
  supportRecordIds: readonly string[]
  time: string
  validity: ValidExtent
}

/** Shared shape for every "one confidence step down, stance unchanged" erosion (delivery/apology/decay/already-uncertain-withdrawal, §7.1). At the floor, mints no new transition at all (P82's floor no-op, decay's own dedicated case). */
export function stepConfidenceDown(input: ErosionInput): AscriptionOutcome {
  if (isAtConfidenceFloor(input.fromBelief.confidence)) {
    return { verdict: 'no-op' }
  }
  return supersedeStance({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    newStance: input.fromStance,
    newConfidence: erodeOneStep(input.fromBelief.confidence),
    cause: input.cause,
    ruleId: input.ruleId,
    understandingRuleId: input.understanding?.understandingRuleId,
    understandingRuleVersion: input.understanding?.understandingRuleVersion,
    inputRecordIds: input.supportRecordIds,
    descriptiveProposition: input.fromBelief.proposition,
    validity: input.validity,
    time: input.time,
  })
}

export interface DeliveryErosionInput {
  toBeliefId: string
  fromBelief: Belief
  fromStance: AttributedStance
  modeledHolder: string
  proposition: AttributionTargetProposition
  deliveryOutcomeId: string
  time: string
  validity: ValidExtent
}

/**
 * ascribe_from_evidence_presentation/aab_v0 (D8 table row 2): fires on the
 * ASCRIBER's own ActionOutcome of dispatching a present-evidence act
 * (delivery only, never the recipient's response). Retains the stance
 * unchanged; mints a new successor one confidence step down (P22) --
 * delivery is not acceptance, even from the deliverer's own vantage.
 */
export function ascribeFromEvidencePresentation(input: DeliveryErosionInput): AscriptionOutcome {
  return stepConfidenceDown({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    fromStance: input.fromStance,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    cause: 'delivery-without-acceptance',
    ruleId: 'ascribe_from_evidence_presentation',
    supportRecordIds: [input.deliveryOutcomeId],
    time: input.time,
    validity: input.validity,
  })
}

export interface ApologyErosionInput {
  toBeliefId: string
  fromBelief: Belief
  fromStance: AttributedStance
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  time: string
  validity: ValidExtent
}

/** ascribe_from_apology/aab_v0 (D8 table row): rung 6+ of an apologize act; retains stance unchanged, one confidence step down (P86 -- apology alone never establishes disbelieves). */
export function ascribeFromApology(input: ApologyErosionInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  return stepConfidenceDown({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    fromStance: input.fromStance,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    cause: 'ascribed-apology-noted',
    ruleId: 'ascribe_from_apology',
    understanding: input.understanding,
    supportRecordIds: input.understanding.inputRecordIds,
    time: input.time,
    validity: input.validity,
  })
}

export interface AcknowledgmentInput {
  toBeliefId: string
  fromBelief: Belief
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  contentSatisfying: boolean
  time: string
  validity: ValidExtent
}

/** ascribe_from_acknowledgment/aab_v0: two exhaustive, mutually exclusive variants (never a shared "may" outcome, P88/F78/F79). */
export function ascribeFromAcknowledgment(input: AcknowledgmentInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  return supersedeStance({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    newStance: input.contentSatisfying ? 'disbelieves' : 'uncertain',
    newConfidence: input.contentSatisfying ? 'high' : 'medium',
    cause: 'ascribed-from-acknowledgment',
    ruleId: 'ascribe_from_acknowledgment',
    understandingRuleId: input.understanding.understandingRuleId,
    understandingRuleVersion: input.understanding.understandingRuleVersion,
    inputRecordIds: input.understanding.inputRecordIds,
    descriptiveProposition: `${input.modeledHolder} ${input.contentSatisfying ? 'disbelieves' : 'is uncertain about'}: the accusation`,
    validity: input.validity,
    time: input.time,
  })
}

export interface RetractionWithdrawInput {
  toBeliefId: string
  fromBelief: Belief
  fromStance: AttributedStance
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  time: string
  validity: ValidExtent
}

/** ascribe_from_retraction_withdraw/aab_v0: two named variants -- stance-changing (-> uncertain @ medium) unless already uncertain/unaware, in which case a confidence-only step-down (P95/F76). */
export function ascribeFromRetractionWithdraw(input: RetractionWithdrawInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  if (input.fromStance === 'uncertain' || input.fromStance === 'unaware') {
    return stepConfidenceDown({
      toBeliefId: input.toBeliefId,
      fromBelief: input.fromBelief,
      fromStance: input.fromStance,
      modeledHolder: input.modeledHolder,
      proposition: input.proposition,
      cause: 'ascribed-from-withdrawal',
      ruleId: 'ascribe_from_retraction_withdraw',
      understanding: input.understanding,
      supportRecordIds: input.understanding.inputRecordIds,
      time: input.time,
      validity: input.validity,
    })
  }
  return supersedeStance({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    newStance: 'uncertain',
    newConfidence: 'medium',
    cause: 'ascribed-from-withdrawal',
    ruleId: 'ascribe_from_retraction_withdraw',
    understandingRuleId: input.understanding.understandingRuleId,
    understandingRuleVersion: input.understanding.understandingRuleVersion,
    inputRecordIds: input.understanding.inputRecordIds,
    descriptiveProposition: `${input.modeledHolder} is uncertain about: the accusation`,
    validity: input.validity,
    time: input.time,
  })
}

export interface RetractionDenyInput {
  toBeliefId: string
  fromBelief: Belief
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  time: string
  validity: ValidExtent
}

/** ascribe_from_retraction_deny/aab_v0: ALWAYS supersedes to disbelieves @ medium -- a single deterministic outcome, never conditional (P87/F77). */
export function ascribeFromRetractionDeny(input: RetractionDenyInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  return supersedeStance({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    newStance: 'disbelieves',
    newConfidence: 'medium',
    cause: 'ascribed-from-denial',
    ruleId: 'ascribe_from_retraction_deny',
    understandingRuleId: input.understanding.understandingRuleId,
    understandingRuleVersion: input.understanding.understandingRuleVersion,
    inputRecordIds: input.understanding.inputRecordIds,
    descriptiveProposition: `${input.modeledHolder} disbelieves: the accusation`,
    validity: input.validity,
    time: input.time,
  })
}

export interface UnawareFromIgnoranceInput {
  beliefId: string
  holder: string
  modeledHolder: string
  proposition: AttributionTargetProposition
  understanding: UnderstandingResult
  time: string
  validity: ValidExtent
}

/**
 * ascribe_unaware_from_ignorance_expression/aab_v0 (D4/D8/D11 amendment):
 * the ONLY mintable path to `unaware`. Input signature reads only the
 * ascriber's own rung-6+ Observation of the modeled holder's typed
 * express-ignorance act -- never receipt history, memory, retrieval state,
 * or private belief projection (F23/F26/P41). First mint only in this
 * fixture (no predecessor).
 */
export function ascribeUnawareFromIgnoranceExpression(input: UnawareFromIgnoranceInput): AscriptionOutcome {
  if (!input.understanding.understood) {
    return { verdict: 'rejected', reason: 'not-rung-6' }
  }
  const built = makeAttributedBelief({
    beliefId: input.beliefId,
    holder: input.holder,
    modeledHolder: input.modeledHolder,
    attributedStance: 'unaware',
    proposition: input.proposition,
    confidence: 'medium',
    sourceType: 'inference',
    sourceRef: input.understanding.observationId,
    supporting: [...input.understanding.inputRecordIds],
    descriptiveProposition: `${input.modeledHolder} is unaware of: the proposition`,
    lastUpdated: input.time,
    validity: input.validity,
  })
  if (built.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'wrong-act' }
  }
  return { verdict: 'mint', belief: built.belief, claim: built.claim, innerKey: built.innerKey }
}

export interface DecayInput {
  toBeliefId: string
  fromBelief: Belief
  fromStance: AttributedStance
  modeledHolder: string
  proposition: AttributionTargetProposition
  time: string
  validity: ValidExtent
}

/** ascription_decay/aab_v0: holder-local, driven only by committed world-time gap; at the floor mints NO new transition at all (P82's floor no-op, §7 Phase 7). */
export function ascriptionDecay(input: DecayInput): AscriptionOutcome {
  return stepConfidenceDown({
    toBeliefId: input.toBeliefId,
    fromBelief: input.fromBelief,
    fromStance: input.fromStance,
    modeledHolder: input.modeledHolder,
    proposition: input.proposition,
    cause: 'ascription-decayed',
    ruleId: 'ascription_decay',
    supportRecordIds: [],
    time: input.time,
    validity: input.validity,
  })
}

export { EVENT_PARTICIPATION_RULE_VERSION }
