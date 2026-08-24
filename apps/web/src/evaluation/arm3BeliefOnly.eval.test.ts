import { describe, expect, it } from 'vitest'
import { buildVisibleRoomMemoryContext } from '../app/buildVisibleRoomMemoryContext'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
  buildThreeNpcPostCorrectionFixture,
  buildThreeNpcRumorDriftFixture,
} from '../app/beliefSliceFixture'
import { THREE_NPC_PLAYER_SCRIPT } from '../app/beliefSlicePlayerScript'
import { assertsEntitledContent, extractSectionBodies } from '../app/answeredCount'
import { leakageBreakdown, leakageCount } from '../app/leakageCount'
import { projectBeliefDialogueContext } from '../app/projectBeliefDialogueContext'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import { BELIEF_SECTION_HEADER, MEMORY_SECTION_HEADER, buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { createRoomMemoryHarness, createSpyLogger, evalDialogueRequest } from './fixtures'

/**
 * S3 / ARM 3 -- belief only (the treatment arm), belief-driven-npc-dialogue-slice-v0.
 *
 * Three-arm design after the S2 correction: with the leaking room-memory
 * section present in BOTH arms, the arms leak identically by construction and
 * the comparison measures nothing. The arms are therefore:
 * - Arm 1: room memory only            (arm1Leakage.eval.test.ts, unchanged)
 * - Arm 2: room memory + belief        (arm2Projection.eval.test.ts, control
 *    proving the projection adds no leaks of its own -- unchanged)
 * - Arm 3: belief only                 (this file, the treatment)
 *
 * Suppression is an ARM CONFIGURATION at the eval/composition level: the
 * orchestrator below still runs recall and the visibility gate exactly as in
 * every other arm, but the request carries no `memory` key, so
 * `buildMemorySection` omits the section natively. Production defaults,
 * `buildMemorySection`, and Arms 1/2 are untouched -- their committed suites
 * are the byte-identical regression check for this slice.
 *
 * Both counters and both seedings apply here exactly as everywhere else.
 */

const WORLD_ID = 'belief-slice-world'
const SESSION_ID = 'belief-slice-session'
const ROOM_ID = 'cellar'

const SCOPE = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }

/** Verbatim rendered belief entries, asserted literally so the arm's entire background is auditable.
 * S4.5 item 3: rumor beliefs carry their attributed teller. */
const VERBATIM_BELIEF_LINE: Readonly<Record<string, string>> = {
  NPC_A: '- is not sure but suspects: something happened involving a scream near cellar (grounding trust: unknown)',
  NPC_B: '- is not sure but suspects: the player was involved in what happened to guard_malik (grounding trust: unknown; heard from NPC_A)',
  NPC_C: '- is not sure but suspects: the player attacked guard_malik (grounding trust: unknown; heard from NPC_B)',
}

/**
 * S4.5 item 2: after the claw mark is presented, C's projection carries the
 * co-rendered accusation AND its evidence correction (spine's own
 * applyEvidenceCorrection; no BeliefTransition hides the old line). A and B
 * are unchanged.
 */
const VERBATIM_C_POST_CORRECTION_LINES = [
  VERBATIM_BELIEF_LINE.NPC_C,
  '- is convinced: zombie_17 attacked guard_malik (grounding trust: unknown)',
]

async function seededHarness(texts: readonly string[]) {
  const harness = createRoomMemoryHarness('belief-slice-mem')
  for (const [index, text] of texts.entries()) {
    const draft: RoomMemoryDraftInput = {
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text,
      confidence: 'medium',
      dedupeKey: `belief-slice-mem-${index}`,
    }
    const result = await harness.service.remember(draft)
    expect(result.status, text).toBe('recorded')
  }
  return harness
}

interface StepMeasurement {
  stepIndex: number
  npcId: string
  findings: ReturnType<typeof leakageBreakdown>
  answered: boolean
  promptText: string
}

/**
 * Arm 3 composition: identical pipeline through recall -> belief projection,
 * with the room-memory section suppressed by not handing memory to the
 * request. The seeded records still exist in the world; this arm simply does
 * not surface them to the model.
 */
