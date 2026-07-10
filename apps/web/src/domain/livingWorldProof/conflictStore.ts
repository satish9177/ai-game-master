import { compareInstants, detectConflict, instantEquals, sortClaimPair } from './canonicalProposition'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { Belief } from './contracts'
import type {
  BeliefTimingMap,
  BeliefTransition,
  ClaimRegistry,
  ConflictCommit,
  ConflictEdge,
  EdgeRejectReason,
  TransitionCause,
  TransitionFault,
  WorldInstant,
} from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'

/**
 * The append-only conflict store (ADR-0008, spec conflict-edge-replay-v0.md
 * §1/§2). Every mutator is pure -- it returns a new store rather than
 * mutating the one passed in -- and every commit is appended to
 * `commitLog` in the exact recorded shape `conflictReplay.ts` later
 * materializes. No LLM, no I/O, no Date.now/Math.random. `commitBelief`/
 * `commitRevision`/`commitTransition` are the only three ways timing or a
 * transition ever enters the store; there is no other write path.
 */

export interface ConflictStore {
  claims: ClaimRegistry
  edges: readonly ConflictEdge[]
  transitions: readonly BeliefTransition[]
  /** beliefId -> {validFrom, mintSeq}. Beliefs never gain a stored validTo (ADR-0008 D4). */
  timing: BeliefTimingMap
  proposalLog: readonly ConflictProposalLogEntry[]
  commitLog: readonly ConflictCommit[]
  nextSeq: number
  nextEdgeSeq: number
}

export function initConflictStore(claims: ClaimRegistry): ConflictStore {
  return {
    claims,
    edges: [],
    transitions: [],
    timing: new Map(),
    proposalLog: [],
    commitLog: [],
    nextSeq: 1,
    nextEdgeSeq: 1,
  }
}

function resolveBelief(universe: readonly ReadableRecord[], beliefId: string): Belief | undefined {
  const entry = universe.find((candidate) => candidate.record.id === beliefId)
  return entry !== undefined && entry.kind === 'belief' ? entry.record : undefined
}

function evidenceExists(universe: readonly ReadableRecord[], evidenceId: string): boolean {
  const entry = universe.find((candidate) => candidate.record.id === evidenceId)
  return entry !== undefined && entry.kind === 'evidence'
}

// ---- ConflictEdge minting (D2, design plan decisions 2/3/8) ---------------

export type MintEdgeOutcome =
  | { verdict: 'minted' | 'duplicate'; edge: ConflictEdge }
  | { verdict: 'rejected'; reason: EdgeRejectReason }

/**
 * Detects and idempotently mints a ConflictEdge over two records' claims
 * (§2.1). Endpoints and the pair key are claim-level, sorted by claimKey --
 * symmetric by construction, so argument order never affects the result
 * (N5). A repeated accepted detection returns the existing edge unchanged
 * (`duplicate`); the same pair can never mint a second edge because this
 * lookup always precedes the append -- there is no second write path.
 * `proposalKey`, when supplied, is stamped at mint time only (never after
 * the fact onto an already-minted edge).
 */
