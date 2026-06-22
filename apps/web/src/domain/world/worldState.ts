import { z } from 'zod'

export const WORLD_SCHEMA_VERSION = 1 as const

export const UuidSchema = z.uuid()
export const UtcIsoDateTimeSchema = z.iso.datetime({ offset: false })

export const HealthSchema = z
  .object({
    current: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  })
  .strict()
  .refine((health) => health.current <= health.max, {
    message: 'current health must not exceed max health',
    path: ['current'],
  })

export const InventoryItemSchema = z
  .object({
    itemId: z.string().min(1),
    name: z.string().min(1),
    quantity: z.number().int().min(1),
  })
  .strict()

const InventorySchema = z
  .array(InventoryItemSchema)
  .refine((items) => new Set(items.map((item) => item.itemId)).size === items.length, {
    message: 'inventory itemId values must be unique',
  })

const StatusSchema = z
  .array(z.string())
  .refine((statuses) => new Set(statuses).size === statuses.length, {
    message: 'player status values must be unique',
  })

export const CanonSeedSchema = z
  .object({
    schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
    worldId: UuidSchema,
    name: z.string().min(1),
    startingRoomId: z.string().min(1),
    initialPlayer: z
      .object({
        health: HealthSchema,
        status: StatusSchema.default([]),
        inventory: InventorySchema.default([]),
      })
      .strict(),
  })
  .strict()

export const RoomStateSchema = z
  .object({
    visited: z.boolean(),
    flags: z.record(z.string(), z.boolean()).optional(),
  })
  .strict()

export const WorldStateSchema = z
  .object({
    schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
    worldId: UuidSchema,
    sessionId: UuidSchema,
    currentRoomId: z.string().min(1),
    player: z
      .object({
        health: HealthSchema,
        status: StatusSchema,
      })
      .strict(),
    inventory: InventorySchema,
    roomStates: z.record(z.string().min(1), RoomStateSchema),
    revision: z.number().int().min(1),
    updatedAt: UtcIsoDateTimeSchema,
  })
  .strict()

export type Health = z.infer<typeof HealthSchema>
export type InventoryItem = z.infer<typeof InventoryItemSchema>
export type CanonSeed = z.infer<typeof CanonSeedSchema>
export type RoomState = z.infer<typeof RoomStateSchema>
export type WorldState = z.infer<typeof WorldStateSchema>
