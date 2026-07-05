import type { PlayerHudView } from './playerHud'
import type { WorldClock } from '../../domain/world/worldClock'

const TIME_OF_DAY_LABEL: Record<WorldClock['timeOfDay'], string> = {
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
}

/** Read-only clock line: "Day 1 · 08:00 · Day". Presentational only. */
function formatWorldClock(clock: WorldClock): string {
  const hour = String(clock.hour).padStart(2, '0')
  return `Day ${clock.day} · ${hour}:00 · ${TIME_OF_DAY_LABEL[clock.timeOfDay]}`
}

export function StatusHud({
  view,
  clock = null,
}: {
  view: PlayerHudView
  clock?: WorldClock | null
}) {
  return (
    <div className="status-hud" role="status" aria-live="polite">
      {clock && <div className="status-hud-clock">{formatWorldClock(clock)}</div>}
      <div className="status-hud-health">
        <span className="status-hud-health-label">
          {view.health.current} / {view.health.max}
        </span>
        <div className="status-hud-health-bar-track">
          <div
            className="status-hud-health-bar-fill"
            style={{ width: `${view.health.fraction * 100}%` }}
          />
        </div>
      </div>
      <div className="status-hud-inventory">
        {view.items.length === 0 ? (
          <span className="status-hud-empty">No items</span>
        ) : (
          <ul className="status-hud-item-list">
            {view.items.map((item) => (
              <li key={item.itemId} className="status-hud-item">
                {item.name} ×{item.quantity}
              </li>
            ))}
          </ul>
        )}
      </div>
      {view.statuses.length > 0 && (
        <div className="status-hud-statuses">
          {view.statuses.map((status) => (
            <span key={status} className="status-hud-chip">{status}</span>
          ))}
        </div>
      )}
    </div>
  )
}
