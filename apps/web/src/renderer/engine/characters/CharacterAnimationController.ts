import * as THREE from 'three'
import type { HumanoidPresetId } from '../../../domain/visuals/contracts'
import type { Logger } from '../../../platform/logger/Logger'
import type { AnimationIntent } from '../visual-pack/contracts'

const ONE_SHOT_INTENTS = new Set<AnimationIntent>([
  'gesture',
  'inspect',
  'pick-up',
  'hurt',
])

export type CharacterAnimationSignals = Readonly<{
  speed: number
  talking?: boolean
  gesturing?: boolean
  seated?: boolean
  carrying?: boolean
  hurt?: boolean
  zombie?: boolean
}>

export type CharacterAnimationControllerOptions = Readonly<{
  presetId?: HumanoidPresetId
  logger?: Pick<Logger, 'warn'>
  reportedCompatibilityDiagnostics?: Set<string>
}>

export type CompatibleAnimationClipResult = Readonly<{
  clip: THREE.AnimationClip | null
  matchedTrackCount: number
  remappedTrackCount: number
  droppedTrackCount: number
}>

/**
 * One animation policy shared by the player, NPCs, zombies, and compatible
 * bipedal monsters. It consumes renderer/runtime signals only and owns no
 * gameplay or authoritative state.
 */
export class CharacterAnimationController {
  private readonly mixer: THREE.AnimationMixer
  private readonly clipsByName: ReadonlyMap<string, THREE.AnimationClip>
  private activeAction: THREE.AnimationAction | null = null
  private activeIntent: AnimationIntent | null = null
  private queuedOneShot: AnimationIntent | null = null
  private suspended = false
  private disposed = false

  private readonly root: THREE.Object3D
  private readonly clipNames: Readonly<Record<AnimationIntent, string>>
  constructor(
    root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    clipNames: Readonly<Record<AnimationIntent, string>>,
    options: CharacterAnimationControllerOptions = {},
  ) {
    this.root = root
    this.clipNames = clipNames
    this.mixer = new THREE.AnimationMixer(root)
    const compatibleClips = new Map<string, THREE.AnimationClip>()
    for (const sourceClip of clips) {
      const compatible = createCompatibleAnimationClip(root, sourceClip)
      reportCompatibility(sourceClip, compatible, clipNames, options)
      if (compatible.clip) compatibleClips.set(compatible.clip.name, compatible.clip)
    }
    this.clipsByName = compatibleClips
  }

  get currentIntent(): AnimationIntent | null {
    return this.activeIntent
  }

  get animationMixer(): THREE.AnimationMixer {
    return this.mixer
  }

  playOneShot(intent: AnimationIntent): boolean {
    if (this.disposed || !ONE_SHOT_INTENTS.has(intent)) return false
    if (!this.findClip(intent)) return false
    this.queuedOneShot = intent
    return true
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended
  }

  update(deltaSeconds: number, signals: CharacterAnimationSignals): AnimationIntent {
    const requested = this.queuedOneShot
      ?? (signals.hurt ? 'hurt' : selectAnimationIntent(signals))

    if (requested !== this.activeIntent) this.transitionTo(requested)

    if (!this.suspended && deltaSeconds > 0) {
      this.mixer.update(Math.min(deltaSeconds, 0.1))
    }

    if (
      this.queuedOneShot !== null
      && this.activeIntent === this.queuedOneShot
      && this.activeAction !== null
      && !this.activeAction.isRunning()
    ) {
      this.queuedOneShot = null
    }

    return this.activeIntent ?? requested
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.activeAction?.stop()
    this.mixer.stopAllAction()
    for (const clip of this.clipsByName.values()) this.mixer.uncacheClip(clip)
    this.mixer.uncacheRoot(this.root)
    this.activeAction = null
    this.activeIntent = null
    this.queuedOneShot = null
  }

  private transitionTo(intent: AnimationIntent): void {
    const clip = this.findClip(intent)
    if (!clip) {
      this.activeIntent = intent
      this.activeAction?.fadeOut(0.15)
      this.activeAction = null
      return
    }

    const previous = this.activeAction
    const next = this.mixer.clipAction(clip)
    next.reset()
    next.enabled = true
    next.clampWhenFinished = ONE_SHOT_INTENTS.has(intent)
    if (ONE_SHOT_INTENTS.has(intent)) next.setLoop(THREE.LoopOnce, 1)
    else next.setLoop(THREE.LoopRepeat, Infinity)
    next.fadeIn(0.15).play()
    previous?.fadeOut(0.15)

    this.activeAction = next
    this.activeIntent = intent
  }

  private findClip(intent: AnimationIntent): THREE.AnimationClip | undefined {
    const exact = this.clipsByName.get(this.clipNames[intent])
    if (exact) return exact

    const fallbackIntent = fallbackAnimationIntent(intent)
    if (fallbackIntent !== intent) {
      const fallback = this.clipsByName.get(this.clipNames[fallbackIntent])
      if (fallback) return fallback
    }
    return this.clipsByName.get(this.clipNames.idle)
  }
}

