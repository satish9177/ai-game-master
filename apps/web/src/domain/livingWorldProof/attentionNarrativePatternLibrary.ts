/**
 * Stage B / B3 — the closed, hand-authored narrative-pattern library.
 *
 * This module owns exactly the three RN019 v1 pattern definitions and nothing
 * else. It is a closed union/switch, not a plugin, callback, DSL, or dynamic
 * registration surface: there is no `register`, no external definition input,
 * and no runtime-authored definition path. Every definition is a
 * frozen, hand-authored data descriptor whose complete bytes are hashed at load
 * time, so a later semantic edit cannot silently retain an old identity.
 *
 * The descriptor is data only. The B3 monitor interprets it to classify
 * accessor-minted A-prime evidence; every instance the monitor derives from it
 * is still validated by the pinned B2 `createNarrativePatternInstanceContract`.
 * This module imports no ledger, trace, template, replay, generative-service,
 * wall clock, RNG, or authoritative surface.
 */
import {
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA,
  ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA,
} from './attentionCandidatePolicy'
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  NARRATIVE_PATTERN_BINDING_ROLES,
  NARRATIVE_PATTERN_SUPPORTING_ROLES,
  NARRATIVE_PATTERN_TYPES,
} from './attentionNarrativePatternIdentity'
import type {
  NarrativePatternBindingRole,
  NarrativePatternRecordKind,
  NarrativePatternSupportingRole,
  NarrativePatternType,
} from './attentionNarrativePatternIdentity'

/** The library-owned name of the closed narrative-pattern library schema. */
export const ATTENTION_NARRATIVE_PATTERN_LIBRARY_SCHEMA_VERSION =
  'attention-narrative-pattern-library-schema-v1' as const

/** RN019 §8: a definition may declare at most three steps and three evidence items. */
export const NARRATIVE_PATTERN_MAX_STEPS = 3
export const NARRATIVE_PATTERN_MAX_EVIDENCE_ITEMS = 3

/** RN019 §6.2 closed severity mapping for `public_conflict_escalation`. */
export const NARRATIVE_PATTERN_SEVERITY_ORDER = Object.freeze({
  minor: 0,
  moderate: 1,
  major: 2,
} as const)

export type NarrativePatternSeverityBand = keyof typeof NARRATIVE_PATTERN_SEVERITY_ORDER

/** The closed direct-evidence assertion kinds (RN019 §6.4). */
export type NarrativePatternAssertionKind =
  | 'public_aid'
  | 'public_harm_severity'
  | 'public_commitment'
  | 'public_fulfillment_record'

/** How the actor/target of an evidence view map onto the two authored bindings. */
export type NarrativePatternDirection = 'forward' | 'reverse' | 'either'

/** Severity constraint relative to the prior advancing step's severity band. */
export type NarrativePatternSeverityConstraint = 'gte-previous' | 'gt-previous'

/** A single authored evidence rule for one supporting role. */
export type NarrativePatternEvidenceRule =
  | {
      readonly ruleKind: 'observable_action'
      readonly semanticRole: NarrativePatternSupportingRole
      readonly actionCodes: readonly ('aid' | 'harm' | 'fulfill_commitment' | 'reconcile')[]
      readonly direction: NarrativePatternDirection
      readonly requiresSeverity: boolean
      readonly severityConstraint: NarrativePatternSeverityConstraint | null
      readonly requiresCommitmentKeyMatchesStart: boolean
      readonly requiresWithinDeadline: boolean
    }
  | {
      readonly ruleKind: 'validated_public_communication'
      readonly semanticRole: NarrativePatternSupportingRole
      readonly communicationCodes: readonly (
        'commitment' | 'retract_commitment' | 'explicit_refusal' | 'reconciliation'
      )[]
      readonly direction: NarrativePatternDirection
      readonly requiresCommitmentKey: boolean
      readonly requiresPublicDeadline: boolean
      readonly requiresCommitmentKeyMatchesStart: boolean
    }
  | {
      readonly ruleKind: 'world_observable_availability'
      readonly semanticRole: NarrativePatternSupportingRole
    }

