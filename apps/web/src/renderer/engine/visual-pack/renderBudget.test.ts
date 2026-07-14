import { describe, expect, it } from 'vitest'
import {
  BALANCED_RENDER_BUDGET,
  ZERO_RENDER_COST,
  isWithinRenderBudget,
  planRenderBudget,
} from './renderBudget'
import type {
  RenderBudget,
  RenderBudgetCandidate,
  RenderCost,
} from './renderBudget'

function cost(overrides: Partial<RenderCost> = {}): RenderCost {
  return { ...ZERO_RENDER_COST, ...overrides }
}

function budget(overrides: Partial<RenderBudget> = {}): RenderBudget {
  return { ...BALANCED_RENDER_BUDGET, ...overrides }
}

const ZERO_BUDGET: RenderBudget = {
  visibleTriangles: 0,
  drawCalls: 0,
  decodedTextureBytes: 0,
  skinnedCharacters: 0,
  activeAnimationMixers: 0,
  shadowCastingLights: 0,
  localLights: 0,
  particleEmitters: 0,
  blendedTransparentDraws: 0,
  shadowCastingMeshes: 0,
  staticCollisionBodies: 0,
  activePhysicsBodies: 0,
}

describe('weighted render budget', () => {
  it('publishes the approved balanced resource profile', () => {
    expect(BALANCED_RENDER_BUDGET).toEqual({
      visibleTriangles: 800_000,
      drawCalls: 250,
      decodedTextureBytes: 128 * 1024 * 1024,
      skinnedCharacters: 16,
      activeAnimationMixers: 12,
      shadowCastingLights: 1,
      localLights: 12,
      particleEmitters: 4,
      blendedTransparentDraws: 16,
      shadowCastingMeshes: 96,
      staticCollisionBodies: 512,
      activePhysicsBodies: 0,
    })
  })

  it('retains 500 inexpensive static pieces and batches their draw calls', () => {
    const candidates: RenderBudgetCandidate[] = Array.from({ length: 500 }, (_, index) => ({
      id: `stone-${index}`,
      priority: 'decorative',
      distanceSquared: index,
      instanceGroup: 'ruins:stone:intact:shadow-off',
      exactCost: cost({
        triangles: 100,
        drawCalls: 1,
        textureSetIds: ['ruins-atlas'],
        collisionBodies: 1,
      }),
    }))

    const plan = planRenderBudget(candidates, { 'ruins-atlas': 4 * 1024 * 1024 })

    expect(plan.items).toHaveLength(500)
    expect(plan.items.every((item) => item.resolution === 'exact')).toBe(true)
    expect(plan.degradations).toEqual([])
    expect(plan.instancedGroups).toEqual(['ruins:stone:intact:shadow-off'])
    expect(plan.usage.visibleTriangles).toBe(50_000)
    expect(plan.usage.drawCalls).toBe(1)
    expect(plan.usage.decodedTextureBytes).toBe(4 * 1024 * 1024)
    expect(plan.usage.staticCollisionBodies).toBe(500)
    expect(plan.withinBudget).toBe(true)
  })

  it('keeps essential humanoids rigged and degrades a lower-priority distant one first', () => {
    const rigged = cost({
      triangles: 12_000,
      drawCalls: 3,
      skinnedCharacters: 1,
      animationMixers: 1,
    })
    const staticHumanoid = cost({ triangles: 2_000, drawCalls: 1 })
    const candidates: RenderBudgetCandidate[] = [
      {
        id: 'player',
        priority: 'essential',
        distanceSquared: 0,
        exactCost: rigged,
        staticHumanoidCost: staticHumanoid,
      },
      {
        id: 'distant-villager',
        priority: 'distant',
        distanceSquared: 200,
        exactCost: rigged,
        staticHumanoidCost: staticHumanoid,
      },
    ]

    const plan = planRenderBudget(candidates, {}, budget({
      skinnedCharacters: 1,
      activeAnimationMixers: 1,
    }))

    expect(plan.items).toEqual([
      expect.objectContaining({ id: 'player', resolution: 'exact' }),
      expect.objectContaining({ id: 'distant-villager', resolution: 'static-humanoid' }),
    ])
    expect(plan.degradations).toEqual([
      { candidateId: 'distant-villager', kind: 'static-humanoid' },
    ])
    expect(plan.withinBudget).toBe(true)
  })

  it('applies every downgrade stage in the documented order without deleting semantics', () => {
    const everyResource = cost({
      triangles: 1,
      drawCalls: 1,
      textureSetIds: ['atlas'],
      skinnedCharacters: 1,
      animationMixers: 1,
      localLights: 1,
      shadowLights: 1,
      particleEmitters: 1,
      transparentDraws: 1,
      shadowCasters: 1,
      collisionBodies: 1,
    })
    const candidate: RenderBudgetCandidate = {
      id: 'expensive-fixture',
      priority: 'decorative',
      distanceSquared: 100,
      exactCost: everyResource,
      lodCosts: [everyResource],
      staticHumanoidCost: everyResource,
      productionFallbackCost: everyResource,
      canSuspendAnimation: true,
      canUseEmissiveOnly: true,
      canDisableParticles: true,
      canUseOpaqueFallback: true,
      canDisableShadows: true,
    }

    const plan = planRenderBudget([candidate], { atlas: 1 }, ZERO_BUDGET)

    expect(plan.degradations.map((entry) => entry.kind)).toEqual([
      'lower-lod',
      'static-humanoid',
      'suspend-animation',
      'emissive-only-light',
      'disable-particles',
      'opaque-transparency',
      'disable-shadows',
      'production-fallback',
    ])
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toEqual(expect.objectContaining({
      id: 'expensive-fixture',
      resolution: 'production-fallback',
      animationSuspended: true,
      emissiveOnly: true,
      particlesDisabled: true,
      opaqueFallback: true,
      shadowsDisabled: true,
    }))
    expect(plan.withinBudget).toBe(false)
  })

  it('uses stable id ordering to make equal-priority degradation deterministic', () => {
    const exact = cost({ skinnedCharacters: 1 })
    const fallback = cost()
    const input: RenderBudgetCandidate[] = [
      { id: 'b', priority: 'distant', distanceSquared: 10, exactCost: exact, staticHumanoidCost: fallback },
      { id: 'a', priority: 'distant', distanceSquared: 10, exactCost: exact, staticHumanoidCost: fallback },
    ]
    const limited = budget({ skinnedCharacters: 1 })

    const first = planRenderBudget(input, {}, limited)
    const second = planRenderBudget(input, {}, limited)

    expect(first).toEqual(second)
    expect(first.degradations).toEqual([{ candidateId: 'a', kind: 'static-humanoid' }])
    expect(first.items.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('counts a shared texture set once and treats an undeclared set as over budget', () => {
    const candidates: RenderBudgetCandidate[] = ['a', 'b'].map((id) => ({
      id,
      priority: 'decorative',
      distanceSquared: 0,
      exactCost: cost({ textureSetIds: ['shared'] }),
    }))

    const declared = planRenderBudget(candidates, { shared: 4096 })
    expect(declared.usage.decodedTextureBytes).toBe(4096)

    const undeclared = planRenderBudget(candidates, {})
    expect(undeclared.usage.decodedTextureBytes).toBe(Number.POSITIVE_INFINITY)
    expect(undeclared.withinBudget).toBe(false)
  })

  it('rejects invalid trusted cost metadata with fixed diagnostic codes', () => {
    expect(() => planRenderBudget([
      {
        id: 'bad',
        priority: 'decorative',
        distanceSquared: 0,
        exactCost: cost({ triangles: -1 }),
      },
    ], {})).toThrow('invalid-render-cost')

    expect(() => planRenderBudget([
      { id: 'same', priority: 'decorative', distanceSquared: 0, exactCost: cost() },
      { id: 'same', priority: 'decorative', distanceSquared: 1, exactCost: cost() },
    ], {})).toThrow('invalid-render-candidate-id')
  })

  it('checks every weighted dimension and never substitutes a raw object count', () => {
    expect(isWithinRenderBudget({ ...ZERO_BUDGET }, ZERO_BUDGET)).toBe(true)
    expect(isWithinRenderBudget({ ...ZERO_BUDGET, localLights: 1 }, ZERO_BUDGET)).toBe(false)
    expect(Object.keys(BALANCED_RENDER_BUDGET)).not.toContain('objects')
    expect(Object.keys(BALANCED_RENDER_BUDGET)).not.toContain('objectCount')
  })
})
