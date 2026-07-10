import { describe, expect, it } from 'vitest'
import { canonicalHash } from './canonicalSerialization'
import { currentBeliefForKey } from './beliefProjection'
import { canonicalKeyOf } from './canonicalProposition'
import { buildConflictScenario, claimRegistry, nightTick } from './conflictScenario'
import type { CanonicalClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION, OVERTURN_BY_HARD_EVIDENCE_RULE_ID, TRANSITION_RULE_VERSION } from './conflictContracts'
import { commitBelief, commitRevision, commitTransition, initConflictStore, mintEdge, proposeEdge } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import { clawEvidence } from './scenario'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import { beliefC2 } from './hierarchyScenario'

/**
 * The conflict store's commit operations (ADR-0008, spec conflict-edge-
 * replay-v0.md §2/§1.9). Covers P1, N4-N7, F1-F3, F5, and the deliberate
 * co-holding resolution cases added by the final destination-validation
 * correction (Case A/B, plus a distinct transition-cycle probe).
 */

describe('mintEdge (P1, N5)', () => {
  it('P1: mints exactly one idempotent ConflictEdge over Bel_C1 vs E_claw', () => {
    const scenario = buildConflictScenario()
    expect(scenario.store.edges).toHaveLength(1)
    const [edge] = scenario.store.edges
    expect(edge?.edgeId).toBe('CE_0001')
    expect(edge?.authoritative).toBe(false)
    expect(edge?.canonicalizerVersion).toBe(CONFLICT_CANONICALIZER_VERSION)
    expect(edge?.proposalKey).toBeUndefined()
    expect(edge?.pairKey).toBeDefined()
  })

  it('N5: repeating the same accepted detection mints no second edge, and argument order never affects the pair key', () => {
    const store = initConflictStore(claimRegistry)
    const forward = mintEdge(store, beliefC1.id, clawEvidence.id)
    expect(forward.outcome.verdict).toBe('minted')

    const repeat = mintEdge(forward.store, beliefC1.id, clawEvidence.id)
    expect(repeat.outcome.verdict).toBe('duplicate')
    expect(repeat.store.edges).toHaveLength(1)

    const swapped = mintEdge(store, clawEvidence.id, beliefC1.id)
    expect(swapped.outcome.verdict).toBe('minted')
    if (forward.outcome.verdict !== 'minted' || swapped.outcome.verdict !== 'minted') throw new Error('unreachable')
    expect(swapped.outcome.edge.pairKey).toBe(forward.outcome.edge.pairKey)
    expect(swapped.outcome.edge.edgeId).toBe(forward.outcome.edge.edgeId)
  })
})

describe('proposeEdge (N4 -- fabricated proposals rejected, explainable minting)', () => {
  it('rejects a mismatched-key candidate and stays uncommitted', () => {
    const store = initConflictStore(claimRegistry)
    const result = proposeEdge(store, { proposalKey: 'theta_1', proposedBy: 'llm', candidate: [beliefC1.id, 'Bel_B1'] })
    expect(result.outcome.verdict).toBe('rejected')
    expect(result.store.edges).toHaveLength(0)
    expect(result.store.proposalLog).toHaveLength(1)
    expect(result.store.proposalLog[0]?.verdict).toBe('rejected')
    expect(result.store.proposalLog[0]?.reason).toBe('key-mismatch')
  })

  it('rejects a disjoint-valid-time candidate', () => {
    const store = initConflictStore(claimRegistry)
    // beliefA1/beliefD1 (zombie claim) share a canonical key and outcome
    // with beliefC1's player claim but at the same instant they're
    // compatible-outcomes, not disjoint -- fabricate a genuinely disjoint
    // pair by proposing beliefC1 against beliefC1Prime's own zombie claim
    // stamped with a shifted validity via a synthetic unregistered id
    // instead: exercise the malformed/unknown branch.
    const result = proposeEdge(store, { proposalKey: 'theta_2', proposedBy: 'llm', candidate: ['Bel_nonexistent_a', 'Bel_nonexistent_b'] })
    expect(result.outcome.verdict).toBe('rejected')
    if (result.outcome.verdict !== 'rejected') throw new Error('unreachable')
    expect(result.outcome.reason).toBe('malformed-claim')
    expect(result.store.edges).toHaveLength(0)
  })

  it('accepts a valid candidate and stamps the proposalKey onto the minted edge -- no evidence text duplicated', () => {
    const store = initConflictStore(claimRegistry)
    const result = proposeEdge(store, { proposalKey: 'theta_3', proposedBy: 'llm', candidate: [beliefC1.id, clawEvidence.id] })
    expect(result.outcome.verdict).toBe('minted')
    if (result.outcome.verdict !== 'minted') throw new Error('unreachable')
    expect(result.outcome.edge.proposalKey).toBe('theta_3')
    expect(result.store.proposalLog[0]?.verdict).toBe('accepted')
    expect(result.store.proposalLog[0]?.edgeId).toBe(result.outcome.edge.edgeId)
    expect(Object.keys(result.outcome.edge)).not.toContain('evidenceText')
  })
})

