import { describe, expect, it } from 'vitest'
import type { VisualPackRegistry } from './contracts'
import {
  resolveVisualAsset,
  resolveVisualAssetCandidates,
  semanticMappingKey,
} from './resolveVisualAsset'
import { ruinedKingdomPack } from './ruinedKingdomPack'

describe('resolveVisualAsset', () => {
  it('resolves an exact closed semantic variant', () => {
    const resolved = resolveVisualAsset(ruinedKingdomPack, {
      semanticKey: 'object.chest.footlocker',
      family: 'container',
      environmentKind: 'tavern',
    })
    expect(resolved).toMatchObject({
      assetId: 'object.chest.footlocker',
      tier: 'exact',
    })
  })

  it('prefers an environment-scoped exact architecture module', () => {
    const resolved = resolveVisualAsset(ruinedKingdomPack, {
      semanticKey: 'architecture.wall-ruined',
      family: 'architecture',
      environmentKind: 'crypt',
    })
    expect(resolved).toMatchObject({
      assetId: 'architecture.crypt.wall-ruined',
      tier: 'exact',
    })
  })

  it('returns the required family, environment, and neutral load chain', () => {
    const candidates = resolveVisualAssetCandidates(ruinedKingdomPack, {
      semanticKey: 'unmapped.safe-concept',
      family: 'architecture',
      environmentKind: 'crypt',
    })
    expect(candidates.map(({ tier }) => tier)).toEqual([
      'family',
      'environment',
      'neutral',
    ])
    expect(candidates[1]?.assetId).toBe('environment.crypt.architecture')
  })

  it('prefers exact condition-and-state mappings deterministically', () => {
    const key = semanticMappingKey('object.chest.footlocker', 'burned', 'looted')
    const registry: VisualPackRegistry = {
      ...ruinedKingdomPack,
      exactMappings: {
        ...ruinedKingdomPack.exactMappings,
        [key]: 'object.chest.coffer',
      },
    }
    const resolved = resolveVisualAsset(registry, {
      semanticKey: 'object.chest.footlocker',
      family: 'container',
      condition: 'burned',
      interactionState: 'looted',
    })
    expect(resolved.assetId).toBe('object.chest.coffer')
  })

  it('never includes debug fallback unless trusted application configuration enables it', () => {
    const debugAsset = 'object.debris.rubble'
    const registry: VisualPackRegistry = {
      ...ruinedKingdomPack,
      debugDefaults: { clutter: debugAsset },
    }
    const request = { semanticKey: 'missing', family: 'clutter' } as const

    expect(resolveVisualAssetCandidates(registry, request).map(({ tier }) => tier))
      .not.toContain('debug')
    expect(
      resolveVisualAssetCandidates(registry, request, { allowDebug: true })
        .map(({ tier }) => tier),
    ).toContain('debug')
  })

  it('deduplicates an asset reused at more than one fallback tier', () => {
    const familyAsset = ruinedKingdomPack.familyDefaults.document
    const registry: VisualPackRegistry = {
      ...ruinedKingdomPack,
      environmentDefaults: {
        ...ruinedKingdomPack.environmentDefaults,
        tavern: {
          ...ruinedKingdomPack.environmentDefaults.tavern,
          document: familyAsset,
        },
      },
      neutralDefaults: {
        ...ruinedKingdomPack.neutralDefaults,
        document: familyAsset,
      },
    }
    const candidates = resolveVisualAssetCandidates(registry, {
      semanticKey: 'missing',
      family: 'document',
      environmentKind: 'tavern',
    })
    expect(candidates.filter(({ assetId }) => assetId === familyAsset)).toHaveLength(1)
  })
})
