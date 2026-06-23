import type { PlayerHudView } from './playerHud'

export function StatusHud({ view }: { view: PlayerHudView }) {
  return (
    <div className="status-hud" role="status" aria-live="polite">
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
