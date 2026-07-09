import type { Belief } from './contracts'
import type { ReadableRecord } from './evidenceRecords'
import { readable, recordTime } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import { buildIndexMap } from './indexMap'

/**
 * Structure and interior digests for Hierarchical Evidence Navigation v0
 * (ADR-0006). Hierarchy nodes hold organization, never facts (D1): an
 * ArcRecord's memberIds are record IDs, validated for participant/time
 * overlap before being trusted (D7); an InteriorDigest is a recursively
 * non-authoritative, cited, regenerable rendering over a holder's entitled
 * members (D2), never state. No LLM, no I/O, no Date.now/Math.random --
 * `asOf` is a content fingerprint (the sorted entitled-id set at build
 * time), not a wall-clock time, so staleness is deterministic and doesn't
 * require regeneration to have happened (D8).
 */

function recordParticipants(entry: ReadableRecord): string[] {
  switch (entry.kind) {
    case 'truth':
      return []
    case 'observation':
      return [entry.record.observer]
    case 'rumor':
      return [entry.record.from, entry.record.to]
    case 'belief':
      return [entry.record.holder]
    case 'evidence':
      return [entry.record.presentedTo]
  }
}

export type ArcMembershipIssue =
  | { arcId: string; recordId: string; reason: 'unknown-record' }
  | { arcId: string; recordId: string; reason: 'truth-event-forbidden' }
  | { arcId: string; recordId: string; reason: 'no-participant-overlap' }
  | { arcId: string; recordId: string; reason: 'time-out-of-span' }

/**
 * Engine-side validation of an LLM-proposed (or engine-derived) ArcRecord:
 * a member must resolve to a known non-TruthEvent record, overlap the arc
 * on >=1 participant, AND fall inside the arc's time set. Either
 * condition failing is reported -- both are required, mirroring the
 * research spec's "AND" rule, so a member sharing a participant with the
 * wrong-window arc (the misrouted-record fault) is still rejected.
 */
export function validateArcMembership(arc: ArcRecord, records: readonly ReadableRecord[]): ArcMembershipIssue[] {
  const byId = new Map(records.map((entry) => [entry.record.id, entry]))
  const issues: ArcMembershipIssue[] = []

  for (const memberId of arc.memberIds) {
    const entry = byId.get(memberId)

    if (entry === undefined) {
      issues.push({ arcId: arc.id, recordId: memberId, reason: 'unknown-record' })
      continue
    }
    if (entry.kind === 'truth') {
      issues.push({ arcId: arc.id, recordId: memberId, reason: 'truth-event-forbidden' })
      continue
    }

    const overlapsParticipant = recordParticipants(entry).some((participant) => arc.participants.includes(participant))
    const inTimeSpan = arc.times.includes(recordTime(entry))

    if (!overlapsParticipant) {
      issues.push({ arcId: arc.id, recordId: memberId, reason: 'no-participant-overlap' })
    }
    if (!inTimeSpan) {
      issues.push({ arcId: arc.id, recordId: memberId, reason: 'time-out-of-span' })
    }
  }

  return issues
}

/**
 * The subset of an arc's memberIds a given NPC may actually read --
 * re-derived from readable() on every call, never trusted from a cached
 * projection (same discipline as evidenceRecords.readable/readEvidence).
 */
export function entitledArcMemberIds(npc: string, arc: ArcRecord, records: readonly ReadableRecord[]): string[] {
  const entitledIds = new Set(readable(npc, records).map((entry) => entry.record.id))
  return arc.memberIds.filter((id) => entitledIds.has(id))
}

export interface DigestClause {
  text: string
  citations: string[]
}

export interface InteriorDigest {
  nodeId: string
  holder: string
  clauses: DigestClause[]
  /** Sorted entitled-id snapshot the digest was generated from -- a content fingerprint, not a timestamp. */
  asOf: string[]
}

