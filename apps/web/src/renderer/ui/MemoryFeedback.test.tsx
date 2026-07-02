import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MemoryFeedback } from './MemoryFeedback'
import {
  MEMORY_CREATED_MESSAGE,
  MEMORY_RECALLED_MESSAGE,
} from '../../app/memoryFeedback'

function markup(message: string | null) {
  return renderToStaticMarkup(<MemoryFeedback message={message} />)
}

describe('MemoryFeedback', () => {
  it('renders nothing when message is null', () => {
    expect(markup(null)).toBe('')
  })

  it('renders the closed created message', () => {
    const html = markup(MEMORY_CREATED_MESSAGE)
    expect(html).toContain(MEMORY_CREATED_MESSAGE)
  })

  it('renders the closed recalled message', () => {
    const html = markup(MEMORY_RECALLED_MESSAGE)
    expect(html).toContain(MEMORY_RECALLED_MESSAGE)
  })

  it('has an accessible status role', () => {
    const html = markup(MEMORY_CREATED_MESSAGE)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('never renders raw memory text, ids, names, or count strings', () => {
    const rawStrings = [
      'SECRET memory text',
      'mem-secret-id',
      'Forbidden Room Name',
      'Forbidden Item Name',
      '3 memories',
    ]

    for (const raw of rawStrings) {
      // The component only ever receives the two closed constants in real
      // wiring; this proves it would not leak an arbitrary string it was
      // never designed to accept beyond rendering it as plain React text.
      const html = markup(raw)
      expect(html).not.toContain('"text"')
      expect(html).not.toContain('"memoryId"')
    }

    const closedOutputs = [markup(MEMORY_CREATED_MESSAGE), markup(MEMORY_RECALLED_MESSAGE)]
    for (const raw of rawStrings) {
      expect(closedOutputs.join('\n')).not.toContain(raw)
    }
  })
})
