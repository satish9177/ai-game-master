import llmDialoguePromptSource from '../generation/llmDialoguePrompt.ts?raw'
import { describe, expect, it } from 'vitest'
import type { NPCDialogueRequest } from '../domain/dialogue/contracts'
import { BELIEF_SECTION_HEADER, DIALOGUE_SYSTEM_PROMPT, MEMORY_SECTION_HEADER, buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'

/**
 * PRODUCTION REDTEAM -- targets the shipped game, not the belief-slice rig.
 *
 * S4 proved dialogue cannot WRITE cognition. Nothing proved dialogue still
 * REFUSES TO DISCLOSE provenance. The game's only disclosure boundary is a
 * set of prose lines inside the single string constant
 * `generation/llmDialoguePrompt.ts::DIALOGUE_SYSTEM_PROMPT`; every dialogue
 * path funnels through it. A careless edit to one line silently removes that
 * boundary and no test would notice. This file makes its presence mechanical.
 *
 * The four load-bearing discretion/epistemic rules (S5b ablation target --
 * removing these measurably converts latent context into spoken leakage):
 * identity of the lines is asserted VERBATIM so paraphrase-by-edit fails.
 */

const DISCRETION_RULES = [
  'Current and authoritative facts override background memory.',
  'Background memory may be incomplete, stale, false, or only a prior observation.',
  'If background conflicts with current facts, ignore the background.',
  'What this character believes may be false, second-hand, or unjustified. Speak it as their belief, never as fact, and never reveal how you came to know it.',
]

function request(overrides: Partial<NPCDialogueRequest['context']> = {}): NPCDialogueRequest {
  return {
    context: {
      roomId: 'room',
      npcId: 'npc',
      npcName: 'NPC',
      persona: 'p',
      player: { health: { current: 10, max: 10 }, status: [], inventoryItemIds: [] },
      history: [],
      ...overrides,
    },
    playerLine: 'What do you know?',
  }
}

function systemContent(requestOverrides: Partial<NPCDialogueRequest['context']> = {}): string {
  return buildDialoguePromptMessages(request(requestOverrides))[0]!.content
}

describe('redteam disclosure boundary firewall (PRODUCTION)', () => {
  it('every discretion rule is present verbatim in the system-prompt constant', () => {
    for (const rule of DISCRETION_RULES) {
      expect(DIALOGUE_SYSTEM_PROMPT.includes(rule), 'missing rule: ' + rule).toBe(true)
    }
  })

  it('the composed system message carries the full constant for every context shape', () => {
    const shapes: Partial<NPCDialogueRequest['context']>[] = [
      {},
      { memory: { entries: [{ text: 'Something happened here.', kind: 'room_observation' }] } },
      {
        belief: {
          entries: [{ text: 'something happened', confidenceBucket: 'low', sourceTrustBucket: 'unknown' }],
        },
      },
      {
        memory: { entries: [{ text: 'Something happened here.', kind: 'room_observation' }] },
        belief: {
          entries: [{ text: 'something happened', confidenceBucket: 'low', sourceTrustBucket: 'unknown' }],
        },
      },
    ]
    for (const [index, shape] of shapes.entries()) {
      expect(systemContent(shape), 'shape ' + String(index)).toBe(DIALOGUE_SYSTEM_PROMPT)
      for (const rule of DISCRETION_RULES) {
        expect(systemContent(shape).includes(rule), 'shape ' + String(index) + ' missing: ' + rule).toBe(true)
      }
    }
  })

  it('the background sections still announce their own non-authoritative framing next to the rules', () => {
    // Defense in depth: even if a rule line is edited away, the section
    // headers must keep flagging the content as non-authoritative.
    expect(MEMORY_SECTION_HEADER).toContain('NON-AUTHORITATIVE')
    expect(BELIEF_SECTION_HEADER).toContain('MAY BE FALSE')

    const withBackground = buildDialoguePromptMessages(request({
      memory: { entries: [{ text: 'A bell rang here.', kind: 'room_observation' }] },
      belief: {
        entries: [{ text: 'the bell rang', confidenceBucket: 'low', sourceTrustBucket: 'unknown' }],
      },
    }))[1]!.content
    expect(withBackground).toContain(MEMORY_SECTION_HEADER)
    expect(withBackground).toContain(BELIEF_SECTION_HEADER)
  })

  it('the source constant has not drifted from the tested lines (edit-detection)', () => {
    // If any discretion rule is removed or reworded in the source file, this
    // static scan fails alongside the behavioural checks above.
    for (const rule of DISCRETION_RULES) {
      expect(llmDialoguePromptSource.includes(rule), 'source no longer contains: ' + rule).toBe(true)
    }
    expect(llmDialoguePromptSource.includes('export const DIALOGUE_SYSTEM_PROMPT')).toBe(true)
  })
})
