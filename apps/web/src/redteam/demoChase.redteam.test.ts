import demoChaseOptInSource from '../app/demoChaseOptIn.ts?raw'
import chaseStepSource from '../renderer/engine/npc/chaseStep.ts?raw'
import { describe, expect, it } from 'vitest'
import {
  DEMO_CHASE_NPC_IDS,
  readDemoChaseEnabled,
  selectDemoChaseOptInNpcIds,
} from '../app/demoChaseOptIn'
import { markers } from './fixtures'

/**
 * Redteam coverage for hostile-npc-chase-demo-opt-in-v0 (ADR-0086, Slice 4).
 *
 * Proves, against the real selector/gate and the real `chaseStep` source, that:
 *   - the selector layer has no import surface onto world-session, memory,
 *     persistence, dialogue, generation, or the server (it has none at all);
 *   - content-shaped poison (prompt/provider/dialogue/relationship-looking
 *     strings) injected as candidate ids or extra allowlist/env entries never
 *     grants eligibility and never appears in the selected output;
 *   - the env gate keys off the exact `VITE_AIGM_DEMO_CHASE` name only, never
 *     off adjacent/poisoned env keys;
 *   - the movement math `chaseStep` consumes has no reference to combat,
 *     damage, health, encounters, quests, items, WorldState/Event/Command,
 *     persistence, memory, or facts — so player contact with a chase-eligible
 *     NPC cannot have gameplay consequences through this path.
 */

describe('redteam demo chase opt-in - selector has no reachable side-effect surface', () => {
  it('demoChaseOptIn.ts has zero import statements (no path to world-session, memory, persistence, dialogue, generation, or server)', () => {
    expect(demoChaseOptInSource).not.toMatch(/^\s*import\s/m)
  })

  it('demoChaseOptIn.ts calls no console/logger method', () => {
    expect(demoChaseOptInSource).not.toMatch(/console\./)
    expect(demoChaseOptInSource).not.toMatch(/logger\./i)
  })
})

describe('redteam demo chase opt-in - content-shaped poison never grants eligibility', () => {
  it('poisoned ids that look like prompt/provider/dialogue/relationship payloads are never selected', () => {
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

    const result = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds: poisonedPresentIds })

    expect([...result]).toEqual(['herald-asha'])
    for (const poisoned of poisonedPresentIds) {
      if (poisoned === 'herald-asha') continue
      expect(result.has(poisoned)).toBe(false)
    }
  })

  it('poisoned allowlist entries shaped like content fields are never selected even when present', () => {
    const poisonedAllowlist = new Set([
      'herald-asha',
      `prompt:${markers.userPrompt}`,
      `relationship:${markers.npcName}`,
      markers.providerBody,
    ])
    const presentNpcIds = poisonedAllowlist // attacker controls both sides; still id-only intersection

    const result = selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds, allowlist: poisonedAllowlist })

    // Every poisoned entry round-trips only because it is literally both
    // allowlisted and present -- proving the selector is a pure set
    // intersection with no semantic parsing, not that poison is "detected".
    expect([...result]).toEqual([...poisonedAllowlist])
    // The real, hand-authored allowlist constant is unaffected by any of this.
    expect([...DEMO_CHASE_NPC_IDS]).toEqual(['herald-asha'])
  })

  it('env gate keys off the exact VITE_AIGM_DEMO_CHASE name only, never adjacent poisoned keys', () => {
    expect(
      readDemoChaseEnabled({
        VITE_AIGM_DEMO_CHASE_RELATIONSHIP: 'true',
        VITE_AIGM_DEMO_CHASE_DIALOGUE: '1',
        DEMO_CHASE: 'true',
        chase: 'true',
        relationship: 'true',
        dialogue: '1',
        [markers.flagKey]: 'true',
      }),
    ).toBe(false)
  })
})

describe('redteam demo chase - contact has no gameplay consequence (movement-only proof)', () => {
  it('chaseStep.ts imports only the pure wander-field contract, never world/memory/persistence/encounter modules', () => {
    const specifiers = importSpecifiers(chaseStepSource)
    expect(specifiers.length).toBeGreaterThan(0) // guard against a vacuous pass
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/domain\/npcMovementContract$/)
    }
  })

  it('chaseStep.ts never references combat, damage, health, encounters, quests, items, WorldState/Event/Command, persistence, memory, or facts', () => {
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
    ]
    for (const term of forbidden) {
      expect(chaseStepSource.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  it('chaseStep\'s result type carries only a position, never a side-effect payload', () => {
    const resultType = chaseStepSource.slice(
      chaseStepSource.indexOf('export type NpcChaseStepResult'),
      chaseStepSource.indexOf('\n\n', chaseStepSource.indexOf('export type NpcChaseStepResult')),
    )
    expect(resultType).toContain('position: { x: number; z: number }')
    // Single-field readonly result: nothing beyond position can ride along.
    expect((resultType.match(/:\s*(number|\{)/g) ?? []).length).toBeLessThanOrEqual(3)
  })
})

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}
