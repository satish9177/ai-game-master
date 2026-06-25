import { z } from 'zod'
import { InteractionEffectSchema } from './interactions/effects'
import { EncounterSpecSchema } from './encounters/encounterSpec'
import { NPCDialogueSpecSchema } from './dialogue/contracts'

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
  effect: InteractionEffectSchema.optional(),
  // Optional genre-neutral encounter (ADR-0015). Rides alongside `effect`; when
  // both are present the encounter takes precedence at the composition root.
  encounter: EncounterSpecSchema.optional(),
  dialogue: NPCDialogueSpecSchema.optional(),
  exit: z.object({ toRoomId: z.string().min(1) }).strict().optional(),
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
  interaction: Interaction.optional(),
  ...transform,
})

const Scroll = z.object({
  type: z.literal('scroll'),
  interaction: Interaction, // key: 'E'
  color: Hex.default('#e8dcb5'),
  ...transform,
})

// Document vocabulary v0. Unlike scroll, these common generated document forms
// may be visual-only; when an interaction is present the existing E/F path and
// renderer affordance apply unchanged.
const Book = z.object({
  type: z.literal('book'),
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([0.7, 0.14, 0.5]),
  coverColor: Hex.default('#6b3f2a'),
  pageColor: Hex.default('#e8dcb5'),
  interaction: Interaction.optional(),
  ...transform,
})

const Paper = z.object({
  type: z.literal('paper'),
  size: z.tuple([z.number().positive(), z.number().positive()]).default([0.8, 0.6]),
  color: Hex.default('#e8dcb5'),
  interaction: Interaction.optional(),
  ...transform,
})

const Map = z.object({
  type: z.literal('map'),
  size: z.tuple([z.number().positive(), z.number().positive()]).default([1.4, 0.9]),
  color: Hex.default('#d6c28e'),
  markColor: Hex.default('#8a3f2f'),
  interaction: Interaction.optional(),
  ...transform,
})

// Practical prop vocabulary v0. These are inert visual room objects unless the
// generator provides an existing optional interaction; no inventory, combat, or
// story behavior is implied by the type alone.
const Chest = z.object({
  type: z.literal('chest'),
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([1.2, 0.8, 0.75]),
  color: Hex.default('#6b4a2e'),
  trimColor: Hex.default('#3a2518'),
  latchColor: Hex.default('#b88a3c'),
  interaction: Interaction.optional(),
  ...transform,
})

const Corpse = z.object({
  type: z.literal('corpse'),
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([0.75, 0.24, 1.75]),
  color: Hex.default('#5a5148'),
  clothColor: Hex.default('#4f5f4a'),
  interaction: Interaction.optional(),
  ...transform,
})

const Table = z.object({
  type: z.literal('table'),
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([1.8, 0.9, 1.1]),
  color: Hex.default('#6b4a2e'),
  interaction: Interaction.optional(),
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

/* ---------- zombie / post-apocalyptic asset pack v0 ---------- */
// A small, reusable vocabulary for ruined cities, raider camps, safe houses,
// abandoned interiors, and survival rooms. All fields are data only (numbers,
// enums, #rrggbb); the trusted renderer owns the geometry.

// Wooden supply/loot crate (storage, stashes).
const Crate = z.object({
  type: z.literal('crate'),
  size: Vec3.default([1, 1, 1]),
  color: Hex.default('#7a5a32'),
  interaction: Interaction.optional(),
  ...transform,
})

// Steel drum — fuel/water/toxic; the color carries the meaning.
const Barrel = z.object({
  type: z.literal('barrel'),
  radius: z.number().positive().default(0.35),
  height: z.number().positive().default(0.95),
  color: Hex.default('#46603a'),
  interaction: Interaction.optional(),
  ...transform,
})

// Rubble/wreckage pile. The builder scatters a fixed, deterministic cluster
// scaled to `size`; no randomness, so it round-trips and tests cleanly.
const Debris = z.object({
  type: z.literal('debris'),
  size: Vec3.default([2, 0.8, 2]),
  color: Hex.default('#6b6358'),
  interaction: Interaction.optional(),
  ...transform,
})

// Improvised barrier — planks or stacked sandbags. Blocks streets/doorways.
const Barricade = z.object({
  type: z.literal('barricade'),
  length: z.number().positive().default(3),
  height: z.number().positive().default(1.2),
  style: z.enum(['planks', 'sandbags']).default('planks'),
  color: Hex.default('#5a4a32'),
  interaction: Interaction.optional(),
  ...transform,
})

// Shambling figure. Static decoration (no combat/AI). May carry the shared
// optional interaction (e.g. "examine"); the existing indicator handles it.
const Zombie = z.object({
  type: z.literal('zombie'),
  name: z.string().optional(),
  interaction: Interaction.optional(),
  color: Hex.default('#5c6b46'), // torn, sickly clothing
  ...transform,
})

export const RoomObjectSchema = z.discriminatedUnion('type', [
  Throne,
  Pillar,
  Rug,
  Torch,
  Arch,
  Scroll,
  Book,
  Paper,
  Map,
  Chest,
  Corpse,
  Table,
  Npc,
  Prop,
  Crate,
  Barrel,
  Debris,
  Barricade,
  Zombie,
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
