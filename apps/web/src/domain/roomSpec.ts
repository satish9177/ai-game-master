import { z } from 'zod'

/**
 * RoomSpec is DATA ONLY. It describes a room declaratively; the trusted
 * renderer maps known `type` strings to trusted builders. Nothing in here is
 * ever executed as code.
 *
 * This module holds the schema and inferred types only — no behavior. The
 * lenient loader lives in loadRoomSpec.ts.
 *
 * Conventions: Y-up, units in meters, -Z = north, rotationY in degrees.
 */

/* ---------- primitives ---------- */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()])
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')

// Shared transform fields mixed into every object.
const transform = {
  id: z.string().optional(),
  position: Vec3,
  rotationY: z.number().default(0), // degrees about Y
  scale: z.number().positive().default(1),
}

const Interaction = z.object({
  key: z.enum(['E', 'F']),
  prompt: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(), // static dialogue text for v0
})

/* ---------- known object types ---------- */
const Throne = z.object({
  type: z.literal('throne'),
  color: Hex.default('#b8860b'),
  ...transform,
})

const Pillar = z.object({
  type: z.literal('pillar'),
  radius: z.number().positive().default(0.4),
  height: z.number().positive().default(4),
  color: Hex.default('#cfc8b8'),
  ...transform,
})

const Rug = z.object({
  type: z.literal('rug'),
  size: z.tuple([z.number().positive(), z.number().positive()]).default([3, 5]),
  color: Hex.default('#7a2f2f'),
  ...transform,
})

const Torch = z.object({
  type: z.literal('torch'),
  light: z
    .object({
      color: Hex.default('#ff8a3d'),
      intensity: z.number().nonnegative().default(8),
      distance: z.number().nonnegative().default(7),
    })
    .prefault({}),
  flicker: z.boolean().default(false),
  ...transform,
})

const Arch = z.object({
  type: z.literal('arch'),
  width: z.number().positive().default(2.5),
  height: z.number().positive().default(3.5),
  color: Hex.default('#9a9488'),
  ...transform,
})

const Scroll = z.object({
  type: z.literal('scroll'),
  interaction: Interaction, // key: 'E'
  color: Hex.default('#e8dcb5'),
  ...transform,
})

const Npc = z.object({
  type: z.literal('npc'),
  name: z.string().min(1),
  interaction: Interaction, // key: 'F'
  color: Hex.default('#3a6ea5'),
  ...transform,
})

// Generic low-poly filler so the data path is exercised without new builders.
const Prop = z.object({
  type: z.literal('prop'),
  shape: z.enum(['box', 'cylinder', 'cone', 'sphere']).default('box'),
  size: Vec3.default([1, 1, 1]),
  color: Hex.default('#888888'),
  ...transform,
})

export const RoomObjectSchema = z.discriminatedUnion('type', [
  Throne,
  Pillar,
  Rug,
  Torch,
  Arch,
  Scroll,
  Npc,
  Prop,
])
export type RoomObject = z.infer<typeof RoomObjectSchema>

/* ---------- room envelope ---------- */
export const RoomSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  shell: z.object({
    dimensions: z.object({
      width: z.number().positive(), // x
      depth: z.number().positive(), // z
      height: z.number().positive(), // y
    }),
    wallThickness: z.number().positive().default(0.3),
    floorColor: Hex.default('#4a4036'),
    wallColor: Hex.default('#6b6355'),
    exits: z
      .array(
        z.object({
          side: z.enum(['north', 'south', 'east', 'west']),
          width: z.number().positive().default(2.5),
        }),
      )
      .default([]),
  }),
  spawn: z.object({
    position: Vec3,
    yaw: z.number().default(0), // degrees, facing
  }),
  lighting: z
    .object({
      ambient: z
        .object({
          color: Hex.default('#404858'),
          intensity: z.number().nonnegative().default(0.6),
        })
        .prefault({}),
      hemisphere: z
        .object({
          sky: Hex.default('#8090a0'),
          ground: Hex.default('#30281f'),
          intensity: z.number().nonnegative().default(0.5),
        })
        .optional(),
    })
    .prefault({}),
  // Kept loose on purpose: a single bad object must not reject the whole room.
  // Per-object validation happens in loadRoomSpec().
  objects: z.array(z.unknown()),
})
export type RoomSpec = z.infer<typeof RoomSpecSchema>