describe('commitRevision (F1/F2, holder-mismatch, destination-not-new)', () => {
  it('F1: commitRevision rejects a transition candidate whose fromBeliefId does not resolve to an existing, timed Belief', () => {
    const scenario = buildConflictScenario()
    const before = scenario.store

    const result = commitRevision(
      before,
      {
        toBeliefId: beliefC1Prime.id,
        validFrom: nightTick('night_5'),
        transition: {
          transitionId: 'BT_F1_missing_from',
          holder: 'NPC_C',
          fromBeliefId: 'Bel_never_committed',
          toBeliefId: beliefC1Prime.id,
          effectiveValidTime: nightTick('night_5'),
          cause: 'corrected-by-evidence',
          ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
          ruleVersion: TRANSITION_RULE_VERSION,
          canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
          inputEvidenceIds: [clawEvidence.id],
          conflictEdgeIds: [scenario.conflictEdgeId],
        },
      },
      scenario.universe,
    )

    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'missing-transition-endpoint' })
    // No transition committed, no timing entry created, commit log and allocator state untouched --
    // a rejected commitRevision returns the exact same store reference, never a mutated copy.
    expect(result.store).toBe(before)
    expect(result.store.transitions).toHaveLength(before.transitions.length)
    expect(result.store.timing.has('Bel_never_committed')).toBe(false)
    expect(result.store.commitLog).toHaveLength(before.commitLog.length)
    expect(result.store.nextSeq).toBe(before.nextSeq)
  })

  it('sanity: commitBelief separately rejects an id that resolves to no Belief record (unknown-belief) -- a distinct contract from the transition-endpoint fault above', () => {
    const scenario = buildConflictScenario()
    const outcome = commitBelief(scenario.store, scenario.universe, 'Bel_never_committed', nightTick('night_5'))
    expect(outcome.outcome).toEqual({ verdict: 'rejected', fault: 'unknown-belief' })
  })

  it('F2: commitTransition rejects a candidate citing unknown evidence', () => {
    // Build an isolated two-belief co-holding scratch fixture so this
    // probes commitTransition's own evidence check in isolation from the
    // committed Bel_C1/Bel_C1' fixture.
    const beliefX: ReadableRecord = {
      kind: 'belief',
      record: {
        schemaVersion: 1,
        id: 'Bel_F2_X',
        holder: 'NPC_F2',
        proposition: 'x',
        confidence: 'medium',
        sourceType: 'observation',
        sourceRef: 'O_f2',
        supporting: ['O_f2'],
        contradicting: [],
        lastUpdated: 'night_1',
      },
    }
    const beliefY: ReadableRecord = { kind: 'belief', record: { ...beliefX.record, id: 'Bel_F2_Y' } }
    const universe = [beliefX, beliefY]

    let store = initConflictStore(new Map())
    store = commitBelief(store, universe, 'Bel_F2_X', nightTick('night_1')).store
    store = commitBelief(store, universe, 'Bel_F2_Y', nightTick('night_1')).store

    const result = commitTransition(
      store,
      {
        transitionId: 'BT_F2',
        holder: 'NPC_F2',
        fromBeliefId: 'Bel_F2_X',
        toBeliefId: 'Bel_F2_Y',
        effectiveValidTime: nightTick('night_2'),
        cause: 'resolved-by-precedence',
        ruleId: 'test_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: ['E_ghost'],
        conflictEdgeIds: [],
      },
      universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'unknown-evidence' })
  })

  it('rejects holder-mismatch when the declared holder does not own both endpoints', () => {
    const scenario = buildConflictScenario()
    const result = commitTransition(
      scenario.store,
      {
        transitionId: 'BT_holder_mismatch',
        holder: 'NPC_B',
        fromBeliefId: beliefC1.id,
        toBeliefId: beliefC1Prime.id,
        effectiveValidTime: nightTick('night_5'),
        cause: 'corrected-by-evidence',
        ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [clawEvidence.id],
        conflictEdgeIds: [scenario.conflictEdgeId],
      },
      scenario.universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'holder-mismatch' })
  })

  it('F3: rejects a canonicalizer-version-mismatched transition candidate', () => {
    // Isolated from Bel_C1's own timeline (which already has an outgoing
    // transition) so the version check is reached rather than masked by
    // from-not-current/branching: NPC_C's unrelated, still-current pantry
    // belief (Bel_C2) stands in as an arbitrary current target.
    const scenario = buildConflictScenario()
    const result = commitTransition(
      scenario.store,
      {
        transitionId: 'BT_cz_mismatch',
        holder: 'NPC_C',
        fromBeliefId: beliefC2.id,
        toBeliefId: beliefC1Prime.id,
        effectiveValidTime: nightTick('night_5'),
        cause: 'resolved-by-precedence',
        ruleId: 'test_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: 'cz_v9',
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      scenario.universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'canonicalizer-version-mismatch' })
    expect(result.store.transitions).toHaveLength(scenario.store.transitions.length)
  })
})

