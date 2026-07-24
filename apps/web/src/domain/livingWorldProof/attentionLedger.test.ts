import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { QuestCandidate } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  ATTENTION_EXPOSURE_POLICY_VERSION,
  ATTENTION_LEDGER_POLICY_VERSION,
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
} from './attentionCandidatePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import { orderAttentionCandidates } from './attentionCandidateOrdering'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import {
  ATTENTION_LEDGER_FEATURE_KEYS,
  ATTENTION_LEDGER_RECORD_KEYS,
  appendAttentionLedgerRecord,
  attentionLedgerFeatures,
  createAttentionLedger,
} from './attentionLedger'
import type { AttentionLedger, AttentionLedgerAppendInput, AttentionLedgerOutcome } from './attentionLedger'

/**
 * A4 — the replay-local, non-authoritative Attention Ledger (surface C).
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D17 non-authoritative and one-way, D15 cooldown keyed on committed
 *    coordinates rather than wall clock, D2 surface C);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§24 L1-L3 ledger closure, §25 L5-L6 no online policy adaptation, §26 T6 a
 *    rendering failure is not non-engagement, §27 lifecycle preservation);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 immutable replay-local append sequence, no table or migration; §9 A4
 *    slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * The static half of the ledger's closure — that no Stage A module imports it, so
 * detection and A-prime construction provably cannot read it — is asserted in
 * `attentionLedgerStaticClosure.test.ts`, which is where the whole-tree evidence
 * lives. What is proven here is the record contract itself.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

function orderedCandidates(candidates: readonly QuestCandidate[]): readonly AttentionCandidate[] {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, access.openingCoordinateViews, Object.freeze([]))
  if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit these views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')
  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') throw new Error('expected the A3 total order to be total')
  return ordered.orderedCandidates
}

function openCandidate(id: string, provenanceId: string, openedAtLsn: number): QuestCandidate {
  return createProofQuestCandidate({
    id,
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn,
    openingProvenance: { visibility: 'public', provenanceId },
    legallyVisibleParties: ['player'],
    legallyVisiblePublicStakes: 'restore-public-trust',
  })
}

const FIRST = openCandidate('quest-a-open', 'consequence-public-31', 31)
const SECOND = openCandidate('quest-b-open', 'consequence-public-32', 32)

function emptyLedger(): AttentionLedger {
  const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (created.kind !== 'ok') throw new Error('expected an empty ledger')
  return created.ledger
}

/** Render one candidate through the real A4 presentation path. */
function renderedIdentity(attentionCandidate: AttentionCandidate): string {
  const built = buildAttentionRevealPackage(attentionCandidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (built.kind !== 'ok') throw new Error('expected a package')
  const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
  if (rendered.kind !== 'ok') throw new Error('expected rendered output')
  return rendered.outputIdentity
}

function appendInput(
  attentionCandidate: AttentionCandidate,
  outcome: AttentionLedgerOutcome,
): AttentionLedgerAppendInput {
  const carriesOutput = outcome === 'presentation-ready' || outcome === 'presentation-fallback'
  return {
    attentionCandidate,
    exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
    templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
    templateVersion: ATTENTION_TEMPLATE_VERSION,
    outcome,
    ...(carriesOutput ? { renderedOutputIdentity: renderedIdentity(attentionCandidate) } : {}),
  }
}

function appendOrThrow(
  ledger: AttentionLedger,
  attentionCandidate: AttentionCandidate,
  outcome: AttentionLedgerOutcome,
): AttentionLedger {
  const result = appendAttentionLedgerRecord(ledger, appendInput(attentionCandidate, outcome))
  if (result.kind !== 'ok') throw new Error('expected an append, got refusal: ' + result.reason)
  return result.ledger
}

describe('A4 — the ledger is created under an explicit, supported policy version', () => {
  it('creates an empty, frozen sequence', () => {
    const ledger = emptyLedger()

    expect(ledger.ledgerPolicyVersion).toBe(ATTENTION_LEDGER_POLICY_VERSION)
    expect(ledger.records).toEqual([])
    expect(Object.isFrozen(ledger)).toBe(true)
    expect(Object.isFrozen(ledger.records)).toBe(true)
  })

  it('refuses a missing or unsupported ledger policy version rather than defaulting one', () => {
    expect(createAttentionLedger({ ledgerPolicyVersion: '  ' }))
      .toEqual({ kind: 'refused', reason: 'missing-ledger-policy-version' })
    expect(createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v2' }))
      .toEqual({ kind: 'refused', reason: 'unsupported-ledger-policy-version' })
  })
})

describe('A4 — records are immutable, append-only, and deterministically identified', () => {
  it('returns a new ledger and leaves the previous one byte-identical', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const before = emptyLedger()
    const beforeBytes = canonicalSerialize(before)

    const after = appendOrThrow(before, first, 'presentation-ready')

    expect(canonicalSerialize(before)).toBe(beforeBytes)
    expect(before.records).toHaveLength(0)
    expect(after.records).toHaveLength(1)
    expect(after).not.toBe(before)
  })

  it('freezes every record, so an appended outcome cannot be edited afterwards', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(emptyLedger(), first, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected one record')

    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      (record as unknown as Record<string, unknown>).outcome = 'non-engagement'
    }).toThrow(TypeError)
  })

  it('carries the closed record field set, its version coordinates, and both ids', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(emptyLedger(), first, 'presentation-ready')
    const record = ledger.records[0]
    if (record === undefined) throw new Error('expected one record')

    expect(Object.keys(record).sort()).toEqual([...ATTENTION_LEDGER_RECORD_KEYS, 'renderedOutputIdentity'].sort())
    expect(record.ledgerPolicyVersion).toBe(ATTENTION_LEDGER_POLICY_VERSION)
    expect(record.exposurePolicyVersion).toBe(ATTENTION_EXPOSURE_POLICY_VERSION)
    expect(record.templateChannelPolicyVersion).toBe(ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION)
    expect(record.templateVersion).toBe(ATTENTION_TEMPLATE_VERSION)
    expect(record.accessorContractVersion).toBe(ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION)
    expect(record.canonicalizationVersion).toBe(first.canonicalizationVersion)
    expect(record.rankingSnapshotLsn).toBe(A1_RANKING_SNAPSHOT_LSN)
    expect(record.sourceKind).toBe('quest_candidate')
    expect(record.sourceId).toBe('quest-a-open')
    expect(record.candidateId).toBe(first.candidateId)
    expect(record.sequence).toBe(0)
    expect(record.recordId.startsWith(ATTENTION_LEDGER_POLICY_VERSION + ':')).toBe(true)
  })

  it('appends in the A3 total order it is given, with strictly increasing sequence', () => {
    const ordered = orderedCandidates([SECOND, FIRST])
    let ledger = emptyLedger()
    for (const attentionCandidate of ordered) {
      ledger = appendOrThrow(ledger, attentionCandidate, 'presentation-ready')
    }

    expect(ordered.map((attentionCandidate) => attentionCandidate.sourceId)).toEqual(['quest-a-open', 'quest-b-open'])
    expect(ledger.records.map((record) => record.sourceId)).toEqual(['quest-a-open', 'quest-b-open'])
    expect(ledger.records.map((record) => record.sequence)).toEqual([0, 1])
  })

  it('gives byte-identical records across repeated cold runs of the same inputs', () => {
    const runs = [0, 1].map(() => {
      const ordered = orderedCandidates([FIRST, SECOND])
      let ledger = emptyLedger()
      for (const attentionCandidate of ordered) {
        ledger = appendOrThrow(ledger, attentionCandidate, 'presentation-ready')
      }
      return canonicalSerialize(ledger)
    })

    expect(runs[1]).toBe(runs[0])
  })

  it('distinguishes a repeated presentation of the same candidate by its position', () => {
    const [first] = orderedCandidates([FIRST])
    if (first === undefined) throw new Error('expected a candidate')
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), first, 'presentation-ready'), first, 'presentation-ready')
    const [one, two] = ledger.records

    expect(one?.candidateId).toBe(two?.candidateId)
    expect(one?.recordId).not.toBe(two?.recordId)
    expect(ledger.records.map((record) => record.sequence)).toEqual([0, 1])
  })
})

