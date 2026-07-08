import npcRoutineSource from '../domain/npcRoutine.ts?raw'
import npcRoutineConfigSource from '../domain/npcRoutineConfig.ts?raw'
import appNpcRoutineSource from '../app/npcRoutine.ts?raw'
import npcMovementContractSource from '../domain/npcMovementContract.ts?raw'
import wanderMotorSource from '../renderer/engine/npc/WanderMotor.ts?raw'
import { describe, expect, it } from 'vitest'
import { readRoutineEnabled, selectNpcRoutineModes } from '../app/npcRoutine'
import { routineModeToMotorPolicy } from '../domain/npcRoutine'
import { getRoutineSchedule, NPC_ROUTINE_CONFIG } from '../domain/npcRoutineConfig'
import { markers } from './fixtures'

/**
 * Redteam coverage for npc-day-night-routine-v0 (ADR-0087, Slice 5).
 *
 * Proves, against the real gate/selector/config and the real source of the
 * routine modules, that:
 *   - `domain/npcRoutine.ts`, `domain/npcRoutineConfig.ts`, and
 *     `app/npcRoutine.ts` have no import surface onto provider, prompt/LLM,
 *     persistence, world-event/command/state, memory, or fact modules;
 *   - none of the three modules call console/logger or reference timers /
 *     wall-clock scheduling;
 *   - content-shaped poison (prompt/provider/dialogue/relationship-looking
 *     strings) injected as candidate ids, config keys, or env keys never
 *     grants a resolved mode and never appears in selector output;
 *   - the env gate keys off the exact `VITE_AIGM_DEMO_ROUTINE` name only;
 *   - `NPC_ROUTINE_CONFIG` is an id-only allowlist of the four closed modes,
 *     with no content-derived fields, and `getRoutineSchedule` performs exact
 *     id lookup only;
 *   - `rest`/`passive` are movement-only: the dialogue-lock gate
 *     (`shouldPauseWander`) takes no routine-mode input, so no routine mode
 *     can special-case or block dialogue.
 */

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}

describe('redteam npc routine - modules have no reachable side-effect import surface', () => {
  it('domain/npcRoutine.ts imports only the world-clock TimeOfDay type', () => {
    const specifiers = importSpecifiers(npcRoutineSource)
    expect(specifiers).toEqual(['./world/worldClock'])
  })

  it('domain/npcRoutineConfig.ts imports only ./npcRoutine', () => {
    const specifiers = importSpecifiers(npcRoutineConfigSource)
    expect(specifiers).toEqual(['./npcRoutine'])
  })

  it('app/npcRoutine.ts imports only the pure domain routine modules, never provider/prompt/LLM/persistence/world-event/memory/fact modules', () => {
    const specifiers = importSpecifiers(appNpcRoutineSource)
    expect(specifiers.length).toBeGreaterThan(0) // guard against a vacuous pass
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^\.\.\/domain\/(world\/worldClock|npcRoutine|npcRoutineConfig)$/)
    }
  })

  it('none of the three routine modules call console/logger', () => {
    for (const source of [npcRoutineSource, npcRoutineConfigSource, appNpcRoutineSource]) {
      expect(source).not.toMatch(/console\./)
      expect(source).not.toMatch(/logger\./i)
    }
  })

  it('none of the three routine modules reference timers, wall-clock polling, or a background loop', () => {
    const forbidden = ['setInterval', 'setTimeout', 'Date.now', 'requestAnimationFrame', 'setImmediate']
    for (const source of [npcRoutineSource, npcRoutineConfigSource, appNpcRoutineSource]) {
      for (const term of forbidden) {
        expect(source).not.toContain(term)
      }
    }
  })

  it('none of the three routine modules reference combat/damage/health/encounter/quest/item/WorldState/WorldEvent/WorldCommand/persistence/memory/fact', () => {
    const forbidden = [
      'combat',
      'damage',
      'encounter',
      'quest',
      'inventory',
      'health',
      'WorldState',
      'WorldEvent',
      'WorldCommand',
      'persistence',
      'memory',
      'fact',
      'sqlite',
    ]
    for (const source of [npcRoutineSource, npcRoutineConfigSource, appNpcRoutineSource]) {
      for (const term of forbidden) {
        expect(source.toLowerCase()).not.toContain(term.toLowerCase())
      }
    }
  })
})

