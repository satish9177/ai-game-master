import type { Interactable } from '../../domain/ports/interaction'
import { AFFORDANCE_LABEL } from '../../domain/interactions/affordance'

/**
 * Bottom-centered prompt for the nearest interactable, e.g. "Press E to read
 * the scroll". Purely presentational and non-interactive (pointer-events off)
 * so drag-look passes through to the canvas underneath.
 */
export function Hud({ active }: { active: Interactable | null }) {
  if (!active) return null
  const resolved = active.resolved === true
  const className = `hud hud--affordance-${active.affordance}${resolved ? ' hud--resolved' : ''}`
  return (
    <div
      className={className}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="hud-key">{active.key}</span>
      <span className="hud-affordance">{AFFORDANCE_LABEL[active.affordance]}</span>
      {resolved && (
        <span className="hud-resolved" aria-label="Already resolved">Resolved</span>
      )}
      <span className="hud-prompt">{active.prompt}</span>
    </div>
  )
}
