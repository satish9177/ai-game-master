import { describe, expect, it } from 'vitest'
import { buildVisibleRoomMemoryContext } from '../app/buildVisibleRoomMemoryContext'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
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
 * S2-gate Arm 2 measurement (belief-driven-npc-dialogue-slice-v0): runs the
 * FIXED player script against the composed Arm 2 surface -- the existing,
 * unmodified memoryContext path PLUS the holder-scoped belief projection
 * threaded through `projectBeliefDialogueContext` -> `belief` context ->
 * `buildBeliefSection`. No model is called; the counted surface is the exact
 * model-visible prompt per turn, identical in kind to the S1 Arm 1
 * measurement (`arm1Leakage.eval.test.ts`), so counts are arm-comparable.
 *
 * TWO counters are reported together for every step, per binding
 * carry-forward ("zero leaks by silence is a failure"):
 * - `leakageBreakdown` -- out-of-scope assertions (S1 instrument, unchanged).
 * - the answered counter -- whether the background context carries anything
 *   this holder IS entitled to assert, measured ONLY on the background
 *   sections (room memory + belief) so structural scaffolding and the
 *   player-question echo can never satisfy it mechanically.
 *
 * TWO seedings are measured, never one:
 * - REALISTIC: only what this scenario's play records through the room-memory
 *   firewall -- the headline configuration.
 * - SENSITIVITY: adds one truth-bearing room observation naming the attacker;
 *   a labelled stress test proving the instrument fires, never a headline.
 */

const WORLD_ID = 'belief-slice-world'
const SESSION_ID = 'belief-slice-session'
const ROOM_ID = 'cellar'

const SCOPE = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }

const BACKGROUND_HEADERS = [MEMORY_SECTION_HEADER, BELIEF_SECTION_HEADER]

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
  contextEntries: number
  beliefEntries: number
  findings: ReturnType<typeof leakageBreakdown>
  answered: boolean
  promptText: string
}

/**
 * Composes each turn exactly as the wire does -- recall -> per-NPC visibility
 * gate -> belief projection -> prompt sections -- and measures both counters
 * on the model-visible result.
 */
async function measureArm2(memoryTexts: readonly string[]): Promise<StepMeasurement[]> {
  const harness = await seededHarness(memoryTexts)
  const fixture = buildThreeNpcRumorDriftFixture()
  const measurements: StepMeasurement[] = []

  for (const [stepIndex, step] of THREE_NPC_PLAYER_SCRIPT.entries()) {
    const recalled = await recallRoomMemoryContext(SCOPE, harness.service, createSpyLogger([]))
    const memoryContext = buildVisibleRoomMemoryContext(recalled, step.npcId)
    const beliefContext = projectBeliefDialogueContext(step.npcId, fixture, createSpyLogger([]))

    const request = evalDialogueRequest({
      npcId: step.npcId,
      npcName: step.npcId,
      ...(memoryContext !== undefined ? { memory: memoryContext } : {}),
      ...(beliefContext.entries.length > 0 ? { belief: beliefContext } : {}),
    })
    const promptText = buildDialoguePromptMessages(request)
      .map((message) => message.content)
      .join('\n\n')

    // The claw mark reaches C between steps 3 and 4; count step 4 against
    // the post-evidence universe so C's granted entitlement applies.
    const universe = step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()
    const findings = leakageBreakdown(promptText, step.npcId, universe)

    // Answered counter: background sections only -- never the echoed player
    // question, never prompt scaffolding.
    const backgroundSurface = extractSectionBodies(promptText, BACKGROUND_HEADERS)

    measurements.push({
      stepIndex,
      npcId: step.npcId,
      contextEntries: memoryContext?.entries.length ?? 0,
      beliefEntries: beliefContext.entries.length,
      findings,
      answered: assertsEntitledContent(backgroundSurface, step.npcId, universe),
      promptText,
    })
    expect(leakageCount(promptText, step.npcId, universe)).toBe(findings.length)
  }

  return measurements
}

/** Arm 1's composed background surface (memory sections only), for the answered-counter contrast rows. */
async function measureArm1Answered(memoryTexts: readonly string[]): Promise<StepMeasurement[]> {
  const harness = await seededHarness(memoryTexts)
  const measurements: StepMeasurement[] = []

  for (const [stepIndex, step] of THREE_NPC_PLAYER_SCRIPT.entries()) {
    const recalled = await recallRoomMemoryContext(SCOPE, harness.service, createSpyLogger([]))
    const memoryContext = buildVisibleRoomMemoryContext(recalled, step.npcId)

    const request = evalDialogueRequest({
      npcId: step.npcId,
      npcName: step.npcId,
      ...(memoryContext !== undefined ? { memory: memoryContext } : {}),
    })
    const promptText = buildDialoguePromptMessages(request)
      .map((message) => message.content)
      .join('\n\n')

    const universe = step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()
    const backgroundSurface = extractSectionBodies(promptText, [MEMORY_SECTION_HEADER])

    measurements.push({
      stepIndex,
      npcId: step.npcId,
      contextEntries: memoryContext?.entries.length ?? 0,
      beliefEntries: 0,
      findings: [],
      answered: assertsEntitledContent(backgroundSurface, step.npcId, universe),
      promptText,
    })
  }

  return measurements
}

