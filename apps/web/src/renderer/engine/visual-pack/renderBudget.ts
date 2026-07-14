import type { RenderCost } from './contracts'
export type { RenderCost } from './contracts'

/**
 * Pure weighted rendering budget for the trusted visual-pack renderer.
 *
 * RoomSpec remains semantic data. This planner receives only trusted registry
 * costs and returns deterministic presentation downgrades; it never removes a
 * room object or changes gameplay state.
 */

export type RenderBudget = Readonly<{
  visibleTriangles: number
  drawCalls: number
  decodedTextureBytes: number
  skinnedCharacters: number
  activeAnimationMixers: number
  shadowCastingLights: number
  localLights: number
  particleEmitters: number
  blendedTransparentDraws: number
  shadowCastingMeshes: number
  staticCollisionBodies: number
  activePhysicsBodies: number
}>


export type TextureSetByteCatalog = Readonly<Record<string, number>>

export const BALANCED_RENDER_BUDGET: RenderBudget = Object.freeze({
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

export const ZERO_RENDER_COST: RenderCost = Object.freeze({
  triangles: 0,
  drawCalls: 0,
  textureSetIds: Object.freeze([]),
  skinnedCharacters: 0,
  animationMixers: 0,
  localLights: 0,
  shadowLights: 0,
  particleEmitters: 0,
  transparentDraws: 0,
  shadowCasters: 0,
  collisionBodies: 0,
})

export type RenderPriority = 'decorative' | 'distant' | 'nearby' | 'interactive' | 'essential'

export type RenderBudgetCandidate = Readonly<{
  /** Stable renderer-owned key. It is not an asset path and is never executed. */
  id: string
  priority: RenderPriority
  distanceSquared: number
  exactCost: RenderCost
  /** Ordered from highest to lowest fidelity. */
  lodCosts?: readonly RenderCost[]
  /** Unskinned production representation for a humanoid beyond the rig budget. */
  staticHumanoidCost?: RenderCost
  /** Closed neutral/family/environment production fallback cost. */
  productionFallbackCost?: RenderCost
  /** Exact asset/material/state/shadow key. Omit for interactive/stateful objects. */
  instanceGroup?: string
  canSuspendAnimation?: boolean
  canUseEmissiveOnly?: boolean
  canDisableParticles?: boolean
  canUseOpaqueFallback?: boolean
  canDisableShadows?: boolean
}>

export type RenderResolution = 'exact' | 'lod' | 'static-humanoid' | 'production-fallback'

export type RenderDegradationKind =
  | 'lower-lod'
  | 'static-humanoid'
  | 'suspend-animation'
  | 'emissive-only-light'
  | 'disable-particles'
  | 'opaque-transparency'
  | 'disable-shadows'
  | 'production-fallback'

export type RenderPlanItem = Readonly<{
  id: string
  resolution: RenderResolution
  lodIndex?: number
  animationSuspended: boolean
  emissiveOnly: boolean
  particlesDisabled: boolean
  opaqueFallback: boolean
  shadowsDisabled: boolean
  instanceGroup?: string
}>

export type RenderBudgetUsage = RenderBudget

export type RenderBudgetPlan = Readonly<{
  items: readonly RenderPlanItem[]
  degradations: readonly Readonly<{
    candidateId: string
    kind: RenderDegradationKind
  }>[]
  instancedGroups: readonly string[]
  usage: RenderBudgetUsage
  withinBudget: boolean
}>

type MutableCandidateState = {
  candidate: RenderBudgetCandidate
  originalIndex: number
  resolution: RenderResolution
  lodIndex: number
  animationSuspended: boolean
  emissiveOnly: boolean
  particlesDisabled: boolean
  opaqueFallback: boolean
  shadowsDisabled: boolean
}

const PRIORITY_RANK: Readonly<Record<RenderPriority, number>> = Object.freeze({
  decorative: 0,
  distant: 1,
  nearby: 2,
  interactive: 3,
  essential: 4,
})

/**
 * Plans presentation cost in the approved deterministic order. Semantic objects
 * are always retained; if trusted production fallbacks still cannot fit, the
 * result reports `withinBudget: false` instead of silently deleting content.
 */
export function planRenderBudget(
  candidates: readonly RenderBudgetCandidate[],
  textureSetBytes: TextureSetByteCatalog,
  budget: RenderBudget = BALANCED_RENDER_BUDGET,
): RenderBudgetPlan {
  assertPlannerInputs(candidates, textureSetBytes, budget)

  const states: MutableCandidateState[] = candidates.map((candidate, originalIndex) => ({
    candidate,
    originalIndex,
    resolution: 'exact',
    lodIndex: -1,
    animationSuspended: false,
    emissiveOnly: false,
    particlesDisabled: false,
    opaqueFallback: false,
    shadowsDisabled: false,
  }))
  const degradations: { candidateId: string; kind: RenderDegradationKind }[] = []
  const degradationOrder = [...states].sort(compareForDegradation)

  const isOverBudget = (): boolean => !isWithinRenderBudget(
    calculateRenderUsage(states, textureSetBytes),
    budget,
  )

  // 1. Static instancing is accounted for by calculateRenderUsage before any
  // visual downgrade. Interactive/stateful candidates do not provide a group.

  // 2. Prefer lower authored LODs.
  let changed = true
  while (isOverBudget() && changed) {
    changed = false
    for (const state of degradationOrder) {
      const lods = state.candidate.lodCosts ?? []
      const nextIndex = state.lodIndex + 1
      if (
        (state.resolution === 'exact' || state.resolution === 'lod')
        && nextIndex < lods.length
      ) {
        if (!isOverBudget()) break
        state.resolution = 'lod'
        state.lodIndex = nextIndex
        degradations.push({ candidateId: state.candidate.id, kind: 'lower-lod' })
        changed = true
      }
    }
  }

  // 3. Keep essential/near humanoids rigged and use static production LODs for
  // lower-priority candidates first.
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'static-humanoid', (state) => {
    if (state.candidate.staticHumanoidCost === undefined || state.resolution === 'static-humanoid') {
      return false
    }
    state.resolution = 'static-humanoid'
    state.lodIndex = -1
    return true
  })

  // 4-8. Disable individual expensive resources in the documented order.
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'suspend-animation', (state) => {
    if (!state.candidate.canSuspendAnimation || state.animationSuspended) return false
    if (effectiveCost(state).animationMixers === 0) return false
    state.animationSuspended = true
    return true
  })
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'emissive-only-light', (state) => {
    if (!state.candidate.canUseEmissiveOnly || state.emissiveOnly) return false
    const cost = effectiveCost(state)
    if (cost.localLights === 0 && cost.shadowLights === 0) return false
    state.emissiveOnly = true
    return true
  })
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'disable-particles', (state) => {
    if (!state.candidate.canDisableParticles || state.particlesDisabled) return false
    if (effectiveCost(state).particleEmitters === 0) return false
    state.particlesDisabled = true
    return true
  })
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'opaque-transparency', (state) => {
    if (!state.candidate.canUseOpaqueFallback || state.opaqueFallback) return false
    if (effectiveCost(state).transparentDraws === 0) return false
    state.opaqueFallback = true
    return true
  })
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'disable-shadows', (state) => {
    if (!state.candidate.canDisableShadows || state.shadowsDisabled) return false
    if (effectiveCost(state).shadowCasters === 0) return false
    state.shadowsDisabled = true
    return true
  })

  // 9. Resolve remaining expensive entries to a trusted production fallback.
  applyCandidateStage(degradationOrder, isOverBudget, degradations, 'production-fallback', (state) => {
    if (state.candidate.productionFallbackCost === undefined || state.resolution === 'production-fallback') {
      return false
    }
    state.resolution = 'production-fallback'
    state.lodIndex = -1
    return true
  })

  const usage = calculateRenderUsage(states, textureSetBytes)
  return {
    items: [...states]
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map(toPlanItem),
    degradations,
    instancedGroups: collectInstancedGroups(states),
    usage,
    withinBudget: isWithinRenderBudget(usage, budget),
  }
}

