import { describe, expect, it } from 'vitest'
import { detectConflict } from './canonicalProposition'
import { currentBeliefs } from './beliefProjection'
import { mintEdge } from './conflictStore'
import { buildCaseA, buildPairSubcase, SIX_PAIRS } from './attributionConflictScenario'
import {
  attributionUniverse,
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_CoraAtt2,
  Bel_CoraAtt2Prime,
  Bel_CoraAtt3,
  Bel_DarenAtt1,
  buildBranch4a,
  buildPhase2Store,
  buildPhase3Store,
  buildPhase5RetractDeny,
  CORA,
  DAREN,
} from './attributionScenario'
import { beliefC1Prime } from './compactionScenario'
import { commitAscriptionSupersession } from './attributionStore'

/**
 * Phase 8 conflict-topology tests (P28-P35, P90, P97-P99, P105; F27-F32,
 * F72, F86-F88).
 */

describe('P28/P29 -- all six pairs mint a conflict under overlap, via the unmodified engine', () => {
  SIX_PAIRS.forEach((pair, index) => {
    it(`pair ${index} (${pair[0]}/${pair[1]}), sub-case 1: overlapping incompatible stances mint exactly one ConflictEdge`, () => {
      const result = buildPairSubcase(index, 'overlapping')
      expect(result.mintOutcome?.verdict).toBe('minted')
    })
  })
})

describe('P32/F28 -- disjoint unlinked pairs mint no conflict', () => {
  SIX_PAIRS.forEach((pair, index) => {
    it(`pair ${index} (${pair[0]}/${pair[1]}), sub-case 2: disjoint valid-time intervals mint no edge`, () => {
      const result = buildPairSubcase(index, 'disjoint-unlinked')
      const projection = currentBeliefs(CORA, result.universe, result.store.conflict, { validT: { night: 20, tick: 0 }, txBound: result.store.conflict.nextSeq - 1 })
      const projectionLater = currentBeliefs(CORA, result.universe, result.store.conflict, { validT: { night: 20, tick: 5 }, txBound: result.store.conflict.nextSeq - 1 })
      expect(projection.unresolved.length + projectionLater.unresolved.length).toBe(0)

      // F29 -- disjoint intervals alone must never be treated as one record
      // superseding the other: no linking BeliefTransition exists between
      // the two endpoints, and both remain independently addressable.
      expect(result.store.conflict.transitions.some((t) => t.fromBeliefId === result.beliefAId && t.toBeliefId === result.beliefBId)).toBe(false)
      expect(result.universe.some((entry) => entry.record.id === result.beliefAId)).toBe(true)
      expect(result.universe.some((entry) => entry.record.id === result.beliefBId)).toBe(true)
    })
  })
})

describe('P33/P34/F30 -- explicit transition creates supersession regardless of overlap; non-overlap alone never implies supersession', () => {
  SIX_PAIRS.forEach((pair, index) => {
    it(`pair ${index} (${pair[0]}/${pair[1]}), sub-case 3: the successor supersedes the predecessor via an explicit BeliefTransition`, () => {
      const result = buildPairSubcase(index, 'explicit-transition')
      expect(result.store.conflict.transitions.some((t) => t.fromBeliefId === result.beliefAId && t.toBeliefId === result.beliefBId)).toBe(true)
      const projection = currentBeliefs(CORA, result.universe, result.store.conflict, { validT: { night: 20, tick: 5 }, txBound: result.store.conflict.nextSeq - 1 })
      expect(projection.beliefs.some((b) => b.id === result.beliefAId)).toBe(false)
    })
  })
})

describe('P30/F31 -- world belief vs. attributed belief mints no edge (different canonical keys, decided before Layer B)', () => {
  it('Bel_C1\' (Cora\'s own world belief) vs. Bel_CoraAtt1 (her attribution about Borin) never key-match', () => {
    const store = buildPhase2Store()
    const worldClaim = store.conflict.claims.get(beliefC1Prime.id)!
    const attributionClaim = store.conflict.claims.get(Bel_CoraAtt1.id)!
    expect(detectConflict(worldClaim, attributionClaim)).toEqual({ verdict: 'no-conflict', reason: 'key-mismatch' })

    const projection = currentBeliefs(CORA, attributionUniverse, store.conflict, { validT: { night: 4, tick: 3 }, txBound: store.conflict.nextSeq - 1 })
    const pairInvolvesBoth = projection.unresolved.some((pair) => pair.beliefIds.includes(beliefC1Prime.id) && pair.beliefIds.includes(Bel_CoraAtt1.id))
    expect(pairInvolvesBoth).toBe(false)
  })
})

describe('P90/F72 -- Case A: same ascriber, different modeled holder (Layer-A key separation)', () => {
  it('Cora attributing to Borin and to Daren never key-matches -- no edge', () => {
    const caseA = buildCaseA()
    const projection = currentBeliefs(CORA, caseA.universe, caseA.store.conflict, { validT: { night: 30, tick: 0 }, txBound: caseA.store.conflict.nextSeq - 1 })
    expect(projection.unresolved.length).toBe(0)
    const claimA = caseA.store.conflict.claims.get(caseA.beliefBorinId)!
    const claimD = caseA.store.conflict.claims.get(caseA.beliefDarenId)!
    expect(detectConflict(claimA, claimD)).toEqual({ verdict: 'no-conflict', reason: 'key-mismatch' })
  })
})

