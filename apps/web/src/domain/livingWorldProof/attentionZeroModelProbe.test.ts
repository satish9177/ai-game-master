import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  ATTENTION_EXPOSURE_POLICY_VERSION,
  ATTENTION_LEDGER_POLICY_VERSION,
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
} from './attentionCandidatePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import { orderAttentionCandidates } from './attentionCandidateOrdering'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import { renderAttentionRevealPackage } from './attentionTemplate'
import { appendAttentionLedgerRecord, createAttentionLedger } from './attentionLedger'
import type { AttentionLedger } from './attentionLedger'
import {
  assertAttentionZeroModelProbeUnused,
  createAttentionZeroModelProbe,
} from './attentionZeroModelProbe'
import type { AttentionZeroModelProbe } from './attentionZeroModelProbe'

/**
 * A4 — zero generative calls in a cold run of the accepted Stage A path.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D18 no call of any kind in the accepted v0 path; D20 item 16 byte-identical
 *    cold replay with zero calls);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13 D4 "a `MintProbe`-style call-count-zero assertion", §26 T1);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 "a zero-model probe that throws if invoked and assert zero calls in
 *    cold replay"; §9 A4 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * The universal evidence is static: `attentionLedgerStaticClosure.test.ts` scans
 * every Stage A module's comment-stripped source for any network, transport, or
 * outside-service token in any import or call form, and separately proves no file
 * outside the proof directory reaches a Stage A module. What runs here is the
 * corroborating dynamic half — a cold end-to-end run whose only generative seam is
 * a probe that would both count and throw, and which finishes with the count at
 * zero. The negative control below proves the probe would actually notice.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

const PUBLIC_OPEN = createProofQuestCandidate({
  id: 'quest-public-open',
  type: 'reputation_repair',
  status: 'open',
  openedAtLsn: 37,
  openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
  legallyVisibleParties: ['player', 'warden'],
  legallyVisiblePublicStakes: 'restore-public-trust',
  legallyVisibleOriginConsequenceReference: 'consequence-public-37',
  privateParties: ['warden-confidant'],
  secretOpeningDetail: 'private-belief-overturn',
})

const HIDDEN_OPEN = createProofQuestCandidate({
  id: 'quest-hidden-open',
  type: 'reputation_repair',
  status: 'open',
  openedAtLsn: 38,
  openingProvenance: { visibility: 'private' },
  legallyVisibleParties: ['player'],
  privateParties: ['warden'],
  secretOpeningDetail: 'unobserved-belief-overturn',
})

const RESOLVED = createProofQuestCandidate({
  id: 'quest-resolved',
  type: 'reputation_repair',
  status: 'resolved',
  openedAtLsn: 39,
  openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-39' },
  legallyVisibleParties: ['player', 'merchant'],
  legallyVisiblePublicStakes: 'repair-merchant-standing',
})

interface ColdRunResult {
  readonly renderedOutputs: readonly string[]
  readonly ledger: AttentionLedger
}

/**
 * One cold run of the whole accepted Stage A path: A1 accessor, A2 boundary, A3
 * normalization and total order, A4 package, template, and ledger append. The
 * probe is in scope throughout and is the only generative seam on offer; nothing
 * in the path has any reason or any means to reach it.
 */
function coldRun(probe: AttentionZeroModelProbe): ColdRunResult {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: [RESOLVED, HIDDEN_OPEN, PUBLIC_OPEN],
  })
  const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit this snapshot')
  const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, Object.freeze([]))
  if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit these views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')
  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') throw new Error('expected the A3 total order to be total')

  const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
  if (created.kind !== 'ok') throw new Error('expected an empty ledger')

  let ledger = created.ledger
  const renderedOutputs: string[] = []

  for (const attentionCandidate of ordered.orderedCandidates) {
    const built = buildAttentionRevealPackage(attentionCandidate, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (built.kind !== 'ok') throw new Error('expected a package, got refusal: ' + built.reason)
    const rendered = renderAttentionRevealPackage(built.revealPackage, { templateVersion: ATTENTION_TEMPLATE_VERSION })
    if (rendered.kind !== 'ok') throw new Error('expected rendered output, got refusal: ' + rendered.reason)
    renderedOutputs.push(rendered.output)

    const appended = appendAttentionLedgerRecord(ledger, {
      attentionCandidate,
      exposurePolicyVersion: ATTENTION_EXPOSURE_POLICY_VERSION,
      templateChannelPolicyVersion: ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
      templateVersion: ATTENTION_TEMPLATE_VERSION,
      outcome: rendered.resultTag,
      renderedOutputIdentity: rendered.outputIdentity,
    })
    if (appended.kind !== 'ok') throw new Error('expected an append, got refusal: ' + appended.reason)
    ledger = appended.ledger
  }

  // The probe is deliberately still unused at this point; the assertion is the
  // caller's, so a run cannot quietly swallow its own evidence.
  expect(probe.invocationCount()).toBe(0)
  return { renderedOutputs, ledger }
}

