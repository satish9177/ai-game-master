import { z } from 'zod'
import {
  CanonSeedSchema,
  InventoryItemSchema,
  UtcIsoDateTimeSchema,
  UuidSchema,
  WORLD_SCHEMA_VERSION,
} from './worldState'

const eventEnvelope = {
  schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
  eventId: UuidSchema,
  sessionId: UuidSchema,
  seq: z.number().int().min(1),
  occurredAt: UtcIsoDateTimeSchema,
}

const SessionStartedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('session-started'),
  payload: z.object({ seed: CanonSeedSchema }).strict(),
}).strict()

const MovedToRoomEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('moved-to-room'),
  payload: z.object({
    fromRoomId: z.string().min(1).optional(),
    toRoomId: z.string().min(1),
  }).strict(),
}).strict()

const ItemAddedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('item-added'),
  payload: z.object({ item: InventoryItemSchema }).strict(),
}).strict()

const ItemDiscoveredEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('item-discovered'),
  payload: z.object({
    roomId: z.string().min(1),
    itemId: z.string().min(1),
  }).strict(),
}).strict()

const OffstageItemTakenEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('offstage-item-taken'),
  payload: z.object({
    roomId: z.string().min(1),
    containerId: z.string().min(1),
    itemId: z.string().min(1),
    actorId: z.string().min(1),
    ruleId: z.string().min(1),
    concealed: z.literal(true),
  }).strict(),
}).strict()

const ItemRemovedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('item-removed'),
  payload: z.object({
    itemId: z.string().min(1),
    quantity: z.number().int().min(1),
  }).strict(),
}).strict()

const HealthChangedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('health-changed'),
  payload: z.object({
    delta: z.number().int(),
    reason: z.string().optional(),
  }).strict(),
}).strict()

const StatusChangedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('status-changed'),
  payload: z.object({
    status: z.string(),
    op: z.enum(['add', 'clear']),
  }).strict(),
}).strict()

const RoomStateChangedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('room-state-changed'),
  payload: z.object({
    roomId: z.string().min(1),
    visited: z.boolean().optional(),
    flags: z.record(z.string(), z.boolean()).optional(),
  }).strict(),
}).strict()

const MeaningfulObjectAppliedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('meaningful-object-applied'),
  payload: z.object({
    roomId: z.string().min(1),
    objectId: z.string().min(1),
    family: z.enum(['document', 'container', 'remains']),
    action: z.enum(['read', 'open', 'search']),
    state: z.enum(['read', 'open', 'looted']),
    item: InventoryItemSchema.optional(),
    clueId: z.string().min(1).optional(),
    objective: z.object({
      questId: z.string().min(1),
      objectiveId: z.string().min(1),
      toStage: z.literal(1),
    }).strict().optional(),
  }).strict(),
}).strict()

const WarrantRuleIdSchema = z.enum([
  'sole-copresent-candidate@1',
  'direct-witness@1',
])

export const WarrantPremiseIdSchema = z.enum([
  'p1-before',
  'p2-after',
  'p3-sole-candidate',
  'p4-no-alternate-access',
  'p1-witnessed-take',
])

const SerializedWarrantPremiseSchema = z.object({
  id: WarrantPremiseIdSchema,
  kind: z.enum(['observed', 'default']),
  observationEventIds: z.array(UuidSchema),
  defeasible: z.boolean(),
}).strict()

export const SerializedWarrantSchema = z.object({
  ruleId: WarrantRuleIdSchema,
  premises: z.array(SerializedWarrantPremiseSchema).min(1),
  defeasiblePremiseIds: z.array(WarrantPremiseIdSchema),
}).strict().superRefine((warrant, context) => {
  const premiseIds = warrant.premises.map((premise) => premise.id)
  if (new Set(premiseIds).size !== premiseIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['premises'],
      message: 'premise ids must be unique',
    })
  }

  warrant.premises.forEach((premise, index) => {
    const provenanceCount = premise.observationEventIds.length
    if (premise.kind === 'default' && provenanceCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['premises', index, 'observationEventIds'],
        message: 'default premises must not carry observation provenance',
      })
    }
    if (premise.kind === 'observed' && provenanceCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['premises', index, 'observationEventIds'],
        message: 'observed premises require observation provenance',
      })
    }
  })

  const expectedDefeasibleIds = warrant.premises
    .filter((premise) => premise.defeasible)
    .map((premise) => premise.id)
  const actualDefeasibleIds = warrant.defeasiblePremiseIds
  const expectedSet = new Set(expectedDefeasibleIds)
  const actualSet = new Set(actualDefeasibleIds)
  if (
    actualSet.size !== actualDefeasibleIds.length
    || actualSet.size !== expectedSet.size
    || [...expectedSet].some((id) => !actualSet.has(id))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['defeasiblePremiseIds'],
      message: 'defeasible premise ids must exactly match defeasible premises',
    })
  }
})