/**
 * Builds an arc-level interior digest: one auto-cited clause per entitled
 * member, using the record's engine-templated index-map description
 * (indexMap.ts) rather than new prose -- split index authorship (D2/D5)
 * extended one level up. Never includes a record the holder cannot read.
 */
export function buildInteriorDigest(npc: string, arc: ArcRecord, records: readonly ReadableRecord[]): InteriorDigest {
  const memberIds = entitledArcMemberIds(npc, arc, records)
  const descriptionById = new Map(buildIndexMap(npc, records).map((entry) => [entry.recordId, entry.description]))

  return {
    nodeId: arc.id,
    holder: npc,
    clauses: memberIds.map((id) => ({ text: descriptionById.get(id) ?? '', citations: [id] })),
    asOf: [...memberIds].sort(),
  }
}

export interface DigestFreshnessResult {
  stale: boolean
  /** Currently entitled ids the digest's asOf snapshot does not cover. */
  missingFromDigest: string[]
  /** Ids the digest's asOf snapshot has that are no longer entitled. */
  removedFromScope: string[]
}

/**
 * Detects staleness by recomputing current entitlement and diffing against
 * the digest's asOf snapshot -- detection never depends on the digest
 * having been regenerated (D8). A newly granted record (e.g. E_claw after
 * presentation) surfaces as missingFromDigest without requiring any
 * mutable "dirty" flag to have been set anywhere.
 */
export function checkDigestFreshness(
  digest: InteriorDigest,
  arc: ArcRecord,
  records: readonly ReadableRecord[],
): DigestFreshnessResult {
  const currentIds = [...entitledArcMemberIds(digest.holder, arc, records)].sort()
  const asOfSet = new Set(digest.asOf)
  const currentSet = new Set(currentIds)

  const missingFromDigest = currentIds.filter((id) => !asOfSet.has(id))
  const removedFromScope = digest.asOf.filter((id) => !currentSet.has(id))

  return { stale: missingFromDigest.length > 0 || removedFromScope.length > 0, missingFromDigest, removedFromScope }
}

export type NodeCitationIssue =
  | { clauseIndex: number; reason: 'uncited-clause' }
  | { clauseIndex: number; reason: 'citation-unknown'; citation: string }

/**
 * Generalized citation validator for an InteriorDigest at any level: every
 * clause must cite >=1 id, and every citation must resolve inside
 * `knownIds` (entitled record ids for an arc digest, entitled arc ids for
 * the root digest). A path-shaped citation (e.g. "root/arc_cellar/E_claw")
 * is rejected by the same membership check -- it simply is not a real id,
 * so paths never substitute for identity (D3).
 */
export function validateInteriorDigestCitations(
  digest: InteriorDigest,
  knownIds: readonly string[],
): NodeCitationIssue[] {
  const known = new Set(knownIds)
  const issues: NodeCitationIssue[] = []

  digest.clauses.forEach((clause, clauseIndex) => {
    if (clause.citations.length === 0) {
      issues.push({ clauseIndex, reason: 'uncited-clause' })
      return
    }
    for (const citation of clause.citations) {
      if (!known.has(citation)) {
        issues.push({ clauseIndex, reason: 'citation-unknown', citation })
      }
    }
  })

  return issues
}

/**
 * Ground-truth sufficient-evidence set for a belief-explanation query: the
 * belief's one-hop provenance (itself + its sourceRef + its supporting
 * ids) intersected with what the holder may actually read. No recursive
 * walk past the holder's own scope -- matches the already-proven recovery
 * rig's rule that an NPC's in-fiction explanation bottoms out at what was
 * transmitted to her, not the full upstream chain.
 */
export function provenanceOracle(npc: string, belief: Belief, records: readonly ReadableRecord[]): string[] {
  const chain = new Set<string>([belief.id, belief.sourceRef, ...belief.supporting])
  const entitledIds = new Set(readable(npc, records).map((entry) => entry.record.id))
  return [...chain].filter((id) => entitledIds.has(id)).sort()
}
