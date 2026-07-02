import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NPCDialoguePanel } from './NPCDialoguePanel'
import type { NPCDialoguePrompt, NPCDialogueTurn } from '../../domain/dialogue/contracts'
import { MAX_PLAYER_FREE_TEXT_CHARS } from '../../domain/dialogue/playerFreeText'

const reactMock = vi.hoisted(() => ({
  effect: undefined as undefined | (() => void | (() => void)),
  useEffect: vi.fn((callback: () => void | (() => void)) => {
    reactMock.effect = callback
  }),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useEffect: reactMock.useEffect,
  }
})

type ElementLike = {
  type: unknown
  props: Record<string, unknown>
}

type PanelProps = Parameters<typeof NPCDialoguePanel>[0]

const prompts: NPCDialoguePrompt[] = [
  { id: 'ask-room', label: 'Ask about the room' },
  { id: 'ask-exit', label: 'Ask about the exit' },
]

const turns: NPCDialogueTurn[] = [
  { speaker: 'player', text: 'What happened here?' },
  { speaker: 'npc', text: 'The ward failed before dawn.' },
]

const generatedPersonaLabels = [
  ['generated-room-guide', 'Room Guide'],
  ['generated-calm-witness', 'Witness'],
  ['generated-keep-warden', 'Keep Warden'],
  ['generated-archive-aide', 'Archive Aide'],
  ['generated-wasteland-scout', 'Wasteland Scout'],
  ['generated-shelter-watch', 'Shelter Watch'],
] as const

function props(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    npcName: 'Stranger',
    turns,
    prompts,
    onSay: () => undefined,
    onClose: () => undefined,
    ...overrides,
  }
}

function markup(overrides: Partial<PanelProps> = {}) {
  return renderToStaticMarkup(<NPCDialoguePanel {...props(overrides)} />)
}

function isElement(value: unknown): value is ElementLike {
  return value !== null && typeof value === 'object' && 'props' in value
}

function flattenChildren(children: unknown): unknown[] {
  if (children === undefined || children === null || typeof children === 'boolean') return []
  return Array.isArray(children) ? children.flatMap(flattenChildren) : [children]
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isElement(node)) return ''
  return flattenChildren(node.props.children).map(textContent).join('')
}

function findElements(node: unknown, predicate: (node: ElementLike) => boolean): ElementLike[] {
  if (!isElement(node)) return []
  const matches = predicate(node) ? [node] : []
  return matches.concat(
    flattenChildren(node.props.children).flatMap((child) => findElements(child, predicate)),
  )
}

function panelTree(overrides: Partial<PanelProps> = {}) {
  return NPCDialoguePanel(props(overrides))
}

function buttonByText(tree: unknown, label: string): ElementLike {
  const button = findElements(
    tree,
    (node) => node.type === 'button' && textContent(node) === label,
  )[0]
  if (button === undefined) throw new Error(`missing button ${label}`)
  return button
}

function firstElementByType(tree: unknown, type: string): ElementLike {
  const element = findElements(tree, (node) => node.type === type)[0]
  if (element === undefined) throw new Error(`missing ${type}`)
  return element
}

function callHandler(handler: unknown, event?: unknown): void {
  if (typeof handler !== 'function') throw new Error('missing handler')
  handler(event)
}

function submitText(form: ElementLike, value: string) {
  const reset = vi.fn()
  const preventDefault = vi.fn()
  callHandler(form.props.onSubmit, {
    preventDefault,
    currentTarget: {
      reset,
      elements: {
        namedItem: (name: string) => (name === 'playerLine' ? { value } : null),
      },
    },
  })
  return { preventDefault, reset }
}

