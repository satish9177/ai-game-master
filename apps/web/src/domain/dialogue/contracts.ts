import { z } from 'zod'
import type { Affordance } from '../interactions/affordance'
import type { RoomObject } from '../roomSpec'
import type { RelationshipDialogueContext } from '../npcRelationship/dialogueContext'
import type { PromptTimeContext, TimeOfDay } from '../world/worldClock'
import type { NpcRoutineMode } from '../npcRoutine'

export const NPCDialoguePromptSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()

export const NPCDialogueSpecSchema = z
  .object({
    persona: z.string().optional(),
    greeting: z.string().optional(),
    prompts: z.array(NPCDialoguePromptSchema).optional(),
  })
  .strict()

export type NPCDialoguePrompt = z.infer<typeof NPCDialoguePromptSchema>
export type NPCDialogueSpec = z.infer<typeof NPCDialogueSpecSchema>

export type NPCDialogueTurn = {
  speaker: 'player' | 'npc'
  text: string
}

export type NPCObjectiveKind = 'inspect' | 'resolve' | 'reach' | 'general'

export type NPCObjectiveContext = {
  status: 'active' | 'complete'
  kind: NPCObjectiveKind
}

export type QuestDialogueContext = {
  activeObjectiveId: string | null
  status: 'active' | 'complete'
  hint?: string
  completionHint?: string
  objective?: NPCObjectiveContext
}

export type RoomMemoryContextEntry = {
  text: string
  kind?: string
}

/**
 * Bounded, non-authoritative recall context (room-memory-recall-context-v0,
 * Slice F). Dialogue-local by design: `domain/dialogue` must not import
 * `domain/memory`, so this is a plain shape rather than a re-export of
 * `RoomMemoryRecord`. The app-layer orchestrator (`app/recallRoomMemoryContext.ts`)
 * maps recalled records into this shape. It is recall/context only — never
 * gameplay truth, never a source of state mutation.
 */
export type RoomMemoryDialogueContext = {
  entries: RoomMemoryContextEntry[]
}

export type BeliefConfidenceBucket = 'low' | 'medium' | 'high'

export type BeliefSourceTrustBucket = 'unknown' | 'low' | 'medium' | 'high'

export type BeliefDialogueContextEntry = {
  /**
   * The holder's belief proposition text, verbatim from the projection.
   * Hedging happens at render time (`buildBeliefSection`), keyed by
   * `confidenceBucket` — never by rewriting this string in place.
   */
  text: string
  confidenceBucket: BeliefConfidenceBucket
  sourceTrustBucket: BeliefSourceTrustBucket
  /**
   * Present only when the belief is a received rumor (`sourceType: 'rumor'`
   * in the spine): the immediate teller the transmission came from, restored
   * in S4.5 item 3 so a holder can say what it was told and by whom. This is
   * the ONE other-holder name a context may carry, and only where a real
   * RumorTransmission to the speaker exists -- exactly the case the leakage
   * instrument already entitles via its direct-transmission rule.
   */
  attributedFrom?: string
}

/**
 * Bounded, holder-scoped belief projection (belief-driven-npc-dialogue-slice-v0,
 * S2). Dialogue-local by design: `domain/dialogue` must not import any
 * cognition module (`domain/livingWorldProof`, `domain/npcBelief`), so this is a
 * plain shape rather than a re-export of spine `Belief` records. The app-layer
 * orchestrator (`app/projectBeliefDialogueContext.ts`) maps the holder's current
 * spine projection into it. It carries only what the speaker is entitled to
 * know: hedged proposition text plus confidence and source-trust buckets, and
 * — where a real transmission to the speaker exists — the immediate teller
 * (`attributedFrom`). No record ids, no evidence ids, no `sourceRef`, no raw
 * scores, and no attributed belief *content* about other minds (depth-1
 * attribution of what another holder currently believes is a different
 * experiment). Like room memory it
 * is recall/context only — never gameplay truth, never a source of state
 * mutation — and what a character believes may be false.
 */
export type BeliefDialogueContext = {
  entries: BeliefDialogueContextEntry[]
}

/**
 * Closed activity label, one per {@link NpcRoutineMode} value (fixed 1:1 mapping,
 * npc-routine-dialogue-context-v0 / ADR-0089).
 */
export type NPCRoutineActivity = 'standing by' | 'patrolling' | 'resting' | 'keeping a quiet watch'

/**
 * Bounded, read-only, advisory current-activity hint (npc-routine-dialogue-context-v0,
 * Slice 1 / ADR-0089). Sourced from the movement layer's already-resolved
 * `NpcRoutineMode` -- never a second resolution. No schedule details, no npc id/name/
 * persona/dialogue/room/prompt/provider/generated text.
 */
export type RoutineDialogueContext = {
  mode: NpcRoutineMode
  activity: NPCRoutineActivity
  timeOfDay: TimeOfDay
}

export type NPCDialogueContext = {
  roomId: string
  npcId: string
  npcName: string
  persona?: string
  room?: RoomDialogueContext
  quest?: QuestDialogueContext
  /** Bounded, non-authoritative room-memory recall context. See `RoomMemoryDialogueContext`. */
  memory?: RoomMemoryDialogueContext
  player: {
    health: { current: number; max: number }
    status: string[]
    inventoryItemIds: string[]
  }
  history: NPCDialogueTurn[]
  /**
   * Bounded, read-only, bucketed relationship hint (npc-relationship-state-v0,
   * Slice 3). Never raw scores, never authoritative -- a compact dialogue-tone
   * hint only. See `RelationshipDialogueContext`.
   */
  relationship?: RelationshipDialogueContext
  /**
   * Bounded, read-only, ambient time-of-day hint only. Never carries numeric day
   * or hour; see `PromptTimeContext`.
   */
  time?: PromptTimeContext
  /**
   * Bounded, read-only, advisory current-activity hint. See `RoutineDialogueContext`.
   */
  routine?: RoutineDialogueContext
  /**
   * Bounded, holder-scoped, read-only belief projection (belief-driven-npc-dialogue-slice-v0,
   * S2). What this character believes — possibly false, second-hand, or
   * unjustified. Never authoritative; see `BeliefDialogueContext`.
   */
  belief?: BeliefDialogueContext
}

export type NPCDialogueRequest = {
  context: NPCDialogueContext
  promptId?: string
  playerLine?: string
}

export type NPCDialogueResponse = {
  text: string
}

export type RoomFeatureDirection = 'north' | 'south' | 'east' | 'west' | 'center'

export type RoomDialogueFeature = {
  type: RoomObject['type']
  direction: RoomFeatureDirection
}

export type RoomDialogueContext = {
  focus?: RoomDialogueFeature
  features: RoomDialogueFeature[]
  affordances: Affordance[]
  npcCount: number
}
