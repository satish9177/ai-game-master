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
  }).strict(),
}).strict()

export const WorldEventSchema = z.discriminatedUnion('type', [
  SessionStartedEventSchema,
  MovedToRoomEventSchema,
  ItemAddedEventSchema,
  ItemDiscoveredEventSchema,
  ItemRemovedEventSchema,
  HealthChangedEventSchema,
  StatusChangedEventSchema,
  RoomStateChangedEventSchema,
  MeaningfulObjectAppliedEventSchema,
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
  }).strict(),
])

export type WorldEvent = z.infer<typeof WorldEventSchema>
export type WorldCommand = z.infer<typeof WorldCommandSchema>
export type SessionStartedEvent = Extract<WorldEvent, { type: 'session-started' }>
