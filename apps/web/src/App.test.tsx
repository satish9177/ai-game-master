import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppRoomEntryOverlay } from './App'
import { buildPromptGeneratedRoomSource } from './app/buildPromptGeneratedRoomSource'
import { FALLBACK_NOTICE } from './app/fallbackNotice'
import { buildRoomIntroView } from './app/roomIntro'
import { loadRoomSpec } from './domain/loadRoomSpec'
import type { LoadedRoom } from './domain/loadRoomSpec'
import type { RoomGenerator } from './domain/ports/RoomGenerator'
import type { Logger } from './platform/logger/Logger'

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}

function makeRoom(objects: unknown[], id = 'room-a', name = 'ruined investigation room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name,
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6] },
    objects,
  })
}

function renderOverlay(room: LoadedRoom | null, notice: string | null = null, entrySeq = 1) {
  return renderToStaticMarkup(
    <AppRoomEntryOverlay
      room={room}
      sessionId="session-1"
      entrySeq={entrySeq}
      notice={notice}
      onDismissNotice={() => undefined}
    />,
  )
}

describe('App room intro wiring', () => {
  it('renders RoomIntroPanel text for an active room with useful objects', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -4] },
      { type: 'table', position: [2, 0, 0] },
    ])
    const html = renderOverlay(room)
    expect(html).toContain('You enter the ruined investigation room.')
    expect(html).toContain('A corpse lies to the north')
    expect(html).toContain('role="status"')
  })

  it('does not render an intro panel when buildRoomSummary returns null', () => {
    const room = makeRoom([
      { type: 'prop', position: [0, 0, 0] },
      { type: 'pillar', position: [3, 0, 0] },
    ])
    expect(renderOverlay(room)).toBe('')
  })

  it('fallback/repaired notice renders independently from the room intro', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -4] },
    ])
    const html = renderOverlay(room, FALLBACK_NOTICE)
    expect(html).toContain('A corpse lies to the north')
    expect(html).toContain('safe one. Try another prompt.')
    expect(html).toContain('room-notice')
    expect(html).toContain('Dismiss notice')
    expect(html).toContain('Dismiss room introduction')
  })

  it('room intro key changes when entering a different room', () => {
    const first = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'room-a')
    const second = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'room-b')
    expect(buildRoomIntroView(first, 'session-1', 1).roomKey).toBe('session-1:room-a:1')
    expect(buildRoomIntroView(second, 'session-1', 2).roomKey).toBe('session-1:room-b:2')
  })

  it('room intro key changes for a new entry even when the room id repeats', () => {
    const room = makeRoom([{ type: 'corpse', position: [0, 0, -4] }], 'generated-room')
    expect(buildRoomIntroView(room, 'session-1', 1).roomKey).toBe('session-1:generated-room:1')
    expect(buildRoomIntroView(room, 'session-1', 2).roomKey).toBe('session-1:generated-room:2')
  })

  it('does not leak object names or interaction bodies through App wiring', () => {
    const room = makeRoom([
      {
        type: 'npc',
        name: 'Secret Named NPC',
        position: [0, 0, -3],
        interaction: {
          key: 'F',
          prompt: 'Talk to the secret named NPC',
          body: 'Raw interaction body should not appear.',
        },
      },
    ])
    const html = renderOverlay(room)
    expect(html).toContain('A figure waits to the north')
    expect(html).not.toContain('Secret Named NPC')
    expect(html).not.toContain('Raw interaction body')
    expect(html).not.toContain('Talk to the secret')
  })
})

describe('App generated room NPC request wiring', () => {
  const generatedRoom = JSON.stringify({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [{ type: 'pillar', position: [4, 0, -2] }],
  })

  it('classifies the raw prompt and passes only a boolean NPC request downstream', async () => {
    const calls: string[] = []
    const generator: RoomGenerator = {
      generate: (seed) => {
        calls.push(seed)
        return Promise.resolve(generatedRoom)
      },
    }
    const source = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'make a bunker with someone to talk to',
      generatorSeed: 'world-bible seed without the request phrase',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })

    const result = await source.getRoom()

    expect(calls).toEqual(['world-bible seed without the request phrase'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(true)
    }
  })

  it('does not request NPC insertion for a raw prompt without living NPC intent', async () => {
    const generator: RoomGenerator = {
      generate: () => Promise.resolve(generatedRoom),
    }
    const source = buildPromptGeneratedRoomSource({
      generator,
      rawUserPrompt: 'make an empty bunker with a barrel',
      generatorSeed: 'empty bunker seed',
      logger: noopLogger,
      fallbackRoom: makeRoom([]),
    })

    const result = await source.getRoom()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
    }
  })
})
