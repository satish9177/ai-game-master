import { describe, expect, it } from 'vitest'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import { beliefB1 } from './conflictScenario'
import { beliefC2 } from './hierarchyScenario'
import {
  ADOPTION_TIME,
  CORRECTION_TIME,
  REFRESH_TIME,
  beliefC1DoublePrime,
  buildIntentionBase,
  intentionContext,
  ptReportWatch,
  ptWarnTownsfolk,
  runScenario1,
  runScenario2,
} from './intentionScenario'
import { INTENTION_RULE_VERSION, RECONSIDER_SUPPORT_RULE_ID } from './intentionContracts'
import type { GoalOption } from './intentionContracts'
import {
  commitAdoption,
  commitIntentionTransition,
  currentSupportOf,
  intentionTxBound,
  isIntentionOpen,
} from './intentionStore'
import { nightTick } from './conflictScenario'

/**
 * Store-level validation faults for Intention Lifecycle Replay v0 (ADR-0009
 * D2/D3/D5/D9, spec §5). Each fault below is rejected by its targeted
 * checker only, committing nothing: F1 (adoption without support), F3
 * (cross-holder support), F5 (duplicate terminal), F6 (resume without
 * suspend), F7 (rebind to inapplicable plan), and the six refresh-support
 * validation faults F15-F20 (§2.5a). F2 (missing trigger) is here too.
 */

function reportOption(overrides: Partial<GoalOption> = {}): GoalOption {
  return {
    holder: 'NPC_C',
    candidateObjective: { objectiveType: 'report-crime', roles: { culprit: 'player', crime: 'attacked', victim: 'guard_malik' }, canonicalizerVersion: 'cz_v0' },
    derivedFromBeliefs: [beliefC1.id],
    sourceObjectiveMetadataId: 'OM_report_crime',
    sourceObjectiveMetadataVersion: 'om_v0',
    ruleId: 'derive_report_option',
    ruleVersion: INTENTION_RULE_VERSION,
    priorityBasis: 'crime_severity=high',
    priorityRank: 2,
    ...overrides,
  }
}

const reportBinding = { templateId: 'PT_report_gatehouse', templateVersion: 'pt_v0', params: {} }

describe('F1 -- adoption without supporting belief references', () => {
  it('an option with empty adoption support is rejected; nothing is committed', () => {
    const base = buildIntentionBase()
    // A fresh store with capacity: use NPC_A, who holds no report intention.
    const result = commitAdoption(
      base.intentions,
      { holder: 'NPC_C', option: reportOption({ holder: 'NPC_C', derivedFromBeliefs: [] }), planBinding: reportBinding, reconsiderationPolicy: 'default', effectiveValidTime: ADOPTION_TIME },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'adoption-without-support' })
    expect(result.store).toBe(base.intentions)
  })

  it('an option referencing a non-existent belief is rejected (unknown-support-belief)', () => {
    const base = buildIntentionBase()
    const result = commitAdoption(
      base.intentions,
      { holder: 'NPC_D', option: reportOption({ holder: 'NPC_D', derivedFromBeliefs: ['Bel_NOPE'] }), planBinding: reportBinding, reconsiderationPolicy: 'default', effectiveValidTime: ADOPTION_TIME },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'unknown-support-belief' })
  })
})

describe('F3 -- adoption/transition using another holder\'s private belief', () => {
  it("NPC_C adopting on NPC_B's belief is rejected (cross-holder-support)", () => {
    const base = buildIntentionBase()
    const result = commitAdoption(
      base.intentions,
      { holder: 'NPC_D', option: reportOption({ holder: 'NPC_D', derivedFromBeliefs: [beliefB1.id] }), planBinding: reportBinding, reconsiderationPolicy: 'default', effectiveValidTime: ADOPTION_TIME },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'cross-holder-support' })
  })
})

describe('F2 -- transition referencing a missing trigger', () => {
  it('a terminal transition citing an absent BeliefTransition/ActionOutcome is rejected', () => {
    const base = buildIntentionBase()
    const result = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.icC1,
        holder: 'NPC_C',
        kind: 'abandon',
        cause: 'unsupported',
        triggeringIds: ['BT_DOES_NOT_EXIST'],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        effectiveValidTime: CORRECTION_TIME,
      },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'missing-trigger' })
  })
})

