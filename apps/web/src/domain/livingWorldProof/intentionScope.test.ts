import { describe, expect, it } from 'vitest'
import { runScenario1 } from './intentionScenario'
import { intentionUniverse } from './intentionScenario'
import { explainIntentionArc, readIntentionRecord } from './intentionScope'

/**
 * Scope, existence hiding, and explanation assembly for Intention Lifecycle
 * Replay v0 (ADR-0009 D12, spec §5): P25 (explanation cites only
 * holder-readable records; no rule ids, priorities, theta-keys, or
 * validator internals appear) plus the per-holder read gate.
 */

describe('P25 -- explanation cites only holder-readable records', () => {
  it("C's 'why did you stop pursuing me?' answer assembles from IC_C1 <- Bel_C1 <- R_B_to_C, E_claw, BT_0001, and the abandon transition", () => {
    const scenario1 = scenario1WithClosedIcC1()
    const outcome = explainIntentionArc('NPC_C', 'IC_C1', scenario1.intentions, scenario1.conflict, intentionUniverse)
    expect(outcome.verdict).toBe('granted')
    if (outcome.verdict !== 'granted') throw new Error('unreachable')

    const allCitations = outcome.clauses.flatMap((clause) => clause.citations)
    // Every expected holder-readable citation is present.
    expect(allCitations).toContain('IC_C1')
    expect(allCitations).toContain('Bel_C1')
    expect(allCitations).toContain('R_B_to_C')
    expect(allCitations).toContain('E_claw')
    expect(allCitations).toContain('BT_0001')

    // No rule ids, priorities, theta-keys, or validator internals leak into
    // the rendered explanation text or citations.
    const rendered = JSON.stringify(outcome)
    expect(rendered).not.toContain('derive_report_option')
    expect(rendered).not.toContain('reconsider_support')
    expect(rendered).not.toContain('crime_severity')
    expect(rendered).not.toContain('ir_v0')
    expect(rendered).not.toContain('commitSeq')
  })

  it('a non-holder cannot read the commitment, its transitions, or an explanation (existence hiding)', () => {
    const scenario1 = scenario1WithClosedIcC1()
    // NPC_B cannot read NPC_C's commitment...
    expect(readIntentionRecord('NPC_B', 'IC_C1', scenario1.intentions).verdict).toBe('denied')
    // ...nor its abandon transition...
    const abandonId = scenario1.abandonTransition.transitionId
    expect(readIntentionRecord('NPC_B', abandonId, scenario1.intentions).verdict).toBe('denied')
    // ...and a denied read is byte-identical to a nonexistent one.
    const hidden = readIntentionRecord('NPC_B', 'IC_C1', scenario1.intentions)
    const nonexistent = readIntentionRecord('NPC_B', 'IC_DOES_NOT_EXIST', scenario1.intentions)
    expect(hidden.verdict).toBe(nonexistent.verdict)
    // NPC_B cannot explain NPC_C's intention.
    expect(explainIntentionArc('NPC_B', 'IC_C1', scenario1.intentions, scenario1.conflict, intentionUniverse).verdict).toBe('denied')
  })

  it('the holder can read its own commitment and transitions, redacted (no rule/priority internals)', () => {
    const scenario1 = scenario1WithClosedIcC1()
    const read = readIntentionRecord('NPC_C', 'IC_C1', scenario1.intentions)
    expect(read.verdict).toBe('granted')
    if (read.verdict !== 'granted' || read.record.kind !== 'commitment') throw new Error('unreachable')
    // The holder view carries the objective and adoption support, but no
    // adoption rule id / priority basis / reconsideration policy.
    expect(JSON.stringify(read.record.view)).not.toContain('crime_severity')
    expect(JSON.stringify(read.record.view)).not.toContain('derive_report_option')
  })
})

function scenario1WithClosedIcC1() {
  return runScenario1()
}
