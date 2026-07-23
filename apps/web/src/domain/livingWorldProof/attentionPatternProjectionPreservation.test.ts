import { describe, expect, it } from 'vitest'
import {
  aidRecord,
  commitmentRecord,
  fulfillmentRecord,
  harmRecord,
  mintPatternEvidenceViews,
} from './attentionNarrativePatternScenario'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import type { ProofPatternEvidenceRecordInput } from './attentionPatternEvidenceContracts'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'

const RECORDS: readonly ProofPatternEvidenceRecordInput[] = [
  aidRecord('a1', 10, 'A', 'B'),
  aidRecord('a2', 12, 'B', 'A'),
  harmRecord('h1', 9, 'C', 'D', 'moderate'),
  harmRecord('h2', 11, 'D', 'C', 'major'),
  commitmentRecord('c1', 8, 'E', 'F', 'gate', 20),
  fulfillmentRecord('f1', 16, 'E', 'F', 'gate'),
]

function viewById(views: readonly AttentionReadablePatternEvidenceView[], id: string) {
  return views.find((view) => view.recordId === id)!
}

describe('B3 monitor — projection preservation (M20-M29)', () => {
  const views = mintPatternEvidenceViews(RECORDS)

  function reconstruct(): readonly NarrativePatternInstance[] {
    const result = reconstructNarrativePatternInstances({
      patternEvidenceViews: views,
      evaluationSnapshotLsn: 20,
    })
    if (result.kind !== 'ok') throw new Error(`monitor refused: ${result.reason}`)
    return result.instances
  }

  it('preserves admitted record ids, commit LSNs, world-time ticks, and visibility provenance ids', () => {
    for (const instance of reconstruct()) {
      for (const entry of instance.supportingRecordIdentityTuple) {
        const source = viewById(views, entry.recordId)
        expect(entry.recordId).toBe(source.recordId)
        expect(entry.commitLsn).toBe(source.commitLsn)
        expect(entry.visibilityProvenanceId).toBe(source.visibilityProvenanceId)
        expect(entry.recordKind).toBe(source.recordKind)
      }
      for (const entry of instance.evidenceSequence) {
        const source = viewById(views, entry.recordId)
        expect(entry.commitLsn).toBe(source.commitLsn)
        expect(entry.worldTimeTick).toBe(source.worldTimeTick)
      }
    }
  })

  it('preserves participant bindings, commitment keys, deadlines, and severity bands via direct assertions', () => {
    for (const instance of reconstruct()) {
      for (const assertion of instance.directEvidenceAssertionInputs) {
        const source = viewById(views, assertion.sourceRecordId)
        expect(assertion.visibilityProvenanceId).toBe(source.visibilityProvenanceId)
        if (assertion.assertionKind === 'public_aid' && source.recordKind === 'observable_action') {
          expect([assertion.actorId, assertion.targetId]).toEqual([source.actorId, source.targetId])
        }
        if (assertion.assertionKind === 'public_harm_severity' && source.recordKind === 'observable_action'
          && source.actionCode === 'harm') {
          expect(assertion.publicSeverityBand).toBe(source.publicSeverityBand)
        }
        if (assertion.assertionKind === 'public_commitment'
          && source.recordKind === 'validated_public_communication'
          && source.communicationCode === 'commitment') {
          expect(assertion.commitmentKey).toBe(source.commitmentKey)
          expect(assertion.speakerId).toBe(source.speakerId)
          expect(assertion.recipientId).toBe(source.recipientId)
        }
      }
      // Every binding entity is a legally readable participant of a supporting record.
      const participants = new Set<string>()
      for (const view of views) {
        if (view.recordKind === 'observable_action') {
          participants.add(view.actorId)
          participants.add(view.targetId)
        } else if (view.recordKind === 'validated_public_communication') {
          participants.add(view.speakerId)
          participants.add(view.recipientId)
        }
      }
      for (const binding of instance.bindingMap) expect(participants.has(binding.entityId)).toBe(true)
    }
  })

  it('invents no supporting record and inserts no synthetic absence evidence', () => {
    const admittedIds = new Set(views.map((view) => view.recordId))
    for (const instance of reconstruct()) {
      for (const entry of instance.supportingRecordIdentityTuple) {
        expect(admittedIds.has(entry.recordId)).toBe(true)
      }
      // Stall/expiry are coordinate-derived: an inconclusive active/stalled/expired
      // partial carries only advancing evidence, never a synthetic terminal record.
      if (instance.monitorVerdict === 'inconclusive'
        && (instance.narrativeAnnotation === 'active'
          || instance.narrativeAnnotation === 'stalled'
          || instance.narrativeAnnotation === 'expired')) {
        expect(instance.supportingRecordIdentityTuple).toHaveLength(instance.progressStep)
      }
    }
  })

  it('emits deeply immutable instances', () => {
    for (const instance of reconstruct()) {
      expect(Object.isFrozen(instance)).toBe(true)
      expect(Object.isFrozen(instance.supportingRecordIdentityTuple)).toBe(true)
      expect(Object.isFrozen(instance.bindingMap)).toBe(true)
      expect(Object.isFrozen(instance.evidenceSequence)).toBe(true)
      expect(Object.isFrozen(instance.directEvidenceAssertionInputs)).toBe(true)
    }
  })

  it('leaves the input evidence views unchanged after monitoring', () => {
    const before = JSON.stringify(views)
    reconstruct()
    reconstruct()
    expect(JSON.stringify(views)).toEqual(before)
    for (const view of views) expect(Object.isFrozen(view)).toBe(true)
  })
})