function applyCandidateStage(
  degradationOrder: readonly MutableCandidateState[],
  isOverBudget: () => boolean,
  degradations: { candidateId: string; kind: RenderDegradationKind }[],
  kind: RenderDegradationKind,
  apply: (state: MutableCandidateState) => boolean,
): void {
  if (!isOverBudget()) return
  for (const state of degradationOrder) {
    if (!apply(state)) continue
    degradations.push({ candidateId: state.candidate.id, kind })
    if (!isOverBudget()) return
  }
}


function compareForDegradation(a: MutableCandidateState, b: MutableCandidateState): number {
  const priority = PRIORITY_RANK[a.candidate.priority] - PRIORITY_RANK[b.candidate.priority]
  if (priority !== 0) return priority
  const distance = b.candidate.distanceSquared - a.candidate.distanceSquared
  if (distance !== 0) return distance
  if (a.candidate.id < b.candidate.id) return -1
  if (a.candidate.id > b.candidate.id) return 1
  return a.originalIndex - b.originalIndex
}

function baseCost(state: MutableCandidateState): RenderCost {
  switch (state.resolution) {
    case 'exact':
      return state.candidate.exactCost
    case 'lod':
      return state.candidate.lodCosts?.[state.lodIndex] ?? state.candidate.exactCost
    case 'static-humanoid':
      return state.candidate.staticHumanoidCost ?? state.candidate.exactCost
    case 'production-fallback':
      return state.candidate.productionFallbackCost ?? state.candidate.exactCost
  }
}

