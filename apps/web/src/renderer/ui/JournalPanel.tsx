import { useState } from 'react'
import type { JournalView } from '../../domain/journal/projectJournal'

export function JournalPanel({ view }: { view: JournalView }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="journal-panel" role="status" aria-live="polite">
      <button
        type="button"
        className="journal-panel-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {expanded ? '▾' : '▸'} Journal ({view.entries.length})
      </button>
      {expanded && (
        <div className="journal-panel-body">
          <div className="journal-panel-title">{view.title}</div>
          {view.entries.length === 0 ? (
            <p className="journal-panel-empty">Nothing of consequence yet.</p>
          ) : (
            <ul className="journal-panel-list">
              {view.entries.map((entry) => (
                <li key={entry.id} className="journal-panel-entry">
                  {entry.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
