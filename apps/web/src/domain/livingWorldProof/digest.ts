import type { ReadableRecord } from './evidenceRecords'
import { readable } from './evidenceRecords'
import type { IndexMapEntry } from './indexMap'

/**
 * Non-authoritative digest: prose over citations, never state. Every
 * clause buildDigest produces auto-cites the single index-map entry it was
 * built from, so nothing this function emits can ever be uncited by
 * construction -- an uncited or out-of-scope citation can only reach
 * validateDigestCitations through a corrupted digest, exactly the
 * fault-injection shape this module tests against.
 */

export interface DigestClause {
  text: string
  citations: string[]
}

export interface Digest {
  holder: string
  clauses: DigestClause[]
  generatedFrom: string[]
}

export function buildDigest(npc: string, indexMap: readonly IndexMapEntry[]): Digest {
  return {
    holder: npc,
    clauses: indexMap.map((entry) => ({ text: entry.description, citations: [entry.recordId] })),
    generatedFrom: indexMap.map((entry) => entry.recordId),
  }
}

export type CitationIssue =
  | { clauseIndex: number; reason: 'uncited-clause' }
  | { clauseIndex: number; reason: 'citation-out-of-scope'; recordId: string }

/**
 * A digest is valid iff every clause cites at least one record and every
 * citation resolves to a record the holder may actually read. Catches a
 * factual claim smuggled in with no grounded backing, and a citation
 * pointing outside the holder's scope.
 */
export function validateDigestCitations(digest: Digest, records: readonly ReadableRecord[]): CitationIssue[] {
  const readableIds = new Set(readable(digest.holder, records).map((entry) => entry.record.id))
  const issues: CitationIssue[] = []

  digest.clauses.forEach((clause, clauseIndex) => {
    if (clause.citations.length === 0) {
      issues.push({ clauseIndex, reason: 'uncited-clause' })
      return
    }
    for (const citedId of clause.citations) {
      if (!readableIds.has(citedId)) {
        issues.push({ clauseIndex, reason: 'citation-out-of-scope', recordId: citedId })
      }
    }
  })

  return issues
}

export function renderExplanation(digest: Digest): string {
  return digest.clauses.map((clause) => clause.text).join(' ')
}
