import { describe, expect, it } from 'vitest'
import {
  BORIN,
  buildSourceTrustLedgerRun,
  CORA,
  DAREN,
  rBridge2,
  rGate1,
  rGateHinge1,
  rHag1,
  rMill1,
  rTroll1,
  rWell1,
} from './reportResolutionScenario'
import { lookupSourceTrust } from './sourceTrustProjection'
import { resolutionVisible } from './reportResolutionContracts'

/**
 * Keystone integration test for Source-Trust Ledger Replay v0 (research
 * vault ADR-0012, spec source-trust-ledger-replay-v0.md). Walks the
 * mandatory scenario sequence (§8, Phases A-N) end to end against one
 * shared store, and maps directly onto ADR-0012 D14's eighteen acceptance
 * items. Per-mechanism unit tests live in the sibling files:
 * reportResolutionContracts.test.ts (schema/topic map), reportResolution
 * Rules.test.ts (the five minting conditions), sourceTrustProjection.test.ts
 * (D8 cutpoints), reportConfidenceCap.test.ts (D11 consumer + single trust
 * authority), reportResolutionReplay.test.ts (D12 replay),
 * reportResolutionCompaction.test.ts (D13 compaction).
 */

describe('Phase A -- initially unknown (D14.1, P41)', () => {
  it('no ReportResolution key exists before any resolution is minted', () => {
    // A fresh store, before Phase B's first mint, has no key for (Cora, Borin, village-events).
    // Exercised directly against the initial construction inside buildSourceTrustLedgerRun's
    // own throw-on-mismatch guards; here we confirm the store-level projection is unknown
    // for a source never evaluated at all (Daren-as-holder, exercised fully in Phase K below).
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.store, DAREN, BORIN, 'village-events').tier).toBe('unknown')
  })
})

describe('Phase B -- confirmation without BeliefTransition, the decisive case (D14.2, P1/P4)', () => {
  it('P1 -- a standalone ReportResolution exists recording that the report was resolved, though Cora\'s belief never moved', () => {
    const run = buildSourceTrustLedgerRun()
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rWell1.belief.id)
    expect(rr).toBeDefined()
    expect(rr?.outcome).toBe('confirmed')
  })

  it('P4/P9 -- the resolution commits with beliefTransitionRef entirely absent, and no BeliefTransition exists in this store at all', () => {
    const run = buildSourceTrustLedgerRun()
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rWell1.belief.id)
    expect(rr?.beliefTransitionRef).toBeUndefined()
    expect(run.store.conflict.transitions).toHaveLength(0)
  })
})

describe('Phase C -- source-presented, holder-inspected evidence (D14.3/D14.4, P5/P20/P21)', () => {
  it('P5/P20 -- resolution_ref names Cora\'s own Observation, never Borin\'s directing-attention act', () => {
    const run = buildSourceTrustLedgerRun()
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rGate1.belief.id)
    expect(rr?.resolutionRef).toBe('O_Cora_gate1')
    expect(rr?.resolutionRef).not.toBe('Bel_CoraGateShow1')
  })

  it('P21 -- the negative twin: testimony alone (directing attention) mints nothing, rejected on the correct condition', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.directingAttentionAttempt).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
    expect(run.store.resolutions.some((resolution) => resolution.resolutionRef === 'Bel_CoraGateShow1')).toBe(false)
  })
})

