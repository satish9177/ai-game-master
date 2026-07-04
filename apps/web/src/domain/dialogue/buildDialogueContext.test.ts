import { describe, expect, it } from 'vitest'
import type { WorldState } from '../world/worldState'
import type {
  NPCDialogueTurn,
  QuestDialogueContext,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
} from './contracts'
import { buildDialogueContext } from './buildDialogueContext'
import { neutralRelationship } from '../npcRelationship/neutral'
import type { NpcRelationshipState } from '../npcRelationship/contracts'

const state: WorldState = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  currentRoomId: 'throne-room',
  player: {
    health: { current: 7, max: 10 },
    status: ['wounded'],
  },
  inventory: [
    { itemId: 'coin', name: 'Gold Coin', quantity: 2 },
    { itemId: 'writ', name: 'Royal Writ', quantity: 1 },
  ],
  roomStates: { 'throne-room': { visited: true } },
  revision: 3,
  updatedAt: '2026-06-22T10:00:02.000Z',
}
const history: NPCDialogueTurn[] = [
  { speaker: 'player', text: 'Hello.' },
  { speaker: 'npc', text: 'Welcome.' },
]
const roomContext: RoomDialogueContext = {
  focus: { type: 'altar', direction: 'north' },
  features: [
    { type: 'altar', direction: 'north' },
    { type: 'corpse', direction: 'south' },
  ],
  affordances: ['inspect', 'talk'],
  npcCount: 2,
}

