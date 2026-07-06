import type { FamiliarityBucket } from './dialogueContext'

/**
 * Pure, closed, dry-at-runtime contract for a future relationship-journal
 * feature (ADR-0082). It builds candidate *data* and renders *closed text*
 * for a strictly upward familiarity bucket crossing only -- trust/respect/
 * fear stay dry (relationship-valence-reducer-v0) and have no path here.
 * Nothing in production code calls this module yet; see
 * relationshipJournalCandidate.test.ts for the dry-at-runtime proof.
 */

export const NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION = 1 as const

export type RelationshipJournalTemplateId = 'familiarity_increased'

export const RELATIONSHIP_JOURNAL_TEMPLATES: Readonly<Record<RelationshipJournalTemplateId, string>> =
  Object.freeze({
    familiarity_increased: 'Someone here seems more familiar with you.',
  })

export type RelationshipJournalCandidate = {
  schemaVersion: typeof NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION
  kind: 'npc_relationship_journal_candidate'
  npcId: string
  axis: 'familiarity'
  direction: 'increased'
  fromBucket: FamiliarityBucket
  toBucket: FamiliarityBucket
  templateId: RelationshipJournalTemplateId
  dedupeKey: string
}

export type RelationshipJournalCandidateInput = {
  worldId: string
  sessionId: string
  npcId: string
  fromBucket: FamiliarityBucket
  toBucket: FamiliarityBucket
}

const FAMILIARITY_BUCKET_RANK: Record<FamiliarityBucket, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

function buildDedupeKey(input: RelationshipJournalCandidateInput): string {
  return `relationship-journal:${input.worldId}:${input.sessionId}:${input.npcId}:familiarity:increased:${input.toBucket}`
}

/**
 * Pure builder: returns exactly one candidate on a strictly upward
 * familiarity bucket crossing, else null. Reads only closed enum bucket
 * values plus scope ids -- never a raw score or delta.
 */
export function buildRelationshipJournalCandidate(
  input: RelationshipJournalCandidateInput,
): RelationshipJournalCandidate | null {
  const fromRank = FAMILIARITY_BUCKET_RANK[input.fromBucket]
  const toRank = FAMILIARITY_BUCKET_RANK[input.toBucket]

  if (fromRank === undefined || toRank === undefined) return null
  if (toRank <= fromRank) return null

  return {
    schemaVersion: NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION,
    kind: 'npc_relationship_journal_candidate',
    npcId: input.npcId,
    axis: 'familiarity',
    direction: 'increased',
    fromBucket: input.fromBucket,
    toBucket: input.toBucket,
    templateId: 'familiarity_increased',
    dedupeKey: buildDedupeKey(input),
  }
}

/** Pure renderer: text comes exclusively from the frozen closed table. */
export function renderRelationshipJournalText(candidate: RelationshipJournalCandidate): string {
  return RELATIONSHIP_JOURNAL_TEMPLATES[candidate.templateId]
}