describe('A4 — appends refuse rather than approximate', () => {
  const [base] = orderedCandidates([FIRST])
  if (base === undefined) throw new Error('expected a candidate')

  const refusals: [string, AttentionLedgerAppendInput, string][] = [
    [
      'an unsupported exposure policy version',
      { ...appendInput(base, 'presentation-ready'), exposurePolicyVersion: 'attention-exposure-policy-v2' },
      'unsupported-exposure-policy-version',
    ],
    [
      'a blank exposure policy version',
      { ...appendInput(base, 'presentation-ready'), exposurePolicyVersion: '' },
      'missing-exposure-policy-version',
    ],
    [
      'an unsupported template/channel policy version',
      { ...appendInput(base, 'presentation-ready'), templateChannelPolicyVersion: 'attention-template-channel-policy-v2' },
      'unsupported-template-channel-policy-version',
    ],
    [
      'a blank template/channel policy version',
      { ...appendInput(base, 'presentation-ready'), templateChannelPolicyVersion: ' ' },
      'missing-template-channel-policy-version',
    ],
    [
      'an unsupported template version',
      { ...appendInput(base, 'presentation-ready'), templateVersion: 'attention-extradiegetic-template-v2' },
      'unsupported-template-version',
    ],
    [
      'a later canonicalization version on the candidate',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, canonicalizationVersion: 'attention-candidate-canonicalization-v2' },
      },
      'unsupported-canonicalization-version',
    ],
    [
      'a blank accessor-contract version on the candidate',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, accessorContractVersion: '' },
      },
      'missing-accessor-contract-version',
    ],
    [
      'a ranking coordinate past the safe-integer ceiling',
      {
        ...appendInput(base, 'presentation-ready'),
        attentionCandidate: { ...base, rankingSnapshotLsn: Number.MAX_SAFE_INTEGER + 2 },
      },
      'ranking-snapshot-lsn-out-of-range',
    ],
    [
      'a blank source id',
      { ...appendInput(base, 'presentation-ready'), attentionCandidate: { ...base, sourceId: '  ' } },
      'missing-source-id',
    ],
    [
      'a blank candidate id',
      { ...appendInput(base, 'presentation-ready'), attentionCandidate: { ...base, candidateId: '' } },
      'missing-candidate-id',
    ],
    [
      'an outcome outside the closed set',
      { ...appendInput(base, 'presentation-ready'), outcome: 'presented-somehow' as unknown as AttentionLedgerOutcome },
      'unsupported-outcome',
    ],
  ]

  it.each(refusals)('refuses %s', (_label, input, reason) => {
    expect(appendAttentionLedgerRecord(emptyLedger(), input)).toEqual({ kind: 'refused', reason })
  })

  it('refuses a ledger value carrying an unsupported policy version', () => {
    const forged = { ledgerPolicyVersion: 'attention-ledger-policy-v2', records: [] } as unknown as AttentionLedger

    expect(appendAttentionLedgerRecord(forged, appendInput(base, 'presentation-ready')))
      .toEqual({ kind: 'refused', reason: 'unsupported-ledger-policy-version' })
  })

  it('refuses a rendered outcome with no output identity, and an unrendered one that claims output', () => {
    const rendered = appendInput(base, 'presentation-ready')
    const withoutIdentity = { ...rendered }
    delete (withoutIdentity as { renderedOutputIdentity?: string }).renderedOutputIdentity

    expect(appendAttentionLedgerRecord(emptyLedger(), withoutIdentity))
      .toEqual({ kind: 'refused', reason: 'missing-rendered-output-identity' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...appendInput(base, 'non-engagement'),
      renderedOutputIdentity: 'forged-output-identity',
    })).toEqual({ kind: 'refused', reason: 'unexpected-rendered-output-identity' })
    expect(appendAttentionLedgerRecord(emptyLedger(), {
      ...appendInput(base, 'presentation-failed'),
      renderedOutputIdentity: 'forged-output-identity',
    })).toEqual({ kind: 'refused', reason: 'unexpected-rendered-output-identity' })
  })

  it('leaves the ledger untouched when it refuses', () => {
    const ledger = appendOrThrow(emptyLedger(), base, 'presentation-ready')
    const before = canonicalSerialize(ledger)

    expect(appendAttentionLedgerRecord(ledger, { ...appendInput(base, 'presentation-ready'), templateVersion: 'x' }).kind)
      .toBe('refused')
    expect(canonicalSerialize(ledger)).toBe(before)
  })
})

