import { describe, expect, it } from 'vitest'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { CompactionProposal } from './compactionContracts'
import { compactionConsequences, compactionArcs } from './compactionScenario'
import { beliefC1DoublePrime, intentionUniverse, runScenario2 } from './intentionScenario'
import { deriveIntentionPins, runIntentionAwareCompactionPass } from './intentionCompactionAdapter'
import { intentionTxBound } from './intentionStore'
import { cellarWatchEvidence } from './intentionScenario'

/**
 * Compaction interaction for Intention Lifecycle Replay v0 (ADR-0009 D13,
 * spec §5): P23 (open-intention support blocks unsafe compaction), P24
 * (pin releases on closure), and F11 (compaction demoting pinned support is
 * rejected). The `intention-quiescence` predicate extends the ADR-0007 D9
 * gate list without modifying the committed compaction implementation.
 */

// A proposal to demote IC_C2's current dependency support (Bel_C1'') while
// it is open -- the F11/P23 subject.
const demotePinnedSupport: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_intent_pin',
  action: 'demote',
  memberIds: [beliefC1DoublePrime.id],
  rationale: 'reclaim space by demoting the cellar-watch belief',
  proposedBy: 'llm',
}

const demoteCitedEvidence: CompactionProposal = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'CP_intent_evidence',
  action: 'demote',
  memberIds: [cellarWatchEvidence.id],
  rationale: 'reclaim space by demoting the cellar-watch evidence',
  proposedBy: 'llm',
}

function boundsFor(conflictNextSeq: number) {
  return { validT: { night: 5, tick: 0 }, txBound: conflictNextSeq - 1 }
}

describe('P23 -- open-intention support blocks unsafe compaction', () => {
  it("while IC_C2 is open, demoting its current dependency support Bel_C1'' is rejected by intention-quiescence", () => {
    const scenario2 = runScenario2()
    const openState = scenario2.afterRefresh
    const bound = intentionTxBound(openState.intentions)

    const pins = deriveIntentionPins(openState.intentions, intentionUniverse, bound)
    expect(pins.recordIds.has(beliefC1DoublePrime.id)).toBe(true)
    // The cited evidence is pinned too (D13 pin set).
    expect(pins.recordIds.has(cellarWatchEvidence.id)).toBe(true)
    // The version pins carry the objective-metadata and plan-template versions.
    const pin = pins.versionPins.find((p) => p.intentionId === 'IC_C2')
    expect(pin?.sourceObjectiveMetadataVersion).toBe('om_v0')
    expect(pin?.planTemplateVersion).toBe('pt_v0')

    const result = runIntentionAwareCompactionPass(
      intentionUniverse,
      compactionArcs,
      openState.conflict,
      openState.intentions,
      bound,
      compactionConsequences,
      [demotePinnedSupport, demoteCitedEvidence],
      Number.MAX_SAFE_INTEGER,
      boundsFor(openState.conflict.nextSeq),
    )
    expect(result.intentionQuiescenceRejections).toHaveLength(2)
    expect(result.intentionQuiescenceRejections.every((r) => r.verdict === 'rejected' && r.rejectReason === 'pinned-member')).toBe(true)
    // The rejected proposals never reached the underlying pass.
    expect(result.pass.result.compactionLog.some((r) => r.id === 'CP_intent_pin')).toBe(false)
  })
})

describe('P24 -- pin releases on closure', () => {
  it('after IC_C2 closes (BT_0003 abandon) and no other pin remains, the same proposal is admitted to the pass', () => {
    const scenario2 = runScenario2() // IC_C2 closed
    const bound = intentionTxBound(scenario2.intentions)

    const pins = deriveIntentionPins(scenario2.intentions, intentionUniverse, bound)
    // IC_C2's support Bel_C1'' is no longer pinned once IC_C2 closes...
    expect(pins.recordIds.has(beliefC1DoublePrime.id)).toBe(false)
    expect(pins.versionPins.some((p) => p.intentionId === 'IC_C2')).toBe(false)
    // ...though NPC_B's still-open report intention keeps its own,
    // unrelated pins (which do not cover Bel_C1'').
    expect(pins.versionPins.every((p) => p.intentionId !== 'IC_C2')).toBe(true)

    const result = runIntentionAwareCompactionPass(
      intentionUniverse,
      compactionArcs,
      scenario2.conflict,
      scenario2.intentions,
      bound,
      compactionConsequences,
      [demotePinnedSupport],
      Number.MAX_SAFE_INTEGER,
      boundsFor(scenario2.conflict.nextSeq),
    )
    // No intention-quiescence rejection: the proposal flows to the pass.
    expect(result.intentionQuiescenceRejections).toHaveLength(0)
    expect(result.pass.result.compactionLog.some((r) => r.id.startsWith('CP_intent_pin'))).toBe(true)
  })
})

describe('F11 -- compaction demoting an open intention\'s pinned support is rejected', () => {
  it('the intention-quiescence gate rejects a demote of pinned support (positive twin of P23)', () => {
    const scenario2 = runScenario2()
    const openState = scenario2.afterRefresh
    const bound = intentionTxBound(openState.intentions)
    const result = runIntentionAwareCompactionPass(
      intentionUniverse,
      compactionArcs,
      openState.conflict,
      openState.intentions,
      bound,
      compactionConsequences,
      [demotePinnedSupport],
      Number.MAX_SAFE_INTEGER,
      boundsFor(openState.conflict.nextSeq),
    )
    expect(result.intentionQuiescenceRejections).toHaveLength(1)
    expect(result.intentionQuiescenceRejections[0]?.rejectReason).toBe('pinned-member')
  })
})
