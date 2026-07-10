import { canonicalSerialize } from './canonicalSerialization'
import type { CanonicalClaim, ClaimFault, EdgeRejectReason, OverlapWitness, ValidExtent, WorldInstant, WorldStateClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'

/**
 * Canonical proposition grammar and deterministic conflict detection (ADR-
 * 0008 D2/D11, spec conflict-edge-replay-v0.md §1.2/§2.1). Detection runs
 * only over engine-validated CanonicalClaims from the claim registry
 * (conflictScenario.ts) -- this module never parses natural language and
 * does not attempt arbitrary entailment. Pure, total, no I/O.
 */

// ---- World-instant ordering -------------------------------------------------

export function compareInstants(a: WorldInstant, b: WorldInstant): -1 | 0 | 1 {
  if (a.night !== b.night) return a.night < b.night ? -1 : 1
  if (a.tick !== b.tick) return a.tick < b.tick ? -1 : 1
  return 0
}

export function instantEquals(a: WorldInstant, b: WorldInstant): boolean {
  return compareInstants(a, b) === 0
}

export function instantBefore(a: WorldInstant, b: WorldInstant): boolean {
  return compareInstants(a, b) < 0
}

// ---- Predicate grammar (design plan §1.2) ----------------------------------

// A small static table declaring, per predicate, which role is contested and
// that it is exclusive (exactly one value can hold at once). `involved_in`
// is a deliberately distinct predicate from `attacked` -- Bel_B1's hedged
// rumor claim never key-matches the sharper attack claims (N2).
export const WORLD_STATE_PREDICATE = 'world_state' as const

interface PredicateSpec {
  contestedRole: string
  exclusive: boolean
}

const PREDICATE_GRAMMAR: Readonly<Record<string, PredicateSpec>> = {
  attacked: { contestedRole: 'actor', exclusive: true },
  involved_in: { contestedRole: 'actor', exclusive: true },
  [WORLD_STATE_PREDICATE]: { contestedRole: 'state', exclusive: true },
}

/** The shared question a claim answers -- excludes the contested value/polarity/time (design plan I4). */
export function canonicalKeyOf(claim: CanonicalClaim): string {
  return canonicalSerialize({ predicate: claim.predicate, fixedRoles: claim.fixedRoles })
}

/** The full claim's identity -- this is what ConflictEdge endpoints and the pair key are built from. */
export function claimKeyOf(claim: CanonicalClaim): string {
  return canonicalSerialize(claim)
}

export interface SortedClaimPair {
  firstKey: string
  secondKey: string
  pairKey: string
  /** True iff (a, b) needed swapping to reach sorted order -- callers use this to sort along matching endpoint/record data. */
  swapped: boolean
}

/**
 * The canonical unordered pair key (design plan decision 3): claim keys
 * sorted lexicographically, then serialized together. `mintEdge` (identity/
 * endpoints) and `isConflictActive`/`currentBeliefs` (edge lookup) share
 * this single implementation so the two can never disagree on what counts
 * as "the same pair" -- argument order never affects the result (N5).
 */
export function sortClaimPair(a: CanonicalClaim, b: CanonicalClaim): SortedClaimPair {
  const keyA = claimKeyOf(a)
  const keyB = claimKeyOf(b)
  const swapped = keyA > keyB
  const firstKey = swapped ? keyB : keyA
  const secondKey = swapped ? keyA : keyB
  return { firstKey, secondKey, pairKey: canonicalSerialize([firstKey, secondKey]), swapped }
}

/**
 * Rejects malformed or version-mismatched claims before any semantic step
 * (N4/F3): the predicate must be grammar-registered, the claim's declared
 * contested role must match the grammar's, the contested role must not
 * double as a fixed role, and the canonicalizer version must match.
 */
export function assertWellFormed(claim: CanonicalClaim): ClaimFault | null {
  if (claim.canonicalizerVersion !== CONFLICT_CANONICALIZER_VERSION) {
    return 'canonicalizer-version-mismatch'
  }
  const spec = PREDICATE_GRAMMAR[claim.predicate]
  if (spec === undefined) {
    return 'malformed-claim'
  }
  if (claim.contestedRole !== spec.contestedRole) {
    return 'malformed-claim'
  }
  if (Object.prototype.hasOwnProperty.call(claim.fixedRoles, claim.contestedRole)) {
    return 'malformed-claim'
  }
  return null
}

/**
 * Object/outcome incompatibility (assumes canonicalKeyOf(a) === canonicalKeyOf(b),
 * checked by the caller): same contested value with opposite polarity, or
 * different contested values on an exclusive role asserted with the same
 * polarity. Decidable from the grammar alone -- no entailment.
 */
export function incompatible(a: CanonicalClaim, b: CanonicalClaim): boolean {
  const spec = PREDICATE_GRAMMAR[a.predicate]
  if (spec === undefined) {
    return false
  }
  if (a.contestedValue === b.contestedValue) {
    return a.polarity !== b.polarity
  }
  return spec.exclusive && a.polarity === b.polarity
}

// ---- Valid-time overlap (design plan clarification 3) ----------------------

function instantWithinInterval(at: WorldInstant, interval: { from: WorldInstant; to: WorldInstant | null }): boolean {
  return !instantBefore(at, interval.from) && (interval.to === null || instantBefore(at, interval.to))
}

function minEnd(a: WorldInstant | null, b: WorldInstant | null): WorldInstant | null {
  if (a === null) return b
  if (b === null) return a
  return compareInstants(a, b) <= 0 ? a : b
}

/**
 * Deterministic overlap over the tagged instant/interval representation:
 * instant/instant overlaps only when the instants are equal (so two event
 * claims about the same world instant can conflict); instant/interval
 * overlaps when `from <= at < to`, or `to` is open; interval/interval uses
 * ordinary half-open overlap. Returns the intersection extent, or null if
 * disjoint -- this is what keeps door-open@T1 and door-closed@T2 provably
 * non-overlapping once their effective intervals are derived (N1).
 */
export function extentOverlap(a: ValidExtent, b: ValidExtent): ValidExtent | null {
  if (a.kind === 'instant') {
    if (b.kind === 'instant') {
      return instantEquals(a.at, b.at) ? { kind: 'instant', at: a.at } : null
    }
    return instantWithinInterval(a.at, b) ? { kind: 'instant', at: a.at } : null
  }

  if (b.kind === 'instant') {
    return instantWithinInterval(b.at, a) ? { kind: 'instant', at: b.at } : null
  }

  const from = compareInstants(a.from, b.from) >= 0 ? a.from : b.from
  const to = minEnd(a.to, b.to)
  if (to !== null && !instantBefore(from, to)) {
    return null
  }
  return { kind: 'interval', from, to }
}

// ---- World-state succession (design plan §1.12) ----------------------------

/**
 * Derives a world-state claim's effective validity on read: open-ended
 * until the earliest later claim on the same `objectKey`, never written
 * back onto any record (ADR-0008 D5). Must be called before overlap
 * checking -- this is what makes ordinary succession provably non-
 * overlapping rather than something a mutable interval-close would fake.
 */
export type IntervalExtent = Extract<ValidExtent, { kind: 'interval' }>

export function effectiveStatePeriod(claim: WorldStateClaim, allClaimsForObject: readonly WorldStateClaim[]): IntervalExtent {
  const successors = allClaimsForObject
    .filter((candidate) => candidate.objectKey === claim.objectKey && instantBefore(claim.from, candidate.from))
    .sort((x, y) => compareInstants(x.from, y.from))
  const [earliestSuccessor] = successors

  return { kind: 'interval', from: claim.from, to: earliestSuccessor === undefined ? null : earliestSuccessor.from }
}

/** Projects a WorldStateClaim into the same CanonicalClaim shape detection runs over, with its derived effective period. */
export function worldStateClaimToCanonicalClaim(claim: WorldStateClaim, siblings: readonly WorldStateClaim[]): CanonicalClaim {
  return {
    predicate: WORLD_STATE_PREDICATE,
    fixedRoles: { object: claim.objectKey },
    contestedRole: 'state',
    contestedValue: claim.state,
    polarity: 'asserts',
    validity: effectiveStatePeriod(claim, siblings),
    canonicalizerVersion: claim.canonicalizerVersion,
  }
}

/**
 * The latest world-state claim whose derived effective period covers
 * `validT` -- current-state projection consults no transitions (D5).
 */
export function latestValidStateClaim(objectKey: string, stateClaims: readonly WorldStateClaim[], validT: WorldInstant): WorldStateClaim | undefined {
  const forObject = stateClaims.filter((claim) => claim.objectKey === objectKey)
  return forObject.find((claim) => {
    const period = effectiveStatePeriod(claim, forObject)
    return !instantBefore(validT, period.from) && (period.to === null || instantBefore(validT, period.to))
  })
}

export type DetectConflictOutcome =
  | { verdict: 'conflict'; canonicalKey: string; overlapWitness: OverlapWitness }
  | { verdict: 'no-conflict'; reason: EdgeRejectReason }

/**
 * The pure detection core (§2.1): well-formedness (grammar + version) on
 * both claims, then canonical-key match, then object/outcome incompatibility,
 * then valid-time overlap. Any failure short-circuits with a typed reason;
 * only every gate passing yields `conflict`.
 */
export function detectConflict(a: CanonicalClaim, b: CanonicalClaim): DetectConflictOutcome {
  const faultA = assertWellFormed(a)
  if (faultA !== null) {
    return { verdict: 'no-conflict', reason: faultA }
  }
  const faultB = assertWellFormed(b)
  if (faultB !== null) {
    return { verdict: 'no-conflict', reason: faultB }
  }

  const keyA = canonicalKeyOf(a)
  const keyB = canonicalKeyOf(b)
  if (keyA !== keyB) {
    return { verdict: 'no-conflict', reason: 'key-mismatch' }
  }

  if (!incompatible(a, b)) {
    return { verdict: 'no-conflict', reason: 'compatible-outcomes' }
  }

  const intersection = extentOverlap(a.validity, b.validity)
  if (intersection === null) {
    return { verdict: 'no-conflict', reason: 'no-valid-time-overlap' }
  }

  return { verdict: 'conflict', canonicalKey: keyA, overlapWitness: { a: a.validity, b: b.validity, intersection } }
}
