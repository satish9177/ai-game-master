import type { Confidence } from './contracts'
import type { WorldInstant } from './conflictContracts'

/**
 * Attributed-Belief Staleness Replay v0 schema (research vault ADR-0011
 * D1-D22, spec attributed-belief-staleness-replay-v0.md). Kept in a
 * separate file so every already-passed proof's schema surface
 * (contracts.ts, conflictContracts.ts, intentionContracts.ts,
 * planBodyContracts.ts) stays untouched -- purely additive. This file
 * introduces ZERO new authoritative record families (D1/D21): an
 * attribution is an ordinary, holder-private `Belief`; only a proof-local
 * typed authoring layer (this file + attributionBuilder.ts) exists at
 * construction time and is never itself committed or serialized as the
 * Belief's `proposition` field.
 *
 * `AttributionTargetProposition` is a closed, structurally depth-capped
 * union (D2): none of its three members can hold `AttributedBeliefProposition`
 * as inner content, so depth 2 is unconstructible by TYPE, not merely
 * rejected by a runtime check (P2). `content_ref`/`eventRef` are typed as
 * branded keys producible only by `innerCanonicalKeyOf`/`eventPayloadRef`
 * (attributionBuilder.ts) -- neither can ever resolve to
 * `AttributedBeliefProposition` content (D2 amendment, P107).
 */

// ---- Closed vocabularies (versioned with the grammar) ----------------------

export const ATTRIBUTION_GRAMMAR_VERSION = 'ag_v0' as const
export const UNDERSTANDING_RULE_VERSION = 'ur_v0' as const
export const ASCRIPTION_RULE_VERSION = 'aab_v0' as const
export const EVENT_PARTICIPATION_RULE_VERSION = 'ep_v0' as const

export const ATTRIBUTED_STANCES = ['believes', 'disbelieves', 'uncertain', 'unaware'] as const
export type AttributedStance = (typeof ATTRIBUTED_STANCES)[number]

export function isAttributedStance(value: string): value is AttributedStance {
  return (ATTRIBUTED_STANCES as readonly string[]).includes(value)
}

// D2: "BARRED: any predicate whose semantics is itself an attitude toward
// propositional content." Every admitted predicate names a flat disposition
// or relation, never an attitude toward a proposition.
export const HOLDER_STATE_PREDICATES = ['trusts', 'distrusts', 'allied-with', 'located-at', 'disposed-toward'] as const
export type HolderStatePredicate = (typeof HOLDER_STATE_PREDICATES)[number]

export function isHolderStatePredicate(value: string): value is HolderStatePredicate {
  return (HOLDER_STATE_PREDICATES as readonly string[]).includes(value)
}

export const EVENT_PARTICIPATION_PREDICATES = [
  'witnessed',
  'asserted',
  'heard',
  'received',
  'performed',
  'retracted',
  'denied',
  'expressed-ignorance-about',
] as const
export type EventParticipationPredicate = (typeof EVENT_PARTICIPATION_PREDICATES)[number]

export function isEventParticipationPredicate(value: string): value is EventParticipationPredicate {
  return (EVENT_PARTICIPATION_PREDICATES as readonly string[]).includes(value)
}

/** D2: predicates naming asserted content (content_ref required) vs. carrying no content of their own (content_ref omitted). */
export const CONTENT_BEARING_EVENT_PREDICATES = ['asserted', 'retracted', 'denied', 'expressed-ignorance-about'] as const

// D11: seven-member closed communicative-act vocabulary.
export const COMMUNICATIVE_ACTS = ['assert', 'retract', 'apologize', 'warn', 'present-evidence', 'acknowledge', 'express-ignorance'] as const
export type CommunicativeAct = (typeof COMMUNICATIVE_ACTS)[number]

// D11/§6 correction: retract carries one of two distinguished strengths.
export const RETRACT_PAYLOADS = ['retract-withdraw', 'retract-deny'] as const
export type RetractPayload = (typeof RETRACT_PAYLOADS)[number]

// ---- Branded canonical-key types (D2's structural exclusion boundary) -----

// Only `eventPayloadRef` (attributionBuilder.ts) may produce this type, and it
// accepts a plain string id naming a TruthEvent/ActionOutcome/communication-act
// payload -- never an AttributedBeliefProposition value, so `eventRef` can
// never resolve to attribution-kind content by construction (F3).
declare const EVENT_PAYLOAD_REF_BRAND: unique symbol
export type EventPayloadRef = string & { readonly [EVENT_PAYLOAD_REF_BRAND]: 'TruthEvent|ActionOutcome|CommunicationAct' }

// Only `innerCanonicalKeyOf` (attributionBuilder.ts) may produce this type,
// and its parameter type is `AttributionTargetProposition` -- a union that
// does not admit `AttributedBeliefProposition` as a member. `content_ref`
// therefore cannot, by any construction, resolve to attribution-kind content
// (D2 amendment, F84/P107) -- the identical structural mechanism that bars
// `event_ref` bars this too.
declare const INNER_KEY_BRAND: unique symbol
export type InnerKey = string & { readonly [INNER_KEY_BRAND]: 'AttributionTargetProposition' }

