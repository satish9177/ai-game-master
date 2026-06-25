import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSummary } from '../../domain/roomSummary'
import { RoomIntroPanel } from './RoomIntroPanel'
import {
  dismissRoomIntroPanel,
  isRoomIntroPanelDismissed,
  type RoomIntroPanelState,
} from './roomIntroPanelState'

function summary(overrides: Partial<RoomSummary> = {}): RoomSummary {
  return {
    text: 'You enter the ruined investigation room. A corpse lies to the north.',
    focal: { type: 'corpse', direction: 'north' },
    mentions: [
      { type: 'corpse', direction: 'north' },
      { type: 'table', direction: 'center' },
    ],
    ...overrides,
  }
}

function markup(value: RoomSummary | null, roomKey?: string) {
  return renderToStaticMarkup(<RoomIntroPanel summary={value} roomKey={roomKey} />)
}

describe('RoomIntroPanel', () => {
  it('renders nothing when summary is null', () => {
    expect(markup(null)).toBe('')
  })

  it('renders nothing when summary.text is blank', () => {
    expect(markup(summary({ text: '   \n\t  ' }))).toBe('')
  })

  it('renders the summary text when present', () => {
    const html = markup(summary())
    expect(html).toContain('You enter the ruined investigation room. A corpse lies to the north.')
  })

  it('dismiss button hides the panel state', () => {
    const state: RoomIntroPanelState = { resetKey: 'room-a', dismissed: false }
    const dismissed = dismissRoomIntroPanel(state.resetKey)
    expect(dismissed).toEqual({
      resetKey: state.resetKey,
      dismissed: true,
    })
    expect(isRoomIntroPanelDismissed(dismissed, 'room-a')).toBe(true)
  })

  it('dismissal resets when roomKey changes', () => {
    const dismissed: RoomIntroPanelState = { resetKey: 'room-a', dismissed: true }
    expect(isRoomIntroPanelDismissed(dismissed, 'room-a')).toBe(true)
    expect(isRoomIntroPanelDismissed(dismissed, 'room-b')).toBe(false)
  })

  it('dismissal can reset when summary text changes if roomKey is omitted', () => {
    const dismissed: RoomIntroPanelState = { resetKey: 'old summary', dismissed: true }
    expect(isRoomIntroPanelDismissed(dismissed, 'old summary')).toBe(true)
    expect(isRoomIntroPanelDismissed(dismissed, 'new summary')).toBe(false)
  })

  it('does not render focal or mentions structured data', () => {
    const html = markup(summary())
    expect(html).not.toContain('"focal"')
    expect(html).not.toContain('"mentions"')
    expect(html).not.toContain('direction')
    expect(html).not.toContain('center')
    expect(html).not.toContain('table')
  })

  it('treats text as plain React text, not HTML', () => {
    const html = markup(summary({
      text: 'Look <strong>safe</strong> <img src=x onerror=alert(1)>',
    }))
    expect(html).toContain('&lt;strong&gt;safe&lt;/strong&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<strong>safe</strong>')
    expect(html).not.toContain('<img src=x')
  })

  it('has an accessible status role and label', () => {
    const html = markup(summary())
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Room introduction"')
    expect(html).toContain('aria-live="polite"')
  })

  it('renders a dismiss button with an accessible label', () => {
    const html = markup(summary())
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Dismiss room introduction"')
    expect(html).toContain('×')
  })

  it('renders standalone without App wiring', () => {
    expect(() => markup(summary(), 'room-1')).not.toThrow()
  })
})