export function mintEdge(
  store: ConflictStore,
  recordIdA: string,
  recordIdB: string,
  proposalKey?: string,
): { store: ConflictStore; outcome: MintEdgeOutcome } {
  const claimA = store.claims.get(recordIdA)
  const claimB = store.claims.get(recordIdB)
  if (claimA === undefined || claimB === undefined) {
    return { store, outcome: { verdict: 'rejected', reason: 'malformed-claim' } }
  }

  const detection = detectConflict(claimA, claimB)
  if (detection.verdict === 'no-conflict') {
    return { store, outcome: { verdict: 'rejected', reason: detection.reason } }
  }

  const sorted = sortClaimPair(claimA, claimB)
  const firstRecord = sorted.swapped ? recordIdB : recordIdA
  const secondRecord = sorted.swapped ? recordIdA : recordIdB
  const pairKey = sorted.pairKey

  const existing = store.edges.find((edge) => edge.pairKey === pairKey)
  if (existing !== undefined) {
    return { store, outcome: { verdict: 'duplicate', edge: existing } }
  }

  const edge: ConflictEdge = {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    edgeId: `CE_${String(store.nextEdgeSeq).padStart(4, '0')}`,
    endpoints: [
      { claimKey: sorted.firstKey, witnessRecordId: firstRecord },
      { claimKey: sorted.secondKey, witnessRecordId: secondRecord },
    ],
    pairKey,
    canonicalKey: detection.canonicalKey,
    overlapWitness: detection.overlapWitness,
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
    commitSeq: store.nextSeq,
    authoritative: false,
    ...(proposalKey !== undefined ? { proposalKey } : {}),
  }

  const nextStore: ConflictStore = {
    ...store,
    edges: [...store.edges, edge],
    nextSeq: store.nextSeq + 1,
    nextEdgeSeq: store.nextEdgeSeq + 1,
    commitLog: [...store.commitLog, { kind: 'edge', edge }],
  }

  return { store: nextStore, outcome: { verdict: 'minted', edge } }
}

// ---- Explainable edge minting: the proposal/theta audit log (decision 8) --

/**
 * Auxiliary audit fixture, not a third persistent world record type (design
 * plan decision 8): every proposal -- accepted or rejected -- is logged
 * here. A rejected proposal is never minted and stays uncommitted (N4); an
 * accepted one's `proposalKey` is stamped onto the edge at mint time, never
 * duplicating evidence text onto it.
 */
export interface ConflictProposalLogEntry {
  proposalKey: string
  proposedBy: 'llm' | 'engine'
  candidate: readonly [string, string]
  verdict: 'accepted' | 'rejected'
  reason?: EdgeRejectReason
  edgeId?: string
}

export interface EdgeProposal {
  proposalKey: string
  proposedBy: 'llm' | 'engine'
  candidate: readonly [string, string]
}

export function proposeEdge(store: ConflictStore, proposal: EdgeProposal): { store: ConflictStore; outcome: MintEdgeOutcome } {
  const [recordIdA, recordIdB] = proposal.candidate
  const { store: nextStore, outcome } = mintEdge(store, recordIdA, recordIdB, proposal.proposalKey)

  const logEntry: ConflictProposalLogEntry =
    outcome.verdict === 'rejected'
      ? { proposalKey: proposal.proposalKey, proposedBy: proposal.proposedBy, candidate: proposal.candidate, verdict: 'rejected', reason: outcome.reason }
      : { proposalKey: proposal.proposalKey, proposedBy: proposal.proposedBy, candidate: proposal.candidate, verdict: 'accepted', edgeId: outcome.edge.edgeId }

  return { store: { ...nextStore, proposalLog: [...nextStore.proposalLog, logEntry] }, outcome }
}

// ---- Belief timing commit (design plan decision 5) -------------------------

export type CommitBeliefOutcome = { verdict: 'committed' } | { verdict: 'rejected'; fault: 'already-committed' | 'unknown-belief' }

/**
 * Registers a belief's `validFrom`/`mintSeq` timing with no transition --
 * the only way a deliberately-unresolved co-holding of two incompatible
 * beliefs can arise (both committed here, neither superseding the other).
 * Never mutates an existing timing entry (idempotent-refusal, not
 * overwrite).
 */
export function commitBelief(
  store: ConflictStore,
  universe: readonly ReadableRecord[],
  beliefId: string,
  validFrom: WorldInstant,
): { store: ConflictStore; outcome: CommitBeliefOutcome } {
  if (resolveBelief(universe, beliefId) === undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'unknown-belief' } }
  }
  if (store.timing.has(beliefId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'already-committed' } }
  }

  const timing = new Map(store.timing)
  const mintSeq = store.nextSeq
  timing.set(beliefId, { validFrom, mintSeq })

  const nextStore: ConflictStore = {
    ...store,
    timing,
    nextSeq: mintSeq + 1,
    commitLog: [...store.commitLog, { kind: 'belief', beliefId, validFrom, mintSeq }],
  }

  return { store: nextStore, outcome: { verdict: 'committed' } }
}

