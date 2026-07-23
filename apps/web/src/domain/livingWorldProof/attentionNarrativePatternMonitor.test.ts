import { describe, expect, it } from 'vitest'
import {
  aidRecord,
  availabilityRecord,
  commitmentRecord,
  fulfillmentRecord,
  harmRecord,
  retractRecord,
  runNarrativePatternMonitor,
} from './attentionNarrativePatternScenario'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'
import type { NarrativePatternType } from './attentionNarrativePatternIdentity'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import { mintPatternEvidenceViews } from './attentionNarrativePatternScenario'

function ok(records: Parameters<typeof runNarrativePatternMonitor>[0], snapshot: number) {
  const result = runNarrativePatternMonitor(records, snapshot)
  if (result.kind !== 'ok') throw new Error(`monitor refused: ${result.reason}`)
  return result
}

function ofType(
  instances: readonly NarrativePatternInstance[],
  patternType: NarrativePatternType,
): readonly NarrativePatternInstance[] {
  return instances.filter((instance) => instance.patternType === patternType)
}

function annotationOf(instance: NarrativePatternInstance): string {
  return instance.monitorVerdict === 'inconclusive' ? instance.narrativeAnnotation : instance.monitorVerdict
}

describe('B3 monitor — reciprocal_public_aid', () => {
  it('creates an active partial from a single aid start', () => {
    const result = ok([aidRecord('aid-1', 10, 'A', 'B')], 12)
    const aid = ofType(result.instances, 'reciprocal_public_aid')
    expect(aid).toHaveLength(1)
    expect(aid[0]!.monitorVerdict).toBe('inconclusive')
    expect(annotationOf(aid[0]!)).toBe('active')
    expect(aid[0]!.progressStep).toBe(1)
  })

  it('completes on reverse aid inside the horizon', () => {
    const result = ok([aidRecord('aid-1', 10, 'A', 'B'), aidRecord('aid-2', 15, 'B', 'A')], 15)
    const satisfied = ofType(result.instances, 'reciprocal_public_aid')
      .filter((instance) => instance.monitorVerdict === 'satisfied')
    expect(satisfied).toHaveLength(1)
    expect(satisfied[0]!.supportingRecordIdentityTuple.map((entry) => entry.recordId))
      .toEqual(['aid-1', 'aid-2'])
  })

  it('completes at exactly E1 + 12 but refuses a return at E1 + 13', () => {
    const onHorizon = ok([aidRecord('aid-1', 10, 'A', 'B'), aidRecord('aid-2', 22, 'B', 'A')], 22)
    expect(
      ofType(onHorizon.instances, 'reciprocal_public_aid')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(true)

    const late = ok([aidRecord('aid-1', 10, 'A', 'B'), aidRecord('aid-2', 23, 'B', 'A')], 23)
    // aid-1 partial never completes (return too late); aid-2 starts its own partial.
    expect(
      ofType(late.instances, 'reciprocal_public_aid')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(false)
  })

  it('violates on harm(B,A) before completion, and refuses a late harm', () => {
    const violated = ok([aidRecord('aid-1', 10, 'A', 'B'), harmRecord('harm-1', 14, 'B', 'A')], 14)
    expect(
      ofType(violated.instances, 'reciprocal_public_aid')
        .some((instance) => instance.monitorVerdict === 'violated'),
    ).toBe(true)

    const lateHarm = ok([aidRecord('aid-1', 10, 'A', 'B'), harmRecord('harm-1', 23, 'B', 'A')], 23)
    expect(
      ofType(lateHarm.instances, 'reciprocal_public_aid')
        .some((instance) => instance.monitorVerdict === 'violated'),
    ).toBe(false)
  })

  it('stalls at delta 4 and expires at horizon + 1', () => {
    const stalled = ok([aidRecord('aid-1', 10, 'A', 'B')], 14)
    expect(annotationOf(ofType(stalled.instances, 'reciprocal_public_aid')[0]!)).toBe('stalled')

    const expired = ok([aidRecord('aid-1', 10, 'A', 'B')], 23)
    expect(annotationOf(ofType(expired.instances, 'reciprocal_public_aid')[0]!)).toBe('expired')
  })

  it('abandons on public departure of a participant', () => {
    const result = ok([aidRecord('aid-1', 10, 'A', 'B'), availabilityRecord('dep-1', 12, 'B')], 12)
    expect(
      ofType(result.instances, 'reciprocal_public_aid')
        .some((instance) => annotationOf(instance) === 'abandoned'),
    ).toBe(true)
  })

  it('produces two completed instances for aid(A,B), aid(B,A), aid(A,B)', () => {
    const result = ok([
      aidRecord('aid-1', 10, 'A', 'B'),
      aidRecord('aid-2', 12, 'B', 'A'),
      aidRecord('aid-3', 14, 'A', 'B'),
    ], 14)
    const satisfied = ofType(result.instances, 'reciprocal_public_aid')
      .filter((instance) => instance.monitorVerdict === 'satisfied')
    const supports = satisfied.map((instance) => instance.supportingRecordIdentityTuple.map((e) => e.recordId))
    expect(satisfied).toHaveLength(2)
    expect(supports).toContainEqual(['aid-1', 'aid-2'])
    expect(supports).toContainEqual(['aid-2', 'aid-3'])
  })

  it('is invariant to reversed source order', () => {
    const forward = ok([
      aidRecord('aid-1', 10, 'A', 'B'),
      aidRecord('aid-2', 12, 'B', 'A'),
      aidRecord('aid-3', 14, 'A', 'B'),
    ], 14)
    const reversedViews = [...mintPatternEvidenceViews([
      aidRecord('aid-1', 10, 'A', 'B'),
      aidRecord('aid-2', 12, 'B', 'A'),
      aidRecord('aid-3', 14, 'A', 'B'),
    ])].reverse()
    const reversed = reconstructNarrativePatternInstances({
      patternEvidenceViews: reversedViews,
      evaluationSnapshotLsn: 14,
    })
    if (reversed.kind !== 'ok') throw new Error('reversed refused')
    expect(JSON.stringify(reversed.instances)).toEqual(JSON.stringify(forward.instances))
  })
})

describe('B3 monitor — public_commitment_fulfilled', () => {
  it('is active while open, satisfied on keyed fulfillment before the deadline', () => {
    const active = ok([commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20)], 12)
    expect(annotationOf(ofType(active.instances, 'public_commitment_fulfilled')[0]!)).toBe('active')

    const satisfied = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      fulfillmentRecord('f-1', 18, 'A', 'B', 'gate'),
    ], 18)
    expect(
      ofType(satisfied.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(true)
  })

  it('refuses fulfillment with the wrong key or wrong participants', () => {
    const wrongKey = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      fulfillmentRecord('f-1', 18, 'A', 'B', 'other'),
    ], 18)
    expect(
      ofType(wrongKey.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(false)

    const wrongParties = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      fulfillmentRecord('f-1', 18, 'B', 'A', 'gate'),
    ], 18)
    expect(
      ofType(wrongParties.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(false)
  })

  it('fulfills at exactly the deadline but refuses one LSN late', () => {
    const onDeadline = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      fulfillmentRecord('f-1', 20, 'A', 'B', 'gate'),
    ], 20)
    expect(
      ofType(onDeadline.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(true)

    const late = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      fulfillmentRecord('f-1', 21, 'A', 'B', 'gate'),
    ], 21)
    expect(
      ofType(late.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'satisfied'),
    ).toBe(false)
    expect(
      ofType(late.instances, 'public_commitment_fulfilled')
        .some((instance) => annotationOf(instance) === 'expired'),
    ).toBe(true)
  })

  it('violates on retraction of the same key before fulfillment', () => {
    const result = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      retractRecord('r-1', 14, 'A', 'B', 'gate'),
    ], 14)
    expect(
      ofType(result.instances, 'public_commitment_fulfilled')
        .some((instance) => instance.monitorVerdict === 'violated'),
    ).toBe(true)
  })

  it('lets different commitment keys overlap independently', () => {
    const result = ok([
      commitmentRecord('c-1', 10, 'A', 'B', 'gate', 20),
      commitmentRecord('c-2', 11, 'A', 'B', 'bridge', 21),
    ], 12)
    expect(ofType(result.instances, 'public_commitment_fulfilled')).toHaveLength(2)
  })
})
