import { describe, expect, it } from 'vitest'
import {
  ACCESSORY_PROFILES,
  ARCHITECTURE_KINDS,
  BODY_PRESENTATIONS,
  CLUTTER_KINDS,
  ENVIRONMENT_KINDS,
  FURNITURE_KINDS,
  HUMANOID_PALETTE_IDS,
  HUMANOID_PRESET_IDS,
  HumanoidAppearanceSchema,
  INFECTION_PROFILES,
  LIGHT_FIXTURE_KINDS,
  OBJECT_CONDITIONS,
  OBJECT_INTERACTION_STATES,
  SemanticVariantSchemas,
  VEGETATION_KINDS,
} from './contracts'

describe('closed visual semantic contracts', () => {
  it('exposes exactly the seven approved environment kinds', () => {
    expect(ENVIRONMENT_KINDS).toEqual([
      'village',
      'tavern',
      'palace',
      'ruins',
      'forest-edge',
      'crypt',
      'dungeon',
    ])
  })

  it('keeps static conditions and dynamic interaction states separate', () => {
    expect(OBJECT_CONDITIONS).toEqual([
      'intact',
      'weathered',
      'damaged',
      'burned',
      'overgrown',
    ])
    expect(OBJECT_INTERACTION_STATES).toEqual([
      'none',
      'closed',
      'open',
      'locked',
      'looted',
      'read',
      'activated',
    ])
  })

  it('exposes the complete approved semantic family vocabularies', () => {
    expect(ARCHITECTURE_KINDS).toHaveLength(18)
    expect(FURNITURE_KINDS).toHaveLength(11)
    expect(CLUTTER_KINDS).toHaveLength(19)
    expect(VEGETATION_KINDS).toHaveLength(9)
    expect(LIGHT_FIXTURE_KINDS).toHaveLength(6)
    expect(new Set([
      ...ARCHITECTURE_KINDS,
      ...FURNITURE_KINDS,
      ...CLUTTER_KINDS,
      ...VEGETATION_KINDS,
      ...LIGHT_FIXTURE_KINDS,
    ]).size).toBeGreaterThan(50)
  })

  it('keeps humanoid selection semantic and modular', () => {
    expect(HUMANOID_PRESET_IDS).toEqual([
      'human-commoner',
      'guard',
      'villager',
      'merchant',
      'noble',
      'servant',
      'wanderer',
      'raider',
      'zombie',
      'humanoid-monster',
    ])
    expect(BODY_PRESENTATIONS).toEqual(['masculine', 'feminine', 'neutral'])
    expect(HUMANOID_PALETTE_IDS).toContain('undead')
    expect(INFECTION_PROFILES).toEqual(['none', 'early', 'advanced'])
    expect(ACCESSORY_PROFILES).toContain('survivor')
  })

  it('accepts a complete closed humanoid appearance', () => {
    expect(HumanoidAppearanceSchema.parse({
      preset: 'raider',
      presentation: 'feminine',
      palette: 'raider',
      infection: 'early',
      accessories: 'survivor',
    })).toEqual({
      preset: 'raider',
      presentation: 'feminine',
      palette: 'raider',
      infection: 'early',
      accessories: 'survivor',
    })
  })

  it.each([
    { preset: 'dragon' },
    { preset: 'guard', presentation: 'armoured' },
    { preset: 'guard', palette: 'javascript:alert(1)' },
    { preset: 'guard', infection: 'execute-code' },
    { preset: 'guard', accessories: '../models/guard.glb' },
    { preset: 'guard', modelPath: '/models/guard.glb' },
    { preset: 'guard', animationClip: 'custom-script' },
  ])('rejects unsafe or open-ended appearance input %#', (appearance) => {
    expect(HumanoidAppearanceSchema.safeParse(appearance).success).toBe(false)
  })

  it('keeps every legacy variant schema closed', () => {
    for (const schema of Object.values(SemanticVariantSchemas)) {
      expect(schema.safeParse('../asset.glb').success).toBe(false)
      expect(schema.safeParse('renderer:execute').success).toBe(false)
    }
  })
})