// ---- The closed, structurally depth-capped inner-content union (D2) -------

export interface WorldProposition {
  kind: 'world'
  subject: string
  predicate: string
  object: string
  at: WorldInstant
}

export interface HolderStateProposition {
  kind: 'holder-state'
  subject: string
  predicate: HolderStatePredicate
  object: string
  at: WorldInstant
}

export interface EventParticipationProposition {
  kind: 'event-participation'
  subject: string
  predicate: EventParticipationPredicate
  eventRef: EventPayloadRef
  /**
   * D2: required for content-bearing predicates (asserted/retracted/denied/
   * expressed-ignorance-about), omitted for predicates carrying no content of
   * their own (witnessed/heard/received/performed). May resolve only to the
   * canonical key of a valid AttributionTargetProposition -- never to
   * AttributedBeliefProposition content (structurally unconstructible, F84).
   */
  contentRef?: InnerKey
}

/**
 * D2's closed three-member union: no member can hold `AttributedBeliefProposition`
 * as inner content, so depth 2 is unconstructible by type (P2, F1/F3/F5/F84).
 */
export type AttributionTargetProposition = WorldProposition | HolderStateProposition | EventParticipationProposition

export interface AttributedBeliefProposition {
  kind: 'attributed-belief'
  modeledHolder: string
  attributedStance: AttributedStance
  proposition: AttributionTargetProposition
}

// ---- express-ignorance typed payload (D11 amendment) -----------------------

export interface ExpressIgnorancePayload {
  act: 'express-ignorance'
  /** Canonical key of the AttributionTargetProposition the speaker currently lacks usable awareness of. */
  propositionRef: InnerKey
}

export interface RetractActPayload {
  act: 'retract'
  strength: RetractPayload
  proposition: InnerKey
}

export interface AssertLikeActPayload {
  act: 'assert' | 'present-evidence' | 'acknowledge' | 'apologize' | 'warn'
  /** Populated for content-bearing acts (assert/present-evidence/acknowledge); apology/warn may omit it. */
  proposition?: InnerKey
  /** acknowledge only: whether the content explicitly denies P or accepts an authored-incompatible proposition (D8's content-satisfying/content-free split). */
  acknowledgesIncompatibleContent?: boolean
}

export type TypedActPayload = ExpressIgnorancePayload | RetractActPayload | AssertLikeActPayload

// ---- AttributionTransitionSupport sidecar (D8 amendment) -------------------

/**
 * Additive, engine-side sidecar keyed 1:1 to its owning `BeliefTransition`'s
 * id -- the same discipline `BeliefTimingMap` already applies to belief
 * timing. No independent epistemic lifecycle: no adoption, no supersession,
 * no conflict participation, no confidence, no stance of its own (D8/D21
 * condition 1, P102). Never carries a modeled-holder private record
 * reference (D13/D14).
 */
export interface AttributionTransitionSupport {
  transitionId: string
  ascriptionRuleId: string
  ascriptionRuleVersion: string
  understandingRuleId?: string
  understandingRuleVersion?: string
  inputRecordIds: readonly string[]
}

export type AttributionTransitionSupportMap = ReadonlyMap<string, AttributionTransitionSupport>

// ---- UnderstandingResult (derived-only, never committed -- §5.3) ----------

/**
 * Deterministic derived projection, never a committed authoritative record
 * (F66). Derived only from the holder's own committed scoped Observation(s)
 * and a closed, versioned understanding rule -- never engine truth, another
 * holder's state, audit-only divergence, or uncommitted data.
 */
export interface UnderstandingResult {
  holderId: string
  observationId: string
  understood: boolean
  understandingRuleId: string
  understandingRuleVersion: string
  inputRecordIds: readonly string[]
}

// ---- Trust registry (reused calculus dimension, D7 -- not duplicated) ------

/** holder -> speaker -> Trust. Hand-registered proof-local fixture input, never parsed from prose -- the ClaimRegistry discipline one layer up. */
export type TrustRegistry = ReadonlyMap<string, ReadonlyMap<string, Confidence>>

export function trustOf(registry: TrustRegistry, holder: string, speaker: string): Confidence {
  return registry.get(holder)?.get(speaker) ?? 'low'
}

// ---- Typed faults (plain unions -- never persisted) ------------------------

export type AttributionBuilderFault =
  | 'self-attribution'
  | 'unknown-holder-state-predicate'
  | 'unknown-event-participation-predicate'
  | 'missing-content-ref'
  | 'unexpected-content-ref'

export type AscriptionRejectReason =
  | 'not-rung-6'
  | 'not-rung-5'
  | 'wrong-act'
  | 'wrong-payload'
  | 'no-declared-consumer'
  | 'at-confidence-floor'

/** D16: the closed, reviewed vocabulary of declared Tier-2 consumers this fixture exercises -- lazy promotion, never a default mint. */
export const DECLARED_CONSUMER_OBJECTIVE_TYPES = ['correct-belief', 'track-discrepancy'] as const
export type DeclaredConsumerObjectiveType = (typeof DECLARED_CONSUMER_OBJECTIVE_TYPES)[number]
