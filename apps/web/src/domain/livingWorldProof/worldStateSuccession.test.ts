import { describe, expect, it } from 'vitest'
import { canonicalHash } from './canonicalSerialization'
import { detectConflict, latestValidStateClaim, worldStateClaimToCanonicalClaim } from './canonicalProposition'
import { deriveContradictionEdges } from './conflictCompactionAdapter'
import { buildConflictScenario, doorClosedClaim, doorOpenClaim, doorStateClaims, nightTick } from './conflictScenario'
import { commitTransition } from './conflictStore'
import { CONFLICT_CANONICALIZER_VERSION, TRANSITION_RULE_VERSION } from './conflictContracts'

/**
 * Ordinary world-state succession is not contradiction (ADR-0008 D5, spec
 * conflict-edge-replay-v0.md N1). WS_door_open/WS_door_closed are proof-
 * local WorldStateClaims -- never added to the ReadableRecord union, so
 * readable()/the gates/index maps/digests/navigation are provably
 * untouched by this pair.
 */

describe('N1 -- door-open@T1 / door-closed@T2 mint no ConflictEdge and no BeliefTransition', () => {
  it('detectConflict over the derived effective periods finds no overlap', () => {
    const openClaim = worldStateClaimToCanonicalClaim(doorOpenClaim, doorStateClaims)
    const closedClaim = worldStateClaimToCanonicalClaim(doorClosedClaim, doorStateClaims)
    const outcome = detectConflict(openClaim, closedClaim)
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('no-valid-time-overlap')
  })

  it('a transition candidate naming door claims as endpoints is rejected -- doors are never Belief records', () => {
    const scenario = buildConflictScenario()
    const result = commitTransition(
      scenario.store,
      {
        transitionId: 'BT_door_attempt',
        holder: 'ENGINE',
        fromBeliefId: doorOpenClaim.recordId,
        toBeliefId: doorClosedClaim.recordId,
        effectiveValidTime: nightTick('night_2'),
        cause: 'superseded-by-update',
        ruleId: 'world_state_succession',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      scenario.universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'missing-transition-endpoint' })
  })

  it("the first record's bytes/hash are unchanged -- no interval close is ever written", () => {
    const hashBefore = canonicalHash(doorOpenClaim)
    // Deriving the effective period and running detection does not mutate the claim.
    worldStateClaimToCanonicalClaim(doorOpenClaim, doorStateClaims)
    expect(canonicalHash(doorOpenClaim)).toBe(hashBefore)
  })

  it('latest-valid-claim projection returns open before T2 and closed from T2 onward (derived, ADR-0008 D5)', () => {
    expect(latestValidStateClaim('cellar_door', doorStateClaims, nightTick('night_1', 5))?.state).toBe('open')
    expect(latestValidStateClaim('cellar_door', doorStateClaims, doorClosedClaim.from)?.state).toBe('closed')
    expect(latestValidStateClaim('cellar_door', doorStateClaims, nightTick('night_10'))?.state).toBe('closed')
  })

  it('compaction is not blocked by a conflict relation -- no derived edge ever references the door claims', () => {
    const scenario = buildConflictScenario()
    const bounds = { validT: nightTick('night_10'), txBound: scenario.store.nextSeq }
    const derived = deriveContradictionEdges(scenario.store, scenario.universe, bounds)
    const doorReferencing = derived.filter(
      (edge) => edge.from === doorOpenClaim.recordId || edge.to === doorOpenClaim.recordId || edge.from === doorClosedClaim.recordId || edge.to === doorClosedClaim.recordId,
    )
    expect(doorReferencing).toHaveLength(0)
  })
})