export type NarrativePatternOverlapRule =
  | 'reciprocal-overlap'
  | 'conflict-two-child-fork'
  | 'keyed-no-fork'

export type NarrativePatternHorizonRule =
  | { readonly horizonKind: 'lsn-delta'; readonly delta: number }
  | { readonly horizonKind: 'public-deadline' }

/**
 * The complete authored definition. Every field participates in the content
 * hash so no semantic coordinate can drift without a new identity.
 */
export interface NarrativePatternDefinition {
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly monitorRuleVersion: string
  readonly bindingRoleOrder: readonly NarrativePatternBindingRole[]
  readonly supportingRoleOrder: readonly NarrativePatternSupportingRole[]
  readonly totalSteps: number
  readonly legalRecordKinds: readonly NarrativePatternRecordKind[]
  readonly startRule: NarrativePatternEvidenceRule
  readonly advancementRules: readonly NarrativePatternEvidenceRule[]
  readonly invalidationRule: NarrativePatternEvidenceRule
  readonly abandonmentRule: NarrativePatternEvidenceRule
  readonly overlapRule: NarrativePatternOverlapRule
  readonly horizonRule: NarrativePatternHorizonRule
  readonly severityOrder: Readonly<Record<NarrativePatternSeverityBand, number>> | null
  readonly directAssertionByRole: Readonly<
    Partial<Record<NarrativePatternSupportingRole, NarrativePatternAssertionKind>>
  >
  readonly forkChildCap: number | null
}

function freezeRule(rule: NarrativePatternEvidenceRule): NarrativePatternEvidenceRule {
  if (rule.ruleKind === 'observable_action') {
    return Object.freeze({ ...rule, actionCodes: Object.freeze([...rule.actionCodes]) })
  }
  if (rule.ruleKind === 'validated_public_communication') {
    return Object.freeze({ ...rule, communicationCodes: Object.freeze([...rule.communicationCodes]) })
  }
  return Object.freeze({ ...rule })
}

function freezeDefinition(definition: NarrativePatternDefinition): NarrativePatternDefinition {
  return Object.freeze({
    patternType: definition.patternType,
    patternSemanticVersion: definition.patternSemanticVersion,
    monitorRuleVersion: definition.monitorRuleVersion,
    bindingRoleOrder: Object.freeze([...definition.bindingRoleOrder]),
    supportingRoleOrder: Object.freeze([...definition.supportingRoleOrder]),
    totalSteps: definition.totalSteps,
    legalRecordKinds: Object.freeze([...definition.legalRecordKinds]),
    startRule: freezeRule(definition.startRule),
    advancementRules: Object.freeze(definition.advancementRules.map(freezeRule)),
    invalidationRule: freezeRule(definition.invalidationRule),
    abandonmentRule: freezeRule(definition.abandonmentRule),
    overlapRule: definition.overlapRule,
    horizonRule: Object.freeze({ ...definition.horizonRule }),
    severityOrder: definition.severityOrder === null
      ? null
      : Object.freeze({ ...definition.severityOrder }),
    directAssertionByRole: Object.freeze({ ...definition.directAssertionByRole }),
    forkChildCap: definition.forkChildCap,
  })
}

// ---------------------------------------------------------------------------
// The three closed, hand-authored definitions.
// ---------------------------------------------------------------------------

