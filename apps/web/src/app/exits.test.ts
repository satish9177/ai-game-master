import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { buildExitLookup, navigationResultMessage } from './exits'

describe('exit helpers', () => {
  it('indexes only stable ids with exit metadata and keeps the first duplicate', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'room-a',
      name: 'Room A',
      shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
      spawn: { position: [0, 1.7, 2], yaw: 180 },
      lighting: { ambient: { intensity: 1 } },
      objects: [
        {
          type: 'arch',
          position: [0, 0, 0],
          interaction: {
            key: 'E', prompt: 'Leave', exit: { toRoomId: 'ignored-without-id' },
          },
        },
        {
          type: 'arch',
          id: 'exit-a',
          position: [1, 0, 0],
          interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'room-b' } },
        },
        {
          type: 'arch',
          id: 'exit-a',
          position: [2, 0, 0],
          interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'room-c' } },
        },
        { type: 'crate', id: 'crate', position: [3, 0, 0] },
      ],
    })

    expect([...buildExitLookup(room)]).toEqual([
      ['exit-a', { toRoomId: 'room-b' }],
    ])
  })

  it('maps navigation outcomes to calm user-facing messages', () => {
    expect(navigationResultMessage({ status: 'rejected', reason: 'missing-exit' }))
      .toBe('The way is blocked.')
    expect(navigationResultMessage({ status: 'rejected', reason: 'already-here' }))
      .toBe('You are already here.')
    expect(navigationResultMessage({ status: 'failed', reason: 'conflict' }))
      .toBe('The world changed. Try again.')
    expect(navigationResultMessage({ status: 'failed', reason: 'invalid-room' }))
      .toBe('This room could not be entered.')
  })
})
