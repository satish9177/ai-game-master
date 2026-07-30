import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
} from './attentionQuestCandidateContracts'
import {
  A1_RANKING_SNAPSHOT_LSN,
  buildAttentionQuestCandidateA1Scenario,
  buildAttentionQuestCandidateHiddenPairScenario,
} from './attentionQuestCandidateScenario'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import {
  A5_AUTHORITATIVE_COMMAND_IDS,
  A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
  A5_RNG_SEED,
  buildAttentionReplayQuestCandidateOnlyWorld,
  buildAttentionReplayTwoQuestCandidateWorld,
} from './attentionReplayScenario'
import {
  runAttentionDirectorOffPass,
  runAttentionP3PairedWorldCheck,
  runAttentionPatternPresentationPass,
  runAttentionQuestCandidatePrimePipeline,
  runAttentionQuestCandidateReplayPass,
  stableWorldReplayPassInput,
} from './attentionReplay'
import {
  createAttentionReplayAuthoritativeResources,
  digestAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'
import { ATTENTION_LEDGER_POLICY_VERSION, ATTENTION_TEMPLATE_VERSION } from './attentionCandidatePolicy'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import { ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION, attentionLedgerFeatures } from './attentionLedger'
import type { AttentionPatternCandidate } from './attentionCandidate'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
import {
  assertAttentionZeroModelProbeUnused,
  createAttentionZeroModelProbe,
} from './attentionZeroModelProbe'
import {
  ATTENTION_STAGE_A_QUEST_ONLY_BASELINE_COMMIT,
  ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN,
} from './attentionStageAQuestOnlyGolden'

const COMMON_REQUEST = Object.freeze({
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
})
const EMPTY_PATTERN_EVIDENCE = Object.freeze([])
const EMPTY_AUTHORITATIVE_LOG_DIGEST =
  digestAttentionReplayAuthoritativeLog({ commits: Object.freeze([]) })

describe(`B1 quest-only compatibility with ${ATTENTION_STAGE_A_QUEST_ONLY_BASELINE_COMMIT}`, () => {
  it('pins the complete canonical quest legal-view bytes, not only IDs', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const surface = constructAttentionReadableSurface(
      COMMON_REQUEST,
      scenario.views,
      scenario.openingCoordinateViews,
      EMPTY_PATTERN_EVIDENCE,
    )
    expect(surface.kind).toBe('ok')
    if (surface.kind !== 'ok') throw new Error('expected common A-prime')

    // The load-bearing B4 compatibility claim: adding the sidecar collection to
    // the surface leaves every embedded legal quest view byte-identical to the
    // pinned Stage A golden. The sidecar is a sibling collection, never a field.
    expect(surface.surface.questCandidateViews.map(canonicalSerialize))
      .toEqual(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.completeCanonicalQuestViewBytes)
    expect(canonicalSerialize(surface.surface.questCandidateViews.map((view) => view.candidateId)))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.questViewIdentityBytes)
    expect(surface.surface.patternEvidenceViews).toEqual([])
    expect(surface.surface.questOpeningCoordinateViews).toHaveLength(1)
  })

  it('preserves single-quest IDs, package, rendered bytes/identity, ledger/features, and observable trace', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const prime = runAttentionQuestCandidatePrimePipeline(world)
    const pass = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('stage-a-golden-single', world, EMPTY_AUTHORITATIVE_LOG_DIGEST),
    )
    expect(prime.kind).toBe('ok')
    expect(pass.kind).toBe('ok')
    if (prime.kind !== 'ok' || pass.kind !== 'ok') throw new Error('expected quest-only replay')

    const candidate = pass.result.orderedCandidates[0]!
    const built = buildAttentionRevealPackage(candidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (built.kind !== 'ok') throw new Error('expected quest package')
    const rendered = renderAttentionRevealPackage(
      built.revealPackage,
      { templateVersion: ATTENTION_TEMPLATE_VERSION },
    )
    if (rendered.kind !== 'ok') throw new Error('expected quest rendering')
    const golden = ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single

    expect(prime.surface.questCandidateViews.map(canonicalSerialize))
      .toEqual(golden.completeCanonicalQuestViewBytes)
    expect(canonicalSerialize(prime.surface.questCandidateViews.map((view) => view.candidateId)))
      .toBe(golden.questViewIdentityBytes)
    expect(canonicalSerialize(pass.result.orderedCandidates.map((value) => value.candidateId)))
      .toBe(golden.normalizedCandidateIdsBytes)
    expect(canonicalSerialize(pass.result.trace.playerObservable.orderedCandidateIds))
      .toBe(golden.orderedCandidateIdsBytes)
    expect(canonicalSerialize(built.revealPackage)).toBe(golden.revealPackageBytes)
    expect(canonicalSerialize({ lines: rendered.lines, output: rendered.output }))
      .toBe(golden.renderedTemplateBytes)
    expect(rendered.outputIdentity).toBe(golden.renderedOutputIdentity)
    expect(canonicalSerialize(pass.result.ledger.records)).toBe(golden.ledgerRecordsBytes)
    expect(canonicalSerialize(attentionLedgerFeatures(pass.result.ledger, candidate.candidateId)))
      .toBe(golden.ledgerFeaturesBytes)
    expect(canonicalSerialize(pass.result.trace.playerObservable))
      .toBe(golden.playerObservableTraceBytes)
    expect(prime.surface.patternEvidenceViews).toEqual([])
    expect(pass.result.orderedCandidates).toHaveLength(1)
    expect(pass.result.trace.presentations).toHaveLength(1)
    expect(pass.result.ledger.records).toHaveLength(1)
  })

  it('keeps the quest branch byte-frozen when a pattern-presentation record is appended elsewhere in the same ledger', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const pass = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('stage-a-golden-ledger-branches', world, EMPTY_AUTHORITATIVE_LOG_DIGEST),
    )
    if (pass.kind !== 'ok') throw new Error('expected quest-only replay')
    const questCandidate = pass.result.orderedCandidates[0]
    const questRecord = pass.result.ledger.records[0]
    if (questCandidate === undefined || questRecord === undefined) throw new Error('expected one quest record')
    if (questRecord.sourceKind !== 'quest_candidate') throw new Error('expected a quest ledger record')

    expect(questRecord.sourceKind).toBe('quest_candidate')
    expect(questRecord.ledgerPolicyVersion).toBe(ATTENTION_LEDGER_POLICY_VERSION)
    expect(questRecord.recordId.startsWith(ATTENTION_LEDGER_POLICY_VERSION + ':')).toBe(true)
    expect(canonicalSerialize(pass.result.ledger.records))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single.ledgerRecordsBytes)

    const patternCandidate: AttentionPatternCandidate = Object.freeze({
      sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId: 'stage-a-compatible-pattern',
      candidateId: 'stage-a-compatible-pattern-candidate', eligibility: 'eligible',
      accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
      canonicalizationVersion: 'attention-candidate-canonicalization-v1',
      identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1', rankingSnapshotLsn: 60,
      legallyVisibleParties: Object.freeze(['a', 'b']), patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
      canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
      canonicalSupportingRecordIdentityTuple: Object.freeze([
        Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', 10] as const),
      ]),
      lastProgressLsn: 10,
    })
    const assertions: readonly NarrativePatternDirectEvidenceAssertionInput[] = Object.freeze([
      Object.freeze({
        assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1',
        actorId: 'a', targetId: 'b',
      }),
    ])
    const pattern = runAttentionPatternPresentationPass({
      orderedCandidates: [{
        candidate: patternCandidate, revalidatedCandidate: patternCandidate, directEvidenceAssertionInputs: assertions,
        rankingCacheKey: 'stage-a-compatible-pattern-cache', revalidationCacheKey: 'stage-a-compatible-pattern-cache',
      }],
      ledger: pass.result.ledger,
      evaluationLsn: 60,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(pattern.presentation).not.toBeNull()
    expect(canonicalSerialize(pattern.ledger.records.slice(0, 1)))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single.ledgerRecordsBytes)
    expect(canonicalSerialize(attentionLedgerFeatures(pattern.ledger, questCandidate.candidateId)))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.single.ledgerFeaturesBytes)
  })

  it('preserves two-quest view bytes, normalization, and deterministic ordering', () => {
    const world = buildAttentionReplayTwoQuestCandidateWorld('reversed')
    const prime = runAttentionQuestCandidatePrimePipeline(world)
    const pass = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('stage-a-golden-two', world, EMPTY_AUTHORITATIVE_LOG_DIGEST),
    )
    if (prime.kind !== 'ok' || pass.kind !== 'ok') throw new Error('expected two-quest replay')
    const golden = ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.two

    expect(prime.surface.questCandidateViews.map(canonicalSerialize))
      .toEqual(golden.completeCanonicalQuestViewBytes)
    expect(canonicalSerialize(prime.surface.questCandidateViews.map((view) => view.candidateId)))
      .toBe(golden.questViewIdentityBytes)
    expect(canonicalSerialize(pass.result.orderedCandidates.map((value) => value.candidateId)))
      .toBe(golden.normalizedCandidateIdsBytes)
    expect(canonicalSerialize(pass.result.trace.playerObservable.orderedCandidateIds))
      .toBe(golden.orderedCandidateIdsBytes)
    expect(prime.surface.patternEvidenceViews).toEqual([])
    expect(pass.result.trace.orderingTrace).toHaveLength(1)
  })

  it('preserves the hidden-quest P3 observable trace and consumes no position', () => {
    const scenario = buildAttentionQuestCandidateHiddenPairScenario()
    const result = runAttentionP3PairedWorldCheck({
      replayCaseId: 'stage-a-golden-hidden',
      worldA: scenario.worldA,
      worldB: scenario.worldB,
    })
    if (result.traceA === undefined || result.traceB === undefined) {
      throw new Error('expected equivalent paired-world traces')
    }

    expect(result.premiseCheck.equivalent).toBe(true)
    expect(canonicalSerialize(result.premiseCheck.leftViewIdentities))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.hidden.questViewIdentityBytes)
    expect(canonicalSerialize(result.traceA.playerObservable))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.hidden.playerObservableTraceBytes)
    expect(result.traceA.admittedQuestCandidateSourceIds).not.toContain(scenario.hiddenCandidateId)
    expect(result.traceA.orderedAttentionCandidates).toHaveLength(2)
  })

  it('preserves authoritative committed-log bytes and the zero-model count', () => {
    const authoritative = runAttentionDirectorOffPass(
      createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const probe = createAttentionZeroModelProbe()
    assertAttentionZeroModelProbeUnused(probe)

    expect(canonicalSerialize(authoritative.resources.log))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.authoritativeCommittedLogBytes)
    expect(authoritative.digest)
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.authoritativeCommittedLogDigest)
    expect(probe.invocationCount()).toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.zeroModelCount)
  })

  it('claims equality only within the explicit common schema', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const first = constructAttentionReadableSurface(
      COMMON_REQUEST, scenario.views, scenario.openingCoordinateViews, EMPTY_PATTERN_EVIDENCE,
    )
    const second = constructAttentionReadableSurface(
      COMMON_REQUEST, scenario.views, scenario.openingCoordinateViews, EMPTY_PATTERN_EVIDENCE,
    )
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected common surfaces')

    // Within-schema only: cross-schema v1/v2 whole-surface byte equality is not
    // claimed, and this surface is explicitly v2.
    expect(first.surface.surfaceSchemaVersion).toBe(ATTENTION_READABLE_SURFACE_SCHEMA_VERSION)
    expect(first.surface.surfaceSchemaVersion).toBe('attention-readable-surface-schema-v2')
    expect(canonicalSerialize(first.surface)).toBe(canonicalSerialize(second.surface))
    expect(first.surface.patternEvidenceViews).toEqual([])
  })
})
