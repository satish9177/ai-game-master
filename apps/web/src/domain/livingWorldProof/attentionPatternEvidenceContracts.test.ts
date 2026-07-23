import { describe, expect, it } from 'vitest'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
  isStructurallyValidAttentionReadablePatternEvidenceView,
  isStructurallyValidProofPatternEvidenceRecord,
} from './attentionPatternEvidenceContracts'

const VERSION = ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION

function sourceCommon(recordId: string, commitLsn = 10) {
  return {
    evidenceViewContractVersion: VERSION,
    recordId,
    commitLsn,
    worldTimeTick: commitLsn + 100,
    visibilityProvenance: { visibility: 'public' as const, provenanceId: `public-${recordId}` },
  }
}

const validActionInputs = [
  ['aid', {
    ...sourceCommon('action-aid'),
    recordKind: 'observable_action',
    actionCode: 'aid',
    actorId: 'a',
    targetId: 'b',
  }],
  ['harm', {
    ...sourceCommon('action-harm'),
    recordKind: 'observable_action',
    actionCode: 'harm',
    actorId: 'a',
    targetId: 'b',
    publicSeverityBand: 'major',
  }],
  ['fulfill_commitment', {
    ...sourceCommon('action-fulfill'),
    recordKind: 'observable_action',
    actionCode: 'fulfill_commitment',
    actorId: 'a',
    targetId: 'b',
    commitmentKey: 'key-1',
  }],
  ['reconcile', {
    ...sourceCommon('action-reconcile'),
    recordKind: 'observable_action',
    actionCode: 'reconcile',
    actorId: 'a',
    targetId: 'b',
  }],
] as const

const validCommunicationInputs = [
  ['commitment', {
    ...sourceCommon('communication-commitment'),
    recordKind: 'validated_public_communication',
    communicationCode: 'commitment',
    speakerId: 'a',
    recipientId: 'b',
    commitmentKey: 'key-1',
    publicDeadlineLsn: 10,
  }],
  ['retract_commitment', {
    ...sourceCommon('communication-retract'),
    recordKind: 'validated_public_communication',
    communicationCode: 'retract_commitment',
    speakerId: 'a',
    recipientId: 'b',
    commitmentKey: 'key-1',
  }],
  ['explicit_refusal', {
    ...sourceCommon('communication-refusal'),
    recordKind: 'validated_public_communication',
    communicationCode: 'explicit_refusal',
    speakerId: 'a',
    recipientId: 'b',
    commitmentKey: 'key-1',
  }],
  ['reconciliation', {
    ...sourceCommon('communication-reconciliation'),
    recordKind: 'validated_public_communication',
    communicationCode: 'reconciliation',
    speakerId: 'a',
    recipientId: 'b',
  }],
] as const

