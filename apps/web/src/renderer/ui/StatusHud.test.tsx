import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusHud } from './StatusHud'
import type { PlayerHudView } from './playerHud'

const view: PlayerHudView = {
  health: { current: 8, max: 10, fraction: 0.8 },
  items: [],
  statuses: [],
}

type TestElementProps = {
  children?: unknown
  className?: string
  'data-time-of-day'?: string
}

function children(element: ReactElement<{ children?: unknown }>): ReactElement<TestElementProps>[] {
  const rawChildren = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children]
  return rawChildren.filter(isValidElement) as ReactElement<TestElementProps>[]
}

describe('StatusHud clock presentation', () => {
  it('labels player status and exposes current health as a progressbar', () => {
    const html = renderToStaticMarkup(<StatusHud view={view} />)

    expect(html).toContain('aria-label="Player status"')
    expect(html).toContain('class="status-hud-section-label">Vitality</span>')
    expect(html).toContain('class="status-hud-section-label">Pack</span>')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="10"')
    expect(html).toContain('aria-valuenow="8"')
  })

  it('adds the time-of-day data attribute to the read-only clock line', () => {
    const element = StatusHud({
      view,
      clock: { day: 2, hour: 18, timeOfDay: 'dusk' },
    }) as ReactElement<{ children?: unknown }>
    const clock = children(element).find((child) => child?.props?.className === 'status-hud-clock')

    expect(clock?.props['data-time-of-day']).toBe('dusk')
    expect(clock?.props.children).toBe('Day 2 · 18:00 · Dusk')
  })
})
