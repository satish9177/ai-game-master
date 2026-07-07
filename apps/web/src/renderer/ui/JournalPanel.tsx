import { useState } from 'react'
import type { JournalView } from '../../domain/journal/projectJournal'

export type JournalPanelProps = {
  view: JournalView
  label?: string
  className?: string
  live?: boolean
}

export function JournalPanel({ view, label = 'Journal', className, live = true }: JournalPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const rootClassName = className ? `journal-panel ${className}` : 'journal-panel'

  return (
    <div className={rootClassName} {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}>
      <button
        type="button"
        className="journal-panel-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {expanded ? '▾' : '▸'} {label} ({view.entries.length})
      </button>
      {expanded && <JournalPanelBody view={view} />}
    </div>
  )
}

// Hookless so it can be rendered directly in tests (e.g. to prove expanded
// content is leak-free) without simulating a click on the stateful toggle.
export function JournalPanelBody({ view }: { view: JournalView }) {
  return (
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
  )
}