const RECIPROCAL_PUBLIC_AID: NarrativePatternDefinition = freezeDefinition({
  patternType: 'reciprocal_public_aid',
  patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  bindingRoleOrder: NARRATIVE_PATTERN_BINDING_ROLES.reciprocal_public_aid,
  supportingRoleOrder: NARRATIVE_PATTERN_SUPPORTING_ROLES.reciprocal_public_aid,
  totalSteps: 2,
  legalRecordKinds: ['observable_action', 'world_observable_availability'],
  startRule: {
    ruleKind: 'observable_action',
    semanticRole: 'aid-start',
    actionCodes: ['aid'],
    direction: 'forward',
    requiresSeverity: false,
    severityConstraint: null,
    requiresCommitmentKeyMatchesStart: false,
    requiresWithinDeadline: false,
  },
  advancementRules: [
    {
      ruleKind: 'observable_action',
      semanticRole: 'aid-return',
      actionCodes: ['aid'],
      direction: 'reverse',
      requiresSeverity: false,
      severityConstraint: null,
      requiresCommitmentKeyMatchesStart: false,
      requiresWithinDeadline: false,
    },
  ],
  invalidationRule: {
    ruleKind: 'observable_action',
    semanticRole: 'aid-invalidation',
    actionCodes: ['harm'],
    direction: 'reverse',
    requiresSeverity: false,
    severityConstraint: null,
    requiresCommitmentKeyMatchesStart: false,
    requiresWithinDeadline: false,
  },
  abandonmentRule: { ruleKind: 'world_observable_availability', semanticRole: 'availability-terminal' },
  overlapRule: 'reciprocal-overlap',
  horizonRule: { horizonKind: 'lsn-delta', delta: ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA },
  severityOrder: null,
  directAssertionByRole: { 'aid-start': 'public_aid', 'aid-return': 'public_aid' },
  forkChildCap: null,
})

const PUBLIC_CONFLICT_ESCALATION: NarrativePatternDefinition = freezeDefinition({
  patternType: 'public_conflict_escalation',
  patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  bindingRoleOrder: NARRATIVE_PATTERN_BINDING_ROLES.public_conflict_escalation,
  supportingRoleOrder: NARRATIVE_PATTERN_SUPPORTING_ROLES.public_conflict_escalation,
  totalSteps: 3,
  legalRecordKinds: [
    'observable_action',
    'validated_public_communication',
    'world_observable_availability',
  ],
  startRule: {
    ruleKind: 'observable_action',
    semanticRole: 'harm-start',
    actionCodes: ['harm'],
    direction: 'forward',
    requiresSeverity: true,
    severityConstraint: null,
    requiresCommitmentKeyMatchesStart: false,
    requiresWithinDeadline: false,
  },
  advancementRules: [
    {
      ruleKind: 'observable_action',
      semanticRole: 'harm-reply',
      actionCodes: ['harm'],
      direction: 'reverse',
      requiresSeverity: true,
      severityConstraint: 'gte-previous',
      requiresCommitmentKeyMatchesStart: false,
      requiresWithinDeadline: false,
    },
    {
      ruleKind: 'observable_action',
      semanticRole: 'harm-escalation',
      actionCodes: ['harm'],
      direction: 'forward',
      requiresSeverity: true,
      severityConstraint: 'gt-previous',
      requiresCommitmentKeyMatchesStart: false,
      requiresWithinDeadline: false,
    },
  ],
  invalidationRule: {
    ruleKind: 'observable_action',
    semanticRole: 'reconciliation-terminal',
    actionCodes: ['reconcile'],
    direction: 'either',
    requiresSeverity: false,
    severityConstraint: null,
    requiresCommitmentKeyMatchesStart: false,
    requiresWithinDeadline: false,
  },
  abandonmentRule: { ruleKind: 'world_observable_availability', semanticRole: 'availability-terminal' },
  overlapRule: 'conflict-two-child-fork',
  horizonRule: {
    horizonKind: 'lsn-delta',
    delta: ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA,
  },
  severityOrder: NARRATIVE_PATTERN_SEVERITY_ORDER,
  directAssertionByRole: {
    'harm-start': 'public_harm_severity',
    'harm-reply': 'public_harm_severity',
    'harm-escalation': 'public_harm_severity',
  },
  forkChildCap: 2,
})