async function measureArm3(memoryTexts: readonly string[]): Promise<StepMeasurement[]> {
  const harness = await seededHarness(memoryTexts)
  const preFixture = buildThreeNpcRumorDriftFixture()
  // S4.5 item 2: the claw-mark step projects C's post-correction state.
  const postFixture = buildThreeNpcPostCorrectionFixture()
  const measurements: StepMeasurement[] = []

  for (const [stepIndex, step] of THREE_NPC_PLAYER_SCRIPT.entries()) {
    // Recall still runs: suppression happens at composition, not upstream.
    const recalled = await recallRoomMemoryContext(SCOPE, harness.service, createSpyLogger([]))
    buildVisibleRoomMemoryContext(recalled, step.npcId)
    const fixture = step.kind === 'showEvidence' ? postFixture : preFixture
    const beliefContext = projectBeliefDialogueContext(step.npcId, fixture, createSpyLogger([]))

    const request = evalDialogueRequest({
      npcId: step.npcId,
      npcName: step.npcId,
      ...(beliefContext.entries.length > 0 ? { belief: beliefContext } : {}),
    })
    const promptText = buildDialoguePromptMessages(request)
      .map((message) => message.content)
      .join('\n\n')

    const universe = step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()
    const findings = leakageBreakdown(promptText, step.npcId, universe)

    // Background surface = belief sections only (memory sections do not exist
    // in this arm); the answered counter reads exactly what the model sees.
    const backgroundSurface = extractSectionBodies(promptText, [BELIEF_SECTION_HEADER])

    measurements.push({
      stepIndex,
      npcId: step.npcId,
      findings,
      answered: assertsEntitledContent(backgroundSurface, step.npcId, universe),
      promptText,
    })
    expect(leakageCount(promptText, step.npcId, universe)).toBe(findings.length)
  }

  return measurements
}

describe('Arm 3 (belief only, treatment) over the fixed player script', () => {
  it('REALISTIC seeding: zero leakage, nobody silent, and the room-memory section is gone from the composed prompt', async () => {
    const measurements = await measureArm3(['The player entered the cellar.', 'A scream rang out from the cellar.'])
    expect(measurements).toHaveLength(4)

    for (const measurement of measurements) {
      // Treatment result: zero out-of-scope assertions anywhere on the script.
      expect(measurement.findings, `${measurement.npcId}#${measurement.stepIndex}`).toEqual([])
      // Suppression is real: no room-memory section reaches the model...
      expect(measurement.promptText, `${measurement.npcId}#${measurement.stepIndex}`).not.toContain(MEMORY_SECTION_HEADER)
      // ...and the belief section is present in its place.
      expect(measurement.promptText, `${measurement.npcId}#${measurement.stepIndex}`).toContain(BELIEF_SECTION_HEADER)
      if (measurement.stepIndex < 3) {
        // Pre-evidence steps: the attacker's name never reaches any prompt.
        expect(measurement.promptText.toLowerCase(), `${measurement.npcId}#${measurement.stepIndex}`).not.toContain('zombie')
      } else {
        // Step 3 (C, post-claw-mark): zombie_17 renders ONLY inside C's
        // entitled evidence correction -- and only after the evidence exists.
        expect(measurement.promptText).toContain('- is convinced: zombie_17 attacked guard_malik')
      }
    }

    expect(measurements.map((measurement) => measurement.answered)).toEqual([true, true, true, true])
  })

  it('REALISTIC seeding: the entire background is the verbatim belief section, auditable per holder', async () => {
    const measurements = await measureArm3(['The player entered the cellar.', 'A scream rang out from the cellar.'])

    for (const measurement of measurements) {
      const expectedLines = measurement.stepIndex === 3
        ? VERBATIM_C_POST_CORRECTION_LINES
        : [VERBATIM_BELIEF_LINE[measurement.npcId]!]
      const expectedBackground = `${BELIEF_SECTION_HEADER}\n${expectedLines.join('\n')}`
      expect(measurement.promptText).toContain(expectedBackground)
      // Nothing else is background: extracting that header yields exactly those lines.
      expect(extractSectionBodies(measurement.promptText, [BELIEF_SECTION_HEADER])).toBe(expectedLines.join('\n'))
    }
  })

  it('SENSITIVITY seeding: numbers are identical to REALISTIC -- the truth-bearing room record cannot reach a belief-only prompt', async () => {
    const realistic = await measureArm3(['The player entered the cellar.', 'A scream rang out from the cellar.'])
    const sensitivity = await measureArm3([
      'The player entered the cellar.',
      'A scream rang out from the cellar.',
      'zombie_17 attacked guard_malik in the cellar.',
    ])

    // Same script, same instruments, same arm config: poisoning the shared
    // room layer changes nothing the model sees in this arm, by construction.
    expect(sensitivity.map((m) => m.findings)).toEqual(realistic.map((m) => m.findings))
    expect(sensitivity.map((m) => m.findings)).toEqual([[], [], [], []])
    expect(sensitivity.map((m) => m.answered)).toEqual([true, true, true, true])
    for (const measurement of sensitivity) {
      expect(measurement.promptText).not.toContain(MEMORY_SECTION_HEADER)
    }
  })
})
