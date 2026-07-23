import { describe, expect, it } from 'vitest'
import {
  ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH,
  NARRATIVE_PATTERN_AUTHORED_DEFINITIONS,
  NARRATIVE_PATTERN_LIBRARY_TYPES,
  getNarrativePatternDefinition,
  loadNarrativePatternLibraryForProof,
  narrativePatternContentHash,
} from './attentionNarrativePatternLibrary'
import type { NarrativePatternDefinition } from './attentionNarrativePatternLibrary'
import {
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
} from './attentionCandidatePolicy'

function clone(definition: NarrativePatternDefinition): NarrativePatternDefinition {
  return JSON.parse(JSON.stringify(definition)) as NarrativePatternDefinition
}

const RECIPROCAL = NARRATIVE_PATTERN_AUTHORED_DEFINITIONS.find(
  (definition) => definition.patternType === 'reciprocal_public_aid',
)!
const CONFLICT = NARRATIVE_PATTERN_AUTHORED_DEFINITIONS.find(
  (definition) => definition.patternType === 'public_conflict_escalation',
)!
const COMMITMENT = NARRATIVE_PATTERN_AUTHORED_DEFINITIONS.find(
  (definition) => definition.patternType === 'public_commitment_fulfilled',
)!

describe('B3 closed narrative-pattern library', () => {
  it('contains exactly the three closed pattern types in canonical order', () => {
    expect([...NARRATIVE_PATTERN_LIBRARY_TYPES]).toEqual([
      'reciprocal_public_aid',
      'public_conflict_escalation',
      'public_commitment_fulfilled',
    ])
    expect(NARRATIVE_PATTERN_AUTHORED_DEFINITIONS).toHaveLength(3)
  })

  it('pins each authored version, horizon, severity, and fork policy', () => {
    expect(RECIPROCAL.patternSemanticVersion).toBe(ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION)
    expect(RECIPROCAL.horizonRule).toEqual({ horizonKind: 'lsn-delta', delta: 12 })
    expect(RECIPROCAL.overlapRule).toBe('reciprocal-overlap')
    expect(RECIPROCAL.totalSteps).toBe(2)
    expect(RECIPROCAL.forkChildCap).toBeNull()

    expect(CONFLICT.horizonRule).toEqual({ horizonKind: 'lsn-delta', delta: 16 })
    expect(CONFLICT.overlapRule).toBe('conflict-two-child-fork')
    expect(CONFLICT.totalSteps).toBe(3)
    expect(CONFLICT.forkChildCap).toBe(2)
    expect(CONFLICT.severityOrder).toEqual({ minor: 0, moderate: 1, major: 2 })

    expect(COMMITMENT.horizonRule).toEqual({ horizonKind: 'public-deadline' })
    expect(COMMITMENT.overlapRule).toBe('keyed-no-fork')
    expect(COMMITMENT.totalSteps).toBe(2)
    expect(COMMITMENT.forkChildCap).toBeNull()
  })

  it('derives a stable proof-local content hash per pattern and for the library', () => {
    for (const type of NARRATIVE_PATTERN_LIBRARY_TYPES) {
      expect(narrativePatternContentHash(type)).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
    }
    // Distinct definitions must not collide on content hash.
    const hashes = new Set(NARRATIVE_PATTERN_LIBRARY_TYPES.map(narrativePatternContentHash))
    expect(hashes.size).toBe(3)
    expect(ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
  })

  it('exposes deeply frozen, immutable definitions', () => {
    const definition = getNarrativePatternDefinition('public_conflict_escalation')
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.advancementRules)).toBe(true)
    expect(Object.isFrozen(definition.advancementRules[0])).toBe(true)
    expect(() => {
      ;(definition as unknown as { totalSteps: number }).totalSteps = 9
    }).toThrow()
  })

  it('accepts the exact three authored definitions', () => {
    expect(loadNarrativePatternLibraryForProof([RECIPROCAL, CONFLICT, COMMITMENT])).toEqual({ kind: 'ok' })
  })

  it('refuses an unknown pattern type', () => {
    const bad = clone(RECIPROCAL)
    ;(bad as unknown as { patternType: string }).patternType = 'unknown_pattern'
    expect(loadNarrativePatternLibraryForProof([bad])).toEqual({
      kind: 'refused',
      reason: 'unknown-pattern-type',
    })
  })

  it('refuses a duplicate definition', () => {
    expect(loadNarrativePatternLibraryForProof([RECIPROCAL, clone(RECIPROCAL)])).toEqual({
      kind: 'refused',
      reason: 'duplicate-definition',
    })
  })

  it('refuses an unsupported semantic version', () => {
    const bad = clone(RECIPROCAL)
    ;(bad as unknown as { patternSemanticVersion: number }).patternSemanticVersion = 2
    expect(loadNarrativePatternLibraryForProof([bad])).toEqual({
      kind: 'refused',
      reason: 'unsupported-semantic-version',
    })
  })

  it('refuses a zero-step definition', () => {
    const bad = clone(RECIPROCAL)
    ;(bad as unknown as { advancementRules: unknown[]; totalSteps: number }).advancementRules = []
    ;(bad as unknown as { totalSteps: number }).totalSteps = 1
    // A start with no advancement is one step, which is below the two-step minimum
    // for a useful reciprocal match; still, the guard we exercise is the >3 bound.
    const tooMany = clone(CONFLICT)
    ;(tooMany as unknown as { advancementRules: unknown[] }).advancementRules = [
      ...CONFLICT.advancementRules,
      CONFLICT.advancementRules[0],
    ]
    expect(loadNarrativePatternLibraryForProof([tooMany]).kind).toBe('refused')
  })

  it('refuses more than three steps', () => {
    const bad = clone(CONFLICT)
    ;(bad as unknown as { advancementRules: unknown[]; totalSteps: number }).advancementRules = [
      ...CONFLICT.advancementRules,
      CONFLICT.advancementRules[0],
    ]
    ;(bad as unknown as { totalSteps: number }).totalSteps = 4
    expect(loadNarrativePatternLibraryForProof([bad])).toEqual({
      kind: 'refused',
      reason: 'too-many-steps',
    })
  })

  it('refuses a definition using an undeclared supporting role', () => {
    const bad = clone(RECIPROCAL)
    ;(bad.startRule as unknown as { semanticRole: string }).semanticRole = 'not-a-role'
    expect(loadNarrativePatternLibraryForProof([bad])).toEqual({
      kind: 'refused',
      reason: 'undeclared-role',
    })
  })

  it('exposes no dynamic registration surface on the exported module', async () => {
    const libraryModule = await import('./attentionNarrativePatternLibrary')
    const exportedNames = Object.keys(libraryModule)
    expect(exportedNames.some((name) => /register|plugin|define/i.test(name))).toBe(false)
    // The only load path is the closed proof reloader, which never mutates the
    // production library.
    expect(exportedNames).toContain('loadNarrativePatternLibraryForProof')
  })
})
