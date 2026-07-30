import { describe, expect, it } from 'vitest'
import { canonicalAttentionTraceBytes } from './attentionReplay'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'
import { canonicalSerialize } from './canonicalSerialization'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { createAttentionLedger } from './attentionLedger'
import { buildAttentionReplayQuestCandidateOnlyWorld } from './attentionReplayScenario'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import { applyNarrativePatternStructuralRetention } from './attentionNarrativePatternResourcePolicy'
import { constructAttentionReadableSurface, ATTENTION_READABLE_SURFACE_SCHEMA_VERSION } from './attentionReadableBoundary'
import { normalizeAttentionCandidates } from './attentionCandidate'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'

function replay() {
  const views = mintPatternEvidenceViews([aidRecord('cold-aid-1', 10, 'a', 'b'), aidRecord('cold-aid-2', 12, 'b', 'a')])
  const monitor = reconstructNarrativePatternInstances({ patternEvidenceViews: views, evaluationSnapshotLsn: 20 })
  if (monitor.kind !== 'ok') throw new Error('expected monitor')
  const retained = applyNarrativePatternStructuralRetention(monitor.instances)
  const surface = constructAttentionReadableSurface({ surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 20 }, Object.freeze([]), Object.freeze([]), views)
  if (surface.kind !== 'ok') throw new Error('expected surface')
  const candidates = normalizeAttentionCandidates(surface.surface, retained.retainedRankableInstances)
  if (candidates.kind !== 'ok' || candidates.attentionCandidates[0]?.sourceKind !== 'narrative_pattern_instance') throw new Error('expected candidate')
  const candidate = candidates.attentionCandidates[0]
  const instance = retained.retainedRankableInstances.find((value) => value.patternInstanceId === candidate.sourceId)
  if (instance === undefined) throw new Error('expected instance')
  const world = buildAttentionReplayQuestCandidateOnlyWorld()
  const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (created.kind !== 'ok') throw new Error('expected ledger')
  return runAttentionMixedFamilyEvaluation({ replayCaseId: 'b6-pattern-cold', snapshot: { ...world.snapshot, candidates: Object.freeze([]) }, request: world.request,
    patternEvidenceViews: views, revalidationSnapshot: { ...world.snapshot, candidates: Object.freeze([]) }, revalidationSnapshotLsn: 20,
    revalidationPatternEvidenceViews: views, ledger: created.ledger,
    patternPresentationInputs: Object.freeze([{ candidateId: candidate.candidateId, directEvidenceAssertionInputs: instance.directEvidenceAssertionInputs,
      rankingCacheKey: 'cold-pattern-cache', revalidationCacheKey: 'cold-pattern-cache' }]),
    patternPresentationLedgerPolicyVersion: 'attention-pattern-presentation-ledger-policy-v1',
    aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    authoritativeLogDigestBefore: digestAttentionReplayAuthoritativeLog({ commits: [] }), authoritativeLogDigestAfter: digestAttentionReplayAuthoritativeLog({ commits: [] }),
  })
}

describe('B6 — narrative-pattern cold replay', () => {
  it('is deterministic across independent cold evaluations and exposes no trusted arbitration material', () => {
    const first = replay()
    const second = replay()
    expect(first.kind).toBe('ok')
    expect(second.kind).toBe('ok')
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected successful replays')
    expect(canonicalAttentionTraceBytes(first.result.trace)).toBe(canonicalAttentionTraceBytes(second.result.trace))
    expect(canonicalSerialize(first.result.ledger)).toBe(canonicalSerialize(second.result.ledger))
    expect(first.result.trace.playerObservable).not.toHaveProperty('mixedFamilyArbitration')
    expect(first.result.trace.mixedFamilyArbitration?.winnerSourceKind).toBe('narrative_pattern_instance')
  })
})
