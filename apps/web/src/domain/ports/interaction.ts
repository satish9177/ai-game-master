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
  key: 'E' | 'F'
  prompt: string
  title?: string
  body?: string
  /** World position on the floor plane; used by the engine for proximity. */
  position: { x: number; y: number; z: number }
}