// ---- Transition commit (design plan decisions 6/7/14, final correction) ---

export interface TransitionCandidate {
  transitionId: string
  holder: string
  fromBeliefId: string
  toBeliefId: string
  effectiveValidTime: WorldInstant
  cause: TransitionCause
  ruleId: string
  ruleVersion: string
  canonicalizerVersion: string
  inputEvidenceIds: readonly string[]
  conflictEdgeIds: readonly string[]
  adjudicationKey?: string
  recordedProposal?: string
}

export type CommitTransitionOutcome = { verdict: 'committed'; transition: BeliefTransition } | { verdict: 'rejected'; fault: TransitionFault }

function isCurrent(store: ConflictStore, beliefId: string, holder: string, at: WorldInstant): boolean {
  const timing = store.timing.get(beliefId)
  if (timing === undefined) return false
  if (compareInstants(timing.validFrom, at) > 0) return false
  const outgoing = store.transitions.find((transition) => transition.fromBeliefId === beliefId && transition.holder === holder)
  if (outgoing === undefined) return true
  return compareInstants(outgoing.effectiveValidTime, at) > 0
}

/** A Belief has at most one outgoing transition in v0 (design plan I8, revised) -- the transition graph is a forest of chains. */
function outgoingTransitionOf(store: ConflictStore, beliefId: string): BeliefTransition | undefined {
  return store.transitions.find((transition) => transition.fromBeliefId === beliefId)
}

/** Walks the (at-most-one-outgoing) chain from `startBeliefId`; true iff it reaches `targetBeliefId` -- the reachability guard behind cycle prevention (design plan final correction §3). */
function reachesViaTransitions(store: ConflictStore, startBeliefId: string, targetBeliefId: string): boolean {
  let current: string | undefined = startBeliefId
  const seen = new Set<string>()
  while (current !== undefined) {
    if (current === targetBeliefId) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = outgoingTransitionOf(store, current)?.toBeliefId
  }
  return false
}

function sortedArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

/** Exact-duplicate identity: every identity-bearing field matches a committed transition (design plan decision 14 / clarification 2). */
function isExactDuplicate(committed: BeliefTransition, candidate: TransitionCandidate): boolean {
  return (
    committed.holder === candidate.holder &&
    committed.fromBeliefId === candidate.fromBeliefId &&
    committed.toBeliefId === candidate.toBeliefId &&
    instantEquals(committed.effectiveValidTime, candidate.effectiveValidTime) &&
    committed.cause === candidate.cause &&
    committed.ruleId === candidate.ruleId &&
    committed.ruleVersion === candidate.ruleVersion &&
    committed.canonicalizerVersion === candidate.canonicalizerVersion &&
    sortedArraysEqual(committed.inputEvidenceIds, candidate.inputEvidenceIds) &&
    sortedArraysEqual(committed.conflictEdgeIds, candidate.conflictEdgeIds)
  )
}

function validateEvidenceAndEdges(store: ConflictStore, universe: readonly ReadableRecord[], candidate: TransitionCandidate): TransitionFault | null {
  for (const evidenceId of candidate.inputEvidenceIds) {
    if (!evidenceExists(universe, evidenceId)) {
      return 'unknown-evidence'
    }
  }
  for (const edgeId of candidate.conflictEdgeIds) {
    if (!store.edges.some((edge) => edge.edgeId === edgeId)) {
      return 'missing-transition-endpoint'
    }
  }
  if (candidate.canonicalizerVersion !== CONFLICT_CANONICALIZER_VERSION) {
    return 'canonicalizer-version-mismatch'
  }
  return null
}

