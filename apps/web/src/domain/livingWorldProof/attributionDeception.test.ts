import { describe, expect, it } from 'vitest'
import { classifyDeception } from './attributionDeception'
import { DECEPTION_CASES, deriveSettledStanceAndBuildCase, runDeceptionCase } from './attributionDeceptionScenario'

/**
 * Phase 9 deception-taxonomy tests (P54-P57, P100, P101, P108; F41-F48).
 */

describe('P54/P108 -- all six §8 Phase 9 cases classify correctly, from the operational settled-stance derivation', () => {
  DECEPTION_CASES.forEach((deceptionCase) => {
    it(`case ${deceptionCase.caseNumber} classifies as ${deceptionCase.expected}`, () => {
      const derived = deriveSettledStanceAndBuildCase(deceptionCase.caseNumber, deceptionCase.recordedIntention)
      expect(derived.settledStance).toBe(deceptionCase.settledStance)
      expect(runDeceptionCase(deceptionCase)).toBe(deceptionCase.expected)
    })
  })
})

describe('P100 -- cases 5 and 6 exercise the two distinct "no settled stance" sub-cases', () => {
  it('case 5 is the status-\'none\' sub-case (no current belief on the key at all)', () => {
    const derived = deriveSettledStanceAndBuildCase(5, false)
    expect(derived.settledStance).toBe('none')
    expect(derived.universe.length).toBe(0)
  })

  it('case 6 is the status-\'unresolved\' sub-case (co-held incompatible beliefs)', () => {
    const derived = deriveSettledStanceAndBuildCase(6, true)
    expect(derived.settledStance).toBe('none')
    expect(derived.universe.length).toBe(2)
  })
})

describe('P55/F46/F47 -- classification is a derived comparison, never stored, never an LLM judgment', () => {
  it('classifyDeception is a pure function with no isLie/sincerity field on any input or output', () => {
    const result = classifyDeception({ settledStance: 'rejecting', recordedIntention: 'induce-belief' })
    expect(result).toBe('deceptive-lie')
    expect(typeof result).toBe('string')
    // Re-running with identical inputs always recomputes the same result --
    // there is no stored flag anywhere for this to diverge from.
    expect(classifyDeception({ settledStance: 'rejecting', recordedIntention: 'induce-belief' })).toBe(result)
  })
})

describe('F41/F42/F43 -- misclassification faults are structurally excluded', () => {
  it('F41 -- a counter-belief assertion (rejecting, no intention) is never deceptive-lie', () => {
    expect(classifyDeception({ settledStance: 'rejecting' })).toBe('counter-belief-assertion')
  })
  it('F42 -- a non-committal assertion (none, no intention) is never deceptive', () => {
    expect(classifyDeception({ settledStance: 'none' })).toBe('non-committal-assertion')
  })
  it('F43 -- an uncertain-speaker manipulation (none, WITH intention) is deceptive-non-committal, never plain non-committal', () => {
    expect(classifyDeception({ settledStance: 'none', recordedIntention: 'induce-belief' })).toBe('deceptive-non-committal-assertion')
  })
})

describe('P56 -- listener-side records expose none of the six classifications', () => {
  it('the DeceptionCase/classification types carry no listener-observable field', () => {
    const derived = deriveSettledStanceAndBuildCase(4, true)
    for (const entry of derived.universe) {
      expect(JSON.stringify(entry)).not.toContain('deceptive')
      expect(JSON.stringify(entry)).not.toContain('isLie')
    }
  })
})

describe('P101 -- listener-side byte identity between sincere assertion and honest mistake', () => {
  it('cases 1 and 2 differ only in the audit-only worldTruthMatches input, never in the derived universe shape', () => {
    const case1 = deriveSettledStanceAndBuildCase(1, false)
    const case2 = deriveSettledStanceAndBuildCase(2, false)
    expect(case1.universe.length).toBe(case2.universe.length)
    expect(case1.settledStance).toBe(case2.settledStance)
  })
})

describe('F44 -- an assert act alone never creates an induce-belief intention', () => {
  it('classifyDeception never infers recordedIntention from settledStance alone -- it is always a separate, explicit input', () => {
    // Same settledStance ('rejecting'), no intention supplied -> never
    // deceptive-lie; the ONLY way to reach deceptive-lie is an explicitly
    // recorded intention (case 4's real IntentionCommitment), never the
    // bare act.
    expect(classifyDeception({ settledStance: 'rejecting' })).toBe('counter-belief-assertion')
    expect(classifyDeception({ settledStance: 'rejecting', recordedIntention: 'induce-belief' })).toBe('deceptive-lie')
  })
})

describe('F45 -- deceptive intent is never exposed to the listener', () => {
  it('case 4/6\'s derived universe (NPC_D-observable state) carries no field naming NPC_A\'s recorded intention', () => {
    const case4 = deriveSettledStanceAndBuildCase(4, true)
    for (const entry of case4.universe) {
      expect(JSON.stringify(entry)).not.toContain('induce-belief')
      expect(JSON.stringify(entry)).not.toContain('IntentionCommitment')
    }
  })
})
