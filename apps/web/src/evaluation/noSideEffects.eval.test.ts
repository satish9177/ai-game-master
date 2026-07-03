import { afterEach, describe, expect, it, vi } from 'vitest'
import { recallRoomMemoryContext } from '../app/recallRoomMemoryContext'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import {
  EVAL_ROOM_ID,
  EVAL_SESSION_ID,
  EVAL_WORLD_ID,
  createSpyLogger,
  createWorldSessionHarness,
  evalCanon,
  evalDialogueRequest,
  longSessionMemoryFixture,
  type LogEntry,
} from './fixtures'

/**
 * Gate F — no side effects from evaluation flows (Slice 4).
 *
 * Recall / context / prompt building at N=1000:
 *   - append zero `WorldEvent`s and leave `WorldState` deep-equal;
 *   - cause zero memory writes (the store record count is unchanged);
 *   - make no provider / network / API call (a stubbed `fetch` is never hit).
 *
 * The memory layer structurally cannot reference `WorldSession` (lint firewall);
 * this gate re-proves it behaviorally at volume, mirroring the redteam
 * `dialogueAuthority` no-mutation stance.
 */

const ROOM_SCOPE = { worldId: EVAL_WORLD_ID, sessionId: EVAL_SESSION_ID, roomId: EVAL_ROOM_ID }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gate F - recall/context/prompt at N=1000 has no side effects', () => {
  it('appends zero WorldEvents and leaves WorldState deep-equal', async () => {
    const worldSession = createWorldSessionHarness()
    const started = await worldSession.session.startSession(evalCanon())
    if (!started.ok) throw new Error('session start failed')
    const { sessionId } = started.state

    const beforeEvents = await worldSession.store.listEvents(sessionId)
    const beforeState = await worldSession.session.getWorldState(sessionId)

    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const logEntries: LogEntry[] = []
    await fixture.service.recall(ROOM_SCOPE)
    const context = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger(logEntries))
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(await worldSession.store.listEvents(sessionId)).toEqual(beforeEvents)
    expect(await worldSession.session.getWorldState(sessionId)).toEqual(beforeState)
  })

  it('causes no memory writes (store record count unchanged)', async () => {
    const fixture = await longSessionMemoryFixture({ count: 1000 })
    const before = fixture.store.snapshotAll().length
    expect(before).toBe(1000)

    await fixture.service.recall(ROOM_SCOPE)
    const context = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger([]))
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(fixture.store.snapshotAll().length).toBe(before)
  })

  it('makes no provider/network call during recall/context/prompt', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden in evaluation')))
    vi.stubGlobal('fetch', fetchSpy)

    const fixture = await longSessionMemoryFixture({ count: 1000 })
    await fixture.service.recall(ROOM_SCOPE)
    const context = await recallRoomMemoryContext(ROOM_SCOPE, fixture.service, createSpyLogger([]))
    buildDialoguePromptMessages(evalDialogueRequest({ memory: context }))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
