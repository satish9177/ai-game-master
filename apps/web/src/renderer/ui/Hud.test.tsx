import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Hud } from './Hud'
import type { Interactable } from '../../domain/ports/interaction'

const active = (overrides: Partial<Interactable> = {}): Interactable => ({
  id: 'note',
  type: 'scroll',
  label: 'scroll',
  affordance: 'inspect',
  key: 'E',
  prompt: 'Read the note',
  position: { x: 0, y: 0, z: 0 },
  ...overrides,
})

describe('Hud', () => {
  it('renders nothing when active is null', () => {
    expect(renderToStaticMarkup(<Hud active={null} />)).toBe('')
  })

  it('renders key chip, deterministic verb chip, and existing prompt', () => {
    const html = renderToStaticMarkup(<Hud active={active({
      affordance: 'talk',
      key: 'F',
      prompt: 'Speak with survivor',
    })} />)

    expect(html).toContain('class="hud-key"')
    expect(html).toContain('>F</span>')
    expect(html).toContain('class="hud-affordance"')
    expect(html).toContain('>Talk</span>')
    expect(html).toContain('Speak with survivor')
  })

  it('uses affordance labels instead of raw enum values when a label exists', () => {
    const html = renderToStaticMarkup(<Hud active={active({
      affordance: 'approach',
      prompt: 'Face the threat',
    })} />)

    expect(html).toContain('>Approach</span>')
    expect(html).not.toContain('>approach</span>')
  })

  it('does not render raw JSON or structured debug data', () => {
    const html = renderToStaticMarkup(<Hud active={active({
      affordance: 'take',
      prompt: 'Gather supplies',
    })} />)

    expect(html).not.toContain('{')
    expect(html).not.toContain('"affordance"')
    expect(html).not.toContain('"take"')
  })
})
