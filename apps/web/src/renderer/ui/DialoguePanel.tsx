import { useEffect } from 'react'
import type { Interactable } from '../../domain/ports/interaction'

/**
 * Static interact panel for v0. Shows the interactable's title/body (with
 * sensible fallbacks) and closes on the close button or Escape. A full-screen
 * backdrop captures pointer events so drags don't reach the canvas while it's
 * open (input is also locked in the engine).
 *
 * For an encounter (ADR-0015) the composition root passes the threat
 * description through `target.body` plus presentational `choices`; picking one
 * calls `onChoose`. This component stays purely presentational — it never
 * imports world-session/encounters and never mutates state.
 */
export function DialoguePanel({
  target,
  resultMessage,
  choices,
  onChoose,
  onClose,
}: {
  target: Interactable
  resultMessage?: string
  choices?: { id: string; label: string }[]
  onChoose?: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = target.title ?? target.label
  const body = target.body ?? 'There is nothing more to learn here.'

  return (
    <div className="panel-backdrop" onPointerDown={onClose}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="panel-body">{body}</p>
        {choices && choices.length > 0 && onChoose && (
          <div className="panel-choices">
            {choices.map((choice) => (
              <button
                key={choice.id}
                className="panel-btn"
                onClick={() => onChoose(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
        {resultMessage && <p className="panel-result">{resultMessage}</p>}
        <div className="panel-foot">
          <button className="panel-btn" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