/**
 * Produces a clip that can bind only to nodes in the reviewed target rig.
 * Resolution is deliberately closed: exact node name, then a unique Three.js
 * sanitized-name match. Unresolved tracks are excluded before AnimationAction
 * construction; no fuzzy or generated mapping is accepted.
 */
export function createCompatibleAnimationClip(
  root: THREE.Object3D,
  source: THREE.AnimationClip,
): CompatibleAnimationClipResult {
  const exactNames = new Set<string>()
  const sanitizedNames = new Map<string, string | null>()
  root.traverse((node) => {
    if (node.name.length === 0) return
    exactNames.add(node.name)
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(node.name)
    const existing = sanitizedNames.get(sanitized)
    sanitizedNames.set(sanitized, existing === undefined || existing === node.name
      ? node.name
      : null)
  })

  const tracks: THREE.KeyframeTrack[] = []
  let remappedTrackCount = 0
  for (const sourceTrack of source.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(sourceTrack.name)
    if (parsed.nodeName === undefined) {
      tracks.push(sourceTrack.clone())
      continue
    }
    if (exactNames.has(parsed.nodeName)) {
      tracks.push(sourceTrack.clone())
      continue
    }

    const sanitized = THREE.PropertyBinding.sanitizeNodeName(parsed.nodeName)
    const resolvedName = sanitizedNames.get(sanitized)
    const remapped = resolvedName === undefined || resolvedName === null
      ? null
      : remapTrackNode(sourceTrack, parsed, resolvedName)
    if (remapped) {
      tracks.push(remapped)
      remappedTrackCount += 1
    }
  }

  const droppedTrackCount = source.tracks.length - tracks.length
  const clip = source.tracks.length > 0 && tracks.length === 0
    ? null
    : new THREE.AnimationClip(source.name, source.duration, tracks, source.blendMode)
  return {
    clip,
    matchedTrackCount: tracks.length,
    remappedTrackCount,
    droppedTrackCount,
  }
}

function remapTrackNode(
  source: THREE.KeyframeTrack,
  parsed: ReturnType<typeof THREE.PropertyBinding.parseTrackName>,
  resolvedName: string,
): THREE.KeyframeTrack | null {
  if (parsed.objectName !== undefined) return null
  const propertyMarker = '.' + parsed.propertyName
  const propertyOffset = source.name.lastIndexOf(propertyMarker)
  if (propertyOffset < 0) return null
  const track = source.clone()
  track.name = resolvedName + source.name.slice(propertyOffset)
  return track
}

function reportCompatibility(
  source: THREE.AnimationClip,
  compatible: CompatibleAnimationClipResult,
  clipNames: Readonly<Record<AnimationIntent, string>>,
  options: CharacterAnimationControllerOptions,
): void {
  if (
    options.presetId === undefined
    || options.logger === undefined
    || (compatible.remappedTrackCount === 0 && compatible.droppedTrackCount === 0)
  ) {
    return
  }

  const registeredClipIds = new Set(Object.values(clipNames))
  const clipId = registeredClipIds.has(source.name) ? source.name : 'unregistered'
  const key = options.presetId + ':' + clipId
  const reported = options.reportedCompatibilityDiagnostics
  if (reported?.has(key)) return
  reported?.add(key)
  options.logger.warn('character animation compatibility', {
    code: compatible.droppedTrackCount > 0
      ? 'animation-tracks-dropped'
      : 'animation-tracks-remapped',
    presetId: options.presetId,
    clipId,
    matchedTrackCount: compatible.matchedTrackCount,
    droppedTrackCount: compatible.droppedTrackCount,
  })
}

export function selectAnimationIntent(signals: CharacterAnimationSignals): AnimationIntent {
  if (signals.hurt) return 'hurt'
  if (signals.talking && signals.gesturing) return 'gesture'
  if (signals.talking) return 'talk'
  if (signals.carrying) return 'carry'
  if (signals.zombie) return signals.speed > 0.05 ? 'zombie-walk' : 'zombie-idle'
  if (signals.speed >= 2.2) return 'run'
  if (signals.speed > 0.05) return 'walk'
  if (signals.seated) return 'sit'
  return 'idle'
}

function fallbackAnimationIntent(intent: AnimationIntent): AnimationIntent {
  switch (intent) {
    case 'zombie-idle':
      return 'idle'
    case 'zombie-walk':
      return 'walk'
    case 'run':
      return 'walk'
    case 'talk':
    case 'gesture':
    case 'inspect':
    case 'pick-up':
    case 'carry':
    case 'hurt':
      return 'idle'
    case 'sit':
    case 'walk':
    case 'idle':
      return intent
  }
}
