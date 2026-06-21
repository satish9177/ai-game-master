import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

/**
 * The first user-facing input: a controlled text field plus a Generate button
 * that hands a trimmed, non-empty prompt to its parent via `onSubmit`.
 *
 * Purely presentational — it knows nothing about generation, room sources, the
 * renderer, or logging. The composition root decides what a submitted prompt
 * means. Submit is gated on a non-empty trimmed value (and an optional
 * `disabled`), so empty/whitespace prompts can never be sent, by button or by
 * Enter.
 */
export function PromptBar({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (prompt: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const canSubmit = trimmed.length > 0 && !disabled

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault() // no full-page navigation; covers Enter and the button alike
    if (!canSubmit) return
    onSubmit(trimmed) // hand over the trimmed value, never the raw text
  }

  // Keep typed keys inside the field. The engine listens for WASD / E / F on
  // `window` (movement + interaction), so without this, typing a prompt would
  // also drive the player. Stopping keydown prevents the native event from
  // bubbling past the React root to those window listeners. Only keydown is
  // stopped (the event the controls act on); keyup is left to bubble, so a
  // movement key held *before* focusing here can never get stuck down.
  const keepKeysLocal = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation()
  }

  return (
    <form className="prompt-bar" onSubmit={handleSubmit}>
      <input
        className="prompt-bar-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={keepKeysLocal}
        placeholder="Describe a room to generate…"
        aria-label="Room prompt"
        disabled={disabled}
      />
      <button className="prompt-bar-btn" type="submit" disabled={!canSubmit}>
        Generate
      </button>
    </form>
  )
}