describe('F5 -- two terminal transitions for one intention', () => {
  it('a second terminal transition on an already-closed intention is rejected (intention-closed)', () => {
    const scenario1 = runScenario1() // IC_C1 already abandoned
    const result = commitIntentionTransition(
      scenario1.intentions,
      {
        intentionId: 'IC_C1',
        holder: 'NPC_C',
        kind: 'fail',
        cause: 'plan-exhausted',
        triggeringIds: ['BT_0001'],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        effectiveValidTime: nightTick('night_4', 5),
      },
      intentionContext(scenario1.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'intention-closed' })
  })
})

describe('F6 -- resume without a preceding suspend', () => {
  it('a resume on an intention with no prior suspend is rejected', () => {
    const base = buildIntentionBase()
    const result = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.icC1,
        holder: 'NPC_C',
        kind: 'resume',
        cause: 'preemption-lifted',
        triggeringIds: [beliefC1.id],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        effectiveValidTime: CORRECTION_TIME,
      },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'resume-without-suspend' })
  })
})

describe('F7 -- rebind to an inapplicable plan', () => {
  it('a rebind binding a template whose context is not entailed is rejected (rebind-plan-inapplicable)', () => {
    const base = buildIntentionBase()
    // IC_C1 is a report intention; PT_warn_townsfolk serves warn-of-danger,
    // so it is inapplicable both by objective type and by context atom.
    const result = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.icC1,
        holder: 'NPC_C',
        kind: 'rebind',
        cause: 'plan-inapplicable',
        triggeringIds: [beliefC1.id],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        planBinding: { templateId: ptWarnTownsfolk.id, templateVersion: 'pt_v0', params: {} },
        effectiveValidTime: CORRECTION_TIME,
      },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'rebind-plan-inapplicable' })
  })

  it('a rebind carrying dependency support is rejected (rebind-carries-support) -- plan and support stay separate (D5)', () => {
    const base = buildIntentionBase()
    const result = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.icC1,
        holder: 'NPC_C',
        kind: 'rebind',
        cause: 'plan-inapplicable',
        triggeringIds: [beliefC1.id],
        planBinding: { templateId: ptReportWatch.id, templateVersion: 'pt_v0', params: {} },
        currentDependencySupport: [beliefC1.id],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        effectiveValidTime: CORRECTION_TIME,
      },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'rebind-carries-support' })
  })
})

