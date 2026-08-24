import { describe, expect, it } from 'vitest'
import type { BeliefDialogueContext } from '../domain/dialogue/contracts'
import {
  projectBeliefDialogueContext,
  type BeliefSpineView,
} from './projectBeliefDialogueContext'
import { buildThreeNpcRumorDriftFixture } from './beliefSliceFixture'
import type { ConflictStore } from '../domain/livingWorldProof/conflictStore'
import type { LogEntry } from '../redteam/fixtures'
import { createSpyLogger } from '../redteam/fixtures'

/**
 * S2 gate tests (plan §3): one constructor, one direction, nothing the
 * holder is not entitled to. The load-bearing invariant is the negative
 * control -- no projection for A, B or C contains `zombie_17` -- enforced
 * upstream of any prompt, before a model ever sees the context.
 */

const A_HEDGED_PROPOSITION = 'something happened involving a scream near cellar'
const B_SPECIFIC_PROPOSITION = 'the player was involved in what happened to guard_malik'
const C_ACCUSATION_PROPOSITION = 'the player attacked guard_malik'

function capturingLogger(entries: LogEntry[] = []) {
  return { logger: createSpyLogger(entries), entries }
}

describe('per-holder projection through the real spine', () => {
  const fixture = buildThreeNpcRumorDriftFixture()

  it('projects A as hedged and attacker-less at low confidence', () => {
    const { logger } = capturingLogger()
    const context = projectBeliefDialogueContext('NPC_A', fixture, logger)
    expect(context.entries).toHaveLength(1)
    expect(context.entries[0]).toEqual({
      text: A_HEDGED_PROPOSITION,
      confidenceBucket: 'low',
      sourceTrustBucket: 'unknown',
    })
  })

  it('projects B as specific-but-unconfident second-hand rumor, attributed to its teller', () => {
    const { logger } = capturingLogger()
    const context = projectBeliefDialogueContext('NPC_B', fixture, logger)
    expect(context.entries).toEqual([
      {
        text: B_SPECIFIC_PROPOSITION,
        confidenceBucket: 'low',
        sourceTrustBucket: 'unknown',
        attributedFrom: 'NPC_A',
      },
    ])
  })

  it('projects C as the low-confidence accusation, attributed to its teller', () => {
    const { logger } = capturingLogger()
    const context = projectBeliefDialogueContext('NPC_C', fixture, logger)
    expect(context.entries).toEqual([
      {
        text: C_ACCUSATION_PROPOSITION,
        confidenceBucket: 'low',
        sourceTrustBucket: 'unknown',
        attributedFrom: 'NPC_B',
      },
    ])
  })

  it('carries only the plain fields per entry -- no ids, no sourceRef, no other records', () => {
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const context = projectBeliefDialogueContext(holder, fixture, logger)
      for (const entry of context.entries) {
        const allowedKeys = entry.attributedFrom !== undefined
          ? ['attributedFrom', 'confidenceBucket', 'sourceTrustBucket', 'text']
          : ['confidenceBucket', 'sourceTrustBucket', 'text']
        expect(Object.keys(entry).sort()).toEqual(allowedKeys)
      }
    }
  })
})

