import { z } from 'zod'

/**
 * Living World Engine research proof: a self-contained, deterministic
 * pipeline (SceneEvent -> scoped Observation -> Belief/Rumor -> Evidence
 * correction) matching the research vault's Observation Scope Contract and
 * Belief-Update Calculus specs. Additive only -- does not read or write any
 * production WorldEvent, Fact, or NpcMemory type. Pure domain code: no I/O,
 * no Date.now/Math.random/crypto, no LLM. Not wired into any use-case,
 * store, or UI.
 */

export const LIVING_WORLD_PROOF_SCHEMA_VERSION = 1 as const

// ---- World geometry --------------------------------------------------------

export const AreaSchema = z.enum(['doorway', 'interior'])

export const SceneLocationSchema = z
  .object({
    node: z.string().min(1),
    area: AreaSchema.optional(),
  })
  .strict()

export const SightVisibilitySchema = z.enum(['open', 'doorway_only', 'blocked'])
export const SoundVisibilitySchema = z.enum(['clear', 'muffled', 'blocked'])

export const TopologyEdgeSchema = z
  .object({
    a: z.string().min(1),
    b: z.string().min(1),
    sight: SightVisibilitySchema,
    sound: SoundVisibilitySchema,
  })
  .strict()

export const TopologySchema = z
  .object({
    nodes: z.array(z.string().min(1)).min(1),
    edges: z.array(TopologyEdgeSchema),
  })
  .strict()

export const NpcPositionSchema = z
  .object({
    npc: z.string().min(1),
    node: z.string().min(1),
  })
  .strict()

// ---- Truth ------------------------------------------------------------------

// v0 exercises sight and sound only, mirroring the research vault's
// Observation Scope Contract v0 (smell/touch/social_report are deferred).
export const SightEmissionSchema = z
  .object({
    channel: z.literal('sight'),
    exposes: z.array(z.enum(['actor', 'action', 'target', 'location'])).min(1),
  })
  .strict()

export const SoundEmissionSchema = z
  .object({
    channel: z.literal('sound'),
    signature: z.string().min(1),
    loudness: z.enum(['quiet', 'loud']),
    exposes: z.array(z.enum(['sound_signature', 'direction'])).min(1),
  })
  .strict()

export const EmissionSchema = z.discriminatedUnion('channel', [SightEmissionSchema, SoundEmissionSchema])

export const SceneEventSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    actor: z.string().min(1),
    action: z.string().min(1),
    target: z.string().min(1),
    location: SceneLocationSchema,
    time: z.string().min(1),
    emissions: z.array(EmissionSchema).min(1),
  })
  .strict()

// ---- Observation --------------------------------------------------------------

export const ObservedChannelSchema = z.enum(['sight', 'sound'])
export const FidelitySchema = z.enum(['full', 'partial'])

export const ObservationSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    observer: z.string().min(1),
    // Engine-only audit pointer -- never rendered to the observer or an LLM
    // prompt; it exists so a scope decision can be checked, not dereferenced.
    truthRef: z.string().min(1),
    channels: z.array(ObservedChannelSchema).min(1),
    perceived: z.record(z.string(), z.string()),
    missing: z.array(z.string()),
    fidelity: FidelitySchema,
    time: z.string().min(1),
  })
  .strict()

// ---- Belief / Rumor / Evidence ------------------------------------------------

export const ConfidenceSchema = z.enum(['low', 'medium', 'high'])
export const BeliefSourceTypeSchema = z.enum(['observation', 'inference', 'rumor', 'evidence'])

export const BeliefSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    holder: z.string().min(1),
    proposition: z.string().min(1),
    confidence: ConfidenceSchema,
    sourceType: BeliefSourceTypeSchema,
    sourceRef: z.string().min(1),
    supporting: z.array(z.string()),
    contradicting: z.array(z.string()),
    lastUpdated: z.string().min(1),
  })
  .strict()

export const TrustSchema = z.enum(['low', 'medium', 'high'])

// v0 mutation is a single named, non-generative operation (never LLM text
// generation): a retelling either passes a proposition through unchanged
// (`faithful`) or sharpens its specificity (`dropped_hedge`). Either way the
// belief-update calculus pins confidence at `low` -- see beliefUpdate.ts.
export const MutationSchema = z.enum(['faithful', 'dropped_hedge'])

export const RumorTransmissionSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    proposition: z.string().min(1),
    sourceBelief: z.string().min(1),
    mutation: MutationSchema,
    speakerTrust: TrustSchema,
    time: z.string().min(1),
  })
  .strict()

export const EvidenceStrengthSchema = z.enum(['soft', 'hard'])

export const EvidenceSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    truthRef: z.string().min(1),
    implies: z.string().min(1),
    contradicts: z.string().min(1),
    strength: EvidenceStrengthSchema,
    presentedTo: z.string().min(1),
    time: z.string().min(1),
  })
  .strict()

export type Area = z.infer<typeof AreaSchema>
export type SceneLocation = z.infer<typeof SceneLocationSchema>
export type Topology = z.infer<typeof TopologySchema>
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>
export type NpcPosition = z.infer<typeof NpcPositionSchema>
export type Emission = z.infer<typeof EmissionSchema>
export type SceneEvent = z.infer<typeof SceneEventSchema>
export type ObservedChannel = z.infer<typeof ObservedChannelSchema>
export type Fidelity = z.infer<typeof FidelitySchema>
export type Observation = z.infer<typeof ObservationSchema>
export type Confidence = z.infer<typeof ConfidenceSchema>
export type BeliefSourceType = z.infer<typeof BeliefSourceTypeSchema>
export type Belief = z.infer<typeof BeliefSchema>
export type Trust = z.infer<typeof TrustSchema>
export type Mutation = z.infer<typeof MutationSchema>
export type RumorTransmission = z.infer<typeof RumorTransmissionSchema>
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
