/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENERATED_ROOM_ALIAS_CATALOG } from '../../../domain/generatedRoomAliases'
import {
  ARCHITECTURE_KINDS,
  CLUTTER_KINDS,
  ENVIRONMENT_KINDS,
  FURNITURE_KINDS,
  LIGHT_FIXTURE_KINDS,
  OBJECT_CONDITIONS,
  OBJECT_INTERACTION_STATES,
  VEGETATION_KINDS,
} from '../../../domain/visuals/contracts'
import type { VisualPackRegistry } from './contracts'
import {
  validateVisualPackRegistry,
  VisualPackRegistryError,
} from './VisualPackRegistry'
import { resolveVisualAssetCandidates } from './resolveVisualAsset'
import {
  RUINED_KINGDOM_LEGACY_FAMILY,
  RUINED_KINGDOM_LEGACY_VARIANTS,
  ruinedKingdomPack,
} from './ruinedKingdomPack'

describe('VisualPackRegistry', () => {
  it('accepts the closed ruined kingdom registry', () => {
    expect(validateVisualPackRegistry(ruinedKingdomPack)).toBe(ruinedKingdomPack)
  })

  it.each([
    'https://assets.example/model.glb',
    '//assets.example/model.glb',
    '/visual-packs/ruined-kingdom-survival/../secret.glb',
    '/visual-packs/ruined-kingdom-survival/core/model.glb?remote=true',
    '/visual-packs/ruined-kingdom-survival/core\\model.glb',
  ])('rejects untrusted bundle URL %s', (url) => {
    const invalid = copyRegistry({
      bundles: { ...ruinedKingdomPack.bundles, core: url },
    })
    expectRegistryCode(() => validateVisualPackRegistry(invalid), 'invalid-bundle')
  })

  it('rejects a mapping to an undeclared renderer asset', () => {
    const invalid = copyRegistry({
      exactMappings: { ...ruinedKingdomPack.exactMappings, injected: 'remote.asset' },
    })
    expectRegistryCode(() => validateVisualPackRegistry(invalid), 'invalid-mapping')
  })

  it('rejects a family default whose descriptor belongs to another family', () => {
    const invalid = copyRegistry({
      familyDefaults: {
        ...ruinedKingdomPack.familyDefaults,
        architecture: ruinedKingdomPack.familyDefaults.humanoid,
      },
    })
    expectRegistryCode(() => validateVisualPackRegistry(invalid), 'invalid-default')
  })

  it('rejects negative or non-finite declared render costs', () => {
    const assetId = ruinedKingdomPack.familyDefaults.architecture
    const descriptor = ruinedKingdomPack.assets[assetId]!
    const invalid = copyRegistry({
      assets: {
        ...ruinedKingdomPack.assets,
        [assetId]: {
          ...descriptor,
          cost: { ...descriptor.cost, triangles: -1 },
        },
      },
    })
    expectRegistryCode(() => validateVisualPackRegistry(invalid), 'invalid-asset')
  })

  it('rejects unknown or cross-family LOD asset references', () => {
    const assetId = ruinedKingdomPack.familyDefaults.architecture
    const descriptor = ruinedKingdomPack.assets[assetId]!
    const unknown = copyRegistry({
      assets: {
        ...ruinedKingdomPack.assets,
        [assetId]: { ...descriptor, lodAssetIds: ['missing.lod'] },
      },
    })
    expectRegistryCode(() => validateVisualPackRegistry(unknown), 'invalid-asset')

    const crossFamily = copyRegistry({
      assets: {
        ...ruinedKingdomPack.assets,
        [assetId]: {
          ...descriptor,
          lodAssetIds: [ruinedKingdomPack.neutralDefaults.furniture],
        },
      },
    })
    expectRegistryCode(() => validateVisualPackRegistry(crossFamily), 'invalid-asset')
  })

  it('provides lower-cost production LODs and explicit humanoid animation/static assets', () => {
    const neutralIds = new Set(Object.values(ruinedKingdomPack.neutralDefaults))
    for (const [assetId, descriptor] of Object.entries(ruinedKingdomPack.assets)) {
      for (const lodAssetId of descriptor.lodAssetIds) {
        const lod = ruinedKingdomPack.assets[lodAssetId]
        expect(lod?.family).toBe(descriptor.family)
        expect(lod?.cost.triangles).toBeLessThanOrEqual(descriptor.cost.triangles)
      }
      if (descriptor.family !== 'humanoid' && !neutralIds.has(assetId)) {
        expect(descriptor.lodAssetIds.length).toBeGreaterThan(0)
      }
    }

    expect(ruinedKingdomPack.assets['humanoid.static-lod']).toMatchObject({
      bundleId: 'characters',
      nodeName: 'HumanoidStaticLod',
      family: 'humanoid',
      licenseSourceId: 'UBC',
    })
    expect(ruinedKingdomPack.assets['humanoid.animations']).toMatchObject({
      bundleId: 'animations',
      nodeName: 'AnimationRoot',
      family: 'humanoid',
      licenseSourceId: 'UAL',
      collision: { kind: 'none' },
    })
  })
  it('keeps all bundle locations same-origin and every descriptor licensed', () => {
    for (const url of Object.values(ruinedKingdomPack.bundles)) {
      expect(url).toMatch(/^\/visual-packs\/ruined-kingdom-survival\/.+\.glb$/)
    }
    for (const descriptor of Object.values(ruinedKingdomPack.assets)) {
      expect(Object.values(MANIFEST_BUNDLE_SOURCE_IDS).flat()).toContain(descriptor.licenseSourceId)
      expect(ruinedKingdomPack.bundles[descriptor.bundleId]).toBeDefined()
    }
  })

  it('matches every descriptor license to a source declared for its bundle manifest entry', () => {
    for (const descriptor of Object.values(ruinedKingdomPack.assets)) {
      const allowed = MANIFEST_BUNDLE_SOURCE_IDS[
        descriptor.bundleId as keyof typeof MANIFEST_BUNDLE_SOURCE_IDS
      ]
      if (allowed === undefined) throw new Error('test manifest bundle coverage is incomplete')
      expect(allowed).toContain(descriptor.licenseSourceId)
    }
  })

  it('covers all 24 legacy types and all 100 generated aliases through production fallbacks', () => {
    const canonicalTypes = [
      ...Object.keys(RUINED_KINGDOM_LEGACY_VARIANTS),
      'npc',
      'prop',
      'barricade',
      'zombie',
    ]
    expect(new Set(canonicalTypes).size).toBe(24)
    expect(GENERATED_ROOM_ALIAS_CATALOG).toHaveLength(100)

    for (const { type, variant } of GENERATED_ROOM_ALIAS_CATALOG) {
      const family = RUINED_KINGDOM_LEGACY_FAMILY[
        type as keyof typeof RUINED_KINGDOM_LEGACY_FAMILY
      ]
      expect(family).toBeDefined()
      if (family === undefined) continue

      const semanticKey = 'object.' + type + '.' + variant
      const exactAssetId = ruinedKingdomPack.exactMappings[semanticKey]
      const exactDescriptor = exactAssetId === undefined
        ? undefined
        : ruinedKingdomPack.assets[exactAssetId]
      expect(exactDescriptor?.family).toBe(family)
      expect(exactDescriptor?.collision).toBeDefined()
      expect(exactDescriptor?.licenseSourceId).toBeDefined()

      for (const environmentKind of ENVIRONMENT_KINDS) {
        const candidates = resolveVisualAssetCandidates(ruinedKingdomPack, {
          semanticKey,
          family,
          environmentKind,
        })
        expect(candidates.map(({ tier }) => tier)).toEqual([
          'exact',
          'family',
          'environment',
          'neutral',
        ])
      }

      for (const condition of OBJECT_CONDITIONS) {
        expect(resolveVisualAssetCandidates(ruinedKingdomPack, {
          semanticKey,
          family,
          condition,
        })[0]?.assetId).toBe(exactAssetId)
      }
      for (const interactionState of OBJECT_INTERACTION_STATES) {
        expect(resolveVisualAssetCandidates(ruinedKingdomPack, {
          semanticKey,
          family,
          interactionState,
        })[0]?.assetId).toBe(exactAssetId)
      }
    }

    for (const [type, variants] of Object.entries(RUINED_KINGDOM_LEGACY_VARIANTS)) {
      for (const variant of variants) {
        expect(ruinedKingdomPack.exactMappings['object.' + type + '.' + variant])
          .toBeDefined()
      }
      expect(ruinedKingdomPack.exactMappings['object.' + type]).toBeDefined()
    }
    for (const key of [
      'object.npc',
      'object.zombie',
      'object.prop.box',
      'object.prop.cylinder',
      'object.prop.cone',
      'object.prop.sphere',
      'object.barricade.planks',
      'object.barricade.sandbags',
    ]) {
      expect(ruinedKingdomPack.exactMappings[key]).toBeDefined()
    }
  })

  it('maps every registry descriptor and animation intent to a committed GLB name', () => {
    const documents = new Map<string, ReturnType<typeof parseGlbJson>>()
    for (const [bundleId, bundleUrl] of Object.entries(ruinedKingdomPack.bundles)) {
      const document = parseGlbJson(readFileSync(resolve(process.cwd(), 'public' + bundleUrl)))
      documents.set(bundleId, document)
    }

    for (const descriptor of Object.values(ruinedKingdomPack.assets)) {
      const document = documents.get(descriptor.bundleId)
      expect(document, descriptor.bundleId).toBeDefined()
      expect(
        new Set(document?.nodes?.map((node) => node.name)),
        descriptor.nodeName,
      ).toContain(descriptor.nodeName)
    }

    const animationDocument = documents.get('animations')
    const committedClips = new Set(animationDocument?.animations?.map((clip) => clip.name))
    for (const clipName of Object.values(ruinedKingdomPack.animationClips)) {
      expect(committedClips, clipName).toContain(clipName)
    }
  })
  it('covers every kind in all five additive semantic families', () => {
    for (const { prefix, family, kinds } of SEMANTIC_FAMILY_MATRIX) {
      for (const kind of kinds) {
        const semanticKey = prefix + '.' + kind
        for (const environmentKind of ENVIRONMENT_KINDS) {
          const candidates = resolveVisualAssetCandidates(ruinedKingdomPack, {
            semanticKey,
            family,
            environmentKind,
          })
          const tiers = candidates.map(({ tier }) => tier)
          expect(tiers[0]).toBe('exact')
          expect(tiers.slice(-3)).toEqual([
            'family',
            'environment',
            'neutral',
          ])
          expect(tiers.slice(0, -3).every((tier) => tier === 'exact')).toBe(true)
          expect(candidates[0]?.descriptor.family).toBe(family)
          expect(candidates[0]?.descriptor.collision).toBeDefined()
          expect(candidates[0]?.descriptor.licenseSourceId).toBeDefined()
        }
      }
    }
  })
})

