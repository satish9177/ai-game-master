import { useEffect } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { NPCDialoguePrompt, NPCDialogueTurn } from '../../domain/dialogue/contracts'
import {
  MAX_PLAYER_FREE_TEXT_CHARS,
  normalizePlayerFreeText,
} from '../../domain/dialogue/playerFreeText'

const PERSONA_ROLE_LABELS: Readonly<Record<string, string>> = {
  'friendly-aide': 'Ally',
  'generated-room-guide': 'Room Guide',
  'generated-calm-witness': 'Witness',
  'generated-keep-warden': 'Keep Warden',
  'generated-archive-aide': 'Archive Aide',
  'generated-wasteland-scout': 'Wasteland Scout',
  'generated-shelter-watch': 'Shelter Watch',
  guide: 'Guide',
  survivor: 'Survivor',
}

export function NPCDialoguePanel({
  npcName,
  persona,
  turns,
  prompts,
  message,
  busy = false,
  onSay,
  onClose,
}: {
  npcName: string
  persona?: string
  turns: NPCDialogueTurn[]
  prompts?: NPCDialoguePrompt[]
  message?: string
  busy?: boolean
  onSay: (promptId: string | undefined, playerLine?: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasPrompts = prompts !== undefined && prompts.length > 0
  const roleLabel = persona !== undefined ? PERSONA_ROLE_LABELS[persona] : undefined
  const keepKeysLocal = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.code === 'Escape') return
    event.stopPropagation()
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const field = event.currentTarget.elements.namedItem('playerLine')
    const rawText = field !== null && 'value' in field && typeof field.value === 'string'
      ? field.value
      : ''
    const playerLine = normalizePlayerFreeText(rawText)
    if (playerLine === null) return
    onSay(undefined, playerLine)
    event.currentTarget.reset()
  }

  return (
    <div className="panel-backdrop" onPointerDown={onClose}>
      <div
        className="panel npc-dialogue-panel"
        data-panel-kind="conversation"
        role="dialog"
        aria-modal="true"
        aria-label={`Conversation with ${npcName}`}
        aria-busy={busy}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{npcName}</h2>
            {roleLabel && <p className="npc-dialogue-subtitle">{roleLabel}</p>}
          </div>
          <button className="panel-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ol className="panel-body panel-turns npc-dialogue-turns" aria-live="polite">
          {turns.map((turn, index) => (
            <li
              className="npc-dialogue-turn"
              data-speaker={turn.speaker}
              key={`${turn.speaker}-${index}`}
            >
              <strong className="npc-dialogue-speaker">
                {turn.speaker === 'player' ? 'Player' : npcName}
              </strong>
              <span className="npc-dialogue-text">{turn.text}</span>
            </li>
          ))}
        </ol>
        {busy && (
          <p className="npc-dialogue-busy" role="status" aria-live="polite">
            responding...
          </p>
        )}
        <div className="panel-choices npc-dialogue-choices">
          {hasPrompts ? prompts.map((prompt) => (
            <button
              key={prompt.id}
              className="panel-btn"
              type="button"
              disabled={busy}
              onClick={() => onSay(prompt.id)}
            >
              {prompt.label}
            </button>
          )) : (
            <div className="npc-dialogue-empty">
              <p className="npc-dialogue-empty-copy">
                No authored prompts remain. Continue the conversation.
              </p>
              <button
                className="panel-btn"
                type="button"
                disabled={busy}
                onClick={() => onSay(undefined)}
              >
                Continue
              </button>
            </div>
          )}
        </div>
        <form className="npc-dialogue-input-row" onSubmit={handleSubmit}>
          <input
            className="npc-dialogue-input"
            type="text"
            name="playerLine"
            maxLength={MAX_PLAYER_FREE_TEXT_CHARS}
            placeholder="Say something..."
            aria-label="Say something"
            disabled={busy}
            onKeyDown={keepKeysLocal}
          />
          <button className="panel-btn npc-dialogue-send" type="submit" disabled={busy}>
            Send
          </button>
        </form>
        {message && <p className="panel-result npc-dialogue-message">{message}</p>}
        <div className="panel-foot">
          <button className="panel-btn" type="button" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
