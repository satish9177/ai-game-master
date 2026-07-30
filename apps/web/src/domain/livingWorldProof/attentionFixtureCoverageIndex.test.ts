import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type FixtureMapping = Readonly<{
  id: string
  canonicalId: string
  file: string
  testTitle: string
}>

const here = fileURLToPath(new URL('.', import.meta.url))

function range(prefix: string, first: number, last: number): string[] {
  return Array.from({ length: last - first + 1 }, (_, index) => `${prefix}${first + index}`)
}

function mapIds(
  ids: readonly string[],
  file: string,
  testTitle: string,
): FixtureMapping[] {
  return ids.map((id) => ({ id, canonicalId: id, file, testTitle }))
}

const fixtureCoverageIndex: readonly FixtureMapping[] = [
  ...mapIds(['S1'], 'attentionLedgerStaticClosure.test.ts', 'a Stage A module reaching an authoritative path is caught whatever the quote style'),
  ...mapIds(['S2'], 'attentionLedgerStaticClosure.test.ts', 'covers every attention-prefixed module plus the closed validator boundary on disk'),

  ...mapIds(['P2-1'], 'attentionP2Noninterference.test.ts', 'produces byte-identical authoritative logs whether or not attention runs'),
  ...mapIds(['P2-2'], 'attentionP2Noninterference.test.ts', 'B6 genuinely mixed director-on: real two-family work, and the authoritative log is byte-identical to director-off'),
  ...mapIds(['P2-3'], 'attentionP2Noninterference.test.ts', 'one prior authoritative commit, then attention runs: the authoritative log matches a director-off run over the same one commit'),
  ...mapIds(['P2-4'], 'attentionP2Noninterference.test.ts', 'running attention before vs after the authoritative commits produces the same authoritative log'),
  ...mapIds(['P2-N1'], 'attentionP2Noninterference.test.ts', 'P2-N1 — a shared authoritative RNG stream causes the authoritative log to diverge'),
  ...mapIds(['P2-N2'], 'attentionP2Noninterference.test.ts', 'P2-N2 — a shared authoritative ID/sequence allocator causes the authoritative log to diverge'),
  ...mapIds(['P2-N3'], 'attentionP2Noninterference.test.ts', 'P2-N3 — a shared authoritative scheduler resource causes the authoritative log to diverge'),
  ...mapIds(['P2-N6', 'P2-N7'], 'attentionP2DiegeticCommit.test.ts', 'P2-N6/P2-N7 rejects invalid or unavailable delivery without a commit or resource mutation'),
  ...mapIds(['P2-N8', 'P2-N9'], 'attentionP2DiegeticCommit.test.ts', 'P2-N8/P2-N9 treats advisory candidate identity as non-authoritative and rejects ambiguous authoritative payloads'),
  ...mapIds(['P2-PC1'], 'attentionP2DiegeticCommit.test.ts', 'P2-PC1 preserves the validator-owned command sequence and communication digest through the single authoritative route'),

  ...mapIds(['P3-1', 'P3-2', 'P3-3'], 'attentionP3Equivalence.test.ts', 'the legal paired worlds pass the independently derived premise and produce byte-identical observable traces'),
  ...mapIds(['P3-4'], 'attentionP3Equivalence.test.ts', 'Control B — a hidden authoritative difference outside A′ alters no permitted observable result and consumes no budget'),
  ...mapIds(['P3-5'], 'attentionP3Equivalence.test.ts', 'the premise check passes: independently constructed A-prime is byte-identical, and the hidden candidate is absent from both -- both real visible candidates are present in both'),

  {
    id: 'Q1',
    canonicalId: 'P3-5',
    file: 'attentionP3Equivalence.test.ts',
    testTitle: 'the hidden candidate consumes no candidate/resource budget and remains authoritatively open and untouched',
  },
  ...mapIds(['Q2'], 'attentionZeroModelProbe.test.ts', 'presents only the legally admitted candidate: the hidden and resolved ones never appear'),
  ...mapIds(['Q3', 'Q4'], 'attentionP3Equivalence.test.ts', 'an identical resolved candidate in both worlds never enters A-prime, so both worlds have empty (and equivalent) A-prime and traces (canonical-byte oracle)'),
  ...mapIds(['Q5', 'Q6', 'Q7', 'Q8', 'Q9'], 'attentionQuestCandidateReplay.test.ts', 'leaves the underlying QuestCandidate snapshot byte-identical'),

  ...mapIds(['D1'], 'attentionQuestCandidateReplay.test.ts', 'produces byte-identical complete traces for identical declared inputs'),
  ...mapIds(['D2'], 'attentionReplayDeterminism.test.ts', 'B6 pattern-only cold replay preserves trusted arbitration, ledger, and trace bytes'),
  ...mapIds(['D3'], 'attentionMixedCandidateReplay.test.ts', 'item 6 — reversed genuinely mixed input produces an identical evaluation in every recorded dimension'),
  ...mapIds(['D4'], 'attentionZeroModelProbe.test.ts', 'completes the whole path with the count still at zero'),
  ...mapIds(['D5'], 'attentionScoreTieBreak.test.ts', 'makes proof-score the forceable second ordering key under reversed insertion'),
  ...mapIds(['D6'], 'attentionMixedCandidateOrdering.test.ts', 'key 3 — source kind: quest_candidate before narrative_pattern_instance'),
  ...mapIds(['D7'], 'attentionCandidateOrdering.test.ts', 'resolves at source-id when two legal quests carry an equal numeric opening LSN'),
  ...mapIds(['D8'], 'attentionMixedCandidateOrdering.test.ts', 'key 4 — semantic version (patterns only; quest uses a fixed sentinel)'),
  ...mapIds(['D9'], 'attentionMixedCandidateOrdering.test.ts', 'key 5 — canonical binding tuple'),
  ...mapIds(['D10'], 'attentionMixedCandidateOrdering.test.ts', 'key 6 — canonical supporting-record identity tuple'),
  ...mapIds(['D11'], 'attentionMixedCandidateOrdering.test.ts', 'key 9 — candidate id is the final total-order guard when every prior key ties'),
  ...mapIds(['D12'], 'attentionMixedCandidateOrdering.test.ts', 'key 7 — source committed LSN: patterns compare lastProgressLsn numerically'),

  ...mapIds(['I1', 'I2', 'I3'], 'attentionCandidateIdentity.test.ts', 'ignores the order the input object literal was written in'),
  ...mapIds(['I4'], 'attentionCandidateCacheKey.test.ts', 'keeps every ranking-only coordinate out of the derivation key material entirely'),
  ...mapIds(['I5'], 'attentionCandidateIdentity.test.ts', 'folds both versions into the bytes and prefixes the identity-schema version onto the ID'),
  ...mapIds(['I6'], 'attentionCandidateIdentity.test.ts', 'keeps the canonicalization and identity-schema versions distinct, never collapsed'),
  ...mapIds(['I7'], 'attentionCandidateIdentity.test.ts', 'gives semantically distinct inputs distinct IDs across the fixture family'),
  ...mapIds(['I8'], 'attentionLedger.test.ts', 'scopes features to one candidate identity'),

  ...mapIds(['M1', 'M2', 'M3'], 'attentionNarrativePatternContracts.test.ts', 'accepts only the six RN019-legal verdict/annotation combinations over the full Cartesian product'),
  ...mapIds(['M4'], 'attentionNarrativePatternMonitor.test.ts', 'is active while open, satisfied on keyed fulfillment before the deadline'),
  ...mapIds(['M5'], 'attentionNarrativePatternMonitor.test.ts', 'stalls at delta 4 and expires at horizon + 1'),
  ...mapIds(['M6'], 'attentionNarrativePatternLifecycle.test.ts', 'uses strict expiry and independent stall equality with total annotation precedence'),
  ...mapIds(['M7'], 'attentionNarrativePatternMonitor.test.ts', 'abandons on public departure of a participant'),
  ...mapIds(['M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14'], 'attentionNarrativePatternLifecycle.test.ts', 'uses strict expiry and independent stall equality with total annotation precedence'),
  ...mapIds(['M15'], 'attentionNarrativePatternMonitor.test.ts', 'creates an active partial from a single aid start'),
  ...mapIds(['M16', 'M17', 'M18', 'M19'], 'attentionNarrativePatternForking.test.ts', 'retains two canonical children per parent'),
  ...mapIds(range('M', 20, 29), 'attentionPatternProjectionPreservation.test.ts', 'B6 mixed evaluation consumes accessor views without writing back into them'),
  ...mapIds(['M30', 'M31', 'M32', 'M33', 'M34', 'M35'], 'attentionNarrativePatternLifecycle.test.ts', 'refreshes deadline - 1, deadline, and deadline + 1 without synthetic evidence'),

  ...mapIds(['R1', 'R2', 'R3'], 'attentionDirectEvidenceAssertion.test.ts', 'uses the four closed direct-record kinds in monitor order with stable identities'),
  ...mapIds(['R4'], 'attentionDirectEvidenceAssertion.test.ts', 'reproduces the original one-record-forges-two-lines exploit and confirms it now refuses end to end'),
  ...mapIds(['R5'], 'attentionClosedRelationCertificateContracts.test.ts', 'accepts only an accessor-minted, bounded, canonical certificate'),
  ...mapIds(['R6'], 'attentionAbsenceWitnessProvenance.test.ts', 'is canonical and refuses absent or forged certificates'),
  ...mapIds(['R7', 'R8', 'R9', 'R10'], 'attentionAbsenceWitnessProvenance.test.ts', 'refuses an incomplete lookback, malformed certificate, and text-shaped non-certificate without treating a failed text search as absence'),
  ...mapIds(['R11'], 'attentionAggregateLegitimacy.test.ts', 'builds the closed reciprocal conclusion from two opposite direct public-aid sources'),
  ...mapIds(['R12', 'R13', 'R15', 'R16'], 'attentionRevealerLegality.test.ts', 'discharges R12/R13/R15/R16 without reading private state'),
  ...mapIds(['R14'], 'attentionAggregateLegitimacyReplay.test.ts', 'routes the normalized extension aggregate through the same evaluator without a synthetic aggregate record id'),
  ...mapIds(['R17', 'R18'], 'attentionInferenceProvenance.test.ts', 'pins canonical bytes and aggregate-first/direct-second for a legal extension'),
  ...mapIds(['R19'], 'attentionInferenceProvenance.test.ts', 'refuses self and multi-node cycles deterministically'),
  ...mapIds(['R20', 'R21'], 'attentionInferenceProvenance.test.ts', 'enforces the pinned node and edge budgets before rendering or packaging'),
  ...mapIds(['R22', 'R23'], 'attentionInferenceProvenance.test.ts', 'refuses incomplete or unpinned rule coordinates'),

  ...mapIds(['C1'], 'attentionDiegeticDelivery.test.ts', 'uses the validator-owned payload and C5 v2 commit route'),
  ...mapIds(['C2'], 'communicationValidator.test.ts', 'independently derives and commits a content-bearing payload through the ordinary resource path'),
  ...mapIds(['C3'], 'attentionDiegeticRejection.test.ts', 'rejects an unavailable independently-owned communication without a commit, identifier, or scheduler change'),

  ...mapIds(['G1', 'G3'], 'attentionDiagnosticPartition.test.ts', 'maps every closed internal literal exactly once and reaches every D11 type-A code'),
  ...mapIds(['G2', 'G4'], 'attentionDiagnosticExternalSink.test.ts', 'refuses engine-only emission and type-A aggregation while allowing only an individual type-A code'),

  ...mapIds(['B1', 'B2'], 'attentionNarrativePatternResourcePolicy.test.ts', 'drops the thirteenth: five + four + four all survive their per-type caps, then global caps to twelve'),
  ...mapIds(['B3', 'B4'], 'attentionMixedCandidateOrdering.test.ts', 'applies the mixed-family candidate cap of 4 after the complete order'),
  ...mapIds(['B5', 'B7'], 'attentionResourceLimits.test.ts', 'keeps every resource decision out of the player-observable projection'),
  ...mapIds(['B6'], 'attentionP3Equivalence.test.ts', 'the hidden candidate consumes no candidate/resource budget and remains authoritatively open and untouched'),
  ...mapIds(['B8', 'B9', 'B10'], 'attentionNarrativePatternResourcePolicy.test.ts', 'retains exactly six of a type and reports no breach'),
  ...mapIds(['B11', 'B12'], 'attentionNarrativePatternResourcePolicy.test.ts', 'drops the fifth after ordering and records the engine-only breach'),
  ...mapIds(['B13'], 'attentionResourceLimits.test.ts', 'produces byte-stable retained/dropped identity sets under reversed input order'),
  ...mapIds(['B14'], 'attentionNarrativePatternResourcePolicy.test.ts', 'drops the thirteenth: five + four + four all survive their per-type caps, then global caps to twelve'),
  ...mapIds(['B15'], 'attentionResourceLimits.test.ts', 'produces byte-stable retained/dropped identity sets under reversed input order'),
  ...mapIds(['B16'], 'attentionMixedCandidateOrdering.test.ts', 'applies the mixed-family candidate cap of 4 after the complete order'),

  ...mapIds(['K1'], 'attentionCandidateCacheKey.test.ts', 'has a variation case for every declared field, so none is unwitnessed'),
  ...mapIds(['K2'], 'attentionCandidateCacheKey.test.ts', 'keeps every ranking-only coordinate out of the derivation key material entirely'),
  ...mapIds(['K3'], 'attentionCandidateCacheKey.test.ts', 'refuses a missing ranking-policy hash and a missing eligibility/resource state'),

  ...mapIds(['V1'], 'attentionCacheRevalidation.test.ts', 'V1 -- a candidate still legal at revalidation is presented, and both LSNs appear in the trace'),
  ...mapIds(['V2'], 'attentionCacheRevalidation.test.ts', 'V2 -- a candidate that disappears between the two coordinates is not presented, and revalidation records it explicitly'),
  ...mapIds(['V3'], 'attentionCacheRevalidation.test.ts', 'V3 -- a candidate that resolves between the two coordinates is not presented, and the attention layer never writes the lifecycle'),
  ...mapIds(['V4'], 'attentionCacheRevalidation.test.ts', 'V4 -- opening provenance becoming private between the two coordinates revokes presentation'),
  ...mapIds(['V5', 'V6'], 'attentionRevealerLegality.test.ts', 'makes V5 and V6 typed refusals'),
  ...mapIds(['V7'], 'attentionCacheRevalidation.test.ts', 'a stale/mismatched revalidation accessor-contract version refuses (stale-snapshot) rather than reusing the original view'),
  ...mapIds(['V8'], 'attentionLedger.test.ts', 'the first success is recorded and the candidate remains eligible for its second attempt after cooldown'),

  ...mapIds(['L1'], 'attentionLedgerStaticClosure.test.ts', 'the canonical derivation cache key reads its dependencies from an explicit bundle, not module ambient state'),
  ...mapIds(['L2', 'L3'], 'attentionLedger.test.ts', 'does not force completion, substitute an actor, or resolve anything on non-engagement'),
  ...mapIds(['L4'], 'attentionLedgerStaticClosure.test.ts', 'is not merely an allowlist claim: no detection/construction allowlist entry admits the ledger either'),
  ...mapIds(['L5'], 'attentionLedgerStaticClosure.test.ts', 'is named by exactly one module beyond the ledger itself: the A5 replay harness, which records a ledger append result rather than feeding one back into detection'),
  ...mapIds(['L6'], 'attentionCandidateCacheKey.test.ts', 'builds a default bundle from the pinned constants, with no field left ambient'),

  ...mapIds(['T1'], 'attentionZeroModelProbe.test.ts', 'completes the whole path with the count still at zero'),
  ...mapIds(['T2'], 'attentionTemplate.test.ts', 'adds no assertion: every content token came from the package'),
  ...mapIds(['T3'], 'attentionTemplate.test.ts', 'names the pinned version in the first line and in the identity'),
  ...mapIds(['T4'], 'attentionTemplate.test.ts', 'refuses a missing, unsupported, or mismatched template version'),
  ...mapIds(['T5', 'T6', 'T7'], 'attentionLedger.test.ts', 'keeps a rendering failure distinct from player non-engagement'),
]

