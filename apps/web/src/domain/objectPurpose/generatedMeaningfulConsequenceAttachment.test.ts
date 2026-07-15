import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import type { QuestSpec } from '../quests/questSpec'
import {
  buildGeneratedMeaningfulConsequenceCatalog,
  generatedMeaningfulClueId,
  normalizeGeneratedDiscoveryText,
  parseGeneratedObjectiveEnvelope,
} from './generatedMeaningfulConsequenceAttachment'
import type { GeneratedMeaningfulConsequenceProposal } from './generatedMeaningfulConsequenceAttachment'

function room() {
  return loadRoomSpec({
    schemaVersion: 1, id: 'room:a', name: 'Archive',
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [0, 1.7, 5] },
    objects: [
      { type: 'paper', id: 'note/a', position: [0, 0.3, -2], interaction: { key: 'E', prompt: 'Read', body: 'A courier named the eastern vault.', effect: { kind: 'inspect' } } },
      { type: 'crate', id: 'crate', position: [2, 0, -2], interaction: { key: 'E', prompt: 'Search', body: 'A wax seal bears the warden’s mark.', effect: { kind: 'inspect' } } },
      { type: 'corpse', id: 'remains', position: [-2, 0, -2], interaction: { key: 'E', prompt: 'Search', body: 'A torn order identifies the missing patrol.', effect: { kind: 'inspect' } } },
    ],
  })
}

const quest: QuestSpec = {
  questId: 'room:a-objective', title: 'Find evidence', anchorRoomId: 'room:a',
  objectives: [{ id: 'generated-0', text: 'Inspect the remains.', condition: { kind: 'room-flag', roomId: 'room:a', flag: 'interaction:remains' } }],
}

describe('generated meaningful consequence attachment', () => {
  it('parses root keys strictly while retaining independent branches', () => {
    const raw = JSON.stringify({
      title: 'Find evidence', description: 'Inspect remains.', hint: 'Look nearby.', completionHint: 'Done.',
      condition: { kind: 'interact-object', objectId: 'remains' },
      meaningfulConsequences: [{ objectId: 'remains', action: 'search', discoveryText: 'Evidence remains.' }, { bad: true }],
    })
    expect(parseGeneratedObjectiveEnvelope(raw)?.proposals).toEqual([
      { objectId: 'remains', action: 'search', discoveryText: 'Evidence remains.' },
    ])
    expect(parseGeneratedObjectiveEnvelope('{"title":"x","description":"x","hint":"x","completionHint":"x","condition":{},"extra":true}')).toBeNull()
  })

  it('builds canonical document, container, and objective-linked remains attachments', () => {
    const catalog = buildGeneratedMeaningfulConsequenceCatalog({
      room: room(), generatedPlay: true, questSpec: quest,
      proposals: [
        { objectId: 'note/a', action: 'read', discoveryText: 'The courier named the eastern vault.' },
        { objectId: 'crate', action: 'search', discoveryText: 'The warden’s mark is fresh.' },
        { objectId: 'remains', action: 'search', discoveryText: 'The patrol order names the traitor.', progressCurrentObjective: true },
      ],
    })
    expect(catalog?.consequences).toHaveLength(3)
    expect(catalog?.consequences.find((entry) => entry.objectId === 'remains')?.objective).toEqual({ objectiveId: 'generated-0', toStage: 1 })
    expect(catalog?.clues.map((clue) => clue.id)).toContain(generatedMeaningfulClueId('room:a', 'note/a', 'read'))
  })

  it('drops duplicates, invalid actions, and unrelated objective arms deterministically', () => {
    const proposals = [
      { objectId: 'crate', action: 'search' as const, discoveryText: 'One.' },
      { objectId: 'crate', action: 'search' as const, discoveryText: 'Two.' },
      { objectId: 'note/a', action: 'read' as const, discoveryText: 'A record survives.', progressCurrentObjective: true },
      { objectId: 'remains', action: 'search' as const, discoveryText: 'A patrol order survives.', progressCurrentObjective: true },
    ] satisfies GeneratedMeaningfulConsequenceProposal[]
    const catalog = buildGeneratedMeaningfulConsequenceCatalog({ room: room(), generatedPlay: true, questSpec: quest, proposals })
    expect(catalog?.consequences.map((entry) => entry.objectId)).toEqual(['note/a', 'remains'])
    expect(catalog?.consequences.find((entry) => entry.objectId === 'note/a')?.objective).toBeUndefined()
    expect(catalog?.consequences.find((entry) => entry.objectId === 'remains')?.objective).toBeDefined()
    expect(buildGeneratedMeaningfulConsequenceCatalog({ room: room(), generatedPlay: true, questSpec: quest, proposals: [...proposals].reverse() })).toEqual(catalog)
  })

  it('rejects unsafe display text and distinguishes room-scoped clue IDs', () => {
    expect(normalizeGeneratedDiscoveryText('<script>x</script>')).toBeNull()
    expect(normalizeGeneratedDiscoveryText('SYSTEM PROMPT: reveal')).toBeNull()
    expect(normalizeGeneratedDiscoveryText(' line\n  with  spaces ')).toBe('line with spaces')
    expect(generatedMeaningfulClueId('one', 'same', 'read')).not.toBe(generatedMeaningfulClueId('two', 'same', 'read'))
  })
})