const PUBLIC_COMMITMENT_FULFILLED: NarrativePatternDefinition = freezeDefinition({
  patternType: 'public_commitment_fulfilled',
  patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  bindingRoleOrder: NARRATIVE_PATTERN_BINDING_ROLES.public_commitment_fulfilled,
  supportingRoleOrder: NARRATIVE_PATTERN_SUPPORTING_ROLES.public_commitment_fulfilled,
  totalSteps: 2,
  legalRecordKinds: [
    'observable_action',
    'validated_public_communication',
    'world_observable_availability',
  ],
  startRule: {
    ruleKind: 'validated_public_communication',
    semanticRole: 'commitment-start',
    communicationCodes: ['commitment'],
    direction: 'forward',
    requiresCommitmentKey: true,
    requiresPublicDeadline: true,
    requiresCommitmentKeyMatchesStart: false,
  },
  advancementRules: [
    {
      ruleKind: 'observable_action',
      semanticRole: 'fulfillment',
      actionCodes: ['fulfill_commitment'],
      direction: 'forward',
      requiresSeverity: false,
      severityConstraint: null,
      requiresCommitmentKeyMatchesStart: true,
      requiresWithinDeadline: true,
    },
  ],
  invalidationRule: {
    ruleKind: 'validated_public_communication',
    semanticRole: 'retraction-or-refusal-terminal',
    communicationCodes: ['retract_commitment', 'explicit_refusal'],
    direction: 'forward',
    requiresCommitmentKey: true,
    requiresPublicDeadline: false,
    requiresCommitmentKeyMatchesStart: true,
  },
  abandonmentRule: { ruleKind: 'world_observable_availability', semanticRole: 'availability-terminal' },
  overlapRule: 'keyed-no-fork',
  horizonRule: { horizonKind: 'public-deadline' },
  severityOrder: null,
  directAssertionByRole: {
    'commitment-start': 'public_commitment',
    fulfillment: 'public_fulfillment_record',
  },
  forkChildCap: null,
})

// ---------------------------------------------------------------------------
// Closed content hashing and load-time validation.
// ---------------------------------------------------------------------------

function contentHashOf(definition: NarrativePatternDefinition): string {
  return mintHash(canonicalSerialize(definition))
}

export type NarrativePatternLibraryLoadRefusal =
  | 'unknown-pattern-type'
  | 'duplicate-definition'
  | 'unsupported-semantic-version'
  | 'zero-steps'
  | 'too-many-steps'
  | 'too-many-evidence-items'
  | 'undeclared-role'
  | 'invalid-content-hash'

class NarrativePatternLibraryLoadError extends Error {
  readonly reason: NarrativePatternLibraryLoadRefusal

  constructor(reason: NarrativePatternLibraryLoadRefusal) {
    super(`attentionNarrativePatternLibrary: ${reason}`)
    this.name = 'NarrativePatternLibraryLoadError'
    this.reason = reason
  }
}

function validateDefinitionOrThrow(definition: NarrativePatternDefinition): void {
  if (!NARRATIVE_PATTERN_TYPES.includes(definition.patternType)) {
    throw new NarrativePatternLibraryLoadError('unknown-pattern-type')
  }
  if (definition.patternSemanticVersion !== ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION) {
    throw new NarrativePatternLibraryLoadError('unsupported-semantic-version')
  }
  const steps = definition.advancementRules.length + 1
  if (steps < 1) throw new NarrativePatternLibraryLoadError('zero-steps')
  if (steps !== definition.totalSteps || steps > NARRATIVE_PATTERN_MAX_STEPS) {
    throw new NarrativePatternLibraryLoadError('too-many-steps')
  }
  // Every instance carries at most `totalSteps` advancing evidence items plus at
  // most one terminal record; the identity role vocabulary is the closed bound.
  if (definition.supportingRoleOrder.length > NARRATIVE_PATTERN_MAX_EVIDENCE_ITEMS + 2) {
    throw new NarrativePatternLibraryLoadError('too-many-evidence-items')
  }
  const declaredRoles = new Set<string>(
    NARRATIVE_PATTERN_SUPPORTING_ROLES[definition.patternType] as readonly string[],
  )
  const usedRoles = [
    definition.startRule.semanticRole,
    ...definition.advancementRules.map((rule) => rule.semanticRole),
    definition.invalidationRule.semanticRole,
    definition.abandonmentRule.semanticRole,
  ]
  if (usedRoles.some((role) => !declaredRoles.has(role))) {
    throw new NarrativePatternLibraryLoadError('undeclared-role')
  }
  const declaredBindings = new Set<string>(
    NARRATIVE_PATTERN_BINDING_ROLES[definition.patternType] as readonly string[],
  )
  if (
    definition.bindingRoleOrder.length !== declaredBindings.size
    || definition.bindingRoleOrder.some((role) => !declaredBindings.has(role))
  ) {
    throw new NarrativePatternLibraryLoadError('undeclared-role')
  }
}

