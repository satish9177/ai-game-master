import { canonicalSerialize } from './canonicalSerialization'
import { ATTRIBUTED_BELIEF_PREDICATE } from './canonicalProposition'
import type { BeliefSourceType, Confidence } from './contracts'
import type { Belief } from './contracts'
import type { CanonicalClaim, ValidExtent } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import type {
  AttributedBeliefProposition,
  AttributedStance,
  AttributionBuilderFault,
  AttributionTargetProposition,
  EventParticipationPredicate,
  EventParticipationProposition,
  EventPayloadRef,
  InnerKey,
} from './attributionContracts'
import { CONTENT_BEARING_EVENT_PREDICATES, isEventParticipationPredicate, isHolderStatePredicate } from './attributionContracts'

/**
 * The validated builder + deterministic canonicalizer (research vault
 * ADR-0011 D1 amendment/D3/§3.0/§3.3): the only authoritative path that
 * produces a valid `AttributedBeliefProposition`/`EventParticipationProposition`
 * ADT value and its derived `CanonicalClaim`/canonical key. No code path
 * elsewhere in this proof inserts a claim-sidecar entry or a canonical key
 * from any input other than these functions' own output (F83).
 */

// ---- Canonical key derivation (a pure, total function of a valid ADT value) --

/**
 * The full inner proposition's content is its own identity -- unlike the
 * outer attribution claim, there is no "contested" slot inside
 * AttributionTargetProposition itself, so every field participates in the
 * key. Two structurally-identical inner propositions always produce
 * byte-identical keys (P5); the two EventParticipationProposition shapes
 * (speaker-act vs. recipient-participation) differ in `subject`/`predicate`/
 * `contentRef` and therefore always canonicalize to distinct keys (P91).
 */
export function innerCanonicalKeyOf(prop: AttributionTargetProposition): InnerKey {
  return canonicalSerialize(prop) as InnerKey
}

/** Stamps a plain string id as a branded EventPayloadRef -- the only producer of this type (F3's twin: never derivable from attribution content). */
export function eventPayloadRef(id: string): EventPayloadRef {
  return id as EventPayloadRef
}

// ---- makeAttributedBelief (D1/D3/D8's validated builder) -------------------

export interface MakeAttributedBeliefInput {
  beliefId: string
  holder: string
  modeledHolder: string
  attributedStance: AttributedStance
  proposition: AttributionTargetProposition
  confidence: Confidence
  sourceType: BeliefSourceType
  sourceRef: string
  supporting: readonly string[]
  descriptiveProposition: string
  lastUpdated: string
  validity: ValidExtent
}

export type MakeAttributedBeliefOutcome =
  | { verdict: 'ok'; belief: Belief; claim: CanonicalClaim; innerKey: InnerKey }
  | { verdict: 'rejected'; fault: AttributionBuilderFault }

function validateInnerProposition(proposition: AttributionTargetProposition): AttributionBuilderFault | null {
  if (proposition.kind === 'holder-state' && !isHolderStatePredicate(proposition.predicate)) {
    return 'unknown-holder-state-predicate'
  }
  if (proposition.kind === 'event-participation') {
    if (!isEventParticipationPredicate(proposition.predicate)) {
      return 'unknown-event-participation-predicate'
    }
    const requiresContent = (CONTENT_BEARING_EVENT_PREDICATES as readonly EventParticipationPredicate[]).includes(proposition.predicate)
    if (requiresContent && proposition.contentRef === undefined) {
      return 'missing-content-ref'
    }
    if (!requiresContent && proposition.contentRef !== undefined) {
      return 'unexpected-content-ref'
    }
  }
  return null
}

/**
 * D3's precondition: `holder == modeledHolder` is rejected before
 * construction completes (self-attribution is a validated builder
 * invariant, never claimed to follow from the union type alone, F6). On
 * success, the constructor always invokes the canonicalizer internally --
 * there is no code path that returns a validated ADT value without also
 * returning its canonicalized CanonicalClaim (§3.3).
 */
export function makeAttributedBelief(input: MakeAttributedBeliefInput): MakeAttributedBeliefOutcome {
  if (input.holder === input.modeledHolder) {
    return { verdict: 'rejected', fault: 'self-attribution' }
  }

  const innerFault = validateInnerProposition(input.proposition)
  if (innerFault !== null) {
    return { verdict: 'rejected', fault: innerFault }
  }

  const innerKey = innerCanonicalKeyOf(input.proposition)

  const claim: CanonicalClaim = {
    predicate: ATTRIBUTED_BELIEF_PREDICATE,
    fixedRoles: { modeled_holder: input.modeledHolder, inner_key: innerKey },
    contestedRole: 'attributed_stance',
    contestedValue: input.attributedStance,
    polarity: 'asserts',
    validity: input.validity,
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }

  const belief: Belief = {
    schemaVersion: 1,
    id: input.beliefId,
    holder: input.holder,
    proposition: input.descriptiveProposition,
    confidence: input.confidence,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    supporting: [...input.supporting],
    contradicting: [],
    lastUpdated: input.lastUpdated,
  }

  return { verdict: 'ok', belief, claim, innerKey }
}

// ---- makeEventParticipationBelief (Tier-1 ledger; no ClaimRegistry entry) --

// Event-participation facts never participate in conflict detection (D5 is
// scoped to stance-as-object incompatibility, never event-participation
// content) -- they are ordinary Beliefs with no CanonicalClaim, so they
// never enter beliefProjection.ts's Layer-B pairing loop (store.claims.get
// returns undefined for them, and the loop skips undefined claims).

export interface MakeEventParticipationBeliefInput {
  beliefId: string
  holder: string
  proposition: EventParticipationProposition
  confidence: Confidence
  sourceRef: string
  supporting: readonly string[]
  descriptiveProposition: string
  lastUpdated: string
}

export type MakeEventParticipationBeliefOutcome =
  | { verdict: 'ok'; belief: Belief; innerKey: InnerKey }
  | { verdict: 'rejected'; fault: AttributionBuilderFault }

export function makeEventParticipationBelief(input: MakeEventParticipationBeliefInput): MakeEventParticipationBeliefOutcome {
  const innerFault = validateInnerProposition(input.proposition)
  if (innerFault !== null) {
    return { verdict: 'rejected', fault: innerFault }
  }

  const belief: Belief = {
    schemaVersion: 1,
    id: input.beliefId,
    holder: input.holder,
    proposition: input.descriptiveProposition,
    confidence: input.confidence,
    sourceType: 'inference',
    sourceRef: input.sourceRef,
    supporting: [...input.supporting],
    contradicting: [],
    lastUpdated: input.lastUpdated,
  }

  return { verdict: 'ok', belief, innerKey: innerCanonicalKeyOf(input.proposition) }
}

// ---- Bypass detection helper (F83's positive-twin check) -------------------

/**
 * Confirms a committed claim's `inner_key` fixed role is exactly what the
 * canonicalizer would derive from the given ADT value -- used by the F83
 * fault test to show a hand-serialized substitute is detectable (any
 * bypass string that isn't byte-identical to `innerCanonicalKeyOf`'s own
 * output fails this check, since the key IS the canonical serialization).
 */
export function claimMatchesInnerProposition(claim: CanonicalClaim, proposition: AttributionTargetProposition): boolean {
  return claim.fixedRoles.inner_key === innerCanonicalKeyOf(proposition)
}

export function attributedBeliefProposition(
  modeledHolder: string,
  attributedStance: AttributedStance,
  proposition: AttributionTargetProposition,
): AttributedBeliefProposition {
  return { kind: 'attributed-belief', modeledHolder, attributedStance, proposition }
}
