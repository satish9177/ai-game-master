import { describe, expect, it } from 'vitest'
import { repairGeneratedObjects } from '../domain/generatedRoomLayout'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { RoomObject } from '../domain/roomSpec'
import { ruinedKingdomShowcases } from '../domain/examples/ruinedKingdomShowcases'
import {
  ZERO_RENDER_COST,
  planRenderBudget,
  type RenderBudgetCandidate,
  type RenderCost,
} from '../renderer/engine/visual-pack/renderBudget'

function cost(overrides: Partial<RenderCost>): RenderCost {
  return { ...ZERO_RENDER_COST, ...overrides }
}

function semanticKey(object: RoomObject): string {
  const kind = 'kind' in object ? object.kind : undefined
  const variant = 'variant' in object ? object.variant : undefined
  const condition = 'condition' in object ? object.condition : undefined
  return [object.type, kind, variant, condition ?? 'intact'].filter(Boolean).join(':')
}

function candidateFor(
  object: RoomObject,
  index: number,
  environment: string,
): RenderBudgetCandidate {
  const id = object.id ?? `${environment}-${index}`
  const interactive = 'interaction' in object && object.interaction !== undefined

  if (object.type === 'npc' || object.type === 'zombie') {
    return {
      id,
      priority: interactive ? 'interactive' : 'nearby',
      distanceSquared: index + 1,
      exactCost: cost({
        triangles: 12_000, drawCalls: 3,
        textureSetIds: ['humanoid-atlas'],
        skinnedCharacters: 1, animationMixers: 1,
        shadowCasters: 1, collisionBodies: 1,
      }),
      staticHumanoidCost: cost({
        triangles: 2_200, drawCalls: 1,
        textureSetIds: ['humanoid-atlas'], collisionBodies: 1,
      }),
      canSuspendAnimation: true,
      canDisableShadows: true,
    }
  }

  if (object.type === 'light-fixture' || object.type === 'torch') {
    const particles = object.type === 'light-fixture'
      && (object.kind === 'brazier' || object.kind === 'campfire')
    return {
      id,
      priority: interactive ? 'interactive' : 'decorative',
      distanceSquared: index + 1,
      exactCost: cost({
        triangles: 350, drawCalls: 1,
        textureSetIds: [`${environment}-atlas`],
        localLights: 1, particleEmitters: particles ? 1 : 0,
      }),
      canUseEmissiveOnly: true,
      canDisableParticles: true,
    }
  }

  return {
    id,
    priority: interactive ? 'interactive' : 'decorative',
    distanceSquared: index + 1,
    exactCost: cost({
      triangles: 300, drawCalls: 1,
      textureSetIds: [`${environment}-atlas`],
      shadowCasters: object.type === 'architecture' ? 1 : 0,
      collisionBodies: object.type === 'rug' || object.type === 'paper' ? 0 : 1,
    }),
    ...(interactive ? {} : { instanceGroup: `${environment}:${semanticKey(object)}` }),
    canDisableShadows: true,
    productionFallbackCost: cost({
      triangles: 80, drawCalls: 1,
      textureSetIds: ['neutral-atlas'],
    }),
  }
}