function effectiveCost(state: MutableCandidateState): RenderCost {
  const cost = baseCost(state)
  return {
    ...cost,
    animationMixers: state.animationSuspended ? 0 : cost.animationMixers,
    localLights: state.emissiveOnly ? 0 : cost.localLights,
    shadowLights: state.emissiveOnly ? 0 : cost.shadowLights,
    particleEmitters: state.particlesDisabled ? 0 : cost.particleEmitters,
    transparentDraws: state.opaqueFallback ? 0 : cost.transparentDraws,
    shadowCasters: state.shadowsDisabled ? 0 : cost.shadowCasters,
  }
}

function calculateRenderUsage(
  states: readonly MutableCandidateState[],
  textureSetBytes: TextureSetByteCatalog,
): RenderBudgetUsage {
  const textureSets = new Set<string>()
  const drawCallGroups = new Set<string>()
  let visibleTriangles = 0
  let drawCalls = 0
  let skinnedCharacters = 0
  let activeAnimationMixers = 0
  let shadowCastingLights = 0
  let localLights = 0
  let particleEmitters = 0
  let blendedTransparentDraws = 0
  let shadowCastingMeshes = 0
  let staticCollisionBodies = 0

  for (const state of states) {
    const cost = effectiveCost(state)
    visibleTriangles += cost.triangles
    skinnedCharacters += cost.skinnedCharacters
    activeAnimationMixers += cost.animationMixers
    shadowCastingLights += cost.shadowLights
    localLights += cost.localLights
    particleEmitters += cost.particleEmitters
    blendedTransparentDraws += cost.transparentDraws
    shadowCastingMeshes += cost.shadowCasters
    staticCollisionBodies += cost.collisionBodies
    for (const textureSetId of cost.textureSetIds) textureSets.add(textureSetId)

    const group = state.candidate.instanceGroup
    if (group === undefined) {
      drawCalls += cost.drawCalls
    } else {
      const key = `${group}|${stateSignature(state)}`
      if (!drawCallGroups.has(key)) {
        drawCallGroups.add(key)
        drawCalls += cost.drawCalls
      }
    }
  }

  let decodedTextureBytes = 0
  for (const textureSetId of textureSets) {
    const bytes = textureSetBytes[textureSetId]
    if (bytes === undefined) {
      decodedTextureBytes = Number.POSITIVE_INFINITY
      break
    }
    decodedTextureBytes += bytes
  }

  return {
    visibleTriangles,
    drawCalls,
    decodedTextureBytes,
    skinnedCharacters,
    activeAnimationMixers,
    shadowCastingLights,
    localLights,
    particleEmitters,
    blendedTransparentDraws,
    shadowCastingMeshes,
    staticCollisionBodies,
    activePhysicsBodies: 0,
  }
}

