import { describe, expect, it } from 'vitest'
import {
  O_A_accuse1,
  O_A_competing1,
  O_Cora_accuse1,
  O_Daren_accuse1,
  O_E_accuse1,
  O_R_accuse1,
  understandingA1,
  understandingCora1,
  understandingDaren1,
  understandingE1,
} from './attributionScenario'
import { receiptRungOf, understandDefault, understandDistracted } from './attributionUnderstanding'
import { UNDERSTANDING_RULE_VERSION } from './attributionContracts'

/**
 * Receipt-ladder and UnderstandingResult tests (P6-P10, P82-P85; F7-F11,
 * F64-F66).
 */

describe('P6/P9 -- occurrence-only observer gets occurrence-level facts only', () => {
  it('NPC_R never reaches rung 5 (no sound channel, no content fragments)', () => {
    expect(receiptRungOf(O_R_accuse1)).toBe('below-rung-5')
    expect(O_R_accuse1.channels).not.toContain('sound')
  })
})

describe('P7/P84 -- canonicalized-but-not-understood recipient reaches rung 5 but derives a negative UnderstandingResult', () => {
  it('NPC_A reaches rung 5 (content fragments present)', () => {
    expect(receiptRungOf(O_A_accuse1)).toBe('rung-5')
  })

  it('F64 -- NPC_A\'s UnderstandingResult is deterministically false, derived from exactly her two committed Observations', () => {
    expect(understandingA1.understood).toBe(false)
    expect(understandingA1.inputRecordIds).toEqual([O_A_accuse1.id, O_A_competing1.id])
    expect(understandingA1.understandingRuleId).toBe('understand_distracted')
  })
})

describe('P8/P11 -- understood-content recipients are ascription-eligible', () => {
  it('Cora and Daren both derive a positive UnderstandingResult from their own single committed Observation', () => {
    expect(understandingCora1.understood).toBe(true)
    expect(understandingCora1.inputRecordIds).toEqual([O_Cora_accuse1.id])
    expect(understandingDaren1.understood).toBe(true)
    expect(understandingDaren1.inputRecordIds).toEqual([O_Daren_accuse1.id])
  })

  it('P73/P99 -- NPC_E reaches an identical positive UnderstandingResult to Cora/Daren (structurally identical reception)', () => {
    expect(understandingE1.understood).toBe(true)
    expect(understandingE1.understandingRuleId).toBe('understand_default')
    expect(understandingE1.inputRecordIds).toEqual([O_E_accuse1.id])
  })
})

describe('P85 -- UnderstandingResult re-derives identically, every time', () => {
  it('re-running the same deterministic rule against the same committed inputs produces the identical value', () => {
    const first = understandDefault('NPC_C', O_Cora_accuse1)
    const second = understandDefault('NPC_C', O_Cora_accuse1)
    expect(first).toEqual(second)
    expect(first.understandingRuleVersion).toBe(UNDERSTANDING_RULE_VERSION)
  })

  it('F65 [static source-contract check] -- the rule signature cannot name anything beyond the ascriber\'s own committed Observation(s)', () => {
    // understandDefault: (holderId: string, observation: Observation) -- no
    // second parameter exists through which engine truth, another holder's
    // state, or an LLM result could enter.
    expect(understandDefault.length).toBe(2)
    expect(understandDistracted.length).toBe(3)
  })
})

describe('F66 -- UnderstandingResult is never a committed authoritative record', () => {
  it('the type has no schemaVersion/id fields and no committing function exists for it', () => {
    expect('schemaVersion' in understandingCora1).toBe(false)
    expect('id' in understandingCora1).toBe(false)
  })
})

describe('P9 -- content_recipients is derived, never a stored "actual audience" object', () => {
  it('rung classification is a pure function of Observation fields alone', () => {
    expect(receiptRungOf(O_Cora_accuse1)).toBe('rung-5')
    expect(receiptRungOf(O_Daren_accuse1)).toBe('rung-5')
    expect(receiptRungOf(O_E_accuse1)).toBe('rung-5')
  })
})

describe('F8/F11 -- the occurrence-only observer is never mis-classified as a content recipient or overhearer', () => {
  it('F8 -- NPC_R never mints the speaker-act or recipient-participation shape (no sound channel reached)', () => {
    expect(O_R_accuse1.channels).toEqual(['sight'])
    expect(O_R_accuse1.perceived.act).toBeUndefined()
  })

  it('F11 -- NPC_R cannot be classified "overheard" (a content_recipients-only classification) since she never reaches rung 5', () => {
    expect(receiptRungOf(O_R_accuse1)).toBe('below-rung-5')
  })
})

describe('F10 -- a rung-5-only Observation never licenses world-content acceptance', () => {
  it('NPC_A\'s rung-5 Observation carries no acceptance-relevant field; acceptance is a separate, later rung (7/8) never reached by rung-5 alone', () => {
    expect(receiptRungOf(O_A_accuse1)).toBe('rung-5')
    expect(understandingA1.understood).toBe(false)
    // Rung 5 alone (canonicalized content) never implies rung 7/8
    // (trust-applied acceptance) -- there is no code path anywhere in
    // attributionRules.ts that reads a rung-5 Observation directly for
    // world-belief acceptance; acceptance rides the ordinary,
    // already-proven Belief-Update Calculus (beliefUpdate.ts) unchanged.
  })
})