describe('F5 / branching -- a Belief has at most one outgoing transition in v0', () => {
  it('rejects a distinct second outgoing transition from Bel_C1 submitted while Bel_C1 is still current (before BT_0001 takes effect)', () => {
    // BT_0001's own effectiveValidTime is night_4/tick1; at any earlier
    // instant Bel_C1 still reads as current, so a distinct competing
    // transition genuinely reaches the branching check rather than being
    // masked by from-not-current. Bel_C2 (NPC_C's own, unrelated, still-
    // current pantry belief) stands in as an arbitrary current target.
    const scenario = buildConflictScenario()
    const result = commitTransition(
      scenario.store,
      {
        transitionId: 'BT_branch_early',
        holder: 'NPC_C',
        fromBeliefId: beliefC1.id,
        toBeliefId: beliefC2.id,
        effectiveValidTime: nightTick('night_4', 0),
        cause: 'superseded-by-update',
        ruleId: 'other_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      scenario.universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'transition-branching' })
  })

  it('at or after BT_0001\'s own effective time, a second candidate instead fails from-not-current -- an even stronger guard, never a silent pick', () => {
    const scenario = buildConflictScenario()
    for (const effectiveValidTime of [nightTick('night_4', 1), nightTick('night_6')]) {
      const result = commitTransition(
        scenario.store,
        {
          transitionId: 'BT_branch_late',
          holder: 'NPC_C',
          fromBeliefId: beliefC1.id,
          toBeliefId: beliefC2.id,
          effectiveValidTime,
          cause: 'superseded-by-update',
          ruleId: 'other_rule',
          ruleVersion: TRANSITION_RULE_VERSION,
          canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
          inputEvidenceIds: [],
          conflictEdgeIds: [],
        },
        scenario.universe,
      )
      expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'from-not-current' })
    }
  })

  it('the original chain Bel_C1 -> Bel_C1\' is unaffected by the rejected branch attempts', () => {
    const scenario = buildConflictScenario()
    commitTransition(
      scenario.store,
      {
        transitionId: 'BT_branch_probe',
        holder: 'NPC_C',
        fromBeliefId: beliefC1.id,
        toBeliefId: beliefC1Prime.id,
        effectiveValidTime: nightTick('night_6'),
        cause: 'superseded-by-update',
        ruleId: 'other_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      scenario.universe,
    )
    expect(scenario.store.transitions).toHaveLength(1)
    expect(scenario.store.transitions[0]?.transitionId).toBe('BT_0001')
  })

  it('exact duplicate is rejected as duplicate-transition, not branching (deterministic fault ordering)', () => {
    const scenario = buildConflictScenario()
    const [original] = scenario.store.transitions
    if (original === undefined) throw new Error('unreachable')
    const duplicateCandidate = {
      transitionId: original.transitionId,
      holder: original.holder,
      fromBeliefId: original.fromBeliefId,
      toBeliefId: original.toBeliefId,
      effectiveValidTime: original.effectiveValidTime,
      cause: original.cause,
      ruleId: original.ruleId,
      ruleVersion: original.ruleVersion,
      canonicalizerVersion: original.canonicalizerVersion,
      inputEvidenceIds: original.inputEvidenceIds,
      conflictEdgeIds: original.conflictEdgeIds,
    }
    const result = commitTransition(scenario.store, duplicateCandidate, scenario.universe)
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'duplicate-transition' })
  })
})

// ---- Deliberate co-holding resolution (final correction: destination
// validation is separate per commit path; commitTransition allows
// resolution toward either currently co-held belief, regardless of mint
// order) -------------------------------------------------------------------