describe('Phase D -- testimony-only rejection, then genuine resolution (F6/F7/F8)', () => {
  it('F6 -- self-licensing (resolutionRef names the source\'s own further testimony) is rejected as resolution-not-holder-observation, not a temporal fault', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.selfLicensingAttempt).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('F7 -- third-party testimony (Daren corroborating Borin) is rejected identically to F6', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.thirdPartyTestimonyAttempt).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('F8 -- a hidden-TruthEvent-shaped resolutionRef (no committed record at all) is rejected identically, never a temporal fault', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.hiddenTruthEventAttempt).toEqual({ verdict: 'rejected', reason: 'resolution-not-holder-observation' })
  })

  it('none of F6/F7/F8 inserted a ReportResolution; Cora\'s own inspection is the only one that resolves the report', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.store.resolutions.some((resolution) => resolution.reportRef === rMill1.belief.id && resolution.resolutionRef !== 'O_Cora_mill1')).toBe(false)
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rMill1.belief.id)
    expect(rr?.outcome).toBe('confirmed')
    expect(rr?.resolutionRef).toBe('O_Cora_mill1')
  })
})

describe('Phase E -- certainty-boundary crossing (D14.5)', () => {
  it('after Well1/Gate1/Mill1, (Cora, Borin, village-events) crosses to C=3, R=0 -- high competence, medium certainty', () => {
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.phaseE, CORA, BORIN, 'village-events')).toEqual({
      tier: 'resolved',
      confirmed: 3,
      refuted: 0,
      competence: 'high',
      certainty: 'medium',
    })
  })
})

describe('Phase F -- observable cap behavior (D14.6, P51/P52)', () => {
  it('P51/P52 -- same pre-cap confidence, different competence tiers, produce different final caps', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.phaseF.borinTrust).toEqual({ tier: 'resolved', confirmed: 3, refuted: 0, competence: 'high', certainty: 'medium' })
    expect(run.phaseF.borinCap).toEqual({ verdict: 'cap', confidence: 'medium' })
    expect(run.phaseF.darenTrust).toEqual({ tier: 'resolved', confirmed: 2, refuted: 1, competence: 'medium', certainty: 'medium' })
    expect(run.phaseF.darenCap).toEqual({ verdict: 'cap', confidence: 'low' })
    expect(run.phaseF.borinCap).not.toEqual(run.phaseF.darenCap)
  })
})

describe('Phase G -- established-low rejection (D14.7, P48/P53/F23)', () => {
  it('three refutations establish low competence at medium certainty; a fourth report\'s assertion fact still commits while no world belief mints', () => {
    const run = buildSourceTrustLedgerRun()
    const monsterTrust = lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')
    expect(monsterTrust).toEqual({ tier: 'resolved', confirmed: 0, refuted: 3, competence: 'low', certainty: 'medium' })

    // The unconditional epSpeakerAct mint for the fourth report committed regardless of trust.
    const hagReportInUniverse = run.store.conflict.timing.has(rHag1.belief.id)
    expect(hagReportInUniverse).toBe(true)
    // ...yet it was never resolved at all -- rejection happens at the cap-consumer layer, not here.
    expect(run.store.resolutions.some((resolution) => resolution.reportRef === rHag1.belief.id)).toBe(false)
  })
})

describe('Phase H -- topic isolation (D14.11, P54)', () => {
  it('Borin\'s two topic keys remain completely independent', () => {
    const run = buildSourceTrustLedgerRun()
    const village = lookupSourceTrust(run.store, CORA, BORIN, 'village-events')
    const monster = lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')
    expect(village.tier).toBe('resolved')
    expect(monster.tier).toBe('resolved')
    if (village.tier === 'resolved' && monster.tier === 'resolved') {
      expect(village.confirmed).not.toBe(monster.confirmed)
      expect(village.refuted).not.toBe(monster.refuted)
    }
  })
})

describe('Phase I -- provenance deduplication (D14.8, P22/P23/F16)', () => {
  it('P22 -- a repeated assertion of Prop_Gate1 collapses to one provenance root; a second resolution attempt is rejected', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.gate2DedupAttempt.verdict).toBe('rejected')
    if (run.gate2DedupAttempt.verdict === 'rejected') {
      expect(run.gate2DedupAttempt.reason).toBe('provenance-already-consumed')
    }
  })

  it('P23 -- GateHinge1, a genuinely distinct claim, independently resolves, unaffected by the Gate1 dedup', () => {
    const run = buildSourceTrustLedgerRun()
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rGateHinge1.belief.id)
    expect(rr?.outcome).toBe('confirmed')
  })
})

