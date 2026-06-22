import { describe, expect, it } from 'vitest'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldCommand } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import { applyCommands } from './applyCommands'
import type { AppendEventResult } from './WorldSession'

const state = (revision: number): WorldState => ({
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  currentRoomId: 'room',
  player: { health: { current: 50, max: 100 }, status: [] },
  inventory: [],
  roomStates: { room: { visited: true } },
  revision,
  updatedAt: '2026-06-22T10:00:00.000Z',
})

const command: WorldCommand = { schemaVersion: 1, type: 'health-changed', delta: 1 }

const okEvent = WorldEventSchema.parse({
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000090',
  sessionId: '00000000-0000-4000-8000-000000000002',
  seq: 2,
  occurredAt: '2026-06-22T10:00:01.000Z',
  type: 'health-changed',
  payload: { delta: 1 },
})

const conflict: Extract<AppendEventResult, { ok: false }> = {
  ok: false,
  error: { code: 'conflict', message: 'x' },
}
const notFound: Extract<AppendEventResult, { ok: false }> = {
  ok: false,
  error: { code: 'not-found', message: 'x' },
}
const invalid: Extract<AppendEventResult, { ok: false }> = {
  ok: false,
  error: { code: 'invalid-command', message: 'x' },
}

describe('applyCommands', () => {
  it('threads each command from the previous returned revision and returns the latest state', async () => {
    const seenRevisions: number[] = []
    const session = {
      appendEvent: (_sessionId: string, _command: unknown, expectedRevision: number) => {
        seenRevisions.push(expectedRevision)
        return Promise.resolve<AppendEventResult>({
          ok: true,
          state: state(expectedRevision + 1),
          event: okEvent,
        })
      },
    }
    const result = await applyCommands(session, 'sid', [command, command, command], state(1))
    expect(seenRevisions).toEqual([1, 2, 3])
    expect(result).toEqual({ ok: true, state: state(4) })
  })

  it('returns ok with the unchanged state for an empty command list', async () => {
    const session = {
      appendEvent: () => Promise.reject(new Error('should not be called')),
    }
    expect(await applyCommands(session, 'sid', [], state(7))).toEqual({ ok: true, state: state(7) })
  })

  it('maps a first-command failure from the append error code', async () => {
    const make = (failure: Extract<AppendEventResult, { ok: false }>) => ({
      appendEvent: () => Promise.resolve<AppendEventResult>(failure),
    })
    expect(await applyCommands(make(conflict), 'sid', [command], state(1))).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(await applyCommands(make(notFound), 'sid', [command], state(1))).toEqual({
      ok: false,
      reason: 'not-found',
    })
    // Any other first-command failure (e.g. invalid-command) maps to partial.
    expect(await applyCommands(make(invalid), 'sid', [command], state(1))).toEqual({
      ok: false,
      reason: 'partial',
    })
  })

  it('reports a later-command failure as partial without retrying', async () => {
    let calls = 0
    const session = {
      appendEvent: (_sessionId: string, _command: unknown, expectedRevision: number) => {
        calls += 1
        if (calls === 1) {
          return Promise.resolve<AppendEventResult>({
            ok: true,
            state: state(expectedRevision + 1),
            event: okEvent,
          })
        }
        return Promise.resolve<AppendEventResult>(conflict)
      },
    }
    expect(await applyCommands(session, 'sid', [command, command], state(1))).toEqual({
      ok: false,
      reason: 'partial',
    })
    expect(calls).toBe(2)
  })
})