function buildTransition(candidate: TransitionCandidate, toBeliefId: string, commitSeq: number): BeliefTransition {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    transitionId: candidate.transitionId,
    holder: candidate.holder,
    fromBeliefId: candidate.fromBeliefId,
    toBeliefId,
    effectiveValidTime: candidate.effectiveValidTime,
    commitSeq,
    cause: candidate.cause,
    ruleId: candidate.ruleId,
    ruleVersion: candidate.ruleVersion,
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
    inputEvidenceIds: [...candidate.inputEvidenceIds],
    conflictEdgeIds: [...candidate.conflictEdgeIds],
    ...(candidate.adjudicationKey !== undefined ? { adjudicationKey: candidate.adjudicationKey } : {}),
    ...(candidate.recordedProposal !== undefined ? { recordedProposal: candidate.recordedProposal } : {}),
  }
}

export interface RevisionEnvelope {
  toBeliefId: string
  validFrom: WorldInstant
  transition: TransitionCandidate
}

/**
 * The atomic revision envelope (design plan clarification 1): a new
 * Belief's timing entry and the BeliefTransition that introduces it become
 * visible together under one shared `commitSeq` -- there is no observable
 * bound at which one is visible without the other. The destination must be
 * an existing, immutable Belief record with no timing entry yet (never an
 * arbitrary or missing id, and never a belief that has already been
 * committed some other way). Transaction order (mintSeq(from) < mintSeq(to))
 * is not checked -- it holds automatically because the destination's
 * mintSeq *is* this envelope's fresh sequence.
 */
export function commitRevision(
  store: ConflictStore,
  envelope: RevisionEnvelope,
  universe: readonly ReadableRecord[],
): { store: ConflictStore; outcome: CommitTransitionOutcome } {
  const candidate = envelope.transition

  if (candidate.fromBeliefId === envelope.toBeliefId) {
    return { store, outcome: { verdict: 'rejected', fault: 'self-transition' } }
  }

  const fromBelief = resolveBelief(universe, candidate.fromBeliefId)
  const toBelief = resolveBelief(universe, envelope.toBeliefId)
  if (fromBelief === undefined || toBelief === undefined || !store.timing.has(candidate.fromBeliefId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'missing-transition-endpoint' } }
  }

  const referenceFault = validateEvidenceAndEdges(store, universe, candidate)
  if (referenceFault === 'unknown-evidence') {
    return { store, outcome: { verdict: 'rejected', fault: referenceFault } }
  }

  if (fromBelief.holder !== candidate.holder || toBelief.holder !== candidate.holder) {
    return { store, outcome: { verdict: 'rejected', fault: 'holder-mismatch' } }
  }

  // Exact-duplicate detection runs before every currency/branching check
  // (design plan clarification 2): a byte-identical resubmission is
  // recognized as a duplicate regardless of whether `from` still reads as
  // current -- otherwise it would always be masked by from-not-current
  // (the just-committed transition already makes `from` non-current at its
  // own effective instant), and 'duplicate-transition' would be
  // unreachable in practice.
  const duplicate = store.transitions.find((committed) => isExactDuplicate(committed, candidate))
  if (duplicate !== undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'duplicate-transition' } }
  }

  if (!isCurrent(store, candidate.fromBeliefId, candidate.holder, candidate.effectiveValidTime)) {
    return { store, outcome: { verdict: 'rejected', fault: 'from-not-current' } }
  }

  if (outgoingTransitionOf(store, candidate.fromBeliefId) !== undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'transition-branching' } }
  }

  // The destination is genuinely new -- an existing immutable Belief record
  // that has not yet received a timing entry, never an arbitrary/missing id
  // (already ruled out above) and never one already committed some other way.
  if (store.timing.has(envelope.toBeliefId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'destination-not-new' } }
  }

  if (referenceFault !== null) {
    return { store, outcome: { verdict: 'rejected', fault: referenceFault } }
  }

  const commitSeq = store.nextSeq
  const transition = buildTransition(candidate, envelope.toBeliefId, commitSeq)

  const timing = new Map(store.timing)
  timing.set(envelope.toBeliefId, { validFrom: envelope.validFrom, mintSeq: commitSeq })

  const nextStore: ConflictStore = {
    ...store,
    timing,
    transitions: [...store.transitions, transition],
    nextSeq: commitSeq + 1,
    commitLog: [...store.commitLog, { kind: 'revision', toBeliefId: envelope.toBeliefId, validFrom: envelope.validFrom, transition }],
  }

  return { store: nextStore, outcome: { verdict: 'committed', transition } }
}

