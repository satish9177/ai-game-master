import type { RoomMemoryDebugRow } from '../../domain/memory/roomMemoryDebugView'

export type RoomMemoryDebugPanelProps = {
  rows: readonly RoomMemoryDebugRow[]
  currentRoomId?: string | null
  open: boolean
  onToggle: () => void
  onRefresh?: () => void
}

export function RoomMemoryDebugPanel({
  rows,
  currentRoomId,
  open,
  onToggle,
  onRefresh,
}: RoomMemoryDebugPanelProps) {
  return (
    <section className="room-memory-debug-panel" aria-label="Room memory debug viewer">
      <button
        type="button"
        className="room-memory-debug-panel-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? 'v' : '>'} Room memory debug ({rows.length})
      </button>
      {open && (
        <div className="room-memory-debug-panel-body">
          <div className="room-memory-debug-panel-head">
            <div>
              <div className="room-memory-debug-panel-label">Read-only debug view</div>
              <div className="room-memory-debug-panel-meta">
                Current room: {currentRoomId ?? 'unavailable'} | Visible records: {rows.length}
              </div>
            </div>
            {onRefresh && (
              <button
                type="button"
                className="room-memory-debug-panel-refresh"
                onClick={onRefresh}
              >
                Refresh
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="room-memory-debug-panel-empty">No room memory records visible.</p>
          ) : (
            <ol className="room-memory-debug-panel-list">
              {rows.map((row) => (
                <li key={`${row.memoryId}:${row.seq}`} className="room-memory-debug-panel-row">
                  <dl className="room-memory-debug-panel-row-meta">
                    <div>
                      <dt>Kind</dt>
                      <dd>{row.kind}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{row.source}</dd>
                    </div>
                    <div>
                      <dt>Confidence</dt>
                      <dd>{row.confidence}</dd>
                    </div>
                    <div>
                      <dt>Seq</dt>
                      <dd>{row.seq}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{row.createdAt}</dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>{row.memoryId}</dd>
                    </div>
                  </dl>
                  <p className="room-memory-debug-panel-text">{row.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