function copyRegistry(
  overrides: Partial<VisualPackRegistry>,
): VisualPackRegistry {
  return { ...ruinedKingdomPack, ...overrides }
}

const MANIFEST_BUNDLE_SOURCE_IDS = {
  core: ['MV', 'FP', 'MD', 'ZA', 'USN'],
  characters: ['UBC', 'FO', 'ZA'],
  animations: ['UAL', 'UAL2'],
  village: ['MV', 'FP'],
  tavern: ['MV', 'FP'],
  palace: ['MV', 'FP'],
  ruins: ['MV', 'MD', 'FP', 'USN'],
  'forest-edge': ['USN'],
  crypt: ['MD', 'FP', 'USN'],
  dungeon: ['MD', 'FP'],
  furniture: ['FP', 'MD', 'MV'],
  containers: ['FP', 'MD', 'MV'],
  clutter: ['FP', 'ZA', 'MD'],
  lighting: ['FP', 'MD', 'MV'],
  vegetation: ['USN', 'MV'],
} as const

const SEMANTIC_FAMILY_MATRIX = [
  {
    prefix: 'architecture',
    family: 'architecture',
    kinds: ARCHITECTURE_KINDS,
  },
  {
    prefix: 'furniture',
    family: 'furniture',
    kinds: FURNITURE_KINDS,
  },
  {
    prefix: 'clutter',
    family: 'clutter',
    kinds: CLUTTER_KINDS,
  },
  {
    prefix: 'vegetation',
    family: 'vegetation',
    kinds: VEGETATION_KINDS,
  },
  {
    prefix: 'lighting',
    family: 'lighting',
    kinds: LIGHT_FIXTURE_KINDS,
  },
] as const

function expectRegistryCode(
  run: () => unknown,
  code: VisualPackRegistryError['code'],
): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(VisualPackRegistryError)
    expect((error as VisualPackRegistryError).code).toBe(code)
    return
  }
  throw new Error('expected registry validation to fail')
}

type GlbJson = {
  nodes?: Array<{ name?: string }>
  animations?: Array<{ name?: string }>
}

function parseGlbJson(buffer: Buffer): GlbJson {
  const jsonLength = buffer.readUInt32LE(12)
  return JSON.parse(
    buffer.subarray(20, 20 + jsonLength).toString('utf8').split(String.fromCharCode(0), 1)[0] ?? '',
  ) as GlbJson
}
