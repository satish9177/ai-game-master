/** Stage B / B2 deterministic NarrativePatternInstance identity. */
import { canonicalSerialize, mintHash } from './canonicalSerialization'

export const NARRATIVE_PATTERN_TYPES = Object.freeze([
  'reciprocal_public_aid',
  'public_conflict_escalation',
  'public_commitment_fulfilled',
] as const)

export type NarrativePatternType = typeof NARRATIVE_PATTERN_TYPES[number]

export const NARRATIVE_PATTERN_BINDING_ROLES = Object.freeze({
  reciprocal_public_aid: Object.freeze(['initiator', 'counterparty'] as const),
  public_conflict_escalation: Object.freeze(['initiator', 'counterparty'] as const),
  public_commitment_fulfilled: Object.freeze(['committer', 'recipient'] as const),
})

export type NarrativePatternBindingRole =
  typeof NARRATIVE_PATTERN_BINDING_ROLES[NarrativePatternType][number]

export const NARRATIVE_PATTERN_SUPPORTING_ROLES = Object.freeze({
  reciprocal_public_aid: Object.freeze([
    'aid-start',
    'aid-return',
    'aid-invalidation',
    'availability-terminal',
  ] as const),
  public_conflict_escalation: Object.freeze([
    'harm-start',
    'harm-reply',
    'harm-escalation',
    'reconciliation-terminal',
    'availability-terminal',
  ] as const),
  public_commitment_fulfilled: Object.freeze([
    'commitment-start',
    'fulfillment',
    'retraction-or-refusal-terminal',
    'availability-terminal',
  ] as const),
})

export type NarrativePatternSupportingRole =
  typeof NARRATIVE_PATTERN_SUPPORTING_ROLES[NarrativePatternType][number]

export type NarrativePatternRecordKind =
  | 'observable_action'
  | 'validated_public_communication'
  | 'world_observable_availability'

export interface NarrativePatternBinding {
  readonly role: NarrativePatternBindingRole
  readonly entityId: string
}

export interface NarrativePatternSupportingRecordIdentity {
  readonly semanticRole: NarrativePatternSupportingRole
  readonly recordKind: NarrativePatternRecordKind
  readonly recordId: string
  readonly visibilityProvenanceId: string
  readonly commitLsn: number
}

export interface NarrativePatternIdentityInput {
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly patternContentHash: string
  readonly monitorRuleVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly supportingRecordIdentityTuple: readonly NarrativePatternSupportingRecordIdentity[]
}

