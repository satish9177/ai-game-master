import { describe, expect, it } from 'vitest'
import {
  aidRecord,
  mintPatternEvidenceViews,
  runNarrativePatternMonitor,
} from './attentionNarrativePatternScenario'
import type { ProofPatternEvidenceRecordInput } from './attentionPatternEvidenceContracts'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'

function run(records: readonly ProofPatternEvidenceRecordInput[], snapshot: number) {
  const result = runNarrativePatternMonitor(records, snapshot)
  if (result.kind !== 'ok') throw new Error(`monitor refused: ${result.reason}`)
  return result
}

function aidInstances(instances: readonly NarrativePatternInstance[]) {
  return instances.filter((instance) => instance.patternType === 'reciprocal_public_aid')
}

function satisfiedSupports(instances: readonly NarrativePatternInstance[]) {
  return aidInstances(instances)
    .filter((instance) => instance.monitorVerdict === 'satisfied')
    .map((instance) => instance.supportingRecordIdentityTuple.map((entry) => entry.recordId))
}

describe('B3 monitor — reciprocal overlap', () => {
  it('produces two overlapping matches sharing the middle record', () => {
    const result = run([
      aidRecord('a1', 10, 'A', 'B'),
      aidRecord('a2', 12, 'B', 'A'),
      aidRecord('a3', 14, 'A', 'B'),
    ], 14)
    const supports = satisfiedSupports(result.instances)
    expect(supports).toHaveLength(2)
    expect(supports).toContainEqual(['a1', 'a2'])
    expect(supports).toContainEqual(['a2', 'a3'])
  })

  it('keeps the two shared-middle matches as distinct identities (no false dedupe)', () => {
    const result = run([
      aidRecord('a1', 10, 'A', 'B'),
      aidRecord('a2', 12, 'B', 'A'),
      aidRecord('a3', 14, 'A', 'B'),
    ], 14)
    const satisfied = aidInstances(result.instances).filter((i) => i.monitorVerdict === 'satisfied')
    const ids = new Set(satisfied.map((i) => i.patternInstanceId))
    expect(ids.size).toBe(2)
  })

  it('a return completes only the earliest open partial, leaving later starts active', () => {
    // aid(A,B), aid(A,B), aid(B,A): the return completes the earliest A->B start.
    const result = run([
      aidRecord('a1', 10, 'A', 'B'),
      aidRecord('a2', 11, 'A', 'B'),
      aidRecord('a3', 13, 'B', 'A'),
    ], 13)
    const supports = satisfiedSupports(result.instances)
    expect(supports).toEqual([['a1', 'a3']])
    // a2 remains an active partial.
    const active = aidInstances(result.instances)
      .filter((i) => i.monitorVerdict === 'inconclusive' && i.supportingRecordIdentityTuple.length === 1)
      .map((i) => i.supportingRecordIdentityTuple[0]!.recordId)
    expect(active).toContain('a2')
  })

  it('is invariant to reversed source order for the overlap case', () => {
    const records = [
      aidRecord('a1', 10, 'A', 'B'),
      aidRecord('a2', 12, 'B', 'A'),
      aidRecord('a3', 14, 'A', 'B'),
    ]
    const forward = run(records, 14)
    const reversed = reconstructNarrativePatternInstances({
      patternEvidenceViews: [...mintPatternEvidenceViews(records)].reverse(),
      evaluationSnapshotLsn: 14,
    })
    if (reversed.kind !== 'ok') throw new Error('reversed refused')
    expect(JSON.stringify(reversed.instances)).toEqual(JSON.stringify(forward.instances))
  })

  it('does not infer reciprocity: verdict/annotation stay engine-only and assertions are direct', () => {
    const result = run([
      aidRecord('a1', 10, 'A', 'B'),
      aidRecord('a2', 12, 'B', 'A'),
    ], 12)
    const satisfied = aidInstances(result.instances).find((i) => i.monitorVerdict === 'satisfied')!
    // Each direct assertion is grounded in exactly one admitted aid record.
    expect(satisfied.directEvidenceAssertionInputs.every((a) => a.assertionKind === 'public_aid')).toBe(true)
    expect(satisfied.directEvidenceAssertionInputs.map((a) => a.sourceRecordId)).toEqual(['a1', 'a2'])
  })
})
