import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import {
  CharacterAnimationController,
  createCompatibleAnimationClip,
  selectAnimationIntent,
} from './CharacterAnimationController'
import { ruinedKingdomPack } from '../visual-pack/ruinedKingdomPack'

describe('selectAnimationIntent', () => {
  it.each([
    [{ speed: 0 }, 'idle'],
    [{ speed: 0.6 }, 'walk'],
    [{ speed: 3 }, 'run'],
    [{ speed: 0, talking: true }, 'talk'],
    [{ speed: 0, talking: true, gesturing: true }, 'gesture'],
    [{ speed: 0, seated: true }, 'sit'],
    [{ speed: 1, carrying: true }, 'carry'],
    [{ speed: 0, hurt: true }, 'hurt'],
    [{ speed: 0, zombie: true }, 'zombie-idle'],
    [{ speed: 0.4, zombie: true }, 'zombie-walk'],
  ] as const)('maps renderer signals %o to %s', (signals, expected) => {
    expect(selectAnimationIntent(signals)).toBe(expected)
  })
})

describe('CharacterAnimationController', () => {
  it('transitions between shared idle, walk, talk, and zombie clips', () => {
    const root = new THREE.Group()
    const controller = new CharacterAnimationController(
      root,
      [
        clip('Idle'),
        clip('Walk'),
        clip('Talk'),
        clip('ZombieIdle'),
        clip('ZombieWalk'),
      ],
      ruinedKingdomPack.animationClips,
    )

    expect(controller.update(0.016, { speed: 0 })).toBe('idle')
    expect(controller.update(0.016, { speed: 0.5 })).toBe('walk')
    expect(controller.update(0.016, { speed: 0, talking: true })).toBe('talk')
    expect(controller.update(0.016, { speed: 0.5, zombie: true })).toBe('zombie-walk')
  })

  it('queues bounded one-shot actions without inventing gameplay triggers', () => {
    const controller = new CharacterAnimationController(
      new THREE.Group(),
      [clip('Idle'), clip('Inspect')],
      ruinedKingdomPack.animationClips,
    )
    expect(controller.playOneShot('inspect')).toBe(true)
    expect(controller.update(0.016, { speed: 0 })).toBe('inspect')
    expect(controller.playOneShot('walk')).toBe(false)
  })

  it('uses documented safe clip fallbacks when an optional clip is absent', () => {
    const controller = new CharacterAnimationController(
      new THREE.Group(),
      [clip('Idle'), clip('Walk')],
      ruinedKingdomPack.animationClips,
    )
    expect(controller.update(0.016, { speed: 3 })).toBe('run')
    expect(controller.update(0.016, { speed: 0, talking: true })).toBe('talk')
  })

  it('can freeze distant mixers and dispose idempotently', () => {
    const controller = new CharacterAnimationController(
      new THREE.Group(),
      [clip('Idle')],
      ruinedKingdomPack.animationClips,
    )
    controller.setSuspended(true)
    controller.update(1, { speed: 0 })
    expect(controller.animationMixer.time).toBe(0)
    controller.setSuspended(false)
    controller.update(0.05, { speed: 0 })
    expect(controller.animationMixer.time).toBeCloseTo(0.05)
    expect(() => {
      controller.dispose()
      controller.dispose()
    }).not.toThrow()
  })

  it('maps every committed animation track onto the committed humanoid joint catalog', async () => {
    const core = await readGlbJson('characters/humanoid-core.glb')
    const skin = core.skins[0]!
    const root = new THREE.Group()
    for (const jointIndex of skin.joints) {
      const bone = new THREE.Bone()
      bone.name = core.nodes[jointIndex]!.name
      root.add(bone)
    }
    const animations = await loadAnimationBundle()

    expect(animations).toHaveLength(12)
    for (const source of animations) {
      const compatible = createCompatibleAnimationClip(root, source)
      expect(compatible.droppedTrackCount, source.name).toBe(0)
      expect(compatible.matchedTrackCount, source.name).toBe(65)
      expect(compatible.clip?.tracks.some((track) => track.name === 'pelvis.quaternion')).toBe(true)
      expect(compatible.clip?.tracks.some((track) => track.name === 'thigh_l.quaternion')).toBe(true)
    }

    const propertyWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const controller = new CharacterAnimationController(
        root,
        animations,
        ruinedKingdomPack.animationClips,
      )
      controller.update(0.016, { speed: 0 })
      controller.update(0.016, { speed: 0.5 })
      expect(propertyWarning).not.toHaveBeenCalled()
      controller.dispose()
    } finally {
      propertyWarning.mockRestore()
    }
  })

  it('uses exact then unique sanitized targets and drops unresolved tracks before binding', () => {
    const root = new THREE.Group()
    const pelvis = new THREE.Bone()
    pelvis.name = 'pelvis'
    const sanitized = new THREE.Bone()
    sanitized.name = 'BoneName'
    root.add(pelvis, sanitized)
    const source = new THREE.AnimationClip('Idle', 1, [
      quaternionTrack('pelvis'),
      quaternionTrack('Bone.Name'),
      quaternionTrack('unsupported-accessory'),
    ])

    const compatible = createCompatibleAnimationClip(root, source)

    expect(compatible).toMatchObject({
      matchedTrackCount: 2,
      remappedTrackCount: 1,
      droppedTrackCount: 1,
    })
    expect(compatible.clip?.tracks.map((track) => track.name)).toEqual([
      'pelvis.quaternion',
      'BoneName.quaternion',
    ])
  })

  it('never creates an action with unresolved tracks and deduplicates safe diagnostics', () => {
    const root = new THREE.Group()
    const pelvis = new THREE.Bone()
    pelvis.name = 'pelvis'
    root.add(pelvis)
    const source = new THREE.AnimationClip('Idle', 1, [
      quaternionTrack('pelvis'),
      quaternionTrack('unsupported-finger'),
    ])
    const warn = vi.fn()
    const reported = new Set<string>()
    const propertyWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (let index = 0; index < 2; index += 1) {
        const controller = new CharacterAnimationController(
          root,
          [source],
          ruinedKingdomPack.animationClips,
          {
            presetId: 'guard',
            logger: { warn },
            reportedCompatibilityDiagnostics: reported,
          },
        )
        controller.update(0.016, { speed: 0 })
        controller.dispose()
      }

      expect(propertyWarning).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith('character animation compatibility', {
        code: 'animation-tracks-dropped',
        presetId: 'guard',
        clipId: 'Idle',
        matchedTrackCount: 1,
        droppedTrackCount: 1,
      })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('unsupported-finger')
    } finally {
      propertyWarning.mockRestore()
    }
  })
})

function clip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, 0.01]),
  ])
}

function quaternionTrack(nodeName: string): THREE.QuaternionKeyframeTrack {
  return new THREE.QuaternionKeyframeTrack(
    nodeName + '.quaternion',
    [0, 1],
    [0, 0, 0, 1, 0, 0, 0, 1],
  )
}

type GlbJson = Readonly<{
  nodes: readonly Readonly<{ name: string }>[]
  skins: readonly Readonly<{ joints: readonly number[] }>[]
}>

async function readGlbJson(relativePath: string): Promise<GlbJson> {
  const bytes = await readFile(resolve(
    process.cwd(),
    'public/visual-packs/ruined-kingdom-survival',
    relativePath,
  ))
  const jsonLength = bytes.readUInt32LE(12)
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim()) as GlbJson
}

async function loadAnimationBundle(): Promise<readonly THREE.AnimationClip[]> {
  const bytes = await readFile(resolve(
    process.cwd(),
    'public/visual-packs/ruined-kingdom-survival/characters/humanoid-animations.glb',
  ))
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return (await new GLTFLoader().parseAsync(arrayBuffer, '')).animations
}
