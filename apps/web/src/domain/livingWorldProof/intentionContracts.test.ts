import { describe, expect, it } from 'vitest'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import {
  IntentionCommitmentSchema,
  IntentionTransitionSchema,
} from './intentionContracts'
import type { IntentionTransition } from './intentionContracts'

/**
 * Schema-level structural invariants for the two intention record families
 * (ADR-0009 D2/D3/D5/D9). These are the type-system's share of the proof:
 * a plan binding may live only on adopt/rebind, dependency support only on
 * adopt/refresh-support, previous support only on refresh-support, and a
 * commitment carries no mutable status field. Zod rejects every crossed
 * wiring, so `rebind` and `refresh-support` can never carry each other's
 * payload even before the store's runtime checks.
 */

function baseTransition(overrides: Partial<IntentionTransition>): unknown {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    transitionId: 'IT_C_0001',
    intentionId: 'IC_C1',
    holder: 'NPC_C',
    kind: 'adopt',
    cause: 'option-adopted',
    triggeringIds: ['Bel_C1'],
    ruleId: 'derive_report_option',
    ruleVersion: 'ir_v0',
    effectiveValidTime: { night: 4, tick: 0 },
    commitSeq: 3,
    ...overrides,
  }
}

const planBinding = { templateId: 'PT_report_gatehouse', templateVersion: 'pt_v0', params: {} }

describe('IntentionCommitment schema (D2)', () => {
  it('accepts a well-formed commitment and forbids a mutable status field', () => {
    const valid = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      intentionId: 'IC_C1',
      holder: 'NPC_C',
      canonicalObjective: { objectiveType: 'report-crime', roles: { culprit: 'player' }, canonicalizerVersion: 'cz_v0' },
      sourceObjectiveMetadataId: 'OM_report_crime',
      sourceObjectiveMetadataVersion: 'om_v0',
      adoptionSupport: ['Bel_C1'],
      adoptionRuleId: 'derive_report_option',
      adoptionRuleVersion: 'ir_v0',
      priorityBasis: 'crime_severity=high',
      reconsiderationPolicy: 'default',
      effectiveValidTime: { night: 4, tick: 0 },
      commitSeq: 3,
    }
    expect(IntentionCommitmentSchema.safeParse(valid).success).toBe(true)
    expect(IntentionCommitmentSchema.safeParse({ ...valid, status: 'active' }).success).toBe(false)
    expect(IntentionCommitmentSchema.safeParse({ ...valid, adoptionSupport: [] }).success).toBe(false)
  })
})

describe('IntentionTransition schema (D3/D5/D9)', () => {
  it('adopt requires a plan binding and dependency support', () => {
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'adopt', planBinding, currentDependencySupport: ['Bel_C1'] })).success).toBe(true)
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'adopt', currentDependencySupport: ['Bel_C1'] })).success).toBe(false)
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'adopt', planBinding })).success).toBe(false)
  })

  it('refresh-support requires support fields and forbids a plan binding', () => {
    const valid = baseTransition({
      kind: 'refresh-support',
      cause: 'support-superseded-but-re-entailed',
      currentDependencySupport: ['Bel_C1_dprime'],
      previousDependencySupport: ['Bel_C1_prime'],
    })
    expect(IntentionTransitionSchema.safeParse(valid).success).toBe(true)
    // A plan binding on refresh-support is structurally illegal.
    expect(IntentionTransitionSchema.safeParse({ ...(valid as object), planBinding }).success).toBe(false)
  })

  it('rebind forbids dependency support and previous support (plan and support stay separate)', () => {
    const valid = baseTransition({ kind: 'rebind', cause: 'plan-inapplicable', planBinding })
    expect(IntentionTransitionSchema.safeParse(valid).success).toBe(true)
    expect(IntentionTransitionSchema.safeParse({ ...(valid as object), currentDependencySupport: ['Bel_C1'] }).success).toBe(false)
    expect(IntentionTransitionSchema.safeParse({ ...(valid as object), previousDependencySupport: ['Bel_C1'] }).success).toBe(false)
  })

  it('previous dependency support may appear only on refresh-support', () => {
    expect(
      IntentionTransitionSchema.safeParse(baseTransition({ kind: 'abandon', cause: 'unsupported', previousDependencySupport: ['Bel_C1'] })).success,
    ).toBe(false)
  })

  it('terminal transitions carry neither plan binding nor support', () => {
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'abandon', cause: 'unsupported' })).success).toBe(true)
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'complete', cause: 'believed-achieved' })).success).toBe(true)
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'fail', cause: 'plan-exhausted' })).success).toBe(true)
    expect(IntentionTransitionSchema.safeParse(baseTransition({ kind: 'complete', cause: 'believed-achieved', planBinding })).success).toBe(false)
  })
})