describe('F15-F20 -- refresh-support validation (§2.5a)', () => {
  // Scenario 2's afterRefresh state has IC_C2 open with current support
  // [Bel_C1'']; the pre-refresh state (scenario1) has it at [Bel_C1'].
  function openWarnState() {
    const scenario1 = runScenario1()
    return { intentions: scenario1.intentions, ctx: intentionContext(scenario1.conflict), icC2: scenario1.icC2 }
  }

  const validRefresh = {
    intentionId: 'IC_C2',
    holder: 'NPC_C' as const,
    kind: 'refresh-support' as const,
    cause: 'support-superseded-but-re-entailed' as const,
    ruleId: RECONSIDER_SUPPORT_RULE_ID,
    ruleVersion: INTENTION_RULE_VERSION,
    effectiveValidTime: REFRESH_TIME,
  }

  it('F15 -- refresh-support citing no triggering BeliefTransition is rejected', () => {
    const { intentions, ctx } = openWarnState()
    const result = commitIntentionTransition(
      intentions,
      { ...validRefresh, triggeringIds: [beliefC1Prime.id], previousDependencySupport: [beliefC1Prime.id], currentDependencySupport: [beliefC1DoublePrime.id] },
      ctx,
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-missing-trigger' })
  })

  it("F16 -- refresh-support whose replacement cites another holder's belief is rejected", () => {
    // Need a committed BeliefTransition to satisfy F15 first: scenario 2's
    // BT_0002 exists only in that fork, so use the pre-refresh state with a
    // real trigger id but a cross-holder replacement.
    const scenario2 = runScenario2()
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0002'],
        previousDependencySupport: [beliefC1DoublePrime.id],
        currentDependencySupport: [beliefB1.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-cross-holder-support' })
  })

  it('F17 -- refresh-support whose replacement belief is not current is rejected', () => {
    const scenario2 = runScenario2()
    // Bel_C1' is already superseded by Bel_C1'' at this bound -- not current.
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0002'],
        previousDependencySupport: [beliefC1DoublePrime.id],
        currentDependencySupport: [beliefC1Prime.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-support-not-current' })
  })

  it('F18 -- a replacement that is current but does not entail the objective is rejected (refresh-support-not-justifying)', () => {
    const scenario2 = runScenario2()
    // Bel_C2 is NPC_C's own pantry belief -- current at night_5, but it
    // carries no danger-present atom, so it cannot justify the warn
    // intention. The correct outcome for a non-justifying supersession is
    // abandon(unsupported), not refresh -- so refresh is rejected here.
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0002'],
        previousDependencySupport: [beliefC1DoublePrime.id],
        currentDependencySupport: [beliefC2.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-support-not-justifying' })
  })

  it('positive twin -- a genuinely re-entailing refresh commits and updates current support', () => {
    const scenario2 = runScenario2()
    expect(scenario2.refreshTransition.kind).toBe('refresh-support')
    expect(scenario2.refreshTransition.currentDependencySupport).toEqual([beliefC1DoublePrime.id])
  })

  it('F19 -- refresh-support attempting to rewrite immutable adoption support is rejected', () => {
    const scenario2 = runScenario2()
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0002'],
        previousDependencySupport: [beliefC1DoublePrime.id],
        currentDependencySupport: [beliefC1DoublePrime.id],
        adoptionSupportOverride: [beliefC1DoublePrime.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-mutates-adoption-support' })
  })

  it('F20 -- refresh-support for a closed intention is rejected', () => {
    const scenario2 = runScenario2() // IC_C2 closed by BT_0003
    const result = commitIntentionTransition(
      scenario2.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0003'],
        previousDependencySupport: [beliefC1DoublePrime.id],
        currentDependencySupport: [beliefC1DoublePrime.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-intention-closed' })
  })

  it('a refresh-support with a previous-support set that does not match the current projection is rejected', () => {
    const scenario2 = runScenario2()
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        ...validRefresh,
        triggeringIds: ['BT_0002'],
        previousDependencySupport: [beliefC1Prime.id], // stale -- current is Bel_C1''
        currentDependencySupport: [beliefC1DoublePrime.id],
        effectiveValidTime: nightTick('night_5', 2),
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'refresh-previous-support-mismatch' })
  })
})

describe('capacity cap (v0: one open intention per holder)', () => {
  it('a second adoption while an intention is open is rejected (capacity-exceeded)', () => {
    const base = buildIntentionBase() // IC_C1 open
    const result = commitAdoption(
      base.intentions,
      { holder: 'NPC_C', option: reportOption(), planBinding: reportBinding, reconsiderationPolicy: 'default', effectiveValidTime: ADOPTION_TIME },
      intentionContext(base.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'capacity-exceeded' })
  })
})

describe('duplicate transition detection', () => {
  it('a byte-identical resubmission of a committed transition is rejected as a duplicate', () => {
    const scenario2 = runScenario2()
    // Resubmit the refresh-support transition verbatim against the
    // afterRefresh store (before it was applied there).
    const result = commitIntentionTransition(
      scenario2.afterRefresh.intentions,
      {
        intentionId: 'IC_C2',
        holder: 'NPC_C',
        kind: 'refresh-support',
        cause: 'support-superseded-but-re-entailed',
        triggeringIds: ['BT_0002'],
        ruleId: RECONSIDER_SUPPORT_RULE_ID,
        ruleVersion: INTENTION_RULE_VERSION,
        previousDependencySupport: [beliefC1Prime.id],
        currentDependencySupport: [beliefC1DoublePrime.id],
        effectiveValidTime: REFRESH_TIME,
      },
      intentionContext(scenario2.afterRefresh.conflict),
    )
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'duplicate-transition' })
  })
})

describe('derived projections (D4: no stored status)', () => {
  it('current dependency support after refresh reads the refreshed set, adoption support stays immutable', () => {
    const scenario2 = runScenario2()
    const bound = intentionTxBound(scenario2.afterRefresh.intentions)
    expect(currentSupportOf(scenario2.afterRefresh.intentions, 'IC_C2', bound)).toEqual([beliefC1DoublePrime.id])
    const commitment = scenario2.afterRefresh.intentions.commitments.find((c) => c.intentionId === 'IC_C2')
    expect(commitment?.adoptionSupport).toEqual([beliefC1Prime.id])
    expect(isIntentionOpen(scenario2.afterRefresh.intentions, 'IC_C2', bound)).toBe(true)
  })
})
