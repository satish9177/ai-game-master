import { describe, expect, it } from 'vitest'
import { assertsEntitledContent, answeredCount, extractSectionBodies } from './answeredCount'
import { deriveEntitlement } from './leakageCount'
import { buildPreEvidenceUniverse } from './beliefSliceFixture'

/**
 * Unit tests for the second deterministic counter ("did the holder actually
 * say anything they were entitled to say?"). Silence must be visible: an arm
 * scoring zero leaks because its NPCs say nothing useful has to be
 * distinguishable from one scoring zero while still talking.
 */

const universe = buildPreEvidenceUniverse()

describe('assertsEntitledContent', () => {
  it('accepts an assertion naming an entity the holder is entitled to name', () => {
    expect(assertsEntitledContent('I heard the player was involved in what happened to guard_malik.', 'NPC_B', universe)).toBe(true)
  })

  it('rejects pure silence -- a reply asserting nothing cannot count as an answer', () => {
    expect(assertsEntitledContent('I know nothing of such matters.', 'NPC_B', universe)).toBe(false)
    expect(assertsEntitledContent('', 'NPC_B', universe)).toBe(false)
  })

  it('rejects content that only names entities the holder is NOT entitled to name', () => {
    // B never learned where any of it happened: cellar-only talk is not
    // something B may assert, so it must not satisfy the counter.
    expect(assertsEntitledContent('It happened in the cellar.', 'NPC_B', universe)).toBe(false)
  })

  it('accepts an assertion carrying only a sound the holder actually heard', () => {
    const sounds = [...deriveEntitlement('NPC_A', universe).heardSounds]
    expect(sounds.length).toBeGreaterThan(0)
    for (const sound of sounds) {
      expect(assertsEntitledContent(`All I heard was ${sound}.`, 'NPC_A', universe)).toBe(true)
    }
  })

  it('S5b item 2: matches morphological variants of entitled names (utility counter, not the leak counter)', () => {
    // Plural of a heard sound.
    expect(assertsEntitledContent('I heard screams, but I did not see a thing.', 'NPC_A', universe)).toBe(true)
    // Short form (final snake segment) of an entitled full id.
    expect(assertsEntitledContent('You knocked Malik clean off his post.', 'NPC_C', universe)).toBe(true)
    // Possessive inflection.
    expect(assertsEntitledContent("That was guard_malik's post, and the player took it.", 'NPC_B', universe)).toBe(true)
  })

  it('S5b item 2: stays strict about UNentitled names even under morphology', () => {
    // B never learned where any of it happened; plural/possessive does not entitle.
    expect(assertsEntitledContent('It happened in the cellars.', 'NPC_B', universe)).toBe(false)
    expect(assertsEntitledContent("The cellar's door was shut.", 'NPC_B', universe)).toBe(false)
    // Bare first segment of a multi-part id is NOT a variant ('guard' alone
    // is generic; only the surname segment counts).
    expect(assertsEntitledContent("The guard's been asking questions.", 'NPC_C', universe)).toBe(false)
  })

  it('is deterministic: same inputs, same answer', () => {
    const text = 'The player was involved in what happened to guard_malik.'
    expect(assertsEntitledContent(text, 'NPC_B', universe)).toBe(assertsEntitledContent(text, 'NPC_B', universe))
  })
})

describe('extractSectionBodies', () => {
  const promptText = [
    'CURRENT ROOM',
    'focus: none',
    '',
    'BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE',
    'Previously observed: The player entered the cellar.',
    '',
    "WHAT THIS CHARACTER BELIEVES - MAY BE FALSE, SECOND-HAND, OR UNJUSTIFIED",
    '- is not sure but suspects: the player attacked guard_malik (grounding trust: unknown)',
    '',
    'RECENT CONVERSATION',
    'player: What have you heard?',
  ].join('\n')

  it('keeps exactly the body lines under the requested headers', () => {
    const surface = extractSectionBodies(promptText, [
      'BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE',
      'WHAT THIS CHARACTER BELIEVES - MAY BE FALSE, SECOND-HAND, OR UNJUSTIFIED',
    ])
    expect(surface.split('\n')).toEqual([
      'Previously observed: The player entered the cellar.',
      '- is not sure but suspects: the player attacked guard_malik (grounding trust: unknown)',
    ])
  })

  it('excludes the echoed player question and structural scaffolding from the measured surface', () => {
    const surface = extractSectionBodies(promptText, [
      'BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE',
      'WHAT THIS CHARACTER BELIEVES - MAY BE FALSE, SECOND-HAND, OR UNJUSTIFIED',
    ])
    expect(surface).not.toContain('player:')
    expect(surface).not.toContain('HEADER')
    expect(surface).not.toContain('CURRENT ROOM')
    expect(surface).not.toContain('RECENT CONVERSATION')
  })
})

describe('answeredCount', () => {
  it('counts only questions whose surface carried an entitled assertion', () => {
    const surfaces = [
      { index: 0, text: 'I heard the player was involved in what happened to guard_malik.' },
      { index: 1, text: 'I know nothing of such matters.' },
    ]
    expect(answeredCount(surfaces, () => 'NPC_B', universe)).toBe(1)
  })

  it('never mutates its inputs and is side-effect free', () => {
    const surfaces = [{ index: 0, text: 'The player was involved.' }] as const
    const snapshot = JSON.stringify(surfaces)
    answeredCount([...surfaces], () => 'NPC_B', universe)
    expect(JSON.stringify(surfaces)).toBe(snapshot)
  })
})
