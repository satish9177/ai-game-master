import { z } from 'zod'
import { InteractionEffectSchema } from './interactions/effects'
import { EncounterSpecSchema } from './encounters/encounterSpec'
import { NPCDialogueSpecSchema } from './dialogue/contracts'
import { NPC_ROUTINE_NPC_TYPES } from './npcRoutinePresets'
import {
  ArchitectureKindSchema,
  ClutterKindSchema,
  EnvironmentKindSchema,
  FurnitureKindSchema,
  HumanoidAppearanceSchema,
  LightFixtureKindSchema,
  ObjectConditionSchema,
  SemanticVariantSchemas,
  VegetationKindSchema,
} from './visuals/contracts'

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
const PositiveVec3 = z.tuple([
  z.number().positive(),
  z.number().positive(),
  z.number().positive(),
])
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')

/** High parser-abuse ceiling; rendering uses weighted resource budgets. */
export const ROOM_OBJECT_ENTRY_LIMIT = 4_096

// Shared transform fields mixed into every object.
const transform = {
  id: z.string().optional(),
  position: Vec3,
  rotationY: z.number().default(0), // degrees about Y
  scale: z.number().positive().default(1),
}


const visualCondition = {
  condition: ObjectConditionSchema.optional().catch(undefined),
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
  variant: SemanticVariantSchemas.throne.optional().catch(undefined),
  ...visualCondition,
  color: Hex.default('#b8860b'),
  ...transform,
})

const Pillar = z.object({
  type: z.literal('pillar'),
  variant: SemanticVariantSchemas.pillar.optional().catch(undefined),
  ...visualCondition,
  radius: z.number().positive().default(0.4),
  height: z.number().positive().default(4),
  color: Hex.default('#cfc8b8'),
  ...transform,
})

const Rug = z.object({
  type: z.literal('rug'),
  variant: SemanticVariantSchemas.rug.optional().catch(undefined),
  ...visualCondition,
  size: z.tuple([z.number().positive(), z.number().positive()]).default([3, 5]),
  color: Hex.default('#7a2f2f'),
  ...transform,
})

const Torch = z.object({
  type: z.literal('torch'),
  variant: SemanticVariantSchemas.torch.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.arch.optional().catch(undefined),
  ...visualCondition,
  width: z.number().positive().default(2.5),
  height: z.number().positive().default(3.5),
  color: Hex.default('#9a9488'),
  interaction: Interaction.optional(),
  ...transform,
})

const Scroll = z.object({
  type: z.literal('scroll'),
  variant: SemanticVariantSchemas.scroll.optional().catch(undefined),
  ...visualCondition,
  interaction: Interaction, // key: 'E'
  color: Hex.default('#e8dcb5'),
  ...transform,
})

// Document vocabulary v0. Unlike scroll, these common generated document forms
// may be visual-only; when an interaction is present the existing E/F path and
// renderer affordance apply unchanged.
const Book = z.object({
  type: z.literal('book'),
  variant: SemanticVariantSchemas.book.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.paper.optional().catch(undefined),
  ...visualCondition,
  size: z.tuple([z.number().positive(), z.number().positive()]).default([0.8, 0.6]),
  color: Hex.default('#e8dcb5'),
  interaction: Interaction.optional(),
  ...transform,
})

const Map = z.object({
  type: z.literal('map'),
  variant: SemanticVariantSchemas.map.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.chest.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.corpse.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.table.optional().catch(undefined),
  ...visualCondition,
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([1.8, 0.9, 1.1]),
  color: Hex.default('#6b4a2e'),
  interaction: Interaction.optional(),
  ...transform,
})

// Story-anchor visual vocabulary v0. These are inert focal props unless an
// existing optional interaction is supplied; no quest, shrine, or puzzle logic.
const Altar = z.object({
  type: z.literal('altar'),
  variant: SemanticVariantSchemas.altar.optional().catch(undefined),
  ...visualCondition,
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([1.8, 1.0, 1.1]),
  color: Hex.default('#8a8172'),
  accentColor: Hex.default('#c4a15a'),
  interaction: Interaction.optional(),
  ...transform,
})

const Statue = z.object({
  type: z.literal('statue'),
  variant: SemanticVariantSchemas.statue.optional().catch(undefined),
  ...visualCondition,
  radius: z.number().positive().default(0.45),
  height: z.number().positive().default(2.2),
  color: Hex.default('#b8b0a2'),
  pedestalColor: Hex.default('#777066'),
  interaction: Interaction.optional(),
  ...transform,
})

// Strange/device/light visual vocabulary v0. These are visual props only:
// machine/artifact may expose existing interactions, candle is presentation-only.
const Machine = z.object({
  type: z.literal('machine'),
  variant: SemanticVariantSchemas.machine.optional().catch(undefined),
  ...visualCondition,
  size: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]).default([1.6, 1.2, 1.0]),
  color: Hex.default('#4f5558'),
  panelColor: Hex.default('#2f3638'),
  pipeColor: Hex.default('#6f665c'),
  interaction: Interaction.optional(),
  ...transform,
})

const Artifact = z.object({
  type: z.literal('artifact'),
  variant: SemanticVariantSchemas.artifact.optional().catch(undefined),
  ...visualCondition,
  radius: z.number().positive().default(0.35),
  height: z.number().positive().default(0.9),
  baseColor: Hex.default('#4b4540'),
  crystalColor: Hex.default('#78d6c6'),
  interaction: Interaction.optional(),
  ...transform,
})

