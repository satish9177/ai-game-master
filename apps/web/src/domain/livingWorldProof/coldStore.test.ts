import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { compactionUniverse } from './compactionScenario'
import { demote, initStore, materialize, readEvidenceTiered, resolveRecord, withCorruptedSegment } from './coldStore'

const PANTRY_OBSERVATION_C = 'O_NPC_C_T2'
const PANTRY_OBSERVATION_B = 'O_NPC_B_T2'

describe('initStore / materialize', () => {
  it('reconstructs the original ordered record universe exactly when nothing has demoted', () => {
    const store = initStore(compactionUniverse)
    expect(canonicalSerialize(materialize(store))).toBe(canonicalSerialize(compactionUniverse))
  })

  it('does not mutate its input', () => {
    const snapshot = structuredClone(compactionUniverse)
    initStore(compactionUniverse)
    expect(compactionUniverse).toEqual(snapshot)
  })
})

describe('demote', () => {
  it('moves a record to a cold segment without changing its id or bytes', () => {
    const store = initStore(compactionUniverse)
    const before = store.records.find((entry) => entry.record.id === PANTRY_OBSERVATION_C)!

    const demoted = demote(store, [PANTRY_OBSERVATION_C])
    expect(demoted.residence.get(PANTRY_OBSERVATION_C)).not.toBe('hot')
    expect(demoted.segments).toHaveLength(1)
    expect(demoted.segments[0]?.recordId).toBe(PANTRY_OBSERVATION_C)

    const resolved = resolveRecord(demoted, PANTRY_OBSERVATION_C)
    expect(resolved.verdict).toBe('paged-back')
    if (resolved.verdict !== 'paged-back') throw new Error('unreachable')
    expect(resolved.record.record.id).toBe(before.record.id)
    expect(canonicalSerialize(resolved.record)).toBe(canonicalSerialize(before))
  })

  it('is idempotent: demoting an already-cold record is a no-op', () => {
    const store = initStore(compactionUniverse)
    const oncedemoted = demote(store, [PANTRY_OBSERVATION_C])
    const twiceDemoted = demote(oncedemoted, [PANTRY_OBSERVATION_C])
    expect(twiceDemoted.segments).toHaveLength(1)
    expect(twiceDemoted.residence.get(PANTRY_OBSERVATION_C)).toBe(oncedemoted.residence.get(PANTRY_OBSERVATION_C))
  })

  it('does not mutate the store passed in (pure)', () => {
    const store = initStore(compactionUniverse)
    const snapshotResidence = new Map(store.residence)
    demote(store, [PANTRY_OBSERVATION_C])
    expect(store.residence).toEqual(snapshotResidence)
    expect(store.segments).toHaveLength(0)
  })

  it('demoting multiple records assigns each its own segment', () => {
    const store = initStore(compactionUniverse)
    const demoted = demote(store, [PANTRY_OBSERVATION_C, PANTRY_OBSERVATION_B])
    expect(demoted.segments).toHaveLength(2)
    expect(new Set(demoted.segments.map((s) => s.segmentId)).size).toBe(2)
  })
})

describe('materialize after demotion', () => {
  it('still reconstructs the exact original universe (residence invisible in the reconstructed array)', () => {
    const store = initStore(compactionUniverse)
    const demoted = demote(store, [PANTRY_OBSERVATION_C, PANTRY_OBSERVATION_B])
    expect(canonicalSerialize(materialize(demoted))).toBe(canonicalSerialize(compactionUniverse))
  })

  it('throws if a segment is corrupted (an internal-consistency assumption, not the F4 path)', () => {
    const store = demote(initStore(compactionUniverse), [PANTRY_OBSERVATION_C])
    const corrupted = withCorruptedSegment(store, PANTRY_OBSERVATION_C, '{"tampered":true}')
    expect(() => materialize(corrupted)).toThrow()
  })
})

describe('readEvidenceTiered', () => {
  it('grants a hot read identically to the committed readEvidence', () => {
    const store = initStore(compactionUniverse)
    const outcome = readEvidenceTiered('NPC_C', PANTRY_OBSERVATION_C, store)
    expect(outcome.verdict).toBe('granted')
  })

  it('pages back a cold record and grants it byte-identically to the pre-demotion hot copy', () => {
    const store = initStore(compactionUniverse)
    const before = readEvidenceTiered('NPC_C', PANTRY_OBSERVATION_C, store)
    const demoted = demote(store, [PANTRY_OBSERVATION_C])
    const after = readEvidenceTiered('NPC_C', PANTRY_OBSERVATION_C, demoted)

    expect(before.verdict).toBe('granted')
    expect(after.verdict).toBe('granted')
    if (before.verdict !== 'granted' || after.verdict !== 'granted') throw new Error('unreachable')
    expect(canonicalSerialize(after.record)).toBe(canonicalSerialize(before.record))
    expect(after.call).toEqual(before.call)
  })

  it('denies a scope-inappropriate read of a cold record exactly as the hot gate would', () => {
    const store = demote(initStore(compactionUniverse), [PANTRY_OBSERVATION_C])
    const outcome = readEvidenceTiered('NPC_B', PANTRY_OBSERVATION_C, store)
    expect(outcome.verdict).toBe('denied')
  })

  it('returns a typed hash-mismatch fault, never a substituted record, on a corrupted segment (F4)', () => {
    const store = demote(initStore(compactionUniverse), [PANTRY_OBSERVATION_C])
    const corrupted = withCorruptedSegment(store, PANTRY_OBSERVATION_C, '{"tampered":true}')
    const outcome = readEvidenceTiered('NPC_C', PANTRY_OBSERVATION_C, corrupted)
    expect(outcome.verdict).toBe('hash-mismatch')
  })

  it('a hash mismatch on one record does not affect reading an unrelated hot record', () => {
    const store = demote(initStore(compactionUniverse), [PANTRY_OBSERVATION_C])
    const corrupted = withCorruptedSegment(store, PANTRY_OBSERVATION_C, '{"tampered":true}')
    const outcome = readEvidenceTiered('NPC_C', 'Bel_C2', corrupted)
    expect(outcome.verdict).toBe('granted')
  })

  it('the granted outcome carries no residence-revealing field (P8)', () => {
    const store = demote(initStore(compactionUniverse), [PANTRY_OBSERVATION_C])
    const outcome = readEvidenceTiered('NPC_C', PANTRY_OBSERVATION_C, store)
    expect(outcome.verdict).toBe('granted')
    expect(Object.keys(outcome).sort()).toEqual(['call', 'record', 'verdict'])
    if (outcome.verdict !== 'granted') throw new Error('unreachable')
    expect(Object.keys(outcome.call).sort()).toEqual(['reader', 'recordId', 'verdict'])
  })
})