describe('redteam npc routine - content-shaped poison never grants a resolved mode', () => {
  it('poisoned present ids that look like prompt/provider/dialogue/relationship payloads never resolve to a mode', () => {
    const poisonedPresentIds = new Set([
      'herald-asha', // the one real allowlisted id, to prove it still passes through
      markers.playerText,
      markers.memoryText,
      markers.providerBody,
      markers.userPrompt,
      `dialogue:${markers.npcName}`,
      `relationship:trust:+5`,
      `prompt:${markers.roomSpecJson}`,
      'effect:unlock-exit',
      'source:llm',
      'axis:fear',
      'delta:-3',
    ])

    const result = selectNpcRoutineModes({ enabled: true, presentNpcIds: poisonedPresentIds, timeOfDay: 'day' })

    expect([...result.keys()]).toEqual(['herald-asha'])
    expect(result.get('herald-asha')).toBe('patrol')
    for (const poisoned of poisonedPresentIds) {
      if (poisoned === 'herald-asha') continue
      expect(result.has(poisoned)).toBe(false)
    }
  })

  it('poisoned config keys shaped like content fields resolve only by literal id intersection, never by semantic content', () => {
    const poisonedConfig = {
      'herald-asha': NPC_ROUTINE_CONFIG['herald-asha']!,
      [`prompt:${markers.userPrompt}`]: { day: 'patrol' as const },
      [`relationship:${markers.npcName}`]: { day: 'rest' as const },
    }
    const presentNpcIds = new Set(Object.keys(poisonedConfig)) // attacker controls both sides

    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      config: poisonedConfig,
    })

    // Every poisoned entry round-trips only because it is literally both
    // configured and present -- proving a pure id intersection, not that
    // poison is "detected".
    expect(result.size).toBe(3)
    // The real, hand-authored config constant is unaffected by any of this.
    expect(Object.keys(NPC_ROUTINE_CONFIG)).toEqual(['herald-asha'])
  })

  it('env gate keys off the exact VITE_AIGM_DEMO_ROUTINE name only, never adjacent poisoned keys', () => {
    expect(
      readRoutineEnabled({
        VITE_AIGM_DEMO_ROUTINE_RELATIONSHIP: 'true',
        VITE_AIGM_DEMO_ROUTINE_DIALOGUE: '1',
        DEMO_ROUTINE: 'true',
        routine: 'true',
        relationship: 'true',
        dialogue: '1',
        [markers.flagKey]: 'true',
      }),
    ).toBe(false)
  })
})

describe('redteam npc routine - config allowlist is id-only, no content-derived fields', () => {
  it('NPC_ROUTINE_CONFIG keys are plain ids and every schedule entry is one of the four closed modes at an authored bucket', () => {
    for (const [npcId, schedule] of Object.entries(NPC_ROUTINE_CONFIG)) {
      expect(npcId).not.toMatch(/[\s:{}[\]<>]/) // no content/JSON/markup-shaped keys
      for (const [bucket, mode] of Object.entries(schedule)) {
        expect(['dawn', 'day', 'dusk', 'night']).toContain(bucket)
        expect(['idle', 'patrol', 'rest', 'passive']).toContain(mode)
      }
    }
  })

  it('getRoutineSchedule performs exact id lookup only, never fuzzy/semantic/content-based matching', () => {
    for (const poisoned of [
      markers.npcName,
      markers.playerText,
      markers.roomSpecJson,
      `prompt:${markers.userPrompt}`,
      'Herald Asha',
      'HERALD-ASHA',
      'herald',
    ]) {
      expect(getRoutineSchedule(poisoned)).toBeNull()
    }
    expect(getRoutineSchedule('herald-asha')).not.toBeNull()
  })
})

describe('redteam npc routine - rest/passive are movement-only, never dialogue-blocking', () => {
  it('routineModeToMotorPolicy maps rest/passive onto the pre-existing, non-dialogue motor policies', () => {
    expect(routineModeToMotorPolicy('rest')).toBe('idle')
    expect(routineModeToMotorPolicy('passive')).toBe('wander')
  })

  it('the dialogue-lock gate shouldPauseWander takes no routine-mode input, so no routine mode can special-case or block dialogue', () => {
    const start = npcMovementContractSource.indexOf('export function shouldPauseWander')
    expect(start).toBeGreaterThanOrEqual(0) // guard against a vacuous pass
    const end = npcMovementContractSource.indexOf('\n}', start)
    const fnBlock = npcMovementContractSource.slice(start, end)

    expect(fnBlock).toContain('interactionLocked')
    expect(fnBlock).toContain('npcTalking')
    expect(fnBlock).not.toMatch(/rest|passive|routine/i)
  })

  it('WanderMotorPauseContext (the per-frame pause input) carries no routine-mode field', () => {
    const start = wanderMotorSource.indexOf('export type WanderMotorPauseContext')
    expect(start).toBeGreaterThanOrEqual(0) // guard against a vacuous pass
    const end = wanderMotorSource.indexOf('\n}', start)
    const typeBlock = wanderMotorSource.slice(start, end)

    expect(typeBlock).not.toMatch(/routine/i)
  })
})
