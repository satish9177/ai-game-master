import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import type {
  ProofPatternEvidenceRecord,
  ProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import {
  isAttentionReadablePatternEvidenceViewFromAccessor,
  readAttentionReadablePatternEvidenceViews,
} from './attentionPatternEvidenceAccessor'
import {
  B1_PATTERN_EVIDENCE_REQUEST,
  buildAttentionPatternEvidenceB1Scenario,
} from './attentionPatternEvidenceScenario'

const VERSION = ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION

function availabilityRecord(
  index: number,
  visibility: 'public' | 'declassified' | 'private' | 'unobserved' = 'public',
  commitLsn = index,
) {
  return createProofPatternEvidenceRecord({
    evidenceViewContractVersion: VERSION,
    recordId: `record-${String(index).padStart(3, '0')}`,
    commitLsn,
    worldTimeTick: commitLsn + 100,
    visibilityProvenance: visibility === 'public' || visibility === 'declassified'
      ? { visibility, provenanceId: `provenance-${index}` }
      : { visibility },
    recordKind: 'world_observable_availability',
    availabilityCode: index % 2 === 0 ? 'dead' : 'departed',
    entityId: `entity-${index}`,
  })
}

function access(records: readonly ProofPatternEvidenceRecord[]) {
  const snapshot = createProofPatternEvidenceSnapshot({
    evidenceViewContractVersion: VERSION,
    records,
  })
  return readAttentionReadablePatternEvidenceViews(snapshot, B1_PATTERN_EVIDENCE_REQUEST)
}

function exactPublicAidSource(): Record<PropertyKey, unknown> {
  return {
    evidenceViewContractVersion: VERSION,
    recordId: 'forged-source',
    commitLsn: 1,
    worldTimeTick: 101,
    visibilityProvenance: Object.freeze({
      visibility: 'public',
      provenanceId: 'public-forged-source',
    }),
    recordKind: 'observable_action',
    actionCode: 'aid',
    actorId: 'a',
    targetId: 'b',
  }
}

function frozenForgedSnapshot(record: object): ProofPatternEvidenceSnapshot {
  Object.freeze(record)
  return Object.freeze({
    evidenceViewContractVersion: VERSION,
    records: Object.freeze([record]),
  }) as unknown as ProofPatternEvidenceSnapshot
}

describe('B1 pattern-evidence accessor admission and authority', () => {
  it('admits public/declassified records only and preserves every legal source value exactly', () => {
    const scenario = buildAttentionPatternEvidenceB1Scenario()
    const before = canonicalSerialize(scenario.snapshot)

    expect(scenario.views.map((view) => view.recordId)).toEqual(scenario.expectedRecordIds)
    expect(scenario.views.map((view) => view.recordId)).not.toContain(scenario.hiddenRecordId)
    expect(canonicalSerialize(scenario.snapshot)).toBe(before)
    for (const view of scenario.views) {
      expect(isAttentionReadablePatternEvidenceViewFromAccessor(view)).toBe(true)
      expect(Object.isFrozen(view)).toBe(true)
    }
    expect(scenario.views[0]).toEqual({
      evidenceViewContractVersion: VERSION,
      recordId: 'evidence-action-aid-10',
      commitLsn: 10,
      worldTimeTick: 110,
      visibilityProvenanceId: 'public-log-10',
      recordKind: 'observable_action',
      actionCode: 'aid',
      actorId: 'warden',
      targetId: 'merchant',
    })
  })

  it('keeps the private marker non-enumerable and WeakSet authority uncopyable', () => {
    const view = buildAttentionPatternEvidenceB1Scenario().views[0]!
    const spread = { ...view }
    const assigned = Object.assign({}, view)
    const serialized = JSON.parse(JSON.stringify(view)) as unknown
    const descriptorCopy = Object.create(
      Object.getPrototypeOf(view),
      Object.getOwnPropertyDescriptors(view),
    ) as unknown

    expect(Object.getOwnPropertySymbols(view)).toHaveLength(1)
    expect(Object.getOwnPropertyDescriptor(view, Object.getOwnPropertySymbols(view)[0]!)?.enumerable)
      .toBe(false)
    expect(isAttentionReadablePatternEvidenceViewFromAccessor(spread)).toBe(false)
    expect(isAttentionReadablePatternEvidenceViewFromAccessor(assigned)).toBe(false)
    expect(isAttentionReadablePatternEvidenceViewFromAccessor(serialized)).toBe(false)
    expect(isAttentionReadablePatternEvidenceViewFromAccessor(descriptorCopy)).toBe(false)
    expect(Object.keys(view)).not.toContain('ACCESSOR_MINT_MARKER')
  })

  it('returns zero views when zero records are admitted', () => {
    expect(access([])).toEqual({ kind: 'ok', views: [] })
  })

  it('retains all exactly-32 admitted records in canonical order regardless of input order', () => {
    const records = Array.from(
      { length: ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT },
      (_, index) => availabilityRecord(index),
    )
    const forward = access(records)
    const reverse = access([...records].reverse())
    if (forward.kind !== 'ok' || reverse.kind !== 'ok') throw new Error('expected admitted views')

    expect(forward.views).toHaveLength(ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)
    expect(forward.views.map((view) => view.recordId)).toEqual(
      records.map((record) => record.recordId),
    )
    expect(canonicalSerialize(reverse.views)).toBe(canonicalSerialize(forward.views))
  })

  it('retains the newest canonical 32 of 33 and excludes the oldest admitted record', () => {
    const records = Array.from(
      { length: ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT + 1 },
      (_, index) => availabilityRecord(index),
    )
    const forward = access(records)
    const reverse = access([...records].reverse())
    if (forward.kind !== 'ok' || reverse.kind !== 'ok') throw new Error('expected admitted views')

    expect(forward.views).toHaveLength(ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)
    expect(forward.views[0]?.recordId).toBe('record-001')
    expect(forward.views.map((view) => view.recordId)).not.toContain('record-000')
    expect(canonicalSerialize(reverse.views)).toBe(canonicalSerialize(forward.views))
  })

  it('uses recordId as the same-LSN secondary order', () => {
    const records = [
      availabilityRecord(2, 'public', 50),
      availabilityRecord(0, 'public', 50),
      availabilityRecord(1, 'public', 50),
    ]
    const result = access(records)
    if (result.kind !== 'ok') throw new Error('expected admitted views')

    expect(result.views.map((view) => view.recordId)).toEqual([
      'record-000',
      'record-001',
      'record-002',
    ])
  })

  it('applies the window only after admission: hidden records before, inside, and repeated never shift it', () => {
    const publicRecords = Array.from(
      { length: ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT + 1 },
      (_, index) => availabilityRecord(index + 1),
    )
    const publicOnly = access(publicRecords)
    const withHidden = access([
      availabilityRecord(900, 'private', 0),
      ...publicRecords.slice(0, 8),
      availabilityRecord(901, 'private', 8),
      availabilityRecord(902, 'unobserved', 8),
      ...publicRecords.slice(8, 20),
      availabilityRecord(903, 'private', 20),
      ...publicRecords.slice(20),
    ])
    if (publicOnly.kind !== 'ok' || withHidden.kind !== 'ok') {
      throw new Error('expected admitted views')
    }

    expect(withHidden.views).toHaveLength(ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)
    expect(canonicalSerialize(withHidden.views)).toBe(canonicalSerialize(publicOnly.views))
    expect(withHidden.views.map((view) => view.recordId)).not.toContain('record-900')
    expect(withHidden.views.map((view) => view.recordId)).not.toContain('record-901')
    expect(withHidden.views.map((view) => view.recordId)).not.toContain('record-902')
    expect(withHidden.views.map((view) => view.recordId)).not.toContain('record-903')
  })

  it('multiple hidden records do not consume any of an exactly-32 admitted capacity', () => {
    const publicRecords = Array.from(
      { length: ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT },
      (_, index) => availabilityRecord(index + 1),
    )
    const records = [...publicRecords]
    for (let index = 0; index < 12; index += 1) {
      records.splice(index * 2, 0, availabilityRecord(950 + index, 'private', index + 1))
    }
    const result = access(records)
    if (result.kind !== 'ok') throw new Error('expected admitted views')

    expect(result.views).toHaveLength(ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)
    expect(result.views.map((view) => view.recordId)).toEqual(
      publicRecords.map((record) => record.recordId),
    )
  })

  it.each([
    ['rawProse', { rawProse: 'forbidden' }],
    ['privateBelief', { privateBelief: 'forbidden' }],
    ['motive', { motive: 'forbidden' }],
    ['arbitrary nested metadata', { metadata: Object.freeze({ nested: 'forbidden' }) }],
    ['unknownField', { unknownField: 1 }],
    ['present-but-undefined optional key', { commitmentKey: undefined }],
  ])('refuses an exact source record widened with %s', (_label, extra) => {
    const record = Object.assign(exactPublicAidSource(), extra)
    expect(readAttentionReadablePatternEvidenceViews(
      frozenForgedSnapshot(record),
      B1_PATTERN_EVIDENCE_REQUEST,
    )).toEqual({ kind: 'refused', reason: 'invalid-pattern-evidence-input' })
  })

  it('refuses caller-supplied symbol data and inherited unexpected enumerable data', () => {
    const withSymbol = exactPublicAidSource()
    withSymbol[Symbol('caller-data')] = 'forbidden'
    const inherited = Object.assign(
      Object.create({ inheritedSecret: 'forbidden' }) as Record<PropertyKey, unknown>,
      exactPublicAidSource(),
    )

    for (const record of [withSymbol, inherited]) {
      expect(readAttentionReadablePatternEvidenceViews(
        frozenForgedSnapshot(record),
        B1_PATTERN_EVIDENCE_REQUEST,
      )).toEqual({ kind: 'refused', reason: 'invalid-pattern-evidence-input' })
    }
  })

  it('refuses missing/mismatched versions and mutable structurally forged input', () => {
    const scenario = buildAttentionPatternEvidenceB1Scenario()
    expect(readAttentionReadablePatternEvidenceViews(
      scenario.snapshot,
      { evidenceViewContractVersion: '' },
    )).toEqual({ kind: 'refused', reason: 'missing-evidence-view-contract-version' })
    expect(readAttentionReadablePatternEvidenceViews(
      scenario.snapshot,
      { evidenceViewContractVersion: 'unknown' },
    )).toEqual({ kind: 'refused', reason: 'evidence-view-contract-version-mismatch' })

    const mutable = {
      evidenceViewContractVersion: VERSION,
      records: [...scenario.snapshot.records],
    }
    expect(readAttentionReadablePatternEvidenceViews(
      mutable as never,
      B1_PATTERN_EVIDENCE_REQUEST,
    )).toEqual({ kind: 'refused', reason: 'mutable-pattern-evidence-input' })
  })
})
