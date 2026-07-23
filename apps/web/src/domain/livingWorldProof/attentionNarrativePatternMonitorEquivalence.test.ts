import { describe, expect, it } from 'vitest'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import type { ProofPatternEvidenceRecordInput } from './attentionPatternEvidenceContracts'
import { readAttentionReadablePatternEvidenceViews } from './attentionPatternEvidenceAccessor'
import {
  aidRecord,
  commitmentRecord,
  fulfillmentRecord,
  harmRecord,
  mintPatternEvidenceViews,
} from './attentionNarrativePatternScenario'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'

function bytes(records: readonly ProofPatternEvidenceRecordInput[], snapshot: number): string {
  const result = reconstructNarrativePatternInstances({
    patternEvidenceViews: mintPatternEvidenceViews(records),
    evaluationSnapshotLsn: snapshot,
  })
  if (result.kind !== 'ok') throw new Error(`monitor refused: ${result.reason}`)
  return JSON.stringify(result.instances)
}

const MIXED: readonly ProofPatternEvidenceRecordInput[] = [
  aidRecord('a1', 10, 'A', 'B'),
  aidRecord('a2', 12, 'B', 'A'),
  aidRecord('a3', 14, 'A', 'B'),
  harmRecord('h1', 11, 'C', 'D', 'minor'),
  harmRecord('h2', 13, 'D', 'C', 'moderate'),
  harmRecord('h3', 15, 'C', 'D', 'major'),
  commitmentRecord('c1', 9, 'E', 'F', 'gate', 20),
  fulfillmentRecord('f1', 18, 'E', 'F', 'gate'),
]

describe('B3 monitor — determinism and equivalence', () => {
  it('is byte-identical on repeated cold reconstruction', () => {
    expect(bytes(MIXED, 20)).toEqual(bytes(MIXED, 20))
  })

  it('is byte-identical under forward vs reverse input order', () => {
    const views = mintPatternEvidenceViews(MIXED)
    const forward = reconstructNarrativePatternInstances({ patternEvidenceViews: views, evaluationSnapshotLsn: 20 })
    const reversed = reconstructNarrativePatternInstances({
      patternEvidenceViews: [...views].reverse(),
      evaluationSnapshotLsn: 20,
    })
    if (forward.kind !== 'ok' || reversed.kind !== 'ok') throw new Error('refused')
    expect(JSON.stringify(reversed.instances)).toEqual(JSON.stringify(forward.instances))
  })

  it('resolves same-LSN records deterministically by recordId regardless of input order', () => {
    const tie: readonly ProofPatternEvidenceRecordInput[] = [
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('z-reply', 12, 'B', 'A', 'moderate'),
      harmRecord('a-reply', 12, 'B', 'A', 'moderate'),
      harmRecord('m-reply', 12, 'B', 'A', 'moderate'),
    ]
    const canonical = bytes(tie, 12)
    const shuffled = bytes([tie[2]!, tie[0]!, tie[3]!, tie[1]!], 12)
    expect(shuffled).toEqual(canonical)
  })

  it('holds no warm state: interleaved unrelated evaluations do not change output', () => {
    const cold = bytes(MIXED, 20)
    // Warm the monitor with unrelated evaluations first.
    bytes([aidRecord('x1', 1, 'X', 'Y')], 5)
    bytes([harmRecord('y1', 2, 'P', 'Q', 'major')], 30)
    bytes(MIXED, 14)
    const warm = bytes(MIXED, 20)
    expect(warm).toEqual(cold)
  })

  it('depends only on the committed prefix: future evidence beyond the snapshot is invisible', () => {
    const withFuture: readonly ProofPatternEvidenceRecordInput[] = [
      ...MIXED,
      aidRecord('future-1', 40, 'A', 'B'),
      harmRecord('future-2', 41, 'C', 'D', 'major'),
    ]
    expect(bytes(withFuture, 20)).toEqual(bytes(MIXED, 20))
  })

  it('emits no duplicate identities', () => {
    const result = reconstructNarrativePatternInstances({
      patternEvidenceViews: mintPatternEvidenceViews(MIXED),
      evaluationSnapshotLsn: 20,
    })
    if (result.kind !== 'ok') throw new Error('refused')
    const ids = result.instances.map((instance) => instance.patternInstanceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('excludes hidden/private evidence: a hidden invalidation cannot influence a partial', () => {
    // World A: aid start plus a PRIVATE harm(B,A) that would violate if admitted.
    const worldARecords = [
      createProofPatternEvidenceRecord(aidRecord('a1', 10, 'A', 'B')),
      createProofPatternEvidenceRecord({
        evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
        recordId: 'hidden-harm',
        commitLsn: 12,
        worldTimeTick: 1012,
        visibilityProvenance: { visibility: 'private' },
        recordKind: 'observable_action',
        actionCode: 'harm',
        actorId: 'B',
        targetId: 'A',
        publicSeverityBand: 'major',
      }),
    ]
    const snapshotA = createProofPatternEvidenceSnapshot({
      evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
      records: worldARecords,
    })
    const viewsA = readAttentionReadablePatternEvidenceViews(snapshotA, {
      evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    })
    if (viewsA.kind !== 'ok') throw new Error('world A refused')
    const resultA = reconstructNarrativePatternInstances({
      patternEvidenceViews: viewsA.views,
      evaluationSnapshotLsn: 13,
    })
    // World B: only the visible aid start.
    const resultB = reconstructNarrativePatternInstances({
      patternEvidenceViews: mintPatternEvidenceViews([aidRecord('a1', 10, 'A', 'B')]),
      evaluationSnapshotLsn: 13,
    })
    if (resultA.kind !== 'ok' || resultB.kind !== 'ok') throw new Error('refused')
    expect(JSON.stringify(resultA.instances)).toEqual(JSON.stringify(resultB.instances))
    expect(resultA.instances.some((i) => i.monitorVerdict === 'violated')).toBe(false)
  })

  it('refuses evidence views that are not accessor-minted', () => {
    const forged = [{
      evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
      recordId: 'forged',
      commitLsn: 10,
      worldTimeTick: 1010,
      visibilityProvenanceId: 'public-forged',
      recordKind: 'observable_action',
      actionCode: 'aid',
      actorId: 'A',
      targetId: 'B',
    }] as unknown as Parameters<typeof reconstructNarrativePatternInstances>[0]['patternEvidenceViews']
    const result = reconstructNarrativePatternInstances({
      patternEvidenceViews: forged,
      evaluationSnapshotLsn: 12,
    })
    expect(result).toEqual({ kind: 'refused', reason: 'input-not-accessor-minted' })
  })

  it('refuses an invalid evaluation snapshot', () => {
    const result = reconstructNarrativePatternInstances({
      patternEvidenceViews: mintPatternEvidenceViews([aidRecord('a1', 10, 'A', 'B')]),
      evaluationSnapshotLsn: -1,
    })
    expect(result).toEqual({ kind: 'refused', reason: 'invalid-evaluation-snapshot' })
  })
})