describe('NPCDialoguePanel', () => {
  it('renders NPC name', () => {
    const html = markup({ npcName: 'Mira' })

    expect(html).toContain('<h2 class="panel-title">Mira</h2>')
    expect(html).toContain('aria-label="Conversation with Mira"')
  })

  it('renders known persona subtitle from a closed map', () => {
    const html = markup({ persona: 'friendly-aide' })

    expect(html).toContain('class="npc-dialogue-subtitle"')
    expect(html).toContain('Ally')
    expect(html).not.toContain('friendly-aide')
  })

  it.each(generatedPersonaLabels)('renders generated persona %s as safe label %s', (persona, label) => {
    const html = markup({ persona })

    expect(html).toContain('class="npc-dialogue-subtitle"')
    expect(html).toContain(label)
    expect(html).not.toContain(persona)
  })

  it('does not render an unknown raw persona slug', () => {
    const html = markup({ persona: 'adjacent:gen-1234abcd:exit:north' })

    expect(html).not.toContain('npc-dialogue-subtitle')
    expect(html).not.toContain('adjacent:gen-1234abcd:exit:north')
  })

  it('does not render an unknown generated persona slug', () => {
    const html = markup({ persona: 'generated-unknown-guide' })

    expect(html).not.toContain('npc-dialogue-subtitle')
    expect(html).not.toContain('generated-unknown-guide')
  })

  it('renders player and NPC turns with labels', () => {
    const html = markup({ npcName: 'Asha' })

    expect(html).toContain('Player')
    expect(html).toContain('What happened here?')
    expect(html).toContain('Asha')
    expect(html).toContain('The ward failed before dawn.')
  })

  it('authored prompts render as buttons and onSay(promptId) fires', () => {
    const onSay = vi.fn()
    const tree = panelTree({ onSay })

    callHandler(buttonByText(tree, 'Ask about the room').props.onClick)

    expect(onSay).toHaveBeenCalledWith('ask-room')
  })

  it('renders a free-text input and Send button', () => {
    const html = markup()

    expect(html).toContain('name="playerLine"')
    expect(html).toContain('aria-label="Say something"')
    expect(html).toContain('Send')
  })

  it('empty or whitespace free-text send does nothing', () => {
    const onSay = vi.fn()
    const tree = panelTree({ onSay })
    const form = firstElementByType(tree, 'form')
    const { preventDefault, reset } = submitText(form, '   \n\t   ')

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onSay).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it('free-text Send normalizes text before calling onSay', () => {
    const onSay = vi.fn()
    const tree = panelTree({ onSay })
    const form = firstElementByType(tree, 'form')
    const { reset } = submitText(form, '  Look\tat \n the   altar  ')

    expect(onSay).toHaveBeenCalledWith(undefined, 'Look at the altar')
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('free-text Send clamps normalized text to 240 characters', () => {
    const onSay = vi.fn()
    const tree = panelTree({ onSay })
    const form = firstElementByType(tree, 'form')
    const longText = `${'x'.repeat(MAX_PLAYER_FREE_TEXT_CHARS)}SECRET_AFTER_CLAMP`

    submitText(form, longText)

    expect(onSay).toHaveBeenCalledWith(undefined, 'x'.repeat(MAX_PLAYER_FREE_TEXT_CHARS))
  })

  it('Enter submits through the single-line free-text form', () => {
    const onSay = vi.fn()
    const tree = panelTree({ onSay })
    const form = firstElementByType(tree, 'form')

    submitText(form, 'Can you help?')

    expect(onSay).toHaveBeenCalledWith(undefined, 'Can you help?')
  })

  it('no-prompts case renders Continue affordance and onSay(undefined) fires', () => {
    const onSay = vi.fn()
    const html = markup({ prompts: [] })
    const tree = panelTree({ prompts: [], onSay })

    expect(html).toContain('No authored prompts remain. Continue the conversation.')
    expect(html).toContain('Continue')
    callHandler(buttonByText(tree, 'Continue').props.onClick)
    expect(onSay).toHaveBeenCalledWith(undefined)
  })

  it('busy shows responding indicator and disables controls', () => {
    const html = markup({ busy: true })
    const tree = panelTree({ busy: true })
    const input = firstElementByType(tree, 'input')
    const sendButton = buttonByText(tree, 'Send')

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('responding...')
    expect(html).toContain('disabled=""')
    expect(input.props.disabled).toBe(true)
    expect(sendButton.props.disabled).toBe(true)
  })

  it('failure message renders clearly', () => {
    const html = markup({ message: 'They have nothing to say right now.' })

    expect(html).toContain('npc-dialogue-message')
    expect(html).toContain('They have nothing to say right now.')
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    const tree = panelTree({ onClose })
    const closeButton = findElements(
      tree,
      (node) => node.type === 'button' && node.props['aria-label'] === 'Close',
    )[0]

    callHandler(closeButton?.props.onClick)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape calls onClose', () => {
    const onClose = vi.fn()
    const listeners: Record<string, (event: KeyboardEvent) => void> = {}
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
          listeners[type] = listener
        },
        removeEventListener: vi.fn(),
      },
    })

    panelTree({ onClose })
    reactMock.effect?.()
    listeners['keydown']?.({ code: 'Escape' } as KeyboardEvent)

    expect(onClose).toHaveBeenCalledTimes(1)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  it('Escape from the focused text input bubbles to the window close listener', () => {
    const onClose = vi.fn()
    const listeners: Record<string, (event: globalThis.KeyboardEvent) => void> = {}
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: (type: string, listener: (event: globalThis.KeyboardEvent) => void) => {
          listeners[type] = listener
        },
        removeEventListener: vi.fn(),
      },
    })
    const tree = panelTree({ onClose })
    reactMock.effect?.()
    const input = firstElementByType(tree, 'input')
    const stopPropagation = vi.fn()

    callHandler(input.props.onKeyDown, { code: 'Escape', stopPropagation })
    if (stopPropagation.mock.calls.length === 0) {
      listeners['keydown']?.({ code: 'Escape' } as globalThis.KeyboardEvent)
    }

    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  it('does not leak raw object id or persona slug in visible title or subtitle', () => {
    const html = markup({
      npcName: 'Stranger',
      persona: 'generated-npc-7f4d',
    })

    expect(html).toContain('<h2 class="panel-title">Stranger</h2>')
    expect(html).not.toContain('generated-npc-7f4d')
    expect(html).not.toContain('npc-dialogue-subtitle')
  })
})
