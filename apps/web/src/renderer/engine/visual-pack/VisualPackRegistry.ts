import {
  ANIMATION_INTENTS,
  VISUAL_FAMILY_IDS,
  type CollisionProfile,
  type RenderCost,
  type VisualAssetDescriptor,
  type VisualFamilyId,
  type VisualPackRegistry,
} from './contracts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PACK_URL_PREFIX = '/visual-packs/ruined-kingdom-survival/'

export type VisualPackRegistryErrorCode =
  | 'invalid-pack-id'
  | 'invalid-bundle'
  | 'invalid-asset'
  | 'invalid-mapping'
  | 'invalid-default'
  | 'invalid-humanoid-preset'
  | 'invalid-animation-clip'

/** Fixed-code error: it deliberately carries no URL, node, or generated content. */
export class VisualPackRegistryError extends Error {
  readonly code: VisualPackRegistryErrorCode

  constructor(code: VisualPackRegistryErrorCode) {
    super('visual pack registry validation failed: ' + code)
    this.name = 'VisualPackRegistryError'
    this.code = code
  }
}

export function validateVisualPackRegistry(registry: VisualPackRegistry): VisualPackRegistry {
  if (registry.id !== 'ruined-kingdom-survival' || registry.version !== 1) {
    throw new VisualPackRegistryError('invalid-pack-id')
  }

  for (const [bundleId, url] of Object.entries(registry.bundles)) {
    if (!isSafeId(bundleId) || !isTrustedBundleUrl(url)) {
      throw new VisualPackRegistryError('invalid-bundle')
    }
  }

  for (const [assetId, descriptor] of Object.entries(registry.assets)) {
    if (!isSafeId(assetId) || !isValidDescriptor(descriptor, registry)) {
      throw new VisualPackRegistryError('invalid-asset')
    }
  }

  for (const assetId of Object.values(registry.exactMappings)) {
    if (!registry.assets[assetId]) throw new VisualPackRegistryError('invalid-mapping')
  }

  for (const family of VISUAL_FAMILY_IDS) {
    assertFamilyDefault(registry, family, registry.familyDefaults[family])
    assertFamilyDefault(registry, family, registry.neutralDefaults[family])
  }

  for (const defaults of Object.values(registry.environmentDefaults)) {
    for (const [family, assetId] of Object.entries(defaults)) {
      if (!assetId || !VISUAL_FAMILY_IDS.includes(family as VisualFamilyId)) {
        throw new VisualPackRegistryError('invalid-default')
      }
      assertFamilyDefault(registry, family as VisualFamilyId, assetId)
    }
  }

  for (const [family, assetId] of Object.entries(registry.debugDefaults)) {
    if (!assetId || !VISUAL_FAMILY_IDS.includes(family as VisualFamilyId)) {
      throw new VisualPackRegistryError('invalid-default')
    }
    assertFamilyDefault(registry, family as VisualFamilyId, assetId)
  }

  for (const preset of Object.values(registry.humanoidPresets)) {
    const pools = [
      preset.bodyPool,
      preset.headPool,
      preset.hairPool,
      preset.outfitPool,
      preset.armourPool,
    ]
    if (pools.some((pool) => pool.length === 0 || pool.some((id) => !isSafeId(id)))) {
      throw new VisualPackRegistryError('invalid-humanoid-preset')
    }
  }

  for (const intent of ANIMATION_INTENTS) {
    if (!isSafeId(registry.animationClips[intent])) {
      throw new VisualPackRegistryError('invalid-animation-clip')
    }
  }

  return registry
}

function isValidDescriptor(
  descriptor: VisualAssetDescriptor,
  registry: VisualPackRegistry,
): boolean {
  return Boolean(registry.bundles[descriptor.bundleId])
    && isSafeId(descriptor.nodeName)
    && VISUAL_FAMILY_IDS.includes(descriptor.family)
    && descriptor.lodAssetIds.every((assetId) => isSafeId(assetId)
      && registry.assets[assetId]?.family === descriptor.family)
    && isSafeId(descriptor.licenseSourceId)
    && isValidCollision(descriptor.collision)
    && isValidCost(descriptor.cost)
}

function isValidCollision(collision: CollisionProfile): boolean {
  if (collision.kind === 'none') return true
  if (collision.kind === 'circle') return isPositiveFinite(collision.radius)
  return collision.halfExtents.every(isPositiveFinite)
}

function isValidCost(cost: RenderCost): boolean {
  return [
    cost.triangles,
    cost.drawCalls,
    cost.skinnedCharacters,
    cost.animationMixers,
    cost.localLights,
    cost.shadowLights,
    cost.particleEmitters,
    cost.transparentDraws,
    cost.shadowCasters,
    cost.collisionBodies,
  ].every(isNonNegativeFinite) && cost.textureSetIds.every(isSafeId)
}

function assertFamilyDefault(
  registry: VisualPackRegistry,
  family: VisualFamilyId,
  assetId: string,
): void {
  const descriptor = registry.assets[assetId]
  if (!descriptor || descriptor.family !== family) {
    throw new VisualPackRegistryError('invalid-default')
  }
}

function isTrustedBundleUrl(value: string): boolean {
  return value.startsWith(PACK_URL_PREFIX)
    && value.endsWith('.glb')
    && !value.includes('..')
    && !value.includes('\\')
    && !value.includes('?')
    && !value.includes('#')
    && !value.slice(PACK_URL_PREFIX.length).includes('//')
}

function isSafeId(value: string): boolean {
  return SAFE_ID.test(value)
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}
