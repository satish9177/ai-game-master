import { useEffect } from 'react'
import type { NPCDialoguePrompt, NPCDialogueTurn } from '../../domain/dialogue/contracts'

export function NPCDialoguePanel({
  npcName,
  turns,
  prompts,
  message,
  busy = false,
  onSay,
  onClose,
}: {
  npcName: string
  turns: NPCDialogueTurn[]
  prompts?: NPCDialoguePrompt[]
  message?: string
  busy?: boolean
  onSay: (promptId: string | undefined) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasPrompts = prompts !== undefined && prompts.length > 0

  return (
    <div className="panel-backdrop" onPointerDown={onClose}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Conversation with ${npcName}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="panel-head">
          <h2 className="panel-title">{npcName}</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ol className="panel-body panel-turns" aria-live="polite">
          {turns.map((turn, index) => (
            <li key={`${turn.speaker}-${index}`}>
              <strong>{turn.speaker === 'player' ? 'You' : npcName}:</strong>{' '}
              {turn.text}
            </li>
          ))}
        </ol>
        <div className="panel-choices">
          {hasPrompts ? prompts.map((prompt) => (
            <button
              key={prompt.id}
              className="panel-btn"
              disabled={busy}
              onClick={() => onSay(prompt.id)}
            >
              {prompt.label}
            </button>
          )) : (
            <button className="panel-btn" disabled={busy} onClick={() => onSay(undefined)}>
              Continue
            </button>
          )}
        </div>
        {message && <p className="panel-result">{message}</p>}
        <div className="panel-foot">
          <button className="panel-btn" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
