import { describe, expect, it } from 'vitest'
import type { FamiliarityBucket } from './dialogueContext'
import {
  NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION,
  RELATIONSHIP_JOURNAL_TEMPLATES,
  buildRelationshipJournalCandidate,
  renderRelationshipJournalText,
  type RelationshipJournalTemplateId,
} from './relationshipJournalCandidate'

const WORLD_ID = 'world-1'
const SESSION_ID = 'session-1'
const NPC_ID = 'npc-guard-01'

const input = (fromBucket: FamiliarityBucket, toBucket: FamiliarityBucket) => ({
  worldId: WORLD_ID,
  sessionId: SESSION_ID,
  npcId: NPC_ID,
  fromBucket,
  toBucket,
})

describe('buildRelationshipJournalCandidate', () => {
  const upwardCrossings: [FamiliarityBucket, FamiliarityBucket][] = [
    ['none', 'low'],
    ['low', 'medium'],
    ['medium', 'high'],
  ]

  it.each(upwardCrossings)('returns a candidate for %s -> %s', (fromBucket, toBucket) => {
    const candidate = buildRelationshipJournalCandidate(input(fromBucket, toBucket))

    expect(candidate).not.toBeNull()
    expect(candidate).toMatchObject({
      schemaVersion: NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION,
      kind: 'npc_relationship_journal_candidate',
      axis: 'familiarity',
      direction: 'increased',
      fromBucket,
      toBucket,
      templateId: 'familiarity_increased',
    })
  })

  const buckets: FamiliarityBucket[] = ['none', 'low', 'medium', 'high']

  it('returns null for every same-bucket pair', () => {
    for (const bucket of buckets) {
      expect(buildRelationshipJournalCandidate(input(bucket, bucket))).toBeNull()
    }
  })

  it('returns null for every downward pair', () => {
    for (let i = 0; i < buckets.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const from = buckets[i]
        const to = buckets[j]
        if (from === undefined || to === undefined) throw new Error('unreachable bucket index')
        expect(buildRelationshipJournalCandidate(input(from, to))).toBeNull()
      }
    }
  })

  it('never returns more than one candidate shape per call (single object, not a list)', () => {
    const candidate = buildRelationshipJournalCandidate(input('none', 'low'))
    expect(Array.isArray(candidate)).toBe(false)
  })
})

describe('dedupeKey', () => {
  it('is stable and identical for the same crossing', () => {
    const first = buildRelationshipJournalCandidate(input('none', 'low'))
    const second = buildRelationshipJournalCandidate(input('none', 'low'))

    expect(first?.dedupeKey).toBeDefined()
    expect(first?.dedupeKey).toBe(second?.dedupeKey)
  })

  it('is distinct across the three familiarity crossings', () => {
    const keys = new Set(
      [
        ['none', 'low'],
        ['low', 'medium'],
        ['medium', 'high'],
      ].map(([fromBucket, toBucket]) => {
        const candidate = buildRelationshipJournalCandidate(
          input(fromBucket as FamiliarityBucket, toBucket as FamiliarityBucket),
        )
        if (candidate === null) throw new Error('expected a candidate')
        return candidate.dedupeKey
      }),
    )

    expect(keys.size).toBe(3)
  })

  it('scopes by worldId/sessionId/npcId', () => {
    const base = buildRelationshipJournalCandidate(input('none', 'low'))
    const otherWorld = buildRelationshipJournalCandidate({ ...input('none', 'low'), worldId: 'world-2' })
    const otherSession = buildRelationshipJournalCandidate({ ...input('none', 'low'), sessionId: 'session-2' })
    const otherNpc = buildRelationshipJournalCandidate({ ...input('none', 'low'), npcId: 'npc-other' })

    expect(base?.dedupeKey).not.toBe(otherWorld?.dedupeKey)
    expect(base?.dedupeKey).not.toBe(otherSession?.dedupeKey)
    expect(base?.dedupeKey).not.toBe(otherNpc?.dedupeKey)
  })
})

