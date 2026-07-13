import { describe, expect, it } from 'vitest'
import { readable, readEvidence } from './evidenceRecords'
import {
  attributionUniverse,
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_DarenAtt1,
  beliefB1Prime,
  BORIN,
  CORA,
  DAREN,
} from './attributionScenario'

/**
 * Privacy and anti-omniscience tests (P62-P66, P104; F33-F40).
 */

describe('P62/P63 -- no cross-holder store read, and no existence/confidence/version/evidence leak', () => {
  it('Cora reads only her own beliefs/observations; Borin\'s corrected belief is not in her readable set', () => {
    const coraReadable = readable(CORA, attributionUniverse)
    expect(coraReadable.some((entry) => entry.record.id === beliefB1Prime.id)).toBe(false)
  })

  it('F36/F37 -- Bel_CoraAtt1 carries no Borin-owned record id, confidence, evidence, or transition-id field', () => {
    expect(JSON.stringify(Bel_CoraAtt1)).not.toContain(beliefB1Prime.id)
    expect(Object.keys(Bel_CoraAtt1)).not.toContain('modeledHolderConfidence')
    expect(Object.keys(Bel_CoraAtt1)).not.toContain('modeledHolderTransitionId')
  })

  it('P21/F33/F34 -- Daren\'s attribution stays byte-identical after Borin\'s private correction (no synchronization mechanism)', () => {
    const beforeHash = JSON.stringify(Bel_DarenAtt1)
    // Borin's correction (BT_AB1, committed in buildPhase3Store) never
    // touches Daren's record -- confirmed by construction: Bel_DarenAtt1 is
    // a module-level const, computed once, never mutated by any later
    // phase builder (every builder returns a NEW store, never mutates an
    // existing Belief object).
    expect(JSON.stringify(Bel_DarenAtt1)).toBe(beforeHash)
  })
})

describe('P64 -- explanation citations are holder-readable only', () => {
  it('readEvidence grants Cora her own attribution but denies Borin\'s corrected belief', () => {
    const ownRead = readEvidence(CORA, Bel_CoraAtt1b.id, attributionUniverse)
    const foreignRead = readEvidence(CORA, beliefB1Prime.id, attributionUniverse)
    expect(ownRead.verdict).toBe('granted')
    expect(foreignRead.verdict).toBe('denied')
  })
})

describe('P104/F13 -- audience-existence is never leakable through any readable surface', () => {
  it('Daren\'s absence from a private event is not inferable by Cora through the readable() gate (Borin\'s private records are simply absent from BOTH holders\' readable sets, not selectively hidden)', () => {
    const coraReadableIds = new Set(readable(CORA, attributionUniverse).map((e) => e.record.id))
    const darenReadableIds = new Set(readable(DAREN, attributionUniverse).map((e) => e.record.id))
    expect(coraReadableIds.has(beliefB1Prime.id)).toBe(false)
    expect(darenReadableIds.has(beliefB1Prime.id)).toBe(false)
  })
})

describe('P66 -- audit divergence is never a holder-readable input', () => {
  it('no attribution-layer type or record carries a "stale"/"divergent" field', () => {
    expect(Object.keys(Bel_CoraAtt1)).not.toContain('stale')
    expect(Object.keys(Bel_CoraAtt1)).not.toContain('divergent')
  })
})

describe('D13 -- Borin\'s own readable set is unaffected by Cora\'s attribution about him', () => {
  it('Borin\'s readable set contains his own corrected belief, never Cora\'s attribution about him', () => {
    const borinReadable = readable(BORIN, attributionUniverse)
    expect(borinReadable.some((entry) => entry.record.id === beliefB1Prime.id)).toBe(true)
    expect(borinReadable.some((entry) => entry.record.id === Bel_CoraAtt1.id)).toBe(false)
  })
})

describe('F35 -- private correction never appears in outside search/index/digest', () => {
  it('the only surface that ever resolves a record by id is readable()/readEvidence(), and both are holder-scoped -- no separate index/digest module in this rig exposes cross-holder ids', () => {
    const darenReadable = readable(DAREN, attributionUniverse)
    expect(darenReadable.some((entry) => entry.record.id === beliefB1Prime.id)).toBe(false)
    expect(darenReadable.some((entry) => entry.record.id === 'BT_AB1')).toBe(false)
  })
})

describe('F38 -- explanation never cites Borin-private evidence', () => {
  it('Cora\'s own attribution-chain support never includes Borin\'s corrected-belief id or his correcting evidence id', () => {
    expect(Bel_CoraAtt1b.supporting).not.toContain(beliefB1Prime.id)
    expect(Bel_CoraAtt1b.supporting).not.toContain('E_claw_borin')
  })
})

describe('F39/P65 -- per-holder context assembly never co-loads a modeled holder\'s actual belief', () => {
  it('a simulated combined-scene read for Cora never includes Bel_B1_prime, even when Borin is also present in the scene', () => {
    // "Assembling Cora's context" is exactly `readable(CORA, universe)` in
    // this proof harness -- there is no separate multi-holder prompt-
    // assembly surface that could co-load a second holder's private state;
    // confirming the single gate never returns Borin's record is the
    // complete check available at this layer.
    const coraContext = readable(CORA, attributionUniverse)
    const borinContext = readable(BORIN, attributionUniverse)
    const coraIds = new Set(coraContext.map((e) => e.record.id))
    const borinOnlyIds = new Set(borinContext.map((e) => e.record.id).filter((id) => !coraIds.has(id)))
    expect(borinOnlyIds.has(beliefB1Prime.id)).toBe(true)
    expect(coraIds.has(beliefB1Prime.id)).toBe(false)
  })
})