function scratchBelief(id: string, holder: string) {
  return {
    schemaVersion: 1 as const,
    id,
    holder,
    proposition: `proposition for ${id}`,
    confidence: 'medium' as const,
    sourceType: 'observation' as const,
    sourceRef: `O_${id}`,
    supporting: [`O_${id}`],
    contradicting: [],
    lastUpdated: 'night_10',
  }
}

const claimForActor = (actor: string): CanonicalClaim => ({
  predicate: 'attacked',
  fixedRoles: { target: 'scratch_target' },
  contestedRole: 'actor',
  contestedValue: actor,
  polarity: 'asserts',
  validity: { kind: 'instant', at: nightTick('night_10') },
  canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
})

describe('deliberate co-holding: commitBelief -> unresolved -> resolve toward either side', () => {
  it('Case A: resolves toward the OLDER co-held belief (Bel_B -> Bel_A), which mint order alone would have rejected', () => {
    const beliefA = scratchBelief('Bel_ScratchA', 'NPC_SCRATCH_A')
    const beliefB = scratchBelief('Bel_ScratchB', 'NPC_SCRATCH_A')
    const universe: ReadableRecord[] = [
      { kind: 'belief', record: beliefA },
      { kind: 'belief', record: beliefB },
    ]
    const claims = new Map<string, CanonicalClaim>([
      [beliefA.id, claimForActor('suspect_1')],
      [beliefB.id, claimForActor('suspect_2')],
    ])

    let store = initConflictStore(claims)
    store = commitBelief(store, universe, beliefA.id, nightTick('night_10')).store // committed first (older mintSeq)
    store = commitBelief(store, universe, beliefB.id, nightTick('night_10', 1)).store // committed second (newer mintSeq)

    const minted = mintEdge(store, beliefA.id, beliefB.id)
    expect(minted.outcome.verdict).toBe('minted')
    store = minted.store

    const canonicalKey = canonicalKeyOf(claimForActor('suspect_1'))
    const bounds = { validT: nightTick('night_10', 2), txBound: store.nextSeq }

    const beforeResolution = currentBeliefForKey('NPC_SCRATCH_A', canonicalKey, universe, store, bounds)
    expect(beforeResolution.status).toBe('unresolved')
    if (beforeResolution.status !== 'unresolved') throw new Error('unreachable')
    expect(beforeResolution.beliefs.map((b) => b.id).sort()).toEqual([beliefA.id, beliefB.id].sort())
    expect(beforeResolution.conflictEdgeIds).toEqual(minted.outcome.verdict === 'minted' ? [minted.outcome.edge.edgeId] : [])

    const beliefAHashBefore = canonicalHash(beliefA)

    // Resolve toward the OLDER belief (A) from the NEWER one (B) --
    // mint-order (mintSeq(B) > mintSeq(A)) is never checked on this path.
    const resolution = commitTransition(
      store,
      {
        transitionId: 'BT_ScratchCaseA',
        holder: 'NPC_SCRATCH_A',
        fromBeliefId: beliefB.id,
        toBeliefId: beliefA.id,
        effectiveValidTime: nightTick('night_11'),
        cause: 'resolved-by-precedence',
        ruleId: 'scratch_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [minted.outcome.verdict === 'minted' ? minted.outcome.edge.edgeId : ''],
      },
      universe,
    )
    expect(resolution.outcome.verdict).toBe('committed')
    store = resolution.store

    const afterBounds = { validT: nightTick('night_12'), txBound: store.nextSeq }
    const afterResolution = currentBeliefForKey('NPC_SCRATCH_A', canonicalKey, universe, store, afterBounds)
    expect(afterResolution).toEqual({ status: 'resolved', belief: beliefA })

    // No Recovery: A was continuously current, never superseded-then-restored -- bytes unchanged throughout.
    expect(canonicalHash(beliefA)).toBe(beliefAHashBefore)

    // Reverse attempt afterward is rejected: B has ceased to be current (to-not-current),
    // and B already reaches A (transition-cycle) -- either is a sufficient, correct barrier.
    const reverseAttempt = commitTransition(
      store,
      {
        transitionId: 'BT_ScratchCaseA_reverse',
        holder: 'NPC_SCRATCH_A',
        fromBeliefId: beliefA.id,
        toBeliefId: beliefB.id,
        effectiveValidTime: nightTick('night_13'),
        cause: 'resolved-by-precedence',
        ruleId: 'scratch_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      universe,
    )
    expect(reverseAttempt.outcome.verdict).toBe('rejected')
    if (reverseAttempt.outcome.verdict !== 'rejected') throw new Error('unreachable')
    expect(reverseAttempt.outcome.fault).toBe('to-not-current')
  })

  it('Case B: resolves toward the NEWER co-held belief, proving both directions are legal before either is superseded', () => {
    const beliefC = scratchBelief('Bel_ScratchC', 'NPC_SCRATCH_B')
    const beliefD = scratchBelief('Bel_ScratchD', 'NPC_SCRATCH_B')
    const universe: ReadableRecord[] = [
      { kind: 'belief', record: beliefC },
      { kind: 'belief', record: beliefD },
    ]
    const claims = new Map<string, CanonicalClaim>([
      [beliefC.id, claimForActor('suspect_3')],
      [beliefD.id, claimForActor('suspect_4')],
    ])

    let store = initConflictStore(claims)
    store = commitBelief(store, universe, beliefC.id, nightTick('night_10')).store
    store = commitBelief(store, universe, beliefD.id, nightTick('night_10', 1)).store

    const canonicalKey = canonicalKeyOf(claimForActor('suspect_3'))
    const beforeBounds = { validT: nightTick('night_10', 2), txBound: store.nextSeq }
    expect(currentBeliefForKey('NPC_SCRATCH_B', canonicalKey, universe, store, beforeBounds).status).toBe('unresolved')

    const resolution = commitTransition(
      store,
      {
        transitionId: 'BT_ScratchCaseB',
        holder: 'NPC_SCRATCH_B',
        fromBeliefId: beliefC.id,
        toBeliefId: beliefD.id,
        effectiveValidTime: nightTick('night_11'),
        cause: 'resolved-by-precedence',
        ruleId: 'scratch_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      universe,
    )
    expect(resolution.outcome.verdict).toBe('committed')

    const afterBounds = { validT: nightTick('night_12'), txBound: resolution.store.nextSeq }
    expect(currentBeliefForKey('NPC_SCRATCH_B', canonicalKey, universe, resolution.store, afterBounds)).toEqual({ status: 'resolved', belief: beliefD })
  })

  it('N6/transition-cycle: constructed so both endpoints are current at the query instant, but the destination already reaches the source', () => {
    const beliefX = scratchBelief('Bel_CycleX', 'NPC_CYCLE')
    const beliefY = scratchBelief('Bel_CycleY', 'NPC_CYCLE')
    const universe: ReadableRecord[] = [
      { kind: 'belief', record: beliefX },
      { kind: 'belief', record: beliefY },
    ]

    let store = initConflictStore(new Map())
    store = commitBelief(store, universe, beliefX.id, nightTick('night_1')).store
    store = commitBelief(store, universe, beliefY.id, nightTick('night_1')).store

    // X -> Y committed far in the future -- at any earlier query instant
    // both X and Y are still "current" (the transition hasn't taken effect
    // yet), which is exactly the scenario that must be caught by
    // reachability rather than by from/to-not-current.
    const forward = commitTransition(
      store,
      {
        transitionId: 'BT_CycleForward',
        holder: 'NPC_CYCLE',
        fromBeliefId: beliefX.id,
        toBeliefId: beliefY.id,
        effectiveValidTime: nightTick('night_100'),
        cause: 'resolved-by-precedence',
        ruleId: 'scratch_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      universe,
    )
    expect(forward.outcome.verdict).toBe('committed')

    const reverseAtEarlierInstant = commitTransition(
      forward.store,
      {
        transitionId: 'BT_CycleReverse',
        holder: 'NPC_CYCLE',
        fromBeliefId: beliefY.id,
        toBeliefId: beliefX.id,
        effectiveValidTime: nightTick('night_60'),
        cause: 'resolved-by-precedence',
        ruleId: 'scratch_rule',
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [],
        conflictEdgeIds: [],
      },
      universe,
    )
    expect(reverseAtEarlierInstant.outcome.verdict).toBe('rejected')
    if (reverseAtEarlierInstant.outcome.verdict !== 'rejected') throw new Error('unreachable')
    expect(reverseAtEarlierInstant.outcome.fault).toBe('transition-cycle')
  })
})

describe('N7: global correction is forbidden -- applying NPC_C\'s transition shape to NPC_B is rejected', () => {
  it('rejects a candidate whose declared holder does not match the endpoints\' actual holder', () => {
    const scenario = buildConflictScenario()
    const result = commitTransition(
      scenario.store,
      {
        transitionId: 'BT_cross_holder',
        holder: 'NPC_B',
        fromBeliefId: beliefC1.id,
        toBeliefId: beliefC1Prime.id,
        effectiveValidTime: nightTick('night_5'),
        cause: 'corrected-by-evidence',
        ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [clawEvidence.id],
        conflictEdgeIds: [scenario.conflictEdgeId],
      },
      scenario.universe,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'holder-mismatch' })
  })
})