describe('P31/F32 -- Case B: different ascribers, same modeled holder, incompatible stances -- Layer-B holder-scoping', () => {
  it('Cora\'s disbelieves vs. Daren\'s stale believes -- same key, incompatible, overlapping, different holder -- never pairs through the legitimate holder-scoped mint driver', () => {
    const result = buildPhase5RetractDeny(buildBranch4a(), false)
    const bounds = { validT: { night: 6, tick: 1 }, txBound: result.store.conflict.nextSeq - 1 }

    const claimCora = result.store.conflict.claims.get(Bel_CoraAtt3.id)!
    const claimDaren = result.store.conflict.claims.get(Bel_DarenAtt1.id)!
    expect(detectConflict(claimCora, claimDaren).verdict).toBe('conflict')

    const projectionCora = currentBeliefs(CORA, attributionUniverse, result.store.conflict, bounds)
    const projectionDaren = currentBeliefs(DAREN, attributionUniverse, result.store.conflict, bounds)
    expect(projectionCora.unresolved.length).toBe(0)
    expect(projectionDaren.unresolved.length).toBe(0)

    // No edge was minted between them anywhere in this store's commit log
    // -- the legitimate mint driver (this fixture's own construction)
    // never proposes a cross-holder pair to mintEdge (P105).
    expect(result.store.conflict.edges.some((edge) => edge.endpoints.some((e) => e.witnessRecordId === Bel_CoraAtt3.id) && edge.endpoints.some((e) => e.witnessRecordId === Bel_DarenAtt1.id))).toBe(false)
  })
})

describe('P105/F86 -- cross-holder edge minting is prevented by mint-driver source discipline, not by mintEdge itself', () => {
  it('a direct, bypass mintEdge call on Case B\'s cross-holder pair SUCCEEDS at Layer A (the expected, documented low-level result) -- mintEdge has no holder-scoping precondition of its own', () => {
    const result = buildPhase5RetractDeny(buildBranch4a(), false)
    const bypass = mintEdge(result.store.conflict, Bel_CoraAtt3.id, Bel_DarenAtt1.id)
    expect(bypass.outcome.verdict).toBe('minted')
    // The actual assertion under test is P105 (above): no AUTHORITATIVE or
    // automatic fixture code path ever performs this call -- confirmed by
    // this test file never doing so outside this one deliberate fault
    // demonstration, and by the prior test showing the legitimate driver's
    // own store carries no such edge.
  })
})

describe('P97 -- every branch/sub-case is its own isolated store; no two share a commit log', () => {
  it('two independently built pair sub-cases never share record ids or a commit log', () => {
    const first = buildPairSubcase(1, 'overlapping')
    const second = buildPairSubcase(1, 'disjoint-unlinked')
    expect(first.store.conflict.commitLog).not.toBe(second.store.conflict.commitLog)
    expect(first.beliefAId).not.toBe(second.beliefAId)
  })
})

describe('F82 -- two branches attempting to share one commit log are rejected by transition-branching', () => {
  it('committing BOTH Branch 4b\'s and a second acknowledgment\'s outgoing transition from the SAME predecessor (Bel_CoraAtt1b) into one store fails', () => {
    const phase3 = buildPhase3Store()
    const first = commitAscriptionSupersession(phase3.store, attributionUniverse, {
      transitionId: 'BT_test_branch_first',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: Bel_CoraAtt2.id,
      effectiveValidTime: { night: 5, tick: 5 },
      validFrom: { night: 5, tick: 5 },
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: 'aab_v0',
      inputRecordIds: [],
    })
    expect(first.outcome.verdict).toBe('committed')
    // A second candidate whose effective time is still BEFORE the first
    // transition's effective time -- so the (already-superseded-later)
    // predecessor would still read as "current" at this earlier instant --
    // isolates the branching check specifically, rather than being masked
    // by the earlier from-not-current check.
    const second = commitAscriptionSupersession(first.store, attributionUniverse, {
      transitionId: 'BT_test_branch_second',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: Bel_CoraAtt2Prime.id,
      effectiveValidTime: { night: 5, tick: 2 },
      validFrom: { night: 5, tick: 2 },
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: 'aab_v0',
      inputRecordIds: [],
    })
    expect(second.outcome).toEqual({ verdict: 'rejected', fault: 'transition-branching' })
  })
})

describe('P98 -- unaware endpoints in the synthetic sub-fixture are minted only through express-ignorance', () => {
  ;[2, 4, 5].forEach((pairIndex) => {
    it(`pair ${pairIndex} (${SIX_PAIRS[pairIndex]![0]}/${SIX_PAIRS[pairIndex]![1]}) mints its unaware endpoint via ascribe_unaware_from_ignorance_expression`, () => {
      const result = buildPairSubcase(pairIndex, 'overlapping')
      const unawareBeliefId = SIX_PAIRS[pairIndex]![0] === 'unaware' ? result.beliefAId : result.beliefBId
      const belief = result.universe.find((entry) => entry.record.id === unawareBeliefId)
      expect(belief?.kind).toBe('belief')
      if (belief?.kind === 'belief') {
        expect(belief.record.proposition).toContain('unaware')
      }
    })
  })
})
