import type { Interactable } from '../../domain/ports/interaction'
import { AFFORDANCE_LABEL } from '../../domain/interactions/affordance'

/**
 * Bottom-centered prompt for the nearest interactable, e.g. "Press E to read
 * the scroll". Purely presentational and non-interactive (pointer-events off)
 * so drag-look passes through to the canvas underneath.
 */
export function Hud({ active }: { active: Interactable | null }) {
  if (!active) return null
  return (
    <div className="hud" aria-live="polite">
      <span className="hud-key">{active.key}</span>
      <span className="hud-affordance">{AFFORDANCE_LABEL[active.affordance]}</span>
      <span className="hud-prompt">{active.prompt}</span>
    </div>
  )
}