const expectedFixtureIds = [
  'S1', 'S2',
  ...range('P2-', 1, 4), 'P2-N1', 'P2-N2', 'P2-N3', 'P2-N6', 'P2-N7', 'P2-N8', 'P2-N9', 'P2-PC1',
  ...range('P3-', 1, 5),
  ...range('Q', 1, 9),
  ...range('D', 1, 12),
  ...range('I', 1, 8),
  ...range('M', 1, 35),
  ...range('R', 1, 23),
  ...range('C', 1, 3),
  ...range('G', 1, 4),
  ...range('B', 1, 16),
  ...range('K', 1, 3),
  ...range('V', 1, 8),
  ...range('L', 1, 6),
  ...range('T', 1, 7),
] as const

describe('attention fixture coverage index', () => {
  it('maps every replay-spec ID to a named executing test and counts the P3-5/Q1 alias exactly once', () => {
    expect(fixtureCoverageIndex.map(({ id }) => id).sort()).toEqual([...expectedFixtureIds].sort())

    const canonicalIds = fixtureCoverageIndex.map(({ canonicalId }) => canonicalId)
    expect(canonicalIds.filter((id) => id === 'P3-5')).toHaveLength(2)
    expect(new Set(canonicalIds).size).toBe(152)

    for (const { id, canonicalId, file, testTitle } of fixtureCoverageIndex) {
      const source = readFileSync(`${here}${file}`, 'utf8')
      expect(source, `${id} must name a test registration in ${file}`).toContain(`it('${testTitle}'`)
      expect(canonicalId).toMatch(/^(?:S|P2-|P3-|Q|D|I|M|R|C|G|B|K|V|L|T)/)
    }
  })
})
