import { describe, expect, it } from 'vitest'
import {
  availabilityRecord,
  harmRecord,
  mintPatternEvidenceViews,
  reconcileActionRecord,
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

function conflicts(instances: readonly NarrativePatternInstance[]): readonly NarrativePatternInstance[] {
  return instances.filter((instance) => instance.patternType === 'public_conflict_escalation')
}

function supports(instance: NarrativePatternInstance): readonly string[] {
  return instance.supportingRecordIdentityTuple.map((entry) => entry.recordId)
}

/** Children under E1 are the [harm-1, ...] instances whose start record is harm-1. */
function childrenOfStart(
  instances: readonly NarrativePatternInstance[],
  startRecordId: string,
): readonly NarrativePatternInstance[] {
  return conflicts(instances).filter((instance) => (
    instance.creationProvenance.startRecordId === startRecordId
    && instance.supportingRecordIdentityTuple.length >= 2
  ))
}

describe('B3 monitor — conflict fork automaton', () => {
  it('one parent, one child: the E1-only parent is internal once a child exists', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'moderate'),
      harmRecord('h2', 12, 'B', 'A', 'major'),
    ], 12)
    const children = childrenOfStart(result.instances, 'h1')
    expect(children).toHaveLength(1)
    expect(supports(children[0]!)).toEqual(['h1', 'h2'])
    // No emitted E1-only parent for h1 (it has a child).
    expect(conflicts(result.instances).some((i) => supports(i).length === 1 && supports(i)[0] === 'h1'))
      .toBe(false)
  })

  it('retains two canonical children per parent', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'moderate'),
    ], 13)
    const children = childrenOfStart(result.instances, 'h1')
    expect(children.map(supports).sort()).toEqual([['h1', 'h2'], ['h1', 'h3']].sort())
  })

  it('rejects the third compatible reply with a trusted fork diagnostic', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'moderate'),
      harmRecord('h4', 14, 'B', 'A', 'moderate'),
    ], 14)
    expect(childrenOfStart(result.instances, 'h1')).toHaveLength(2)
    const rejection = result.diagnostics.find((d) => (
      d.diagnosticKind === 'fork-child-cap-exceeded' && d.recordId === 'h4'
    ))
    expect(rejection?.detail).toContain('resource_limit_exceeded')
    // The rejected reply never appears in any child under h1.
    expect(childrenOfStart(result.instances, 'h1').some((i) => supports(i).includes('h4'))).toBe(false)
  })

  it('orders same-LSN replies by recordId when the cap forces a drop', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('r-c', 12, 'B', 'A', 'moderate'),
      harmRecord('r-a', 12, 'B', 'A', 'moderate'),
      harmRecord('r-b', 12, 'B', 'A', 'moderate'),
    ], 12)
    const retained = childrenOfStart(result.instances, 'h1').map((i) => supports(i)[1]).sort()
    // The two lowest recordIds at the tie LSN are retained: r-a, r-b.
    expect(retained).toEqual(['r-a', 'r-b'])
    expect(result.diagnostics.some((d) => d.diagnosticKind === 'fork-child-cap-exceeded' && d.recordId === 'r-c'))
      .toBe(true)
  })

  it('lets one reply extend multiple compatible parents', () => {
    const result = run([
      harmRecord('e1a', 10, 'A', 'B', 'minor'),
      harmRecord('e1b', 11, 'A', 'B', 'minor'),
      harmRecord('e2', 13, 'B', 'A', 'moderate'),
    ], 13)
    expect(childrenOfStart(result.instances, 'e1a').map(supports)).toContainEqual(['e1a', 'e2'])
    expect(childrenOfStart(result.instances, 'e1b').map(supports)).toContainEqual(['e1b', 'e2'])
  })

  it('one E3 completes every compatible retained child', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'moderate'),
      harmRecord('h4', 15, 'A', 'B', 'major'),
    ], 15)
    const satisfied = childrenOfStart(result.instances, 'h1')
      .filter((instance) => instance.monitorVerdict === 'satisfied')
    expect(satisfied.map(supports).sort()).toEqual([['h1', 'h2', 'h4'], ['h1', 'h3', 'h4']].sort())
  })

  it('an incompatible E3 (severity not strictly greater) advances no child', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'major'),
      harmRecord('h4', 15, 'A', 'B', 'major'),
    ], 15)
    expect(childrenOfStart(result.instances, 'h1').some((i) => i.monitorVerdict === 'satisfied')).toBe(false)
  })

  it('preserves sibling independence when one child completes and another does not', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'major'),
      harmRecord('h4', 15, 'A', 'B', 'major'),
    ], 15)
    const children = childrenOfStart(result.instances, 'h1')
    const satisfied = children.filter((i) => i.monitorVerdict === 'satisfied')
    const active = children.filter((i) => i.monitorVerdict === 'inconclusive')
    expect(satisfied.map(supports)).toEqual([['h1', 'h2', 'h4']])
    expect(active.map(supports)).toEqual([['h1', 'h3']])
  })

  it('reconciliation invalidates every matching live branch', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'moderate'),
      reconcileActionRecord('rec', 15, 'A', 'B'),
    ], 15)
    const children = childrenOfStart(result.instances, 'h1')
    expect(children).toHaveLength(2)
    expect(children.every((i) => i.monitorVerdict === 'violated')).toBe(true)
  })

  it('completes at exactly E1 + 16 and refuses at E1 + 17', () => {
    const onHorizon = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 26, 'A', 'B', 'major'),
    ], 26)
    expect(childrenOfStart(onHorizon.instances, 'h1').some((i) => i.monitorVerdict === 'satisfied')).toBe(true)

    const late = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 27, 'A', 'B', 'major'),
    ], 27)
    expect(childrenOfStart(late.instances, 'h1').some((i) => i.monitorVerdict === 'satisfied')).toBe(false)
  })

  it('expires an unresolved conflict after E1 + 16', () => {
    const result = run([harmRecord('h1', 10, 'A', 'B', 'minor')], 27)
    const parent = conflicts(result.instances).find((i) => supports(i).length === 1)
    expect(parent?.monitorVerdict).toBe('inconclusive')
    expect(parent && parent.monitorVerdict === 'inconclusive' && parent.narrativeAnnotation).toBe('expired')
  })

  it('abandons live branches when a participant departs', () => {
    const result = run([
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      availabilityRecord('dep', 14, 'A'),
    ], 14)
    const children = childrenOfStart(result.instances, 'h1')
    expect(children.some((i) => i.monitorVerdict === 'inconclusive' && i.narrativeAnnotation === 'abandoned'))
      .toBe(true)
  })

  it('is invariant to reversed insertion order', () => {
    const records = [
      harmRecord('h1', 10, 'A', 'B', 'minor'),
      harmRecord('h2', 12, 'B', 'A', 'moderate'),
      harmRecord('h3', 13, 'B', 'A', 'moderate'),
      harmRecord('h4', 15, 'A', 'B', 'major'),
    ]
    const forward = run(records, 15)
    const reversed = reconstructNarrativePatternInstances({
      patternEvidenceViews: [...mintPatternEvidenceViews(records)].reverse(),
      evaluationSnapshotLsn: 15,
    })
    if (reversed.kind !== 'ok') throw new Error('reversed refused')
    expect(JSON.stringify(reversed.instances)).toEqual(JSON.stringify(forward.instances))
  })
})
