import { z } from 'zod'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'

/**
 * Hierarchical Evidence Navigation v0 schema (ADR-0006 D1/D7). Kept in a
 * separate file so the two already-passed proofs' schema surface in
 * contracts.ts stays untouched -- purely additive. An ArcRecord is engine
 * structure, never a fact: memberIds are record IDs only (never a
 * TruthEvent id, never a path -- ADR-0006 D3/D6), and are only trustworthy
 * once validateArcMembership (hierarchy.ts) has checked them against the
 * record universe. proposedBy is provenance metadata only, distinguishing
 * an LLM proposal from an engine-derived facet grouping; it has no effect
 * on validation or committal.
 */

export const ArcProposedBySchema = z.enum(['llm', 'engine'])

export const ArcRecordSchema = z
  .object({
    schemaVersion: z.literal(LIVING_WORLD_PROOF_SCHEMA_VERSION),
    id: z.string().min(1),
    label: z.string().min(1),
    memberIds: z.array(z.string().min(1)),
    times: z.array(z.string().min(1)).min(1),
    participants: z.array(z.string().min(1)).min(1),
    proposedBy: ArcProposedBySchema,
  })
  .strict()

export type ArcProposedBy = z.infer<typeof ArcProposedBySchema>
export type ArcRecord = z.infer<typeof ArcRecordSchema>