describe('Ruined Kingdom Survival weighted performance evaluation', () => {
  it.each(Object.entries(ruinedKingdomShowcases))(
    'retains every semantic object in the %s fixture and budgets resources by weight',
    (id, fixture) => {
      const loaded = loadRoomSpec(structuredClone(fixture))
      const candidates = loaded.objects.map((object, index) =>
        candidateFor(object, index, loaded.environmentKind ?? 'neutral'),
      )
      const plan = planRenderBudget(candidates, {
        [`${loaded.environmentKind ?? 'neutral'}-atlas`]: 8 * 1024 * 1024,
        'humanoid-atlas': 12 * 1024 * 1024,
        'neutral-atlas': 2 * 1024 * 1024,
      })

      expect(id).toBeTruthy()
      expect(plan.items).toHaveLength(loaded.objects.length)
      expect(plan.withinBudget).toBe(true)
      expect(plan.usage.drawCalls).toBeLessThan(loaded.objects.length)
      expect(new Set(plan.items.map((item) => item.id)).size).toBe(loaded.objects.length)
    },
  )

  it('preserves 500 inexpensive static pieces through loading, repair, and instanced planning', () => {
    const raw = {
      schemaVersion: 1,
      id: 'rich-static-layout',
      name: 'Rich Static Layout',
      environmentKind: 'ruins',
      shell: {
        dimensions: { width: 24, depth: 24, height: 5 },
        exits: [{ side: 'north', width: 3 }],
      },
      spawn: { position: [0, 1.7, 8] },
      objects: Array.from({ length: 500 }, (_, index) => ({
        type: 'architecture',
        kind: 'floor-section',
        condition: index % 5 === 0 ? 'weathered' : 'intact',
        position: [2, 0.01, 2],
        size: [0.8, 0.08, 0.8],
      })),
    }
    const loaded = loadRoomSpec(raw)
    const repaired = repairGeneratedObjects(loaded)
    const candidates = repaired.objects.map((object, index) => ({
      ...candidateFor(object, index, 'ruins'),
      exactCost: cost({
        triangles: 100, drawCalls: 1,
        textureSetIds: ['ruins-atlas'], collisionBodies: 1,
      }),
    }))
    const plan = planRenderBudget(candidates, { 'ruins-atlas': 4 * 1024 * 1024 })

    expect(loaded.objects).toHaveLength(500)
    expect(repaired.objects).toHaveLength(500)
    expect(plan.items).toHaveLength(500)
    expect(plan.usage.visibleTriangles).toBe(50_000)
    expect(plan.usage.drawCalls).toBe(2)
    expect(plan.usage.staticCollisionBodies).toBe(500)
    expect(plan.withinBudget).toBe(true)
  })

  it('retains all humanoids while deterministically freezing distant excess rigs', () => {
    const rigged = cost({
      triangles: 12_000, drawCalls: 3,
      skinnedCharacters: 1, animationMixers: 1,
    })
    const staticHumanoid = cost({ triangles: 2_000, drawCalls: 1 })
    const candidates: RenderBudgetCandidate[] = Array.from({ length: 24 }, (_, index) => ({
      id: index === 0 ? 'player' : `humanoid-${index}`,
      priority: index === 0 ? 'essential' : 'distant',
      distanceSquared: index,
      exactCost: rigged,
      staticHumanoidCost: staticHumanoid,
      canSuspendAnimation: true,
    }))
    const plan = planRenderBudget(candidates, {})

    expect(plan.items).toHaveLength(24)
    expect(plan.items.find((item) => item.id === 'player')?.resolution).toBe('exact')
    expect(plan.items.filter((item) => item.resolution === 'static-humanoid')).toHaveLength(12)
    expect(plan.usage.skinnedCharacters).toBe(12)
    expect(plan.usage.activeAnimationMixers).toBe(12)
    expect(plan.withinBudget).toBe(true)
  })

  it('makes excess fixtures emissive-only and disables particles without deleting them', () => {
    const candidates: RenderBudgetCandidate[] = Array.from({ length: 20 }, (_, index) => ({
      id: `brazier-${index}`,
      priority: 'decorative',
      distanceSquared: index,
      exactCost: cost({
        triangles: 400, drawCalls: 1, localLights: 1, particleEmitters: 1,
      }),
      canUseEmissiveOnly: true,
      canDisableParticles: true,
    }))
    const plan = planRenderBudget(candidates, {})

    expect(plan.items).toHaveLength(20)
    expect(plan.usage.localLights).toBeLessThanOrEqual(12)
    expect(plan.usage.particleEmitters).toBeLessThanOrEqual(4)
    expect(plan.withinBudget).toBe(true)
  })
})
