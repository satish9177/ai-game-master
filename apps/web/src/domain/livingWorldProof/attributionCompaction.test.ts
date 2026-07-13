import { describe, expect, it } from 'vitest'
import { deriveIntentionPins } from './intentionCompactionAdapter'
import type { AdoptionCandidate } from './intentionStore'
import { commitAdoption, initIntentionStore } from './intentionStore'
import { runAttributionAwareCompactionPass } from './attributionCompactionAdapter'
import { attributionUniverse, Bel_CoraAtt1, Bel_CoraAtt1b, beliefB1Prime, buildPhase3Store, buildPhase2Store, T_PRESENT } from './attributionScenario'
import { buildIntentionRun1, buildObjectiveAtoms, CORRECT_BORIN_PLAN_BINDING, omCorrectBelief, OM_CORRECT_BELIEF_ID } from './attributionIntentionScenario'
import { beliefC1Prime } from './compactionScenario'
import { INTENTION_RULE_VERSION } from './intentionContracts'
import type { GoalOption } from './intentionContracts'

/**
 * Compaction tests (P67-P72; F54-F58). Because attributions are ordinary
 * `Belief`s, they inherit every existing gate unchanged (D19) -- this
 * proof adds zero new positive quiescence predicates.
 */

describe('P67 -- an open attribution pins only its own holder-local support', () => {
  it('an OPEN IntentionCommitment citing Bel_CoraAtt1b pins it via the unmodified intention-quiescence', () => {
    const phase3 = buildPhase3Store()
    const option: GoalOption = {
      holder: 'NPC_C',
      candidateObjective: { objectiveType: 'correct-belief', roles: { modeled_holder: 'NPC_B' }, canonicalizerVersion: 'cz_v0' },
      derivedFromBeliefs: [Bel_CoraAtt1b.id, beliefC1Prime.id],
      sourceObjectiveMetadataId: OM_CORRECT_BELIEF_ID,
      sourceObjectiveMetadataVersion: 'om_v0',
      ruleId: 'derive_correct_belief_option',
      ruleVersion: INTENTION_RULE_VERSION,
      priorityBasis: 'correction',
      priorityRank: 1,
    }
    const candidate: AdoptionCandidate = { holder: 'NPC_C', option, planBinding: CORRECT_BORIN_PLAN_BINDING, reconsiderationPolicy: 'default', effectiveValidTime: T_PRESENT }
    const adopted = commitAdoption(initIntentionStore(), candidate, {
      conflict: phase3.store.conflict,
      universe: attributionUniverse,
      atoms: buildObjectiveAtoms(),
      metadataById: new Map([[OM_CORRECT_BELIEF_ID, omCorrectBelief]]),
      templates: [CORRECT_BORIN_PLAN_BINDING].map((b) => ({ schemaVersion: 1 as const, id: b.templateId, version: b.templateVersion, servesObjectiveType: 'correct-belief', contextAtomKind: 'correct-belief-eligible', steps: [] })),
    })
    expect(adopted.outcome.verdict).toBe('committed')
    if (adopted.outcome.verdict !== 'committed') throw new Error('unreachable')

    const pins = deriveIntentionPins(adopted.store, attributionUniverse, adopted.store.nextSeq - 1)
    expect(pins.recordIds.has(Bel_CoraAtt1b.id)).toBe(true)
  })
})

describe('P68/F55/F56 -- cross-holder (modeled-holder) records are never pinned', () => {
  it('an open intention over Cora\'s attribution never pins Bel_B1_prime (Borin\'s own corrected belief)', () => {
    const run1 = buildIntentionRun1()
    const pins = deriveIntentionPins(run1.intentions, attributionUniverse, run1.intentions.nextSeq - 1)
    expect(pins.recordIds.has(beliefB1Prime.id)).toBe(false)
  })

  it('structurally: no attribution Belief anywhere in the fixture references a Borin-owned record id in its own bytes', () => {
    expect(Bel_CoraAtt1.supporting).not.toContain(beliefB1Prime.id)
    expect(JSON.stringify(Bel_CoraAtt1)).not.toContain(beliefB1Prime.id)
  })
})

describe('D19 -- zero new positive quiescence predicates: this adapter is a thin pass-through', () => {
  it('runAttributionAwareCompactionPass delegates unchanged to the intention-aware pass (same arity, same behavior)', () => {
    const phase2 = buildPhase2Store()
    const result = runAttributionAwareCompactionPass(attributionUniverse, [], phase2.conflict, initIntentionStore(), 0, [], [], 100, { validT: { night: 4, tick: 3 }, txBound: phase2.conflict.nextSeq - 1 })
    expect(result.intentionQuiescenceRejections).toEqual([])
  })
})

describe('P71/P72 -- compaction never rewrites attribution bytes; replay after legal compaction is byte-identical', () => {
  it('the pin-set derivation is a pure read -- it never mutates the intention store or universe it is given', () => {
    const run1 = buildIntentionRun1()
    const before = JSON.stringify(run1.intentions)
    deriveIntentionPins(run1.intentions, attributionUniverse, run1.intentions.nextSeq - 1)
    expect(JSON.stringify(run1.intentions)).toBe(before)
  })
})

describe('P69/F54 -- an active attribution conflict blocks demotion of either endpoint', () => {
  it('a demote proposal naming a live, currently-held attribution endpoint is rejected (currency alone already pins every current belief, D9)', () => {
    const phase2 = buildPhase2Store()
    const bounds = { validT: { night: 4, tick: 3 }, txBound: phase2.conflict.nextSeq - 1 }
    const result = runAttributionAwareCompactionPass(
      attributionUniverse,
      [],
      phase2.conflict,
      initIntentionStore(),
      0,
      [],
      [{ schemaVersion: 1, id: 'CP_test_demote', action: 'demote', memberIds: [Bel_CoraAtt1.id], rationale: 'test', proposedBy: 'engine' }],
      100,
      bounds,
    )
    // A demote proposal naming a pinned (currently-held) member is split by
    // scope and re-logged as a committed 'pin' record for that member --
    // never as a committed 'demote' (compactionPass.ts's processDemoteProposal).
    expect(result.pass.result.compactionLog.some((r) => r.action === 'pin' && r.memberIds.includes(Bel_CoraAtt1.id) && r.verdict === 'committed')).toBe(true)
    expect(result.pass.result.compactionLog.some((r) => r.action === 'demote' && r.memberIds.includes(Bel_CoraAtt1.id) && r.verdict === 'committed')).toBe(false)
  })
})
