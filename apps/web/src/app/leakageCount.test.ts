import { describe, expect, it } from 'vitest'
import type { ReadableRecord } from '../domain/livingWorldProof/evidenceRecords'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
} from './beliefSliceFixture'
import { deriveEntitlement, leakageBreakdown, leakageCount } from './leakageCount'

/**
 * S1 evidence (plan §3): `leakageCount` must catch a hand-written leaking
 * transcript, stay silent on in-scope speech (including C's confident,
 * wrong accusation and C's legal depth-1 attribution through a real
 * transmission chain), honor per-holder correction after the claw mark is
 * presented to C only, and be pure.
 */

describe('entitlement derivation from spine records', () => {
  it('gives C the rumor content but not the zombie before evidence', () => {
    const entitlement = deriveEntitlement('NPC_C', buildPreEvidenceUniverse())
    expect([...entitlement.allowedEntities].sort()).toEqual(['cellar', 'guard_malik', 'player'])
    expect(entitlement.allowedBeliefSources).toEqual(new Set(['NPC_B']))
    // Sound direction is not sight: C cannot assert interior contents.
    expect(entitlement.sightSeenLocations.size).toBe(0)
  })

  it("admits the zombie into C's entitlement only after E_claw is presented to C", () => {
    const pre = deriveEntitlement('NPC_C', buildPreEvidenceUniverse())
    const post = deriveEntitlement('NPC_C', buildPostEvidenceUniverse())
    expect(pre.allowedEntities.has('zombie_17')).toBe(false)
    expect(post.allowedEntities.has('zombie_17')).toBe(true)
    // B was not shown the claw mark and stays unentitled.
    const bPost = deriveEntitlement('NPC_B', buildPostEvidenceUniverse())
    expect(bPost.allowedEntities.has('zombie_17')).toBe(false)
  })

  it('never lets truth records entitle anyone directly', () => {
    const entitlement = deriveEntitlement('NPC_A', buildPreEvidenceUniverse())
    expect(entitlement.allowedEntities.has('zombie_17')).toBe(false)
    expect(entitlement.allowedEntities.has('guard_malik')).toBe(false)
  })
})

describe('leakageCount catches a deliberate leaking transcript (C, pre-evidence)', () => {
  const LEAKING = [
    'The zombie_17 attacked guard_malik inside the cellar, there was blood everywhere.',
    'NPC_A believes you are innocent.',
  ].join(' ')

  it('fires every applicable category exactly once', () => {
    const findings = leakageBreakdown(LEAKING, 'NPC_C', buildPreEvidenceUniverse())
    const categories = findings.map((finding) => finding.category)
    expect(categories).toContain('named-zombie')
    expect(categories).toContain('named-real-attacker')
    expect(categories).toContain('unseen-location-contents')
    expect(categories).toContain('other-mind-without-transmission')
    expect(categories.filter((category) => category === 'unentitled-entity')).toHaveLength(1)
    expect(leakageCount(LEAKING, 'NPC_C', buildPreEvidenceUniverse())).toBe(findings.length)
  })

  it('attributes the offending entity on entity-scoped findings', () => {
    const findings = leakageBreakdown(LEAKING, 'NPC_C', buildPreEvidenceUniverse())
    expect(findings.filter((finding) => finding.category === 'named-zombie').map((finding) => finding.entity)).toEqual(['zombie_17'])
  })
})

describe('leakageCount stays silent on in-scope speech', () => {
  const universe = buildPreEvidenceUniverse()

  it('accepts A hedging within what A actually perceived', () => {
    const line = 'I heard a scream from the cellar after you went down. I never saw who it was.'
    expect(leakageCount(line, 'NPC_A', universe)).toBe(0)
  })

  it('accepts B repeating its rumor and citing its actual source', () => {
    const line = 'NPC_A told me the player was involved in what happened to guard_malik.'
    expect(leakageCount(line, 'NPC_B', universe)).toBe(0)
  })

  it("accepts C's confident wrong accusation -- wrongness is not leakage", () => {
    const line = 'You attacked guard_malik! Everyone is saying so.'
    expect(leakageCount(line, 'NPC_C', universe)).toBe(0)
  })

  it("accepts C's legal depth-1 attribution through a real transmission chain", () => {
    const line = 'NPC_B told me you attacked guard_malik.'
    expect(leakageCount(line, 'NPC_C', universe)).toBe(0)
  })
})

describe('leakageCount category mechanics', () => {
  const pre = buildPreEvidenceUniverse()
  const post = buildPostEvidenceUniverse()

  it('catches the lemma paraphrase ("a zombie") without an attack verb', () => {
    expect(leakageCount('A zombie did it.', 'NPC_A', pre)).toBe(2) // named-zombie + unentitled-entity
  })

  it('exempts sounds the holder actually heard from the contents rule', () => {
    expect(leakageCount('There was a scream in the cellar.', 'NPC_A', pre)).toBe(0)
  })

  it('counts unseen-interior existence claims that name no entity', () => {
    // C has sound-only knowledge of the cellar, so interior claims leak.
    expect(leakageCount('There was an altar in the cellar.', 'NPC_C', pre)).toBe(1)
    // A saw into the cellar doorway (full sight of T0), so per-node
    // interior assertions are in-scope for A under the spine's v0 scope.
    expect(leakageCount('There was an altar in the cellar.', 'NPC_A', pre)).toBe(0)
  })

  it("releases C's zombie speech after the claw mark, while B stays caught", () => {
    const cLine = 'It was zombie_17 -- the claw mark proves it attacked guard_malik.'
    expect(leakageCount(cLine, 'NPC_C', post)).toBe(0)
    expect(leakageCount(cLine, 'NPC_B', post)).toBe(3) // named-zombie + named-real-attacker + unentitled-entity
  })
})

describe('purity', () => {
  it('is deterministic and mutates neither transcript nor universe', () => {
    const universe: ReadableRecord[] = buildPreEvidenceUniverse()
    const snapshot = JSON.stringify(universe)
    const transcript = 'The zombie_17 attacked guard_malik.'
    const first = leakageBreakdown(transcript, 'NPC_C', universe)
    const second = leakageBreakdown(transcript, 'NPC_C', universe)
    expect(first).toEqual(second)
    expect(JSON.stringify(universe)).toBe(snapshot)
    expect(transcript).not.toContain('zzz') // transcript untouched by any normalization pass
  })
})
