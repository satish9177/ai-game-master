import { affordanceFor, type Affordance } from '../interactions/affordance'
import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'

export type { Affordance } from '../interactions/affordance'

/**
 * Interaction view-model (ADR-0002, BOUNDARIES.md).
 *
 * A neutral, framework-free description of a nearby interactable thing: derived
 * from RoomSpec by the engine (producer) and rendered by the React UI
 * (consumer). It lives here — not in the engine or the UI — so neither layer
 * imports the other's internals; both depend only on this contract.
 *
 * Domain-pure: no Three.js, no React. `position` is a plain vector, not a
 * THREE.Vector3.
 */
export type Interactable = {
  id?: string
  type: string
  label: string
  affordance: Affordance
  key: 'E' | 'F'
  prompt: string
  title?: string
  body?: string
  /** World position on the floor plane; used by the engine for proximity. */
  position: { x: number; y: number; z: number }
}

export function affordanceForInteractableObject(object: RoomObject): Affordance | undefined {
  const interaction = 'interaction' in object ? object.interaction : undefined
  return interaction ? affordanceFor(interaction, object.type) : undefined
}

export function buildInteractables(room: LoadedRoom): Interactable[] {
  const interactables: Interactable[] = []

  // `interaction` is required on scroll/npc and optional on other supported
  // objects, so read it as a value rather than trusting the key's presence.
  for (const o of room.objects) {
    const interaction = 'interaction' in o ? o.interaction : undefined
    if (!interaction) continue
    const affordance = affordanceForInteractableObject(o)
    interactables.push({
      id: 'id' in o ? o.id : undefined,
      type: o.type,
      label: 'name' in o && o.name ? o.name : o.type,
      affordance: affordance ?? 'inspect',
      key: interaction.key,
      prompt: interaction.prompt,
      title: interaction.title,
      body: interaction.body,
      position: { x: o.position[0], y: o.position[1], z: o.position[2] },
    })
  }

  return interactables
}
