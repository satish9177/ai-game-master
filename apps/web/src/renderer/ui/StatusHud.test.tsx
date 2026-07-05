import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
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
