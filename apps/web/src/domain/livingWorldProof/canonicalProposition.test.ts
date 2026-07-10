import { describe, expect, it } from 'vitest'
import {
  assertWellFormed,
  canonicalKeyOf,
  claimKeyOf,
  compareInstants,
  detectConflict,
  effectiveStatePeriod,
  extentOverlap,
  incompatible,
  instantBefore,
  instantEquals,
  latestValidStateClaim,
  sortClaimPair,
  worldStateClaimToCanonicalClaim,
} from './canonicalProposition'
import type { CanonicalClaim, ValidExtent, WorldStateClaim } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'

/**
 * Canonical proposition grammar and detection (ADR-0008 D2/D11, spec
 * conflict-edge-replay-v0.md §1.2/§2.1). Covers N3/N4/F3 and the detection
 * core underlying P1/N2 (the store-level idempotency and edge-minting
 * assertions live in conflictStore.test.ts).
 */

function attacked(actor: string, at = { night: 3, tick: 0 }): CanonicalClaim {
  return {
    predicate: 'attacked',
    fixedRoles: { target: 'guard_malik' },
    contestedRole: 'actor',
    contestedValue: actor,
    polarity: 'asserts',
    validity: { kind: 'instant', at },
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

describe('world-instant ordering', () => {
  it('compares night first, then tick', () => {
    expect(compareInstants({ night: 3, tick: 0 }, { night: 4, tick: 0 })).toBe(-1)
    expect(compareInstants({ night: 4, tick: 1 }, { night: 4, tick: 0 })).toBe(1)
    expect(compareInstants({ night: 4, tick: 1 }, { night: 4, tick: 1 })).toBe(0)
    expect(instantBefore({ night: 4, tick: 0 }, { night: 4, tick: 1 })).toBe(true)
    expect(instantEquals({ night: 4, tick: 1 }, { night: 4, tick: 1 })).toBe(true)
  })
})

describe('canonical key / claim key', () => {
  it('canonicalKeyOf excludes the contested value, polarity, and validity (design plan I4)', () => {
    const player = attacked('player')
    const zombie = attacked('zombie_17')
    expect(canonicalKeyOf(player)).toBe(canonicalKeyOf(zombie))
    expect(claimKeyOf(player)).not.toBe(claimKeyOf(zombie))
  })

  it('sortClaimPair is order-invariant (N5 prerequisite)', () => {
    const player = attacked('player')
    const zombie = attacked('zombie_17')
    expect(sortClaimPair(player, zombie).pairKey).toBe(sortClaimPair(zombie, player).pairKey)
  })
})

describe('assertWellFormed (F3 / malformed-claim)', () => {
  it('accepts a well-formed claim', () => {
    expect(assertWellFormed(attacked('player'))).toBeNull()
  })

  it('rejects an unregistered predicate as malformed-claim', () => {
    expect(assertWellFormed({ ...attacked('player'), predicate: 'unregistered_predicate' })).toBe('malformed-claim')
  })

  it('rejects a contestedRole that disagrees with the grammar as malformed-claim', () => {
    expect(assertWellFormed({ ...attacked('player'), contestedRole: 'target' })).toBe('malformed-claim')
  })

  it('rejects a canonicalizer version mismatch (F3)', () => {
    expect(assertWellFormed({ ...attacked('player'), canonicalizerVersion: 'cz_v9' })).toBe('canonicalizer-version-mismatch')
  })
})

describe('incompatible', () => {
  it('same contested value, opposite polarity -- incompatible', () => {
    expect(incompatible(attacked('player'), { ...attacked('player'), polarity: 'denies' })).toBe(true)
  })

  it('different contested values on an exclusive role, same polarity -- incompatible (P1 core)', () => {
    expect(incompatible(attacked('player'), attacked('zombie_17'))).toBe(true)
  })

  it('same contested value, same polarity -- compatible', () => {
    expect(incompatible(attacked('player'), attacked('player'))).toBe(false)
  })
})

describe('extentOverlap (design plan clarification 3)', () => {
  it('instant/instant overlaps only when equal -- two event claims about the same world instant can conflict', () => {
    expect(extentOverlap({ kind: 'instant', at: { night: 3, tick: 0 } }, { kind: 'instant', at: { night: 3, tick: 0 } })).toEqual({
      kind: 'instant',
      at: { night: 3, tick: 0 },
    })
    expect(extentOverlap({ kind: 'instant', at: { night: 3, tick: 0 } }, { kind: 'instant', at: { night: 4, tick: 0 } })).toBeNull()
  })

  it('instant/interval overlaps when from <= at < to, or to is open', () => {
    const openInterval: ValidExtent = { kind: 'interval', from: { night: 1, tick: 0 }, to: null }
    const closedInterval: ValidExtent = { kind: 'interval', from: { night: 1, tick: 0 }, to: { night: 2, tick: 0 } }

    expect(extentOverlap({ kind: 'instant', at: { night: 5, tick: 0 } }, openInterval)).toEqual({ kind: 'instant', at: { night: 5, tick: 0 } })
    expect(extentOverlap({ kind: 'instant', at: { night: 1, tick: 0 } }, closedInterval)).toEqual({ kind: 'instant', at: { night: 1, tick: 0 } })
    expect(extentOverlap({ kind: 'instant', at: { night: 2, tick: 0 } }, closedInterval)).toBeNull()
  })

  it('interval/interval uses ordinary half-open overlap; disjoint successive state periods never overlap (N1 core)', () => {
    const doorOpen: ValidExtent = { kind: 'interval', from: { night: 1, tick: 0 }, to: { night: 2, tick: 0 } }
    const doorClosed: ValidExtent = { kind: 'interval', from: { night: 2, tick: 0 }, to: null }
    expect(extentOverlap(doorOpen, doorClosed)).toBeNull()

    const overlapping: ValidExtent = { kind: 'interval', from: { night: 1, tick: 5 }, to: { night: 3, tick: 0 } }
    expect(extentOverlap(doorOpen, overlapping)).toEqual({ kind: 'interval', from: { night: 1, tick: 5 }, to: { night: 2, tick: 0 } })
  })
})

describe('effectiveStatePeriod / latestValidStateClaim (N1 world-state succession)', () => {
  const doorOpen: WorldStateClaim = { recordId: 'WS_door_open', objectKey: 'cellar_door', state: 'open', from: { night: 1, tick: 0 }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION }
  const doorClosed: WorldStateClaim = { recordId: 'WS_door_closed', objectKey: 'cellar_door', state: 'closed', from: { night: 2, tick: 0 }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION }
  const siblings = [doorOpen, doorClosed]

  it('derives the effective period from the earliest later claim on the same object, never storing it back', () => {
    expect(effectiveStatePeriod(doorOpen, siblings)).toEqual({ kind: 'interval', from: { night: 1, tick: 0 }, to: { night: 2, tick: 0 } })
    expect(effectiveStatePeriod(doorClosed, siblings)).toEqual({ kind: 'interval', from: { night: 2, tick: 0 }, to: null })
    expect(doorOpen).toEqual({ recordId: 'WS_door_open', objectKey: 'cellar_door', state: 'open', from: { night: 1, tick: 0 }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION })
  })

  it('latestValidStateClaim returns open before T2 and closed from T2 onward', () => {
    expect(latestValidStateClaim('cellar_door', siblings, { night: 1, tick: 5 })?.state).toBe('open')
    expect(latestValidStateClaim('cellar_door', siblings, { night: 2, tick: 0 })?.state).toBe('closed')
    expect(latestValidStateClaim('cellar_door', siblings, { night: 5, tick: 0 })?.state).toBe('closed')
  })

  it('detectConflict over the derived periods finds no overlap -- succession is not contradiction (N1)', () => {
    const openClaim = worldStateClaimToCanonicalClaim(doorOpen, siblings)
    const closedClaim = worldStateClaimToCanonicalClaim(doorClosed, siblings)
    const outcome = detectConflict(openClaim, closedClaim)
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('no-valid-time-overlap')
  })
})

describe('detectConflict (the full pipeline, N3/N4)', () => {
  it('P1 core: incompatible actors at the same instant conflict', () => {
    const outcome = detectConflict(attacked('player'), attacked('zombie_17'))
    expect(outcome.verdict).toBe('conflict')
    if (outcome.verdict !== 'conflict') throw new Error('unreachable')
    expect(outcome.overlapWitness.intersection).toEqual({ kind: 'instant', at: { night: 3, tick: 0 } })
  })

  it('N2 core: a different predicate (hedged vs. sharpened) never key-matches, regardless of shared lineage', () => {
    const hedged: CanonicalClaim = {
      predicate: 'involved_in',
      fixedRoles: { target: 'guard_malik' },
      contestedRole: 'actor',
      contestedValue: 'player',
      polarity: 'asserts',
      validity: { kind: 'instant', at: { night: 3, tick: 0 } },
      canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
    }
    const outcome = detectConflict(hedged, attacked('player'))
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('key-mismatch')
  })

  it('N3: same key, incompatible outcome, but disjoint valid times -- no overlap, no conflict', () => {
    const outcome = detectConflict(attacked('player', { night: 3, tick: 0 }), attacked('zombie_17', { night: 5, tick: 0 }))
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('no-valid-time-overlap')
  })

  it('N4: compatible outcomes never conflict even at the same instant', () => {
    const outcome = detectConflict(attacked('zombie_17'), attacked('zombie_17'))
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('compatible-outcomes')
  })

  it('N4/F3: a canonicalizer-version-mismatched claim is rejected before any semantic step', () => {
    const outcome = detectConflict({ ...attacked('player'), canonicalizerVersion: 'cz_v9' }, attacked('zombie_17'))
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('canonicalizer-version-mismatch')
  })

  it('N4: a malformed claim (unregistered predicate) is rejected', () => {
    const outcome = detectConflict({ ...attacked('player'), predicate: 'not_a_real_predicate' }, attacked('zombie_17'))
    expect(outcome.verdict).toBe('no-conflict')
    if (outcome.verdict !== 'no-conflict') throw new Error('unreachable')
    expect(outcome.reason).toBe('malformed-claim')
  })
})
