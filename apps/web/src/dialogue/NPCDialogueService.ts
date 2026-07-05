import { buildDialogueContext } from '../domain/dialogue/buildDialogueContext'
import type {
  NPCDialogueSpec,
  NPCDialogueTurn,
  QuestDialogueContext,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
} from '../domain/dialogue/contracts'
import type { NpcRelationshipState } from '../domain/npcRelationship/contracts'
import type { PromptTimeContext } from '../domain/world/worldClock'
import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type { Logger } from '../platform/logger/Logger'
import type { WorldSession } from '../world-session/WorldSession'

export type NPCDialogueSession = Pick<WorldSession, 'getWorldState'>

export type NPCDialogueResult =
  | { status: 'replied'; turn: NPCDialogueTurn }
  | { status: 'rejected'; reason: 'missing-dialogue' }
  | { status: 'failed'; reason: 'not-found' | 'provider-unavailable' }

export type NPCDialogueInput = {
  sessionId: string
  npcId: string
  npcName: string
  dialogue?: NPCDialogueSpec
  persona?: string
  history: NPCDialogueTurn[]
  promptId?: string
  playerLine?: string
  roomContext?: RoomDialogueContext
  quest?: QuestDialogueContext
  memoryContext?: RoomMemoryDialogueContext
  relationshipState?: NpcRelationshipState
  timeContext?: PromptTimeContext
}

/** Read-only NPC dialogue coordinator. It has no world-session append capability. */
export class NPCDialogueService {
  private readonly session: NPCDialogueSession
  private readonly provider: NPCDialogueProvider
  private readonly log: Logger

  constructor(session: NPCDialogueSession, provider: NPCDialogueProvider, logger: Logger) {
    this.session = session
    this.provider = provider
    this.log = logger
  }

  async reply(input: NPCDialogueInput): Promise<NPCDialogueResult> {
    const { sessionId, npcId, npcName, dialogue, history, promptId, playerLine } = input
    if (!dialogue) {
      const result = { status: 'rejected', reason: 'missing-dialogue' } as const
      this.logResult({ sessionId, npcId, status: result.status, reason: result.reason, turnCount: history.length })
      return result
    }

    const current = await this.session.getWorldState(sessionId)
    if (!current.ok) {
      const result = { status: 'failed', reason: 'not-found' } as const
      this.logResult({ sessionId, npcId, status: result.status, reason: result.reason, turnCount: history.length })
      return result
    }

    const context = buildDialogueContext(
      current.state,
      { npcId, npcName, persona: input.persona ?? dialogue.persona },
      history,
      input.roomContext,
      input.quest,
      input.memoryContext,
      input.relationshipState,
      input.timeContext,
    )

    try {
      const response = await this.provider.reply({ context, promptId, playerLine })
      const result = {
        status: 'replied',
        turn: { speaker: 'npc', text: response.text },
      } as const
      this.logResult({
        sessionId,
        npcId,
        roomId: current.state.currentRoomId,
        status: result.status,
        turnCount: history.length,
      })
      return result
    } catch {
      const result = { status: 'failed', reason: 'provider-unavailable' } as const
      this.logResult({
        sessionId,
        npcId,
        roomId: current.state.currentRoomId,
        status: result.status,
        reason: result.reason,
        turnCount: history.length,
      })
      return result
    }
  }

  private logResult(input: {
    sessionId: string
    npcId: string
    roomId?: string
    status: NPCDialogueResult['status']
    reason?: 'missing-dialogue' | 'not-found' | 'provider-unavailable'
    turnCount: number
  }): void {
    const context = {
      sessionId: input.sessionId,
      npcId: input.npcId,
      ...(input.roomId ? { roomId: input.roomId } : {}),
      status: input.status,
      ...(input.reason ? { reason: input.reason } : {}),
      turnCount: input.turnCount,
    }
    if (input.status === 'failed') this.log.warn('npc dialogue failed', context)
    else this.log.info('npc dialogue resolved', context)
  }
}
