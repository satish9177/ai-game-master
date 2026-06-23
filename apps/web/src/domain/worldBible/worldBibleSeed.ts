import { z } from 'zod'

export const WORLD_BIBLE_SCHEMA_VERSION = 1 as const

export const ThemePackSchema = z.enum(['fantasy-keep', 'post-apoc'])
export const ToneSchema = z.enum(['heroic', 'grim', 'mysterious', 'tense', 'hopeful'])
export const DispositionSchema = z.enum(['ally', 'neutral', 'hostile'])

const NpcSeedSchema = z
  .object({
    name: z.string().min(1).max(40),
    role: z.string().min(1).max(60),
    disposition: DispositionSchema,
  })
  .strict()

const LocationSeedSchema = z
  .object({
    label: z.string().min(1).max(60),
    kind: z.string().min(1).max(40),
  })
  .strict()

const GenerationHintsSchema = z
  .object({
    allowedThemePack: ThemePackSchema,
    keywords: z.array(z.string().min(1).max(24)).max(6),
  })
  .strict()

export const WorldBibleSeedSchema = z
  .object({
    schemaVersion: z.literal(WORLD_BIBLE_SCHEMA_VERSION),
    title: z.string().min(1).max(60),
    themePack: ThemePackSchema,
    tone: ToneSchema,
    premise: z.string().min(1).max(240),
    startingLocation: z.string().min(1).max(120),
    majorConflict: z.string().min(1).max(240),
    factions: z.array(z.string().min(1).max(60)).max(3),
    npcs: z.array(NpcSeedSchema).min(2).max(3),
    locations: z.array(LocationSeedSchema).min(2).max(4),
    generationHints: GenerationHintsSchema,
    canonNotes: z.array(z.string().min(1).max(120)).max(4),
  })
  .strict()

export type WorldBibleSeed = z.infer<typeof WorldBibleSeedSchema>
