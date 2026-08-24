import { describe, expect, it } from 'vitest'
import { buildVisibleRoomMemoryContext } from '../app/buildVisibleRoomMemoryContext'
import {
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
} from '../app/beliefSliceFixture'
import { THREE_NPC_PLAYER_SCRIPT } from '../app/beliefSlicePlayerScript'
import { leakageBreakdown, leakageCount } from '../app/leakageCount'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { createRoomMemoryHarness, createSpyLogger, evalDialogueRequest } from './fixtures'

/**
 * S1.5 / plan §6.3 -- the early Arm 1 measurement. Runs the FIXED player
 * script against the existing, unmodified memoryContext path
 * (`recallRoomMemoryContext` -> `buildVisibleRoomMemoryContext` ->
 * `buildDialoguePromptMessages`) and counts spine-scope leakage on the
 * composed prompt: the exact model-visible surface of each turn. No code
 * in the Arm 1 path is touched; no model is called.
 *
 * Two seedings are measured:
 * - REALISTIC: only what this scenario's play actually records through the
 *   room-memory firewall (the player's entry and the scream as
 *   game-authored room observations).
 * - SENSITIVITY: adds one truth-bearing room observation naming the
 *   attacker, to prove the instrument fires when out-of-scope content
 *   reaches the shared room layer at all.
 */

const WORLD_ID = 'belief-slice-world'
const SESSION_ID = 'belief-slice-session'
const ROOM_ID = 'cellar'

const SCOPE = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }

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
  findings: ReturnType<typeof leakageBreakdown>
}

async function measureArm1(memoryTexts: readonly string[]): Promise<StepMeasurement[]> {
  const harness = await seededHarness(memoryTexts)
  const measurements: StepMeasurement[] = []

  for (const [stepIndex, step] of THREE_NPC_PLAYER_SCRIPT.entries()) {
    // The real composition path, exactly as App.tsx builds dialogue turns:
    // recall -> per-NPC visibility gate -> prompt sections.
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

    // The claw mark reaches C between steps 3 and 4; count step 4 against
    // the post-evidence universe so C's granted entitlement applies.
    const universe = step.kind === 'showEvidence' ? buildPostEvidenceUniverse() : buildPreEvidenceUniverse()
    const findings = leakageBreakdown(promptText, step.npcId, universe)

    measurements.push({
      stepIndex,
      npcId: step.npcId,
      contextEntries: memoryContext?.entries.length ?? 0,
      findings,
    })
    expect(leakageCount(promptText, step.npcId, universe)).toBe(findings.length)
  }

  return measurements
}

describe('Arm 1 (existing memoryContext path) over the fixed player script', () => {
  it('REALISTIC seeding: benign room observations leak only scene geometry to B, nothing else to anyone', async () => {
    const measurements = await measureArm1(['The player entered the cellar.', 'A scream rang out from the cellar.'])
    expect(measurements).toHaveLength(4)

    const byStep = new Map(measurements.map((measurement) => [`${measurement.npcId}#${measurement.stepIndex}`, measurement]))
    const of = (npcId: string, stepIndex: number) => byStep.get(`${npcId}#${stepIndex}`)!

    // Positive bound: every context actually carried both observations.
    for (const measurement of measurements) {
      expect(measurement.contextEntries, `step ${measurement.stepIndex}`).toBe(2)
    }

    // A and C are entitled to the cellar name (A saw into it; C heard sounds from it).
    expect(of('NPC_A', 0).findings).toEqual([])
    expect(of('NPC_C', 2).findings).toEqual([])
    expect(of('NPC_C', 3).findings).toEqual([])

    // B never learned where any of this happened -- yet shared room recall
    // hands it the scene name twice. Even "benign" memories leak geometry.
    expect(of('NPC_B', 1).findings.map((finding) => [finding.category, finding.entity])).toEqual([
      ['unentitled-entity', 'cellar'],
      ['unentitled-entity', 'cellar'],
    ])
  })

  it('SENSITIVITY seeding: a truth-bearing room record leaks the attack to A, B and pre-evidence C -- but not post-evidence C', async () => {
    const measurements = await measureArm1([
      'The player entered the cellar.',
      'A scream rang out from the cellar.',
      'zombie_17 attacked guard_malik in the cellar.',
    ])
    expect(measurements).toHaveLength(4)

    const byStep = new Map(measurements.map((measurement) => [`${measurement.npcId}#${measurement.stepIndex}`, measurement]))

    // Positive bound: the truth-bearing entry actually rendered into every context.
    for (const measurement of measurements) {
      expect(measurement.contextEntries, `step ${measurement.stepIndex}`).toBe(3)
    }

    const categoriesOf = (npcId: string, stepIndex: number): string[] =>
      byStep.get(`${npcId}#${stepIndex}`)!.findings.map((finding) => finding.category)

    // A: names the zombie and the victim it never perceived.
    expect(categoriesOf('NPC_A', 0)).toEqual(['named-zombie', 'named-real-attacker', 'unentitled-entity', 'unentitled-entity'])
    // B: also leaks the cellar name on all three entries (geometry, as above).
    expect(categoriesOf('NPC_B', 1)).toEqual([
      'named-zombie',
      'named-real-attacker',
      'unentitled-entity',
      'unentitled-entity',
      'unentitled-entity',
      'unentitled-entity',
    ])
    // C pre-evidence: entitled to player+guard+cellar, not to the zombie.
    expect(categoriesOf('NPC_C', 2)).toEqual(['named-zombie', 'named-real-attacker', 'unentitled-entity'])
    // C after its claw-mark entitlement: silent.
    expect(categoriesOf('NPC_C', 3)).toEqual([])
  })
})
