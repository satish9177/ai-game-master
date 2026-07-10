import { beliefFromRumor } from './beliefUpdate'
import { beliefC1, beliefC1Prime, compactionUniverse } from './compactionScenario'
import type { CanonicalClaim, ClaimRegistry, WorldInstant, WorldStateClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION, OVERTURN_BY_HARD_EVIDENCE_RULE_ID, TRANSITION_RULE_VERSION } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { commitBelief, commitRevision, initConflictStore, mintEdge } from './conflictStore'
import { beliefA1, beliefD1 } from './evidenceScenario'
import type { ReadableRecord } from './evidenceRecords'
import { beliefC2 } from './hierarchyScenario'
import { clawEvidence, events, rumorAToB } from './scenario'

/**
 * Fixture for Conflict-Edge Replay v0 (ADR-0008, spec conflict-edge-
 * replay-v0.md), built additively on the already-committed compaction
 * universe (compactionScenario.ts, unmodified). No existing fixture file
 * is edited. Reuses Bel_C1, Bel_C1', E_claw, R_B_to_C, and the C-corrected/
 * B-uncorrected divergence exactly as specced; Bel_C2 stays reserved for
 * the pantry fixture and is never registered as a conflict-bearing claim.
 */

// NPC_B's own belief in the rumor it received. The existing fixtures only
// reference 'Bel_B1' as rumorBToC.sourceBelief -- it is never materialized
// as a committed Belief record in evidenceScenario.ts/compactionScenario.ts.
// This derives it the same way the existing test files already do locally
// (beliefUpdate.test.ts, scenario.test.ts): running the already-proven
// beliefFromRumor over the committed rumorAToB. Additive only --
// compactionUniverse and every existing fixture stay byte-identical.
export const beliefB1 = beliefFromRumor(rumorAToB, 'Bel_B1')

export const conflictUniverse: ReadableRecord[] = [...compactionUniverse, { kind: 'belief', record: beliefB1 }]

function nightTick(label: string, tick = 0): WorldInstant {
  const match = /^night_(\d+)$/.exec(label)
  if (match === null) {
    throw new Error(`conflictScenario: unparseable world-time label '${label}'`)
  }
  return { night: Number(match[1]), tick }
}

// ---- Claim registry (design plan I3/I4: hand-registered, canonical key
// excludes the contested role's value) ---------------------------------

// The claims' own asserted validity is the underlying event's world time
// (T1, night_3) -- not when a belief was formed or evidence presented
// (both night_4). Derived from the committed truth record rather than a
// second hardcoded literal.
const GUARD_MALIK_ATTACK_TIME = nightTick(events.find((event) => event.id === 'T1')!.time)