const Candle = z.object({
  type: z.literal('candle'),
  variant: SemanticVariantSchemas.candle.optional().catch(undefined),
  ...visualCondition,
  radius: z.number().positive().default(0.09),
  height: z.number().positive().default(0.22),
  waxColor: Hex.default('#f1e3c0'),
  flameColor: Hex.default('#ffb347'),
  ...transform,
})

const Npc = z.object({
  type: z.literal('npc'),
  appearance: HumanoidAppearanceSchema.optional().catch(undefined),
  name: z.string().min(1),
  interaction: Interaction, // key: 'F'
  color: Hex.default('#3a6ea5'),
  // Closed, optional, data-only category label — never a schedule or behavior
  // command. Any value outside NPC_ROUTINE_NPC_TYPES (wrong type, wrong case,
  // free text, null, etc.) is dropped to undefined so the NPC/room still
  // validates. See ADR-0090.
  npcType: z.enum(NPC_ROUTINE_NPC_TYPES).optional().catch(undefined),
  ...transform,
})

// Generic low-poly filler so the data path is exercised without new builders.
const Prop = z.object({
  type: z.literal('prop'),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.crate.optional().catch(undefined),
  ...visualCondition,
  size: Vec3.default([1, 1, 1]),
  color: Hex.default('#7a5a32'),
  interaction: Interaction.optional(),
  ...transform,
})

// Steel drum — fuel/water/toxic; the color carries the meaning.
const Barrel = z.object({
  type: z.literal('barrel'),
  variant: SemanticVariantSchemas.barrel.optional().catch(undefined),
  ...visualCondition,
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
  variant: SemanticVariantSchemas.debris.optional().catch(undefined),
  ...visualCondition,
  size: Vec3.default([2, 0.8, 2]),
  color: Hex.default('#6b6358'),
  interaction: Interaction.optional(),
  ...transform,
})

// Improvised barrier — planks or stacked sandbags. Blocks streets/doorways.
const Barricade = z.object({
  type: z.literal('barricade'),
  ...visualCondition,
  length: z.number().positive().default(3),
  height: z.number().positive().default(1.2),
  style: z.enum(['planks', 'sandbags']).default('planks'),
  color: Hex.default('#5a4a32'),
  interaction: Interaction.optional(),
  ...transform,
})


/* ---------- reusable semantic visual families ---------- */
// These families broaden generated room composition without exposing asset
// identifiers. Exact models, materials, LODs, and collision remain trusted
// visual-pack registry concerns.
const Architecture = z.object({
  type: z.literal('architecture'),
  kind: ArchitectureKindSchema,
  size: PositiveVec3.default([1, 1, 1]),
  color: Hex.default('#8a8172'),
  accentColor: Hex.default('#554a3d'),
  interaction: Interaction.optional(),
  ...visualCondition,
  ...transform,
})

const Furniture = z.object({
  type: z.literal('furniture'),
  kind: FurnitureKindSchema,
  size: PositiveVec3.default([1, 1, 1]),
  color: Hex.default('#6b4a2e'),
  accentColor: Hex.default('#35251b'),
  interaction: Interaction.optional(),
  ...visualCondition,
  ...transform,
})

const Clutter = z.object({
  type: z.literal('clutter'),
  kind: ClutterKindSchema,
  size: PositiveVec3.default([0.5, 0.5, 0.5]),
  color: Hex.default('#746858'),
  accentColor: Hex.default('#40382f'),
  interaction: Interaction.optional(),
  ...visualCondition,
  ...transform,
})

const Vegetation = z.object({
  type: z.literal('vegetation'),
  kind: VegetationKindSchema,
  size: PositiveVec3.default([1, 1, 1]),
  color: Hex.default('#4f633f'),
  accentColor: Hex.default('#343f2c'),
  interaction: Interaction.optional(),
  ...visualCondition,
  ...transform,
})

const LightFixture = z.object({
  type: z.literal('light-fixture'),
  kind: LightFixtureKindSchema,
  size: PositiveVec3.default([0.5, 0.8, 0.5]),
  color: Hex.default('#4b4035'),
  flameColor: Hex.default('#ffb347'),
  light: z
    .object({
      color: Hex.default('#ff8a3d'),
      intensity: z.number().nonnegative().default(5),
      distance: z.number().nonnegative().default(6),
    })
    .prefault({}),
  flicker: z.boolean().default(false),
  interaction: Interaction.optional(),
  ...visualCondition,
  ...transform,
})
// Shambling figure. Static decoration (no combat/AI). May carry the shared
// optional interaction (e.g. "examine"); the existing indicator handles it.
const Zombie = z.object({
  type: z.literal('zombie'),
  appearance: HumanoidAppearanceSchema.optional().catch(undefined),
  name: z.string().optional(),
  interaction: Interaction.optional(),
  color: Hex.default('#5c6b46'), // torn, sickly clothing
  ...visualCondition,
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
  Altar,
  Statue,
  Machine,
  Artifact,
  Candle,
  Npc,
  Prop,
  Crate,
  Barrel,
  Debris,
  Barricade,
  Architecture,
  Furniture,
  Clutter,
  Vegetation,
  LightFixture,
  Zombie,
])
export type RoomObject = z.infer<typeof RoomObjectSchema>

/* ---------- room envelope ---------- */
export const RoomSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  environmentKind: EnvironmentKindSchema.optional().catch(undefined),
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
  objects: z.array(z.unknown()).max(ROOM_OBJECT_ENTRY_LIMIT),
})
export type RoomSpec = z.infer<typeof RoomSpecSchema>