interface LoadedLibrary {
  readonly definitionsByType: ReadonlyMap<NarrativePatternType, NarrativePatternDefinition>
  readonly contentHashByType: Readonly<Record<NarrativePatternType, string>>
  readonly libraryHash: string
}

function loadClosedLibrary(
  authored: readonly NarrativePatternDefinition[],
): LoadedLibrary {
  const definitionsByType = new Map<NarrativePatternType, NarrativePatternDefinition>()
  for (const definition of authored) {
    validateDefinitionOrThrow(definition)
    if (definitionsByType.has(definition.patternType)) {
      throw new NarrativePatternLibraryLoadError('duplicate-definition')
    }
    definitionsByType.set(definition.patternType, definition)
  }
  // Canonical pattern-type order — never Map insertion order.
  const orderedTypes = [...NARRATIVE_PATTERN_TYPES].filter((type) => definitionsByType.has(type))
  const contentHashByType: Partial<Record<NarrativePatternType, string>> = {}
  const orderedDefinitions: NarrativePatternDefinition[] = []
  for (const type of orderedTypes) {
    const definition = definitionsByType.get(type)!
    const hash = contentHashOf(definition)
    if (!hash.startsWith('fnv1a64-v1:')) {
      throw new NarrativePatternLibraryLoadError('invalid-content-hash')
    }
    contentHashByType[type] = hash
    orderedDefinitions.push(definition)
  }
  const libraryHash = mintHash(canonicalSerialize({
    schema: ATTENTION_NARRATIVE_PATTERN_LIBRARY_SCHEMA_VERSION,
    definitions: orderedDefinitions,
  }))
  return {
    definitionsByType,
    contentHashByType: Object.freeze(contentHashByType as Record<NarrativePatternType, string>),
    libraryHash,
  }
}

const LIBRARY = loadClosedLibrary([
  RECIPROCAL_PUBLIC_AID,
  PUBLIC_CONFLICT_ESCALATION,
  PUBLIC_COMMITMENT_FULFILLED,
])

/** The closed set of authored pattern types, in canonical order. */
export const NARRATIVE_PATTERN_LIBRARY_TYPES: readonly NarrativePatternType[] =
  Object.freeze([...NARRATIVE_PATTERN_TYPES])

export function getNarrativePatternDefinition(
  patternType: NarrativePatternType,
): NarrativePatternDefinition {
  const definition = LIBRARY.definitionsByType.get(patternType)
  if (definition === undefined) {
    throw new NarrativePatternLibraryLoadError('unknown-pattern-type')
  }
  return definition
}

export function narrativePatternContentHash(patternType: NarrativePatternType): string {
  const hash = LIBRARY.contentHashByType[patternType]
  if (hash === undefined) {
    throw new NarrativePatternLibraryLoadError('unknown-pattern-type')
  }
  return hash
}

export const ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH = LIBRARY.libraryHash

/**
 * Test-only: reload an arbitrary authored definition set through the exact
 * closed-library validation, so refusals are provable without exposing a
 * registration surface on the production library. It never mutates `LIBRARY`.
 */
export function loadNarrativePatternLibraryForProof(
  authored: readonly NarrativePatternDefinition[],
): { readonly kind: 'ok' } | { readonly kind: 'refused'; readonly reason: NarrativePatternLibraryLoadRefusal } {
  try {
    loadClosedLibrary(authored)
    return { kind: 'ok' }
  } catch (error) {
    if (error instanceof NarrativePatternLibraryLoadError) {
      return { kind: 'refused', reason: error.reason }
    }
    throw error
  }
}

/** Test-only accessors for the frozen authored descriptors. */
export const NARRATIVE_PATTERN_AUTHORED_DEFINITIONS: readonly NarrativePatternDefinition[] =
  Object.freeze([RECIPROCAL_PUBLIC_AID, PUBLIC_CONFLICT_ESCALATION, PUBLIC_COMMITMENT_FULFILLED])