export const SerializedBeliefV1Schema = z.object({
  predicate: z.literal('player-took-item'),
  itemId: z.string().min(1),
  roomId: z.string().min(1),
  confidence: z.literal('high'),
}).strict()

export const SerializedBeliefV2Schema = z.object({
  beliefSchemaVersion: z.literal(2),
  predicate: z.literal('player-took-item'),
  itemId: z.string().min(1),
  roomId: z.string().min(1),
  confidence: z.enum(['low', 'high']),
  warrant: SerializedWarrantSchema,
}).strict()

export const SerializedBeliefSchema = z.union([
  SerializedBeliefV1Schema,
  SerializedBeliefV2Schema,
])

export type SerializedBelief = z.infer<typeof SerializedBeliefSchema>

const NpcActionCommittedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('npc-action-committed'),
  payload: z.object({
    npcId: z.string().min(1),
    roomId: z.string().min(1),
    action: z.literal('bar-exit'),
    targetObjectId: z.string().min(1),
    ruleId: z.string().min(1),
    belief: SerializedBeliefSchema,
    supportingEventIds: z.array(UuidSchema).min(1),
  }).strict(),
}).strict()

const EvidenceDiscoveredEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('evidence-discovered'),
  payload: z.object({
    roomId: z.string().min(1),
    evidenceId: z.string().min(1),
    sourceObjectId: z.string().min(1),
  }).strict(),
}).strict()

const EvidencePresentedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('evidence-presented'),
  payload: z.object({
    roomId: z.string().min(1),
    evidenceId: z.string().min(1),
    toNpcId: z.string().min(1),
    presentationObjectId: z.string().min(1),
    discoveryEventId: UuidSchema,
  }).strict(),
}).strict()

const NpcActionRetractedEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('npc-action-retracted'),
  payload: z.object({
    npcId: z.string().min(1),
    roomId: z.string().min(1),
    action: z.literal('bar-exit'),
    targetObjectId: z.string().min(1),
    ruleId: z.string().min(1),
    defeatedPremiseId: WarrantPremiseIdSchema,
    evidenceId: z.string().min(1),
    supersedesEventId: UuidSchema,
    supportingEventIds: z.array(UuidSchema).min(1),
  }).strict(),
}).strict()

export const WorldEventSchema = z.discriminatedUnion('type', [
  SessionStartedEventSchema,
  MovedToRoomEventSchema,
  ItemAddedEventSchema,
  ItemDiscoveredEventSchema,
  OffstageItemTakenEventSchema,
  ItemRemovedEventSchema,
  HealthChangedEventSchema,
  StatusChangedEventSchema,
  RoomStateChangedEventSchema,
  MeaningfulObjectAppliedEventSchema,
  NpcActionCommittedEventSchema,
  EvidenceDiscoveredEventSchema,
  EvidencePresentedEventSchema,
  NpcActionRetractedEventSchema,
])

const commandEnvelope = { schemaVersion: z.literal(WORLD_SCHEMA_VERSION) }

export const WorldCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...commandEnvelope,
    type: z.literal('moved-to-room'),
    fromRoomId: z.string().min(1).optional(),
    toRoomId: z.string().min(1),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('item-added'),
    item: InventoryItemSchema,
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('item-discovered'),
    roomId: z.string().min(1),
    itemId: z.string().min(1),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('item-removed'),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('health-changed'),
    delta: z.number().int(),
    reason: z.string().optional(),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('status-changed'),
    status: z.string(),
    op: z.enum(['add', 'clear']),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('room-state-changed'),
    roomId: z.string().min(1),
    visited: z.boolean().optional(),
    flags: z.record(z.string(), z.boolean()).optional(),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('meaningful-object-applied'),
    roomId: z.string().min(1),
    objectId: z.string().min(1),
    family: z.enum(['document', 'container', 'remains']),
    action: z.enum(['read', 'open', 'search']),
    item: InventoryItemSchema.optional(),
    clueId: z.string().min(1).optional(),
    objective: z.object({
      objectiveId: z.string().min(1),
      toStage: z.literal(1),
    }).strict().optional(),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('npc-action-committed'),
    npcId: z.string().min(1),
    roomId: z.string().min(1),
    action: z.literal('bar-exit'),
    targetObjectId: z.string().min(1),
  }).strict(),
  z.object({
    ...commandEnvelope,
    type: z.literal('npc-action-retracted'),
    npcId: z.string().min(1),
    roomId: z.string().min(1),
    action: z.literal('bar-exit'),
    targetObjectId: z.string().min(1),
  }).strict(),
])

export type WorldEvent = z.infer<typeof WorldEventSchema>
export type WorldCommand = z.infer<typeof WorldCommandSchema>
export type SessionStartedEvent = Extract<WorldEvent, { type: 'session-started' }>
