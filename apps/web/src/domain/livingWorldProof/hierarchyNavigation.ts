import type { ReadableRecord } from './evidenceRecords'
import { readable } from './evidenceRecords'
import type { InteriorDigest } from './hierarchy'
import { buildInteriorDigest, entitledArcMemberIds } from './hierarchy'
import type { ArcRecord } from './hierarchyContracts'
import { buildIndexMap } from './indexMap'

/**
 * Scope-gated, logged navigation over a two-level hierarchy (root + one
 * arc level, ADR-0006 D4/D5/D6). Every list/open/search call is gated per
 * NPC exactly as readEvidence already is; leaf recall itself is untouched
 * -- navigation only changes how an NPC finds an id before dereferencing
 * it through evidenceRecords.readEvidence. An NPC's projected tree
 * contains only nodes with >=1 entitled descendant: out-of-scope branches
 * are invisible, not visible-but-locked -- existence is information.
 */

export const ROOT_NODE_ID = 'root'

export interface ProjectedChildStub {
  nodeId: string
  description: string
}

function childStubDescription(arc: ArcRecord, entitledMemberCount: number): string {
  return `${arc.label} (${entitledMemberCount} entitled record${entitledMemberCount === 1 ? '' : 's'})`
}

function projectedArcs(npc: string, arcs: readonly ArcRecord[], records: readonly ReadableRecord[]): ArcRecord[] {
  return arcs.filter((arc) => entitledArcMemberIds(npc, arc, records).length > 0)
}

export interface ProjectedTree {
  holder: string
  rootDigest: InteriorDigest
  children: ProjectedChildStub[]
}

/**
 * The NPC's full projection: a root digest citing only arcs with >=1
 * entitled member, and matching child stubs. Pure function of the record
 * + arc universe -- never trusts a caller-supplied tree.
 */
export function projectTree(npc: string, arcs: readonly ArcRecord[], records: readonly ReadableRecord[]): ProjectedTree {
  const visibleArcs = projectedArcs(npc, arcs, records)
  const children = visibleArcs.map((arc) => ({
    nodeId: arc.id,
    description: childStubDescription(arc, entitledArcMemberIds(npc, arc, records).length),
  }))

  const rootDigest: InteriorDigest = {
    nodeId: ROOT_NODE_ID,
    holder: npc,
    clauses: children.map((child) => ({ text: child.description, citations: [child.nodeId] })),
    asOf: visibleArcs.map((arc) => arc.id).sort(),
  }

  return { holder: npc, rootDigest, children }
}

export interface TraversalCall {
  caller: string
  op: 'list' | 'open' | 'search'
  target: string
  verdict: 'granted' | 'not_found'
  returnedIds: string[]
}

export interface ListChildrenOutcome {
  result: ProjectedChildStub[]
  call: TraversalCall
}

/**
 * Lists a node's children within the caller's projection. `root` always
 * exists and returns the caller's visible arcs. Any other node id is
 * looked up against the projection: an arc the caller has no entitled
 * member under returns `not_found`, byte-identical to a nonexistent node
 * id -- an unentitled NPC cannot distinguish "hidden" from "does not
 * exist" (F3).
 */
export function listChildren(
  npc: string,
  nodeId: string,
  arcs: readonly ArcRecord[],
  records: readonly ReadableRecord[],
): ListChildrenOutcome {
  if (nodeId === ROOT_NODE_ID) {
    const children = projectTree(npc, arcs, records).children
    return {
      result: children,
      call: { caller: npc, op: 'list', target: nodeId, verdict: 'granted', returnedIds: children.map((child) => child.nodeId) },
    }
  }

  const arc = arcs.find((candidate) => candidate.id === nodeId)
  const visible = arc !== undefined && entitledArcMemberIds(npc, arc, records).length > 0

  // v0 is root + one arc level: a visible arc has no further children of
  // its own, but the lookup itself must still be scope-gated.
  return {
    result: [],
    call: { caller: npc, op: 'list', target: nodeId, verdict: visible ? 'granted' : 'not_found', returnedIds: [] },
  }
}

export interface OpenNodeOutcome {
  result: InteriorDigest | undefined
  call: TraversalCall
}

/**
 * Opens a node and returns its interior digest, gated identically to
 * listChildren. `root` is always openable (its digest is the caller's own
 * projection); an arc with zero entitled members is `not_found`.
 */
export function openNode(
  npc: string,
  nodeId: string,
  arcs: readonly ArcRecord[],
  records: readonly ReadableRecord[],
): OpenNodeOutcome {
  if (nodeId === ROOT_NODE_ID) {
    const digest = projectTree(npc, arcs, records).rootDigest
    return {
      result: digest,
      call: {
        caller: npc,
        op: 'open',
        target: nodeId,
        verdict: 'granted',
        returnedIds: digest.clauses.flatMap((clause) => clause.citations),
      },
    }
  }

  const arc = arcs.find((candidate) => candidate.id === nodeId)
  const memberIds = arc === undefined ? [] : entitledArcMemberIds(npc, arc, records)

  if (arc === undefined || memberIds.length === 0) {
    return {
      result: undefined,
      call: { caller: npc, op: 'open', target: nodeId, verdict: 'not_found', returnedIds: [] },
    }
  }

  return {
    result: buildInteriorDigest(npc, arc, records),
    call: { caller: npc, op: 'open', target: nodeId, verdict: 'granted', returnedIds: memberIds },
  }
}

function recordSearchableValues(entry: ReadableRecord): string[] {
  switch (entry.kind) {
    case 'truth':
      return []
    case 'observation':
      return Object.values(entry.record.perceived)
    case 'rumor':
      return [entry.record.proposition]
    case 'belief':
      return [entry.record.proposition]
    case 'evidence':
      return [entry.record.implies, entry.record.contradicts]
  }
}

export interface SearchResultEntry {
  recordId: string
  description: string
}

export interface SearchScopeOutcome {
  result: SearchResultEntry[]
  call: TraversalCall
}

/**
 * Full-text search evaluated strictly inside readable(npc) -- matching
 * against each record's typed field values (so a hidden perceived.actor
 * like 'zombie_17' is searchable at all), but returning only ids plus
 * engine-templated descriptions, never the matched raw snippet (D6). A
 * query with no in-scope match returns an empty result; the call itself
 * always succeeds (the operation is always permitted -- scope filters the
 * result, it does not deny the query).
 */
export function searchScope(npc: string, query: string, records: readonly ReadableRecord[]): SearchScopeOutcome {
  const needle = query.toLowerCase()
  const scoped = readable(npc, records)
  const descriptionById = new Map(buildIndexMap(npc, records).map((entry) => [entry.recordId, entry.description]))

  const matches = scoped.filter((entry) =>
    recordSearchableValues(entry).some((value) => value.toLowerCase().includes(needle)),
  )

  const result: SearchResultEntry[] = matches.map((entry) => ({
    recordId: entry.record.id,
    description: descriptionById.get(entry.record.id) ?? '',
  }))

  return {
    result,
    call: { caller: npc, op: 'search', target: query, verdict: 'granted', returnedIds: result.map((entry) => entry.recordId) },
  }
}

/** Display-only rendering of a node path. Never used for identity -- citations and logs always pin ids (D3). */
export function renderPath(nodeIds: readonly string[]): string {
  return nodeIds.join('/')
}