describe('Arm 2 (belief context present) over the fixed player script', () => {
  it('REALISTIC seeding: zero leakage on every step, and the answered counter proves nobody is silent', async () => {
    const measurements = await measureArm2(['The player entered the cellar.', 'A scream rang out from the cellar.'])
    expect(measurements).toHaveLength(4)

    // Positive bound: the memory and belief contexts were actually present.
    for (const measurement of measurements) {
      expect(measurement.contextEntries, `step ${measurement.stepIndex}`).toBe(2)
      expect(measurement.beliefEntries, `step ${measurement.stepIndex}`).toBe(1)
    }

    // Anti-leakage result: the composed Arm 2 surface leaks exactly what
    // Arm 1 leaked -- B's two unentitled geometry mentions from the SHARED
    // ROOM MEMORY layer -- because the belief projection is additive and the
    // room layer is deliberately untouched. The projection itself
    // contributes zero findings of its own anywhere on the script.
    for (const measurement of measurements) {
      if (measurement.npcId === 'NPC_B' && measurement.stepIndex === 1) {
        expect(measurement.findings.map((finding) => [finding.category, finding.entity])).toEqual([
          ['unentitled-entity', 'cellar'],
          ['unentitled-entity', 'cellar'],
        ])
      } else {
        expect(measurement.findings, `${measurement.npcId}#${measurement.stepIndex}`).toEqual([])
      }
    }

    // Stronger rendering-level gate: the string never reaches the model at all.
    for (const measurement of measurements) {
      expect(measurement.promptText.toLowerCase(), `${measurement.npcId}#${measurement.stepIndex}`).not.toContain('zombie')
      expect(measurement.promptText, `${measurement.npcId}#${measurement.stepIndex}`).toContain(BELIEF_SECTION_HEADER)
    }

    // Silence check: every scripted question had entitled material to speak
    // from -- zero leaks is talking, not silence.
    expect(measurements.map((measurement) => measurement.answered)).toEqual([true, true, true, true])
  })

  it('SENSITIVITY seeding: the truth-bearing room record leaks exactly as it did in Arm 1 -- the belief projection adds nothing', async () => {
    const measurements = await measureArm2([
      'The player entered the cellar.',
      'A scream rang out from the cellar.',
      'zombie_17 attacked guard_malik in the cellar.',
    ])
    expect(measurements).toHaveLength(4)

    const byStep = new Map(measurements.map((measurement) => [`${measurement.npcId}#${measurement.stepIndex}`, measurement]))
    const categoriesOf = (npcId: string, stepIndex: number): string[] =>
      byStep.get(`${npcId}#${stepIndex}`)!.findings.map((finding) => finding.category)

    // Identical to the committed Arm 1 sensitivity numbers (arm1Leakage.eval.test.ts):
    // the holder-scoped projection contributes zero additional findings under stress.
    expect(categoriesOf('NPC_A', 0)).toEqual(['named-zombie', 'named-real-attacker', 'unentitled-entity', 'unentitled-entity'])
    expect(categoriesOf('NPC_B', 1)).toEqual([
      'named-zombie',
      'named-real-attacker',
      'unentitled-entity',
      'unentitled-entity',
      'unentitled-entity',
      'unentitled-entity',
    ])
    expect(categoriesOf('NPC_C', 2)).toEqual(['named-zombie', 'named-real-attacker', 'unentitled-entity'])
    expect(categoriesOf('NPC_C', 3)).toEqual([])

    // And still nobody is silent under stress either.
    expect(measurements.map((measurement) => measurement.answered)).toEqual([true, true, true, true])
  })
})

describe('answered-counter contrast rows (Arm 1 surface, memory sections only)', () => {
  it('REALISTIC seeding: every arm has some entitled material -- the zero-leak gap is not silence-driven', async () => {
    const measurements = await measureArm1Answered(['The player entered the cellar.', 'A scream rang out from the cellar.'])
    // Even Arm 1's weakest holder (B) may name the player its rumor is about,
    // and the shared room layer records the player's movement -- so the
    // name-level counter finds entitled material for everyone. The
    // silence-detection machinery itself is proven in answeredCount.test.ts;
    // this row certifies the S1 numbers are not a silence artifact.
    expect(measurements.map((measurement) => `${measurement.npcId}:${measurement.answered}`)).toEqual([
      'NPC_A:true',
      'NPC_B:true',
      'NPC_C:true',
      'NPC_C:true',
    ])
  })

  it('SENSITIVITY seeding hands Arm 1 B entitled content it may assert -- the counter tracks it', async () => {
    const measurements = await measureArm1Answered([
      'The player entered the cellar.',
      'A scream rang out from the cellar.',
      'zombie_17 attacked guard_malik in the cellar.',
    ])
    expect(measurements.map((measurement) => measurement.answered)).toEqual([true, true, true, true])
  })
})