describe('B1 pattern-evidence contracts', () => {
  it.each(validActionInputs)('accepts the exact %s action field matrix', (_code, input) => {
    const record = createProofPatternEvidenceRecord(input)
    expect(isStructurallyValidProofPatternEvidenceRecord(record)).toBe(true)
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.visibilityProvenance)).toBe(true)
  })

  it.each(validCommunicationInputs)(
    'accepts the exact %s communication field matrix',
    (_code, input) => {
      const record = createProofPatternEvidenceRecord(input)
      expect(isStructurallyValidProofPatternEvidenceRecord(record)).toBe(true)
      expect(Object.isFrozen(record)).toBe(true)
    },
  )

  it('accepts the exact availability variant and builds an immutable snapshot', () => {
    const availability = createProofPatternEvidenceRecord({
      ...sourceCommon('availability-dead'),
      recordKind: 'world_observable_availability',
      availabilityCode: 'dead',
      entityId: 'c',
    })
    const snapshot = createProofPatternEvidenceSnapshot({
      evidenceViewContractVersion: VERSION,
      records: [availability],
    })

    expect(availability.recordKind).toBe('world_observable_availability')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.records)).toBe(true)
  })

  const invalidActions = [
    ['aid with commitment key', {
      ...validActionInputs[0][1],
      commitmentKey: 'forbidden',
    }],
    ['aid with severity', {
      ...validActionInputs[0][1],
      publicSeverityBand: 'major',
    }],
    ['harm without severity', {
      ...sourceCommon('harm-no-severity'),
      recordKind: 'observable_action',
      actionCode: 'harm',
      actorId: 'a',
      targetId: 'b',
    }],
    ['harm with commitment key', {
      ...validActionInputs[1][1],
      commitmentKey: 'forbidden',
    }],
    ['fulfill commitment without key', {
      ...sourceCommon('fulfill-no-key'),
      recordKind: 'observable_action',
      actionCode: 'fulfill_commitment',
      actorId: 'a',
      targetId: 'b',
    }],
    ['fulfill commitment with severity', {
      ...validActionInputs[2][1],
      publicSeverityBand: 'major',
    }],
    ['reconcile with commitment key', {
      ...validActionInputs[3][1],
      commitmentKey: 'forbidden',
    }],
    ['reconcile with severity', {
      ...validActionInputs[3][1],
      publicSeverityBand: 'minor',
    }],
    ['present-but-undefined optional action field', {
      ...validActionInputs[0][1],
      commitmentKey: undefined,
    }],
  ] as const

  it.each(invalidActions)('rejects %s', (_label, input) => {
    expect(() => createProofPatternEvidenceRecord(input as never)).toThrow()
  })

  const invalidCommunications = [
    ['commitment without key', {
      ...sourceCommon('commitment-no-key'),
      recordKind: 'validated_public_communication',
      communicationCode: 'commitment',
      speakerId: 'a',
      recipientId: 'b',
      publicDeadlineLsn: 12,
    }],
    ['commitment without deadline', {
      ...sourceCommon('commitment-no-deadline'),
      recordKind: 'validated_public_communication',
      communicationCode: 'commitment',
      speakerId: 'a',
      recipientId: 'b',
      commitmentKey: 'key-1',
    }],
    ['commitment deadline before commit LSN', {
      ...validCommunicationInputs[0][1],
      publicDeadlineLsn: 9,
    }],
    ['commitment with unsafe deadline', {
      ...validCommunicationInputs[0][1],
      publicDeadlineLsn: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['retraction without key', {
      ...sourceCommon('retract-no-key'),
      recordKind: 'validated_public_communication',
      communicationCode: 'retract_commitment',
      speakerId: 'a',
      recipientId: 'b',
    }],
    ['retraction with deadline', {
      ...validCommunicationInputs[1][1],
      publicDeadlineLsn: 12,
    }],
    ['refusal without key', {
      ...sourceCommon('refusal-no-key'),
      recordKind: 'validated_public_communication',
      communicationCode: 'explicit_refusal',
      speakerId: 'a',
      recipientId: 'b',
    }],
    ['refusal with deadline', {
      ...validCommunicationInputs[2][1],
      publicDeadlineLsn: 12,
    }],
    ['reconciliation with key', {
      ...validCommunicationInputs[3][1],
      commitmentKey: 'forbidden',
    }],
    ['reconciliation with deadline', {
      ...validCommunicationInputs[3][1],
      publicDeadlineLsn: 12,
    }],
    ['present-but-undefined communication deadline', {
      ...validCommunicationInputs[1][1],
      publicDeadlineLsn: undefined,
    }],
  ] as const

  it.each(invalidCommunications)('rejects %s', (_label, input) => {
    expect(() => createProofPatternEvidenceRecord(input as never)).toThrow()
  })

  it.each([
    ['unsafe commit LSN', { commitLsn: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative world tick', { worldTimeTick: -1 }],
    ['unsupported action code', { actionCode: 'observe' }],
    ['blank actor id', { actorId: ' ' }],
    ['unsupported severity', { publicSeverityBand: 'extreme' }],
    ['extra arbitrary prose', { rawProse: 'interpret this event' }],
  ])('rejects %s at runtime', (_label, patch) => {
    expect(() => createProofPatternEvidenceRecord({
      ...validActionInputs[1][1],
      ...patch,
    } as never)).toThrow()
  })

  it('rejects caller symbols and inherited enumerable source data', () => {
    const withSymbol = { ...validActionInputs[0][1] } as Record<PropertyKey, unknown>
    withSymbol[Symbol('caller-data')] = 'forbidden'
    const inherited = Object.assign(
      Object.create({ privateBelief: 'forbidden' }) as Record<string, unknown>,
      validActionInputs[0][1],
    )

    expect(isStructurallyValidProofPatternEvidenceRecord(withSymbol)).toBe(false)
    expect(isStructurallyValidProofPatternEvidenceRecord(inherited)).toBe(false)
  })

  it('rejects unsupported versions, mutable snapshot records, and forged view semantics', () => {
    expect(() => createProofPatternEvidenceRecord({
      ...validActionInputs[0][1],
      evidenceViewContractVersion: 'unknown',
    } as never)).toThrow()

    expect(() => createProofPatternEvidenceSnapshot({
      evidenceViewContractVersion: VERSION,
      records: [{
        ...validActionInputs[0][1],
      } as never],
    })).toThrow(/exact immutable proof records/)

    expect(isStructurallyValidAttentionReadablePatternEvidenceView({
      evidenceViewContractVersion: VERSION,
      recordId: 'forged-harm',
      commitLsn: 1,
      worldTimeTick: 1,
      visibilityProvenanceId: 'public-1',
      recordKind: 'observable_action',
      actionCode: 'harm',
      actorId: 'a',
      targetId: 'b',
    })).toBe(false)
  })
})
