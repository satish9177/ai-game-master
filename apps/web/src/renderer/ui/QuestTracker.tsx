import { useEffect, useRef, useState } from 'react'
import type { QuestView } from '../../domain/quests/evaluateQuest'

export function QuestTracker({ view }: { view: QuestView }) {
  const previousObjectivesRef = useRef(view.objectives)
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  useEffect(() => {
    const previousDoneById = new Map(previousObjectivesRef.current.map((obj) => [obj.id, obj.done]))
    const completedIds = view.objectives
      .filter((obj) => obj.done && previousDoneById.get(obj.id) === false)
      .map((obj) => obj.id)

    previousObjectivesRef.current = view.objectives

    if (completedIds.length === 0) {
      return
    }

    setRecentlyCompletedIds(new Set(completedIds))

    const timeoutId = window.setTimeout(() => {
      setRecentlyCompletedIds((current) => {
        const next = new Set(current)
        completedIds.forEach((id) => next.delete(id))
        return next
      })
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [view])

  return (
    <div className="quest-tracker" role="status" aria-live="polite">
      <div className="quest-tracker-title">{view.title}</div>
      <ul className="quest-tracker-objectives">
        {view.objectives.map((obj) => {
          const isCurrent = obj.id === view.activeObjectiveId
          const isRecentlyCompleted = recentlyCompletedIds.has(obj.id)
          const className = [
            'quest-tracker-objective',
            obj.done ? 'quest-tracker-objective--done' : '',
            isCurrent ? 'quest-tracker-objective--current' : '',
            isRecentlyCompleted ? 'quest-tracker-objective--completed-recently' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <li
              key={obj.id}
              className={className}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="quest-tracker-check" aria-hidden="true">
                {obj.done ? '[x]' : '[ ]'}
              </span>
              <span className="quest-tracker-objective-text">{obj.text}</span>
              {isCurrent && (
                <span className="quest-tracker-current-label" aria-label="Current objective">
                  Current
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {view.status === 'complete' && (
        <div className="quest-tracker-complete">
          The Steward&apos;s Toll is complete. The road north is yours.
        </div>
      )}
    </div>
  )
}
