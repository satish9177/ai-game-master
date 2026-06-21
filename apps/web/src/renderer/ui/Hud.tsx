import type { Interactable } from '../../domain/ports/interaction'

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
      <span className="hud-prompt">{active.prompt}</span>
    </div>
  )
}