/**
 * Resolves a deliberate co-holding of two already-committed, currently-
 * current beliefs (design plan §1.6 unresolved case, final correction):
 * both endpoints must already exist and both must be current at the
 * effective instant -- unlike `commitRevision`, resolution may point toward
 * either co-held belief regardless of which was minted first (no mint-order
 * check). Rejects a transition to a belief that has ceased to be current,
 * reactivation of an old superseded belief, cycles (via reachability), and
 * branching -- always in that order, duplicate before branching.
 */
export function commitTransition(
  store: ConflictStore,
  candidate: TransitionCandidate,
  universe: readonly ReadableRecord[],
): { store: ConflictStore; outcome: CommitTransitionOutcome } {
  if (candidate.fromBeliefId === candidate.toBeliefId) {
    return { store, outcome: { verdict: 'rejected', fault: 'self-transition' } }
  }

  const fromBelief = resolveBelief(universe, candidate.fromBeliefId)
  const toBelief = resolveBelief(universe, candidate.toBeliefId)
  if (
    fromBelief === undefined ||
    toBelief === undefined ||
    !store.timing.has(candidate.fromBeliefId) ||
    !store.timing.has(candidate.toBeliefId)
  ) {
    return { store, outcome: { verdict: 'rejected', fault: 'missing-transition-endpoint' } }
  }

  const referenceFault = validateEvidenceAndEdges(store, universe, candidate)
  if (referenceFault === 'unknown-evidence') {
    return { store, outcome: { verdict: 'rejected', fault: referenceFault } }
  }

  if (fromBelief.holder !== candidate.holder || toBelief.holder !== candidate.holder) {
    return { store, outcome: { verdict: 'rejected', fault: 'holder-mismatch' } }
  }

  // Exact-duplicate detection runs before every currency/branching/cycle
  // check (design plan clarification 2) -- see the matching comment in
  // commitRevision for why: otherwise a byte-identical resubmission would
  // always be masked by from-not-current instead.
  const duplicate = store.transitions.find((committed) => isExactDuplicate(committed, candidate))
  if (duplicate !== undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'duplicate-transition' } }
  }

  if (!isCurrent(store, candidate.fromBeliefId, candidate.holder, candidate.effectiveValidTime)) {
    return { store, outcome: { verdict: 'rejected', fault: 'from-not-current' } }
  }

  if (!isCurrent(store, candidate.toBeliefId, candidate.holder, candidate.effectiveValidTime)) {
    return { store, outcome: { verdict: 'rejected', fault: 'to-not-current' } }
  }

  if (outgoingTransitionOf(store, candidate.fromBeliefId) !== undefined) {
    return { store, outcome: { verdict: 'rejected', fault: 'transition-branching' } }
  }

  if (reachesViaTransitions(store, candidate.toBeliefId, candidate.fromBeliefId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'transition-cycle' } }
  }

  if (referenceFault !== null) {
    return { store, outcome: { verdict: 'rejected', fault: referenceFault } }
  }

  const commitSeq = store.nextSeq
  const transition = buildTransition(candidate, candidate.toBeliefId, commitSeq)

  const nextStore: ConflictStore = {
    ...store,
    transitions: [...store.transitions, transition],
    nextSeq: commitSeq + 1,
    commitLog: [...store.commitLog, { kind: 'transition', transition }],
  }

  return { store: nextStore, outcome: { verdict: 'committed', transition } }
}
