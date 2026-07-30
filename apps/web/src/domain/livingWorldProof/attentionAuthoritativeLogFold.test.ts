import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V1,
  ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2,
  ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V1,
  ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
  foldAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'

const commit = Object.freeze({ commitSeq: 0, commandId: 'ordinary', rngValue: 1, allocatedId: 1, schedulerToken: 1, reducerCacheDigestAtCommit: 'cache', wallClockInputAtCommit: 2 })

describe('C5 authoritative log fold', () => {
  it('preserves v1 and refuses missing/version-incompatible payload records', () => {
    const v1 = Object.freeze({ commits: Object.freeze([commit]), commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V1, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V1 })
    expect(foldAttentionReplayAuthoritativeLog(v1, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V1).kind).toBe('ok')
    expect(foldAttentionReplayAuthoritativeLog(v1, undefined)).toEqual({ kind: 'refused', reason: 'missing-authoritative-log-fold-version' })
    expect(foldAttentionReplayAuthoritativeLog({ ...v1, commits: [{ ...commit, communicationPayloadDigest: 'payload' }] }, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V1))
      .toEqual({ kind: 'refused', reason: 'payload-bearing-v1-record' })
  })
  it('uses the existing canonical serializer for v2 and makes payload presence load-bearing', () => {
    const absent = Object.freeze({ commits: Object.freeze([commit]), commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 })
    const present = Object.freeze({ ...absent, commits: Object.freeze([{ ...commit, communicationPayloadDigest: 'payload-1' }]) })
    const absentFold = foldAttentionReplayAuthoritativeLog(absent, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    const presentFold = foldAttentionReplayAuthoritativeLog(present, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    expect(absentFold.kind).toBe('ok'); expect(presentFold.kind).toBe('ok')
    if (absentFold.kind !== 'ok' || presentFold.kind !== 'ok') throw new Error('expected folds')
    expect(absentFold.digest).not.toBe(presentFold.digest)
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe(canonicalSerialize({ a: 2, b: 1 }))
  })
})