export interface CanonicalNarrativePatternIdentityInput {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly patternContentHash: string
  readonly monitorRuleVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly bindingTuple: readonly (readonly [NarrativePatternBindingRole, string])[]
  readonly supportingRecordIdentityTuple: readonly (
    readonly [NarrativePatternSupportingRole, NarrativePatternRecordKind, string, string, number]
  )[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const names = Object.getOwnPropertyNames(value)
  return names.length === keys.length
    && names.every((name) => keys.includes(name))
    && keys.every((name) => names.includes(name))
    && Object.getOwnPropertySymbols(value).length === 0
    && names.every((name) => Object.getOwnPropertyDescriptor(value, name)?.enumerable === true)
    && names.every((name) => (value as Record<string, unknown>)[name] !== undefined)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function assertPatternType(value: unknown): asserts value is NarrativePatternType {
  if (!NARRATIVE_PATTERN_TYPES.includes(value as NarrativePatternType)) {
    throw new Error('attentionNarrativePatternIdentity: unsupported pattern type')
  }
}

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function roleRank(patternType: NarrativePatternType, role: NarrativePatternSupportingRole): number {
  return (NARRATIVE_PATTERN_SUPPORTING_ROLES[patternType] as readonly string[]).indexOf(role)
}

export function canonicalizeNarrativePatternBindings(
  patternType: NarrativePatternType,
  bindings: readonly NarrativePatternBinding[],
): readonly NarrativePatternBinding[] {
  assertPatternType(patternType)
  if (!Array.isArray(bindings)) {
    throw new Error('attentionNarrativePatternIdentity: invalid binding map')
  }
  const requiredRoles = NARRATIVE_PATTERN_BINDING_ROLES[patternType] as readonly NarrativePatternBindingRole[]
  if (bindings.length !== requiredRoles.length) {
    throw new Error('attentionNarrativePatternIdentity: binding map must contain exactly two roles')
  }
  const byRole = new Map<NarrativePatternBindingRole, string>()
  for (const binding of bindings) {
    if (
      !isRecord(binding)
      || !exactKeys(binding, ['role', 'entityId'])
      || !requiredRoles.includes(binding.role as NarrativePatternBindingRole)
      || !isNonEmptyString(binding.entityId)
      || byRole.has(binding.role as NarrativePatternBindingRole)
    ) {
      throw new Error('attentionNarrativePatternIdentity: duplicate or invalid binding role')
    }
    byRole.set(binding.role as NarrativePatternBindingRole, binding.entityId as string)
  }
  const ordered = requiredRoles.map((role) => Object.freeze({
    role,
    entityId: byRole.get(role)!,
  }))
  if (ordered[0]!.entityId === ordered[1]!.entityId) {
    throw new Error('attentionNarrativePatternIdentity: binding entities must be distinct')
  }
  return Object.freeze(ordered)
}

export function canonicalizeNarrativePatternSupportingRecords(
  patternType: NarrativePatternType,
  records: readonly NarrativePatternSupportingRecordIdentity[],
): readonly NarrativePatternSupportingRecordIdentity[] {
  assertPatternType(patternType)
  if (!Array.isArray(records)) {
    throw new Error('attentionNarrativePatternIdentity: invalid supporting records')
  }
  const ids = new Set<string>()
  const copies = records.map((record) => {
    if (
      !isRecord(record)
      || !exactKeys(record, ['semanticRole', 'recordKind', 'recordId', 'visibilityProvenanceId', 'commitLsn'])
      || roleRank(patternType, record.semanticRole as NarrativePatternSupportingRole) < 0
      || ![
        'observable_action',
        'validated_public_communication',
        'world_observable_availability',
      ].includes(record.recordKind as string)
      || !isNonEmptyString(record.recordId)
      || !isNonEmptyString(record.visibilityProvenanceId)
      || !isCoordinate(record.commitLsn)
      || ids.has(record.recordId as string)
    ) {
      throw new Error('attentionNarrativePatternIdentity: duplicate or invalid supporting evidence')
    }
    ids.add(record.recordId as string)
    return Object.freeze({
      semanticRole: record.semanticRole as NarrativePatternSupportingRole,
      recordKind: record.recordKind as NarrativePatternRecordKind,
      recordId: record.recordId as string,
      visibilityProvenanceId: record.visibilityProvenanceId as string,
      commitLsn: record.commitLsn as number,
    })
  })
  return Object.freeze(copies.sort((left, right) => (
    roleRank(patternType, left.semanticRole) - roleRank(patternType, right.semanticRole)
    || left.commitLsn - right.commitLsn
    || compareCodeUnit(left.recordId, right.recordId)
  )))
}

export function canonicalNarrativePatternIdentityInput(
  input: NarrativePatternIdentityInput,
): CanonicalNarrativePatternIdentityInput {
  assertPatternType(input.patternType)
  if (
    !Number.isSafeInteger(input.patternSemanticVersion)
    || input.patternSemanticVersion < 0
    || !isNonEmptyString(input.patternContentHash)
    || !isNonEmptyString(input.monitorRuleVersion)
    || !isNonEmptyString(input.canonicalizationVersion)
    || !isNonEmptyString(input.identitySchemaVersion)
  ) {
    throw new Error('attentionNarrativePatternIdentity: invalid identity input')
  }
  const bindings = canonicalizeNarrativePatternBindings(input.patternType, input.bindingMap)
  const support = canonicalizeNarrativePatternSupportingRecords(
    input.patternType,
    input.supportingRecordIdentityTuple,
  )
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance',
    patternType: input.patternType,
    patternSemanticVersion: input.patternSemanticVersion,
    patternContentHash: input.patternContentHash,
    monitorRuleVersion: input.monitorRuleVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    identitySchemaVersion: input.identitySchemaVersion,
    bindingTuple: Object.freeze(bindings.map((entry) => Object.freeze([
      entry.role,
      entry.entityId,
    ] as const))),
    supportingRecordIdentityTuple: Object.freeze(support.map((entry) => Object.freeze([
      entry.semanticRole,
      entry.recordKind,
      entry.recordId,
      entry.visibilityProvenanceId,
      entry.commitLsn,
    ] as const))),
  })
}

export function canonicalNarrativePatternIdentityBytes(input: NarrativePatternIdentityInput): string {
  return canonicalSerialize(canonicalNarrativePatternIdentityInput(input))
}

export function computeNarrativePatternInstanceId(input: NarrativePatternIdentityInput): string {
  return `${input.identitySchemaVersion}:${mintHash(canonicalNarrativePatternIdentityBytes(input))}`
}

type NarrativePatternIdentityInstance = NarrativePatternIdentityInput & {
  readonly patternInstanceId: string
}

export type NarrativePatternIdentitySetResult<T extends NarrativePatternIdentityInstance> =
  | { readonly kind: 'ok'; readonly instances: readonly T[] }
  | {
      readonly kind: 'refused'
      readonly reason:
        | 'invalid-narrative-pattern-instance-id'
        | 'narrative-pattern-identity-collision'
    }

/**
 * Exact canonical bytes collapse. Supplied IDs are always re-derived, and an
 * actual hash collision between unequal canonical bytes fails closed.
 */
export function deduplicateNarrativePatternInstances<T extends NarrativePatternIdentityInstance>(
  instances: readonly T[],
): NarrativePatternIdentitySetResult<T> {
  const byBytes = new Map<string, T>()
  const bytesById = new Map<string, string>()
  for (const instance of instances) {
    const bytes = canonicalNarrativePatternIdentityBytes(instance)
    const expectedId = computeNarrativePatternInstanceId(instance)
    if (instance.patternInstanceId !== expectedId) {
      return Object.freeze({ kind: 'refused', reason: 'invalid-narrative-pattern-instance-id' })
    }
    const priorBytes = bytesById.get(expectedId)
    if (priorBytes !== undefined && priorBytes !== bytes) {
      return Object.freeze({ kind: 'refused', reason: 'narrative-pattern-identity-collision' })
    }
    bytesById.set(expectedId, bytes)
    if (!byBytes.has(bytes)) byBytes.set(bytes, instance)
  }
  return Object.freeze({
    kind: 'ok',
    instances: Object.freeze([...byBytes.values()]),
  })
}