describe('A4 — the probe is a real detector', () => {
  it('throws and counts when the seam is reached', () => {
    const probe = createAttentionZeroModelProbe()

    expect(() => probe.invoke('a-deliberate-negative-control')).toThrow(/generative call was attempted/)
    expect(probe.invocationCount()).toBe(1)
    expect(() => assertAttentionZeroModelProbeUnused(probe)).toThrow(/zero generative calls/)
  })

  it('counts a caught invocation, so a swallowed call cannot pass as an absent one', () => {
    const probe = createAttentionZeroModelProbe()

    try {
      probe.invoke('a-swallowed-call')
    } catch {
      // Deliberately ignored: the point is that ignoring it changes nothing.
    }

    expect(probe.invocationCount()).toBe(1)
    expect(() => assertAttentionZeroModelProbeUnused(probe)).toThrow()
  })

  it('gives each probe its own count, so no run inherits or leaks another run\'s', () => {
    const used = createAttentionZeroModelProbe()
    const fresh = createAttentionZeroModelProbe()
    expect(() => used.invoke('elsewhere')).toThrow()

    expect(used.invocationCount()).toBe(1)
    expect(fresh.invocationCount()).toBe(0)
    expect(() => assertAttentionZeroModelProbeUnused(fresh)).not.toThrow()
  })

  it('is frozen, so a run cannot swap the seam for a silent one', () => {
    const probe = createAttentionZeroModelProbe()

    expect(Object.isFrozen(probe)).toBe(true)
    expect(() => {
      (probe as unknown as Record<string, unknown>).invoke = () => undefined
    }).toThrow(TypeError)
  })
})

describe('A4 — a cold run of the accepted Stage A path makes zero generative calls', () => {
  it('completes the whole path with the count still at zero', () => {
    const probe = createAttentionZeroModelProbe()

    const result = coldRun(probe)

    expect(result.renderedOutputs).toHaveLength(1)
    expect(result.ledger.records).toHaveLength(1)
    expect(probe.invocationCount()).toBe(0)
    expect(() => assertAttentionZeroModelProbeUnused(probe)).not.toThrow()
  })

  it('presents only the legally admitted candidate: the hidden and resolved ones never appear', () => {
    const result = coldRun(createAttentionZeroModelProbe())
    const output = result.renderedOutputs.join('\n')

    expect(output).toContain('consequence-public-37')
    expect(output).not.toContain('quest-hidden-open')
    expect(output).not.toContain('unobserved-belief-overturn')
    expect(output).not.toContain('declassification-39')
    expect(output).not.toContain('repair-merchant-standing')
    expect(result.ledger.records.map((record) => record.sourceId)).toEqual(['quest-public-open'])
  })

  it('is byte-identical across repeated cold runs', () => {
    const runs = [0, 1, 2].map(() => {
      const probe = createAttentionZeroModelProbe()
      const result = coldRun(probe)
      assertAttentionZeroModelProbeUnused(probe)
      return canonicalSerialize(result)
    })

    expect(new Set(runs).size).toBe(1)
  })

  it('leaves the authoritative proof-local records untouched by the whole run', () => {
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidates: [RESOLVED, HIDDEN_OPEN, PUBLIC_OPEN],
    })
    const before = canonicalSerialize(snapshot)

    coldRun(createAttentionZeroModelProbe())

    expect(canonicalSerialize(snapshot)).toBe(before)
    expect(snapshot.candidates.map((candidate) => candidate.status)).toEqual(['resolved', 'open', 'open'])
  })
})
