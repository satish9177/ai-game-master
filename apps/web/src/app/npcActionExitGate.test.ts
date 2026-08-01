import { describe, expect, it } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'
import { evaluateNpcActionExitGate } from './npcActionExitGate'

const room = loadRoomSpec(throneRoom)

function state(flags: Record<string, boolean>): Pick<WorldState, 'roomStates'> {
  return { roomStates: { 'throne-room': { visited: true, flags } } }
}

function evaluate(overrides: Partial<Parameters<typeof evaluateNpcActionExitGate>[0]> = {}) {
  return evaluateNpcActionExitGate({
    room,
    fromRoomId: 'throne-room',
    toRoomId: 'ruined-safehouse',
    state: state({ 'npc-action:herald-asha:bar-exit:north-door': true }),
    npcActionEnabled: true,
    ...overrides,
  })
}

describe('evaluateNpcActionExitGate', () => {
  it('T40 gates a reachable barred exit and reports the NPC id', () => {
    expect(evaluate()).toEqual({ gated: true, npcId: 'herald-asha' })
  })

  it('T41 restores passage when the feature flag is off', () => {
    expect(evaluate({ npcActionEnabled: false })).toEqual({ gated: false })
  })

  it('T42 stays open when the action flag is absent', () => {
    expect(evaluate({ state: state({}) })).toEqual({ gated: false })
  })

  it('T43 ignores a flag for another target object', () => {
    expect(evaluate({
      state: state({ 'npc-action:herald-asha:bar-exit:other-door': true }),
    })).toEqual({ gated: false })
  })

  it('T44 ignores barred exits that do not reach the requested room', () => {
    expect(evaluate({ toRoomId: 'other-room' })).toEqual({ gated: false })
  })

  it('T45 ignores all unrelated flag namespaces', () => {
    expect(evaluate({
      state: state({
        'interaction:north-door': true,
        'encounter:north-door': true,
        'meaningful-object:north-door:read': true,
      }),
    })).toEqual({ gated: false })
  })

  it('stays open when authoritative state is null', () => {
    expect(evaluate({ state: null })).toEqual({ gated: false })
  })

  it('stays open when the supplied room does not match fromRoomId', () => {
    expect(evaluate({ room: { ...room, id: 'other-room' } })).toEqual({ gated: false })
  })

  it('stays open when a matching NPC action flag is false', () => {
    expect(evaluate({
      state: state({ 'npc-action:herald-asha:bar-exit:north-door': false }),
    })).toEqual({ gated: false })
  })

  it('selects the same barring NPC deterministically when two flags target one exit', () => {
    expect(evaluate({
      state: state({
        'npc-action:herald-zed:bar-exit:north-door': true,
        'npc-action:herald-anna:bar-exit:north-door': true,
      }),
    })).toEqual({ gated: true, npcId: 'herald-anna' })
  })
})
