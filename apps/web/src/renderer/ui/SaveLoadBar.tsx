/**
 * Presentational save/load control (session-save-load-v0).
 * Props in, callbacks out. No store, service, or localStorage access.
 */

export type SaveLoadStatus = 'idle' | 'saving' | 'saved' | 'loading' | 'error'

export type SaveLoadBarProps = {
  /** Save is enabled only when an active session exists. */
  canSave: boolean
  /** Continue is shown/enabled only when a slot is present. */
  hasSave: boolean
  status: SaveLoadStatus
  errorMessage?: string | null
  onSave: () => void
  onContinue: () => void
}

export function SaveLoadBar({
  canSave,
  hasSave,
  status,
  errorMessage,
  onSave,
  onContinue,
}: SaveLoadBarProps) {
  const busy = status === 'saving' || status === 'loading'

  let saveLabel = 'Save'
  if (status === 'saving') saveLabel = 'Saving…'
  else if (status === 'saved') saveLabel = 'Saved'

  return (
    <div className="save-load-bar">
      <div className="save-load-bar-actions">
        <button
          type="button"
          className="save-load-bar-btn"
          onClick={onSave}
          disabled={!canSave || busy}
        >
          {saveLabel}
        </button>
        {hasSave && (
          <button
            type="button"
            className="save-load-bar-btn"
            onClick={onContinue}
            disabled={busy}
          >
            {status === 'loading' ? 'Loading…' : 'Continue'}
          </button>
        )}
      </div>
      {hasSave && (
        <p className="save-load-bar-copy">
          Loading replaces your current unsaved progress.
        </p>
      )}
      {status === 'error' && errorMessage && (
        <p className="save-load-bar-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