describe('A4 — the ledger exposes only the declared exposure and cooldown inputs', () => {
  const [base] = orderedCandidates([FIRST])
  if (base === undefined) throw new Error('expected a candidate')

  it('projects exactly the pinned feature keys and nothing else', () => {
    const features = attentionLedgerFeatures(emptyLedger(), base.candidateId)

    expect(Object.keys(features).sort()).toEqual([...ATTENTION_LEDGER_FEATURE_KEYS])
    expect(ATTENTION_LEDGER_FEATURE_KEYS).toEqual([
      'exposureCount',
      'lastPresentedRankingSnapshotLsn',
      'nonEngagementCount',
      'repetitionCount',
    ])
    expect(features).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 0,
      lastPresentedRankingSnapshotLsn: null,
    })
  })

  it('counts exposures and repetitions, and keys cooldown on a committed coordinate', () => {
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), base, 'presentation-ready'), base, 'presentation-fallback')

    expect(attentionLedgerFeatures(ledger, base.candidateId)).toEqual({
      exposureCount: 2,
      repetitionCount: 1,
      nonEngagementCount: 0,
      // A committed ranking coordinate, never a wall-clock instant (D15).
      lastPresentedRankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })
  })

  it('keeps a rendering failure distinct from player non-engagement', () => {
    const failed = appendOrThrow(emptyLedger(), base, 'presentation-failed')
    const ignored = appendOrThrow(emptyLedger(), base, 'non-engagement')

    // A failure is neither an exposure nor a non-engagement (replay spec T6).
    expect(attentionLedgerFeatures(failed, base.candidateId)).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 0,
      lastPresentedRankingSnapshotLsn: null,
    })
    expect(attentionLedgerFeatures(ignored, base.candidateId)).toEqual({
      exposureCount: 0,
      repetitionCount: 0,
      nonEngagementCount: 1,
      lastPresentedRankingSnapshotLsn: null,
    })
  })

  it('scopes features to one candidate identity', () => {
    const ordered = orderedCandidates([FIRST, SECOND])
    const [first, second] = ordered
    if (first === undefined || second === undefined) throw new Error('expected two candidates')
    const ledger = appendOrThrow(appendOrThrow(emptyLedger(), first, 'presentation-ready'), second, 'non-engagement')

    expect(attentionLedgerFeatures(ledger, first.candidateId).exposureCount).toBe(1)
    expect(attentionLedgerFeatures(ledger, second.candidateId).exposureCount).toBe(0)
    expect(attentionLedgerFeatures(ledger, second.candidateId).nonEngagementCount).toBe(1)
  })

  it('does not force completion, substitute an actor, or resolve anything on non-engagement', () => {
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidates: [FIRST],
    })
    const snapshotBefore = canonicalSerialize(snapshot)
    const [only] = orderedCandidates([FIRST])
    if (only === undefined) throw new Error('expected a candidate')
    const candidateBefore = canonicalSerialize(only)

    appendOrThrow(appendOrThrow(emptyLedger(), only, 'non-engagement'), only, 'presentation-failed')

    // Nothing about the engine-owned record moved: same bytes, same lifecycle.
    expect(canonicalSerialize(snapshot)).toBe(snapshotBefore)
    expect(canonicalSerialize(only)).toBe(candidateBefore)
    expect(snapshot.candidates.map((candidate) => candidate.status)).toEqual(['open'])
  })
})