describe('renderRelationshipJournalText', () => {
  it('returns exactly the frozen constant for the reachable template', () => {
    const candidate = buildRelationshipJournalCandidate(input('none', 'low'))
    if (candidate === null) throw new Error('expected a candidate')

    expect(renderRelationshipJournalText(candidate)).toBe(RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased)
    expect(renderRelationshipJournalText(candidate)).toBe('Someone here seems more familiar with you.')
  })

  it('is a pure function of the closed enum fields (identical inputs -> identical text)', () => {
    const first = buildRelationshipJournalCandidate(input('low', 'medium'))
    const second = buildRelationshipJournalCandidate(input('low', 'medium'))
    if (first === null || second === null) throw new Error('expected a candidate')

    expect(renderRelationshipJournalText(first)).toBe(renderRelationshipJournalText(second))
  })

  it('template table is frozen and complete for every RelationshipJournalTemplateId', () => {
    expect(Object.isFrozen(RELATIONSHIP_JOURNAL_TEMPLATES)).toBe(true)

    const templateIds: RelationshipJournalTemplateId[] = ['familiarity_increased']
    for (const templateId of templateIds) {
      expect(typeof RELATIONSHIP_JOURNAL_TEMPLATES[templateId]).toBe('string')
    }
  })
})

describe('no score/delta/text leak', () => {
  it('candidate JSON never contains a raw numeric axis value, delta, or interactionCount field', () => {
    const candidate = buildRelationshipJournalCandidate(input('none', 'low'))
    if (candidate === null) throw new Error('expected a candidate')

    const json = JSON.stringify(candidate)
    expect(json).not.toMatch(/"interactionCount"/)
    expect(json).not.toMatch(/"delta"/)
    expect(json).not.toMatch(/"familiarity":\s*\d/)
    expect(json).not.toMatch(/"score"/)
  })

  it('rendered text never contains an NPC display name, room/object name, or bucket-internal number', () => {
    const candidate = buildRelationshipJournalCandidate(input('medium', 'high'))
    if (candidate === null) throw new Error('expected a candidate')

    const text = renderRelationshipJournalText(candidate)
    expect(text).not.toMatch(/npc-/i)
    expect(text).not.toContain(NPC_ID)
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(/none|low|medium|high/i)
  })
})

describe('no trust/respect/fear output', () => {
  it('candidate axis is always familiarity; there is no way to construct a trust/respect/fear candidate', () => {
    const candidate = buildRelationshipJournalCandidate(input('none', 'high'))
    if (candidate === null) throw new Error('expected a candidate')

    expect(candidate.axis).toBe('familiarity')
  })

  it('the template table exposes no trust/respect/fear template id', () => {
    const templateIds = Object.keys(RELATIONSHIP_JOURNAL_TEMPLATES)
    expect(templateIds).toEqual(['familiarity_increased'])
  })
})

describe('relationship journal candidate module is dry at runtime', () => {
  const sourceModules = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  it('has no production runtime or composition importer yet', () => {
    const productionReferences = Object.entries(sourceModules).filter(([path, source]) => {
      if (path.endsWith('/relationshipJournalCandidate.ts')) return false
      if (path.endsWith('/relationshipJournalCandidate.test.ts')) return false
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return false
      return source.includes('relationshipJournalCandidate') || source.includes('RelationshipJournalCandidate')
    })

    expect(productionReferences).toEqual([])
  })
})

describe('import boundary', () => {
  it('imports only sibling domain/npcRelationship types and its own tables -- no app/world-session/renderer/etc.', () => {
    const source = sourceOf('./relationshipJournalCandidate.ts')

    const forbiddenPatterns = [
      /from ['"].*\/App['"]/,
      /from ['"]react['"]/,
      /from ['"]three['"]/,
      /from ['"].*\/renderer\//,
      /from ['"].*\/journal\//,
      /from ['"].*\/world-session\//,
      /from ['"].*\/interactions\//,
      /from ['"].*\/encounters\//,
      /from ['"].*\/dialogue\//,
      /from ['"].*\/memory\//,
      /from ['"].*\/persistence\//,
      /from ['"].*\/app\//,
      /from ['"].*\/generation\//,
      /WorldEvent/,
      /WorldCommand/,
    ]

    for (const pattern of forbiddenPatterns) {
      expect(source).not.toMatch(pattern)
    }

    expect(source).toMatch(/from '\.\/dialogueContext'/)
  })
})

function sourceOf(relativeToThisTestFile: string): string {
  const modules = import.meta.glob('./relationshipJournalCandidate.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
  const key = Object.keys(modules).find((path) => path.endsWith(relativeToThisTestFile.replace('./', '/')))
  if (key === undefined) throw new Error('module source not found for import-boundary test')
  const source = modules[key]
  if (source === undefined) throw new Error('module source not found for import-boundary test')
  return source
}
