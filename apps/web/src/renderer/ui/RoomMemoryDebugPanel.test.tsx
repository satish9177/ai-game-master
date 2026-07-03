import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ROOM_MEMORY_DEBUG_REDACTED_TEXT,
  type RoomMemoryDebugRow,
} from '../../domain/memory/roomMemoryDebugView'
import roomMemoryDebugPanelSource from './RoomMemoryDebugPanel.tsx?raw'
import { RoomMemoryDebugPanel } from './RoomMemoryDebugPanel'

function row(overrides: Partial<RoomMemoryDebugRow> = {}): RoomMemoryDebugRow {
  return {
    memoryId: 'mem-1',
    roomId: 'room-1',
    kind: 'room_observation',
    source: 'game',
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    text: 'sanitized room memory text',
    ...overrides,
  }
}

function markup(rows: readonly RoomMemoryDebugRow[], overrides: {
  currentRoomId?: string | null
  open?: boolean
  onToggle?: () => void
  onRefresh?: () => void
} = {}) {
  return renderToStaticMarkup(
    <RoomMemoryDebugPanel
      rows={rows}
      currentRoomId={overrides.currentRoomId ?? 'room-1'}
      open={overrides.open ?? true}
      onToggle={overrides.onToggle ?? (() => undefined)}
      onRefresh={overrides.onRefresh}
    />,
  )
}

describe('RoomMemoryDebugPanel', () => {
  it('renders an empty state with debug-only read-only context', () => {
    const html = markup([])

    expect(html).toContain('Room memory debug (0)')
    expect(html).toContain('Read-only debug view')
    expect(html).toContain('Current room: room-1')
    expect(html).toContain('Visible records: 0')
    expect(html).toContain('No room memory records visible.')
  })

  it('renders sanitized records with metadata primary and text secondary', () => {
    const html = markup([
      row({
        memoryId: 'mem-safe',
        kind: 'player_claim',
        source: 'player',
        confidence: 'high',
        seq: 7,
        createdAt: '2026-06-23T10:07:00.000Z',
        text: 'safe projected display text',
      }),
    ])

    expect(html).toContain('Kind')
    expect(html).toContain('player_claim')
    expect(html).toContain('Source')
    expect(html).toContain('player')
    expect(html).toContain('Confidence')
    expect(html).toContain('high')
    expect(html).toContain('Seq')
    expect(html).toContain('7')
    expect(html).toContain('Created')
    expect(html).toContain('2026-06-23T10:07:00.000Z')
    expect(html).toContain('Memory')
    expect(html).toContain('mem-safe')
    expect(html).toContain('safe projected display text')
  })

  it('shows redacted rows visibly without recovering hidden text', () => {
    const html = markup([
      row({
        memoryId: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
        roomId: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
        text: ROOM_MEMORY_DEBUG_REDACTED_TEXT,
      }),
    ])

    expect(html).toContain(ROOM_MEMORY_DEBUG_REDACTED_TEXT)
    expect(html).not.toContain('raw prompt')
    expect(html).not.toContain('provider response')
  })

  it('does not expose write, edit, delete, or memory mutation controls', () => {
    const html = markup([row()], { onRefresh: () => undefined })

    expect(html).toContain('Refresh')
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('>Delete<')
    expect(html).not.toContain('>Write<')
    expect(html).not.toContain('>Remember<')
    expect(html).not.toContain('>Record<')
  })

  it('Refresh calls only the provided callback prop', () => {
    const onToggle = vi.fn()
    const onRefresh = vi.fn()
    const element = RoomMemoryDebugPanel({
      rows: [row()],
      currentRoomId: 'room-1',
      open: true,
      onToggle,
      onRefresh,
    })

    const refreshButton = findButtonByText(element, 'Refresh')
    expect(refreshButton).toBeDefined()
    refreshButton!.props.onClick()

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('RoomMemoryDebugPanel import boundary', () => {
  it('does not directly import or use store, persistence, provider, App, event log, or logger APIs', () => {
    const forbiddenFragments = [
      '../app',
      '../../App',
      'App.tsx',
      'snapshotAll',
      'InMemoryRoomMemoryStore',
      'RoomMemoryService',
      'persistence',
      'server',
      'provider',
      'llm',
      'WorldEvent',
      'WorldCommand',
      'WorldSession',
      'logger',
      'console.',
      'remember',
      'record(',
      'delete',
    ]

    for (const fragment of forbiddenFragments) {
      expect(roomMemoryDebugPanelSource).not.toContain(fragment)
    }
  })
})

type ElementProps = {
  children?: ReactNode
  onClick?: () => void
}

function findButtonByText(node: ReactNode, text: string): ReactElement<{ onClick: () => void }> | undefined {
  if (!isValidElement<ElementProps>(node)) return undefined

  if (node.type === 'button' && textContent(node.props.children) === text && node.props.onClick) {
    return node as ReactElement<{ onClick: () => void }>
  }

  const children = node.props.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findButtonByText(child, text)
      if (found) return found
    }
    return undefined
  }

  return findButtonByText(children, text)
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement<ElementProps>(node)) return ''

  const children = node.props.children
  if (Array.isArray(children)) return children.map(textContent).join('')
  return textContent(children)
}