describe('S2 gate: zombie_17 negative control', () => {
  const fixture = buildThreeNpcRumorDriftFixture()

  it('no projection for A, B or C contains zombie_17 (id or lemma), in any field, serialized', () => {
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const serialized = JSON.stringify(projectBeliefDialogueContext(holder, fixture, logger)).toLowerCase()
      expect(serialized, holder).not.toContain('zombie_17')
      expect(serialized, holder).not.toMatch(/\bzombie\b/)
    }
  })

  it('no projection carries record, evidence, transmission or belief-transition identifiers', () => {
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const serialized = JSON.stringify(projectBeliefDialogueContext(holder, fixture, logger))
      for (const forbidden of ['T0', 'T1', 'E_claw', 'O_A_T0', 'sourceRef', 'truthRef', 'supporting', 'contradicting', 'lastUpdated']) {
        expect(serialized, `${holder} must not carry ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('names another holder ONLY as the attributed teller of a real received transmission', () => {
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const context = projectBeliefDialogueContext(holder, fixture, logger)
      for (const entry of context.entries) {
        for (const other of ['NPC_A', 'NPC_B', 'NPC_C']) {
          if (other === holder) continue
          const appears = JSON.stringify(entry).includes(other)
          if (appears) {
            // The only sanctioned appearance: attributedFrom on a rumor belief,
            // backed by a real RumorTransmission to this holder.
            expect(entry.attributedFrom, `${holder} may only attribute to its own transmission source`).toBe(other)
            expect(entry.text === C_ACCUSATION_PROPOSITION || entry.text === B_SPECIFIC_PROPOSITION).toBe(true)
          }
        }
      }
    }
    // A's inference is not a rumor: it carries no attribution at all.
    const a = projectBeliefDialogueContext('NPC_A', fixture, logger)
    expect(a.entries[0]).not.toHaveProperty('attributedFrom')
  })
})

describe('failure degrades to an empty context', () => {
  it('a throwing store yields empty entries and a logged warning, never a propagation', () => {
    const fixture = buildThreeNpcRumorDriftFixture()
    const throwingStore: ConflictStore = new Proxy(fixture.store, {
      get(target, property) {
        if (property === 'timing') throw new Error('store exploded')
        return Reflect.get(target, property, target)
      },
    })
    const spine: BeliefSpineView = { universe: fixture.universe, store: throwingStore, bounds: fixture.bounds }
    const { logger, entries } = capturingLogger()
    const context = projectBeliefDialogueContext('NPC_B', spine, logger)
    expect(context.entries).toEqual([])
    expect(entries.some((entry) => entry.message === 'belief dialogue context failed')).toBe(true)
  })

  it('the empty shape is the omitted-section shape downstream (entries: [])', () => {
    const empty: BeliefDialogueContext = { entries: [] }
    expect(empty.entries).toHaveLength(0)
  })
})

describe('read-only discipline and determinism', () => {
  it('never mutates the spine view: universe, store and bounds are byte-identical after projection', () => {
    const fixture = buildThreeNpcRumorDriftFixture()
    const before = JSON.stringify({ universe: fixture.universe, bounds: fixture.bounds, timing: [...fixture.store.timing] })
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      projectBeliefDialogueContext(holder, fixture, logger)
    }
    const after = JSON.stringify({ universe: fixture.universe, bounds: fixture.bounds, timing: [...fixture.store.timing] })
    expect(after).toBe(before)
  })

  it('is deterministic across repeated calls with the same inputs', () => {
    const fixture = buildThreeNpcRumorDriftFixture()
    const { logger } = capturingLogger()
    const first = JSON.stringify(projectBeliefDialogueContext('NPC_C', fixture, logger))
    const second = JSON.stringify(projectBeliefDialogueContext('NPC_C', fixture, logger))
    expect(first).toBe(second)
  })
})

describe('source-trust seam', () => {
  it('with a supplied (resolution-free) ledger the lookup runs and stays unknown; counts never surface', () => {
    const fixture = buildThreeNpcRumorDriftFixture()
    // This slice commits no ReportResolutions, so every key is structurally
    // unknown (ADR-0012 §6.0); the seam is wired here without inventing tiers.
    const trustStore = {
      conflict: fixture.store,
      observationCommits: new Map<string, number>(),
      resolutions: [],
      commitLog: [],
    }
    const { logger } = capturingLogger()
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const context = projectBeliefDialogueContext(holder, fixture, logger, { trustStore })
      expect(context.entries.every((entry) => entry.sourceTrustBucket === 'unknown'), holder).toBe(true)
      expect(JSON.stringify(context)).not.toMatch(/confirmed|refuted/)
    }
  })
})
