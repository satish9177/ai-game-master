import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type {
  CompactionProposal,
  CompactionRecord,
  CompactionRejectReason,
  ContradictionEdge,
  ProofConsequenceRecord,
} from './compactionContracts'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import { validateArcMembership } from './hierarchy'

/**
 * Mechanical, reject-on-violation compaction gates (ADR-0007 D7, spec
 * §2.3/§2.4). `evaluateProposal` decides one proposal atomically: every
 * member must survive every applicable gate, or the whole proposal is
 * rejected and logged (never partially committed). Splitting a
 * cross-scope proposal into admissible per-scope pieces, or filtering
 * pinned members out before demotion, is `compactionPass.ts`'s job --
 * this module only judges what it is given, so F3's rejection of the
 * unsplit grouping is never masked by pass-level auto-correction.
 */

function scopeOwnerOf(entry: ReadableRecord): string | undefined {
  switch (entry.kind) {
    case 'truth':
      return undefined
    case 'observation':
      return entry.record.observer
    case 'rumor':
      return entry.record.to
    case 'belief':
      return entry.record.holder
    case 'evidence':
      return entry.record.presentedTo
  }
}

/**
 * The pin set (spec §2.4): current beliefs (not superseded) ∪ active-arc
 * members (an arc touching a contradiction/supersession edge) ∪ granted
 * evidence ∪ live-reducer inputs. Derived entirely from typed state --
 * no per-entry importance score is ever consulted (D9).
 */
export function derivePinSet(
  records: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  edges: readonly ContradictionEdge[],
  consequences: readonly ProofConsequenceRecord[],
): Set<string> {
  const supersededIds = new Set(edges.filter((edge) => edge.kind === 'supersedes').map((edge) => edge.to))
  const currentBeliefIds = records
    .filter((entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief')
    .filter((entry) => !supersededIds.has(entry.record.id))
    .map((entry) => entry.record.id)

  const contradictionEndpointIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  const activeArcMemberIds = arcs
    .filter((arc) => arc.memberIds.some((id) => contradictionEndpointIds.has(id)))
    .flatMap((arc) => arc.memberIds)

  const grantedEvidenceIds = records
    .filter((entry): entry is Extract<ReadableRecord, { kind: 'evidence' }> => entry.kind === 'evidence')
    .map((entry) => entry.record.id)

  const liveReducerInputIds = consequences.filter((consequence) => consequence.status === 'live').flatMap((consequence) => consequence.inputIds)

  return new Set([...currentBeliefIds, ...activeArcMemberIds, ...grantedEvidenceIds, ...liveReducerInputIds])
}

function committed(proposal: CompactionProposal): CompactionRecord {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: proposal.id,
    action: proposal.action === 'delete' ? 'demote' : proposal.action,
    memberIds: proposal.memberIds,
    rationale: proposal.rationale,
    proposedBy: proposal.proposedBy,
    verdict: 'committed',
    ...(proposal.targetArcId !== undefined ? { targetArcId: proposal.targetArcId } : {}),
  }
}

function rejected(proposal: CompactionProposal, rejectReason: CompactionRejectReason): CompactionRecord {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: proposal.id,
    action: proposal.action,
    memberIds: proposal.memberIds,
    rationale: proposal.rationale,
    proposedBy: proposal.proposedBy,
    verdict: 'rejected',
    rejectReason,
    ...(proposal.targetArcId !== undefined ? { targetArcId: proposal.targetArcId } : {}),
  }
}

/**
 * Evaluates one CompactionProposal atomically against every applicable
 * gate (spec §2.3):
 *  (a) 'delete' is categorically forbidden (D1/F1) -- checked first, before
 *      any member is even resolved.
 *  (b) every member must resolve to a known record.
 *  (c) 'demote' and 'merge_projection' may never group across a
 *      contradiction/supersession edge (D7a/F2).
 *  (d) 'merge_projection' must ride the *exact* validated ArcRecord it
 *      names in `targetArcId`: that arc must exist, still pass
 *      validateArcMembership (ADR-0006 D7), and contain every proposed
 *      member (subset -- the projection may cover only the demoted leaves);
 *      any of these failing is 'projection-not-validated'. It is then held
 *      to the same scope-boundary rule as demote (e): because one validated
 *      arc may legitimately span NPC scopes (arc_pantry holds NPC_B- and
 *      NPC_C-scoped records), the subset check alone is not enough -- a
 *      same-arc, cross-scope member set is rejected 'scope-boundary' so a
 *      projection can never become a cross-scope read surface.
 *  (e) 'demote' additionally requires every member to share one scope
 *      owner (D7b/F3) and none to be pinned (D4/D9) -- a proposal
 *      mixing scopes or including a pinned member is rejected whole,
 *      never partially committed; `compactionPass.ts` is responsible for
 *      presenting already-split, already-pin-filtered member sets here.
 */
export function evaluateProposal(
  proposal: CompactionProposal,
  universe: readonly ReadableRecord[],
  edges: readonly ContradictionEdge[],
  pinSet: ReadonlySet<string>,
  arcs: readonly ArcRecord[],
): CompactionRecord {
  if (proposal.action === 'delete') {
    return rejected(proposal, 'deletion-forbidden')
  }

  const byId = new Map(universe.map((entry) => [entry.record.id, entry]))
  const members = proposal.memberIds.map((id) => byId.get(id))
  if (members.some((entry) => entry === undefined)) {
    return rejected(proposal, 'unknown-record')
  }
  const resolvedMembers = members as ReadableRecord[]

  if (proposal.action === 'demote' || proposal.action === 'merge_projection') {
    const memberIdSet = new Set(proposal.memberIds)
    const groupedByAnEdge = edges.some((edge) => memberIdSet.has(edge.from) && memberIdSet.has(edge.to))
    if (groupedByAnEdge) {
      return rejected(proposal, 'contradiction-edge')
    }
  }

  if (proposal.action === 'merge_projection') {
    const targetArc = proposal.targetArcId === undefined ? undefined : arcs.find((arc) => arc.id === proposal.targetArcId)
    if (targetArc === undefined || validateArcMembership(targetArc, universe).length !== 0) {
      return rejected(proposal, 'projection-not-validated')
    }
    const targetMemberIds = new Set(targetArc.memberIds)
    if (!proposal.memberIds.every((id) => targetMemberIds.has(id))) {
      return rejected(proposal, 'projection-not-validated')
    }
    const scopeOwners = new Set(resolvedMembers.map((entry) => scopeOwnerOf(entry)))
    if (scopeOwners.size > 1 || scopeOwners.has(undefined)) {
      return rejected(proposal, 'scope-boundary')
    }
  }

  if (proposal.action === 'demote') {
    const scopeOwners = new Set(resolvedMembers.map((entry) => scopeOwnerOf(entry)))
    if (scopeOwners.size > 1 || scopeOwners.has(undefined)) {
      return rejected(proposal, 'scope-boundary')
    }
    if (proposal.memberIds.some((id) => pinSet.has(id))) {
      return rejected(proposal, 'pinned-member')
    }
  }

  return committed(proposal)
}
