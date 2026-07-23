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
  runAttentionQuestCandidatePrimePipeline,
  runAttentionQuestCandidateReplayPass,
  stableWorldReplayPassInput,
} from './attentionReplay'
import {
  createAttentionReplayAuthoritativeResources,
  digestAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'
import { ATTENTION_TEMPLATE_VERSION } from './attentionCandidatePolicy'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import { attentionLedgerFeatures } from './attentionLedger'
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
      EMPTY_PATTERN_EVIDENCE,
    )
    expect(surface.kind).toBe('ok')
    if (surface.kind !== 'ok') throw new Error('expected common A-prime')

    expect(surface.surface.questCandidateViews.map(canonicalSerialize))
      .toEqual(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.completeCanonicalQuestViewBytes)
    expect(canonicalSerialize(surface.surface.questCandidateViews.map((view) => view.candidateId)))
      .toBe(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.questViewIdentityBytes)
    expect(surface.surface.patternEvidenceViews).toEqual([])
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
    const views = buildAttentionQuestCandidateA1Scenario().views
    const first = constructAttentionReadableSurface(COMMON_REQUEST, views, EMPTY_PATTERN_EVIDENCE)
    const second = constructAttentionReadableSurface(COMMON_REQUEST, views, EMPTY_PATTERN_EVIDENCE)
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected common surfaces')

    expect(first.surface.surfaceSchemaVersion).toBe(ATTENTION_READABLE_SURFACE_SCHEMA_VERSION)
    expect(canonicalSerialize(first.surface)).toBe(canonicalSerialize(second.surface))
    expect(first.surface.patternEvidenceViews).toEqual([])
  })
})
