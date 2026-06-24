import type { QuestView } from '../../domain/quests/evaluateQuest'

export function QuestTracker({ view }: { view: QuestView }) {
  return (
    <div className="quest-tracker" role="status" aria-live="polite">
      <div className="quest-tracker-title">{view.title}</div>
      <ul className="quest-tracker-objectives">
        {view.objectives.map((obj) => (
          <li
            key={obj.id}
            className={`quest-tracker-objective${obj.done ? ' quest-tracker-objective--done' : ''}`}
          >
            <span className="quest-tracker-check" aria-hidden="true">
              {obj.done ? '☑' : '▢'}
            </span>
            <span className="quest-tracker-objective-text">{obj.text}</span>
          </li>
        ))}
      </ul>
      {view.status === 'complete' && (
        <div className="quest-tracker-complete">Complete</div>
      )}
    </div>
  )
}
