import { useState } from 'react'
import type { RoomSummary } from '../../domain/roomSummary'
import {
  dismissRoomIntroPanel,
  isRoomIntroPanelDismissed,
  type RoomIntroPanelState,
} from './roomIntroPanelState'

export type RoomIntroPanelProps = {
  summary: RoomSummary | null
  roomKey?: string
}

export function RoomIntroPanel({ summary, roomKey }: RoomIntroPanelProps) {
  const text = summary?.text.trim() ?? ''
  const resetKey = roomKey ?? text
  const [state, setState] = useState<RoomIntroPanelState>(() => ({
    resetKey,
    dismissed: false,
  }))

  if (text.length === 0 || isRoomIntroPanelDismissed(state, resetKey)) return null

  return (
    <section
      className="room-intro-panel"
      role="status"
      aria-label="Room introduction"
      aria-live="polite"
    >
      <p className="room-intro-panel-text">{text}</p>
      <button
        type="button"
        className="room-intro-panel-close"
        aria-label="Dismiss room introduction"
        onClick={() => {
          setState(dismissRoomIntroPanel(resetKey))
        }}
      >
        ×
      </button>
    </section>
  )
}