function attackedClaim(actor: string): CanonicalClaim {
  return {
    predicate: 'attacked',
    fixedRoles: { target: 'guard_malik' },
    contestedRole: 'actor',
    contestedValue: actor,
    polarity: 'asserts',
    validity: { kind: 'instant', at: GUARD_MALIK_ATTACK_TIME },
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

// Deliberately a different predicate from `attacked` (design plan §1.2) --
// B's hedged claim never key-matches the sharper attack claims, so the
// A->B->C wording mutation alone can never mint a ConflictEdge (N2).
const involvedInPlayerClaim: CanonicalClaim = {
  predicate: 'involved_in',
  fixedRoles: { target: 'guard_malik' },
  contestedRole: 'actor',
  contestedValue: 'player',
  polarity: 'asserts',
  validity: { kind: 'instant', at: GUARD_MALIK_ATTACK_TIME },
  canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
}

export const claimRegistry: ClaimRegistry = new Map<string, CanonicalClaim>([
  [beliefA1.id, attackedClaim('zombie_17')],
  [beliefD1.id, attackedClaim('zombie_17')],
  [beliefB1.id, involvedInPlayerClaim],
  [beliefC1.id, attackedClaim('player')],
  [beliefC1Prime.id, attackedClaim('zombie_17')],
  [clawEvidence.id, attackedClaim('zombie_17')],
])

// ---- World-state succession fixture (design plan I6/I7) -------------------

// Fresh ids -- T1/T2 already name committed SceneEvents in scenario.ts.
// Proof-local: never added to the ReadableRecord union, so readable()/the
// gates/index maps/digests/navigation are provably untouched by this pair.
export const doorOpenClaim: WorldStateClaim = {
  recordId: 'WS_door_open',
  objectKey: 'cellar_door',
  state: 'open',
  from: { night: 1, tick: 0 },
  canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
}

export const doorClosedClaim: WorldStateClaim = {
  recordId: 'WS_door_closed',
  objectKey: 'cellar_door',
  state: 'closed',
  from: { night: 2, tick: 0 },
  canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
}

export const doorStateClaims: readonly WorldStateClaim[] = [doorOpenClaim, doorClosedClaim]

// ---- Belief timing (design plan I1/I2: fixture-authored world instants,
// sidecar only -- BeliefSchema itself is never touched) --------------------

// Sub-night ticks disambiguate Bel_C1 (rumor arrives) from Bel_C1' (evidence
// corrects it) within the same night_4 -- required by the fixture itself
// (R_B_to_C.time and E_claw.time are both 'night_4').
const beliefValidFrom: ReadonlyMap<string, WorldInstant> = new Map([
  [beliefC2.id, nightTick('night_2')],
  [beliefA1.id, nightTick('night_3')],
  [beliefD1.id, nightTick('night_3')],
  [beliefB1.id, nightTick('night_3', 1)],
  [beliefC1.id, nightTick('night_4')],
])

export const REVISION_VALID_FROM: WorldInstant = nightTick('night_4', 1)
export const TRANSITION_ID = 'BT_0001'

export interface CommittedConflictScenario {
  store: ConflictStore
  universe: readonly ReadableRecord[]
  conflictEdgeId: string
  transitionId: string
}

/**
 * Builds the fully-committed v0 scenario by running the real store
 * operations in order -- never hand-authoring the resulting records. Base
 * beliefs (everything except Bel_C1', which is introduced by the revision
 * envelope) are committed first; CE_0001 is then deterministically
 * detected and minted; the atomic Bel_C1 -> Bel_C1' revision commits last,
 * sharing one commit sequence with BT_0001 (design plan clarification 1).
 */
export function buildConflictScenario(): CommittedConflictScenario {
  let store = initConflictStore(claimRegistry)

  const baseBeliefEntries = conflictUniverse.filter(
    (entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief' && entry.record.id !== beliefC1Prime.id,
  )

  for (const entry of baseBeliefEntries) {
    const validFrom = beliefValidFrom.get(entry.record.id)
    if (validFrom === undefined) {
      throw new Error(`conflictScenario: missing validFrom for ${entry.record.id} -- fixture invariant broken`)
    }
    const committed = commitBelief(store, conflictUniverse, entry.record.id, validFrom)
    if (committed.outcome.verdict !== 'committed') {
      throw new Error(`conflictScenario: expected ${entry.record.id} to commit -- fixture invariant broken`)
    }
    store = committed.store
  }

  const minted = mintEdge(store, beliefC1.id, clawEvidence.id)
  if (minted.outcome.verdict !== 'minted') {
    throw new Error('conflictScenario: expected CE_0001 to mint -- fixture invariant broken')
  }
  store = minted.store
  const conflictEdge = minted.outcome.edge

  const revised = commitRevision(
    store,
    {
      toBeliefId: beliefC1Prime.id,
      validFrom: REVISION_VALID_FROM,
      transition: {
        transitionId: TRANSITION_ID,
        holder: 'NPC_C',
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
    throw new Error('conflictScenario: expected BT_0001 to commit -- fixture invariant broken')
  }

  return {
    store: revised.store,
    universe: conflictUniverse,
    conflictEdgeId: conflictEdge.edgeId,
    transitionId: revised.outcome.transition.transitionId,
  }
}

export { nightTick }