function stateSignature(state: MutableCandidateState): string {
  return [
    state.resolution,
    state.lodIndex,
    state.animationSuspended ? 1 : 0,
    state.emissiveOnly ? 1 : 0,
    state.particlesDisabled ? 1 : 0,
    state.opaqueFallback ? 1 : 0,
    state.shadowsDisabled ? 1 : 0,
  ].join(':')
}

function collectInstancedGroups(states: readonly MutableCandidateState[]): string[] {
  const counts = new Map<string, number>()
  for (const state of states) {
    const group = state.candidate.instanceGroup
    if (group === undefined) continue
    const key = `${group}|${stateSignature(state)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const groups = new Set<string>()
  for (const state of states) {
    const group = state.candidate.instanceGroup
    if (group === undefined) continue
    const key = `${group}|${stateSignature(state)}`
    if ((counts.get(key) ?? 0) > 1) groups.add(group)
  }
  return [...groups].sort()
}

function toPlanItem(state: MutableCandidateState): RenderPlanItem {
  return {
    id: state.candidate.id,
    resolution: state.resolution,
    ...(state.resolution === 'lod' ? { lodIndex: state.lodIndex } : {}),
    animationSuspended: state.animationSuspended,
    emissiveOnly: state.emissiveOnly,
    particlesDisabled: state.particlesDisabled,
    opaqueFallback: state.opaqueFallback,
    shadowsDisabled: state.shadowsDisabled,
    ...(state.candidate.instanceGroup === undefined
      ? {}
      : { instanceGroup: state.candidate.instanceGroup }),
  }
}

export function isWithinRenderBudget(usage: RenderBudgetUsage, budget: RenderBudget): boolean {
  return usage.visibleTriangles <= budget.visibleTriangles
    && usage.drawCalls <= budget.drawCalls
    && usage.decodedTextureBytes <= budget.decodedTextureBytes
    && usage.skinnedCharacters <= budget.skinnedCharacters
    && usage.activeAnimationMixers <= budget.activeAnimationMixers
    && usage.shadowCastingLights <= budget.shadowCastingLights
    && usage.localLights <= budget.localLights
    && usage.particleEmitters <= budget.particleEmitters
    && usage.blendedTransparentDraws <= budget.blendedTransparentDraws
    && usage.shadowCastingMeshes <= budget.shadowCastingMeshes
    && usage.staticCollisionBodies <= budget.staticCollisionBodies
    && usage.activePhysicsBodies <= budget.activePhysicsBodies
}

function assertPlannerInputs(
  candidates: readonly RenderBudgetCandidate[],
  textureSetBytes: TextureSetByteCatalog,
  budget: RenderBudget,
): void {
  assertFiniteNonNegativeRecord(budget, 'invalid-render-budget')
  assertFiniteNonNegativeRecord(textureSetBytes, 'invalid-texture-budget')

  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.id === '' || ids.has(candidate.id)) throw new Error('invalid-render-candidate-id')
    ids.add(candidate.id)
    if (!Number.isFinite(candidate.distanceSquared) || candidate.distanceSquared < 0) {
      throw new Error('invalid-render-candidate-distance')
    }
    assertRenderCost(candidate.exactCost)
    for (const cost of candidate.lodCosts ?? []) assertRenderCost(cost)
    if (candidate.staticHumanoidCost !== undefined) assertRenderCost(candidate.staticHumanoidCost)
    if (candidate.productionFallbackCost !== undefined) assertRenderCost(candidate.productionFallbackCost)
  }
}

function assertRenderCost(cost: RenderCost): void {
  for (const value of Object.values(cost)) {
    if (Array.isArray(value)) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('invalid-render-cost')
    }
  }
  if (cost.textureSetIds.some((id) => id === '')) throw new Error('invalid-render-cost')
}

function assertFiniteNonNegativeRecord(
  values: Readonly<Record<string, number>>,
  errorCode: string,
): void {
  for (const value of Object.values(values)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(errorCode)
  }
}