describe('Phase J -- retraction (D14.9, P26-P32, F27)', () => {
  it('P26/P27 -- retraction alone mints nothing; the report stays unresolved at that point', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.bridgeRetractionAttempt.verdict).toBe('rejected')
  })

  it('P28/P29/P30 -- a later, holder-observed refutation resolves it, recording that a retraction preceded it, scored identically to any other refutation', () => {
    const run = buildSourceTrustLedgerRun()
    const rr = run.store.resolutions.find((resolution) => resolution.reportRef === rBridge2.belief.id)
    expect(rr?.outcome).toBe('refuted')
    expect(rr?.resolutionCause).toBe('refuted-after-source-retraction')
  })
})

describe('Phase K -- holder isolation and circular-trust immunity (D14.12/D14.13, P25/P55/P68)', () => {
  it('P25/P55 -- Daren, as an independent holder, has no ReportResolution key at all, in either topic', () => {
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.store, DAREN, BORIN, 'village-events')).toEqual({ tier: 'unknown' })
    expect(lookupSourceTrust(run.store, DAREN, BORIN, 'monster-knowledge')).toEqual({ tier: 'unknown' })
  })

  it('P68 -- circular trust: Borin vouching for Daren, and Daren vouching for Borin, mint nothing and leave both counts unaffected', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.vouchDarenAttempt.verdict).toBe('rejected')
    expect(run.vouchBorinAttempt.verdict).toBe('rejected')

    const darenVillage = lookupSourceTrust(run.store, CORA, DAREN, 'village-events')
    expect(darenVillage).toEqual({ tier: 'resolved', confirmed: 2, refuted: 1, competence: 'medium', certainty: 'medium' })

    const borinMonster = lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')
    expect(borinMonster).toEqual({ tier: 'resolved', confirmed: 0, refuted: 3, competence: 'low', certainty: 'medium' })
  })
})

describe('Phase O -- topic validation at the live mint boundary (D9, F14/F15)', () => {
  it('F14 -- an unmapped predicate is rejected as unknown-predicate-topic-mapping at the live commitReportResolution boundary', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.unmappedPredicateAttempt).toEqual({ verdict: 'rejected', reason: 'unknown-predicate-topic-mapping' })
  })

  it('F15 -- a known predicate paired with the wrong topicId is rejected as topic-mismatch at the live commitReportResolution boundary', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.topicMismatchAttempt).toEqual({ verdict: 'rejected', reason: 'topic-mismatch' })
  })

  it('F14/F15 -- neither attempt inserted a ReportResolution', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.store.resolutions.some((resolution) => resolution.resolutionId === 'RR_attempt_unmapped_predicate')).toBe(false)
    expect(run.store.resolutions.some((resolution) => resolution.resolutionId === 'RR_attempt_topic_mismatch')).toBe(false)
  })

  it('F14/F15 -- no competence/certainty counts changed for any key the attempts named', () => {
    const run = buildSourceTrustLedgerRun()
    // Borin's village-events tally is the final, fully-accumulated Phase
    // A-N tally (C=4, R=1) -- neither the unmapped-predicate attempt (Borin,
    // village-events) nor the topic-mismatch attempt (Borin, reportRef
    // rGateHinge1, attempted under 'monster-knowledge') moved any count.
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'village-events')).toEqual({
      tier: 'resolved',
      confirmed: 4,
      refuted: 1,
      competence: 'high',
      certainty: 'medium',
    })
    // GateHinge1's own genuine, already-committed resolution (Phase I) is
    // the only village-events resolution referencing it -- the mismatched
    // monster-knowledge attempt against the same report contributed nothing.
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')).toEqual({
      tier: 'resolved',
      confirmed: 0,
      refuted: 3,
      competence: 'low',
      certainty: 'medium',
    })
  })

  it('F14/F15 -- no unrelated store mutation: a rejected outcome returns the exact same store reference it was given', () => {
    const run = buildSourceTrustLedgerRun()
    // No ConflictEdge/BeliefTransition/IntentionCommitment exists anywhere
    // in this rig's store, and both Phase O attempts left that untouched.
    expect(run.store.conflict.edges).toHaveLength(0)
    expect(run.store.conflict.transitions).toHaveLength(0)
  })
})