describe('buildDialogueContext', () => {
  it('maps authoritative facts to the provider context without item names', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context).toEqual({
      roomId: 'throne-room',
      npcId: 'aide',
      npcName: 'Asha',
      persona: 'friendly-aide',
      player: {
        health: { current: 7, max: 10 },
        status: ['wounded'],
        inventoryItemIds: ['coin', 'writ'],
      },
      history,
      relationship: {
        schemaVersion: 1,
        subject: 'npc',
        object: 'player',
        familiarityBucket: 'none',
        trustBucket: 'neutral',
        respectBucket: 'neutral',
        fearBucket: 'none',
      },
    })
    expect(JSON.stringify(context)).not.toContain('Gold Coin')
    expect(JSON.stringify(context)).not.toContain('Royal Writ')
  })

  it('attaches provided room dialogue context', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      roomContext,
    )

    expect(context.room).toEqual(roomContext)
    expect(context.room).not.toBe(roomContext)
    expect(context.room?.focus).not.toBe(roomContext.focus)
    expect(context.room?.features).not.toBe(roomContext.features)
    expect(context.room?.features[0]).not.toBe(roomContext.features[0])
    expect(context.room?.affordances).not.toBe(roomContext.affordances)
  })

  it('omits room dialogue context when none is provided', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context.room).toBeUndefined()
    expect(context).not.toHaveProperty('room')
  })

  it('keeps existing context fields unchanged when room dialogue context is provided', () => {
    const withoutRoom = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )
    const withRoom = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      roomContext,
    )

    expect(withRoom).toEqual({ ...withoutRoom, room: roomContext })
  })

  it('is deterministic and does not mutate or alias mutable inputs', () => {
    const stateBefore = structuredClone(state)
    const historyBefore = structuredClone(history)
    const roomContextBefore = structuredClone(roomContext)
    const npc = { npcId: 'aide', npcName: 'Asha' }

    const first = buildDialogueContext(state, npc, history, roomContext)
    const second = buildDialogueContext(state, npc, history, roomContext)

    expect(first).toEqual(second)
    expect(state).toEqual(stateBefore)
    expect(history).toEqual(historyBefore)
    expect(roomContext).toEqual(roomContextBefore)
    expect(first.player.health).not.toBe(state.player.health)
    expect(first.player.status).not.toBe(state.player.status)
    expect(first.history).not.toBe(history)
    expect(first.history[0]).not.toBe(history[0])
  })

  it('copies quest ids/enums through and does not alias the input', () => {
    const questContext: QuestDialogueContext = {
      activeObjectiveId: 'claim-tribute-coin',
      status: 'active',
      hint: 'Sanitized generated hint.',
      completionHint: 'Sanitized generated completion.',
    }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      undefined,
      questContext,
    )

    expect(context.quest).toEqual({
      activeObjectiveId: 'claim-tribute-coin',
      status: 'active',
      hint: 'Sanitized generated hint.',
      completionHint: 'Sanitized generated completion.',
    })
    expect(context.quest).not.toBe(questContext)
  })

  it('copies quest with null activeObjectiveId and complete status', () => {
    const questContext: QuestDialogueContext = { activeObjectiveId: null, status: 'complete' }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha' },
      history,
      undefined,
      questContext,
    )

    expect(context.quest).toEqual({ activeObjectiveId: null, status: 'complete' })
  })

  it('omits quest when absent', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context.quest).toBeUndefined()
    expect(context).not.toHaveProperty('quest')
  })

  it('copies memory dialogue context entries through and does not alias the input', () => {
    const memoryContext: RoomMemoryDialogueContext = {
      entries: [
        { text: 'The east door is locked.', kind: 'player_claim' },
        { text: 'This area changed in a lasting way.', kind: 'room_observation' },
      ],
    }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      undefined,
      undefined,
      memoryContext,
    )

    expect(context.memory).toEqual(memoryContext)
    expect(context.memory).not.toBe(memoryContext)
    expect(context.memory?.entries).not.toBe(memoryContext.entries)
    expect(context.memory?.entries[0]).not.toBe(memoryContext.entries[0])
  })

  it('omits memory dialogue context when absent', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context.memory).toBeUndefined()
    expect(context).not.toHaveProperty('memory')
  })

  it('does not introduce free-text leakage beyond existing dialogue context fields', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      roomContext,
    )
    const roomOnly = JSON.stringify(context.room)

    expect(roomOnly).toContain('altar')
    expect(roomOnly).toContain('inspect')
    expect(roomOnly).not.toContain('Gold Coin')
    expect(roomOnly).not.toContain('Royal Writ')
    expect(roomOnly).not.toContain('Asha')
    expect(roomOnly).not.toContain('friendly-aide')
    expect(roomOnly).not.toContain('Hello.')
    expect(roomOnly).not.toContain('Welcome.')
  })

  it('does not leak persona or dialogue history into the memory dialogue context', () => {
    const memoryContext: RoomMemoryDialogueContext = {
      entries: [{ text: 'The east door is locked.', kind: 'player_claim' }],
    }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      undefined,
      undefined,
      memoryContext,
    )
    const memoryOnly = JSON.stringify(context.memory)

    expect(memoryOnly).toContain('east door is locked')
    expect(memoryOnly).not.toContain('Asha')
    expect(memoryOnly).not.toContain('friendly-aide')
    expect(memoryOnly).not.toContain('Hello.')
    expect(memoryOnly).not.toContain('Welcome.')
  })

  it('projects a bucketed relationship hint from the provided relationship state', () => {
    const scope = { worldId: state.worldId, sessionId: state.sessionId, npcId: 'aide' }
    const relationshipState: NpcRelationshipState = {
      ...neutralRelationship(scope),
      axes: { ...neutralRelationship(scope).axes, familiarity: 50 },
    }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      undefined,
      undefined,
      undefined,
      relationshipState,
    )

    expect(context.relationship).toEqual({
      schemaVersion: 1,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'medium',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('degrades a missing relationship state to the neutral/no-familiarity context', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context.relationship).toEqual({
      schemaVersion: 1,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'none',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('never leaks raw relationship axis numbers or scope ids into the projected context', () => {
    const scope = { worldId: state.worldId, sessionId: state.sessionId, npcId: 'aide' }
    const relationshipState: NpcRelationshipState = {
      ...neutralRelationship(scope),
      axes: { ...neutralRelationship(scope).axes, familiarity: 77 },
    }
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
      undefined,
      undefined,
      undefined,
      relationshipState,
    )
    const serialized = JSON.stringify(context.relationship)

    expect(serialized).not.toContain('77')
    expect(serialized).not.toContain(scope.sessionId)
    expect(serialized).not.toContain(scope.worldId)
  })
})
