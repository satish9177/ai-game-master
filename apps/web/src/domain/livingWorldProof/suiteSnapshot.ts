import { buildDigest, renderExplanation, validateDigestCitations } from './digest'
import { readable, readEvidence } from './evidenceRecords'
import type { ReadableRecord } from './evidenceRecords'
import {
  buildInteriorDigest,
  checkDigestFreshness,
  provenanceOracle,
  validateArcMembership,
  validateInteriorDigestCitations,
} from './hierarchy'
import type { ArcRecord } from './hierarchyContracts'
import { listChildren, openNode, projectTree, ROOT_NODE_ID, searchScope } from './hierarchyNavigation'
import { buildIndexMap } from './indexMap'

/**
 * Pure snapshot functions over the full observable surface of the two
 * already-passed proofs (bounded evidence recovery, hierarchical evidence
 * navigation), used to compare Phase A (pre-compaction) against Phase C
 * (post-compaction) byte-for-byte (spec §5 P1/P2). Every function reused
 * here (readable, readEvidence, buildIndexMap, buildDigest,
 * validateDigestCitations, projectTree, listChildren, openNode,
 * searchScope, buildInteriorDigest, checkDigestFreshness,
 * validateInteriorDigestCitations, provenanceOracle,
 * validateArcMembership) is imported from the committed, unedited
 * modules -- nothing here reimplements or approximates their behavior.
 */

const NPCS = ['NPC_A', 'NPC_B', 'NPC_C', 'NPC_D'] as const
const SEARCH_QUERIES = ['zombie_17', 'pantry', 'guard_malik', 'gate_patrol'] as const
const NONEXISTENT_NODE_PROBE = 'arc_does_not_exist'

/**
 * Every NPC's readable set, index map, digest (+ citation validation),
 * rendered explanation, and a full read-log cross product: every NPC
 * against every record id in the universe (including TruthEvent ids, to
 * capture the always-denied case). This is deliberately exhaustive
 * rather than a handful of literal probes, since P1 requires the *whole*
 * observable read surface to be byte-identical, not a sample of it.
 */
export function captureRecoverySnapshot(records: readonly ReadableRecord[]) {
  const allIds = [...new Set(records.map((entry) => entry.record.id))].sort()

  const perNpc = Object.fromEntries(
    NPCS.map((npc) => {
      const readableIds = readable(npc, records)
        .map((entry) => entry.record.id)
        .sort()
      const indexMap = buildIndexMap(npc, records)
      const digest = buildDigest(npc, indexMap)
      const citationIssues = validateDigestCitations(digest, records)
      const explanation = renderExplanation(digest)
      const reads = allIds.map((recordId) => ({ recordId, outcome: readEvidence(npc, recordId, records) }))

      return [npc, { readableIds, indexMap, digest, citationIssues, explanation, reads }]
    }),
  )

  return { allIds, perNpc }
}

/**
 * Every NPC's projected tree, list/open outcomes for every real node plus
 * one nonexistent probe (parity with the committed suite's not_found
 * check), search results for a fixed probe-query set, every arc's
 * membership validation, every (npc, arc) interior digest with freshness
 * and citation validation, and the provenance oracle for every belief in
 * the universe (not just one NPC's) -- the full surface P2 requires.
 */
export function captureNavigationSnapshot(arcs: readonly ArcRecord[], records: readonly ReadableRecord[]) {
  const nodeIds = [ROOT_NODE_ID, ...arcs.map((arc) => arc.id), NONEXISTENT_NODE_PROBE]
  const beliefs = records.filter((entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief')

  const perNpc = Object.fromEntries(
    NPCS.map((npc) => {
      const tree = projectTree(npc, arcs, records)
      const nodes = Object.fromEntries(
        nodeIds.map((nodeId) => [nodeId, { list: listChildren(npc, nodeId, arcs, records), open: openNode(npc, nodeId, arcs, records) }]),
      )
      const searches = Object.fromEntries(SEARCH_QUERIES.map((query) => [query, searchScope(npc, query, records)]))

      return [npc, { tree, nodes, searches }]
    }),
  )

  const arcMembership = Object.fromEntries(arcs.map((arc) => [arc.id, validateArcMembership(arc, records)]))

  const interiorDigests = Object.fromEntries(
    NPCS.flatMap((npc) =>
      arcs.map((arc) => {
        const digest = buildInteriorDigest(npc, arc, records)
        return [
          `${npc}:${arc.id}`,
          {
            digest,
            freshness: checkDigestFreshness(digest, arc, records),
            citationIssues: validateInteriorDigestCitations(digest, digest.asOf),
          },
        ]
      }),
    ),
  )

  const provenanceOracles = Object.fromEntries(
    beliefs.map((entry) => [entry.record.id, provenanceOracle(entry.record.holder, entry.record, records)]),
  )

  return { perNpc, arcMembership, interiorDigests, provenanceOracles }
}