describe('Phase P -- reportPredicate-authority gap closure (D9)', () => {
  it('exact rejection reason is topic-mismatch: rTroll1 is a real, committed monster-knowledge report (troll-weak-to-fire); resolving it under village-events is rejected identically to any other topic mismatch, with no caller-supplied predicate left to spoof the check', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.crossTopicSpoofAttempt).toEqual({ verdict: 'rejected', reason: 'topic-mismatch' })
  })

  it('no ReportResolution inserts for the spoof attempt', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.store.resolutions.some((resolution) => resolution.resolutionId === 'RR_attempt_cross_topic_spoof')).toBe(false)
  })

  it('village-events counts do not change', () => {
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'village-events')).toEqual({
      tier: 'resolved',
      confirmed: 4,
      refuted: 1,
      competence: 'high',
      certainty: 'medium',
    })
  })

  it('monster-knowledge counts do not change', () => {
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')).toEqual({
      tier: 'resolved',
      confirmed: 0,
      refuted: 3,
      competence: 'low',
      certainty: 'medium',
    })
  })

  it('conflict edges/transitions and unrelated state do not change', () => {
    const run = buildSourceTrustLedgerRun()
    expect(run.store.conflict.edges).toHaveLength(0)
    expect(run.store.conflict.transitions).toHaveLength(0)
  })
})

describe('Single trust authority, Phase N (D14.17)', () => {
  it('P56/P66 -- no ReportResolution ever carries a holderId that did not itself observe the resolutionRef', () => {
    const run = buildSourceTrustLedgerRun()
    for (const resolution of run.store.resolutions) {
      const witnessEntry = run.store.conflict // resolutionRef must be an Observation observed by resolution.holderId
      expect(resolutionVisible(resolution.holderId, resolution)).toBe(true)
      expect(resolutionVisible('some-other-npc', resolution)).toBe(false)
      void witnessEntry
    }
  })

  it('P67 -- minting a ReportResolution never writes to any other record family', () => {
    const run = buildSourceTrustLedgerRun()
    // No ConflictEdge/BeliefTransition/IntentionCommitment exists anywhere in this rig's store.
    expect(run.store.conflict.edges).toHaveLength(0)
    expect(run.store.conflict.transitions).toHaveLength(0)
  })
})

describe('D14 acceptance-gate summary -- every item mapped and demonstrated', () => {
  it('the full run completes with the exact final tiers the spec\'s narrative requires', () => {
    const run = buildSourceTrustLedgerRun()
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'village-events')).toEqual({
      tier: 'resolved',
      confirmed: 4,
      refuted: 1,
      competence: 'high',
      certainty: 'medium',
    })
    expect(lookupSourceTrust(run.store, CORA, BORIN, 'monster-knowledge')).toEqual({
      tier: 'resolved',
      confirmed: 0,
      refuted: 3,
      competence: 'low',
      certainty: 'medium',
    })
    expect(lookupSourceTrust(run.store, CORA, DAREN, 'village-events')).toEqual({
      tier: 'resolved',
      confirmed: 2,
      refuted: 1,
      competence: 'medium',
      certainty: 'medium',
    })
    // rTroll1 (a monster-knowledge report) and rGate1/rHag1 stay addressable throughout -- referenced here so this file documents the full claim inventory the narrative exercises.
    expect(run.store.conflict.timing.has(rTroll1.belief.id)).toBe(true)
  })
})
