import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { QuestCandidate } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_TEMPLATE_VERSION,
} from './attentionCandidatePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import { orderAttentionCandidates } from './attentionCandidateOrdering'
import {
  ATTENTION_REVEAL_PACKAGE_KEYS,
  ATTENTION_REVEAL_SLOT_ORDER,
  buildAttentionRevealPackage,
} from './attentionRevealPackage'

/**
 * A4 — the Stage A `RevealPackage` subset.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D4 the closed legally-visible field set, D8 an immutable package for
 *    exactly one attempt, D18 deterministic rendering only);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§12 "only legally-visible fields appear ... private parties and secret
 *    origin details are absent, not populated-then-hidden", §27 Q7 lifecycle
 *    preservation through package construction);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 package subset and fixed slot order, §9 A4 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * Every fixture enters through the real A1 accessor, A2 boundary, A3 normalizer
 * and A3 total order, so what is asserted about a package is asserted about a
 * candidate the committed slices actually admitted — not a hand-built stand-in.
 * The few malformed cases that the earlier slices refuse before A4 is reached are
 * built by copying a real normalized candidate and breaking exactly one field;
 * they say so, and they exist because a refusal that is unreachable today is what
 * keeps a later slice from widening the input silently.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

const TEMPLATE_REQUEST = { templateVersion: ATTENTION_TEMPLATE_VERSION } as const

/** The full committed A1 -> A2 -> A3 path, ending in the A3 total order. */
function orderedCandidates(candidates: readonly QuestCandidate[]): readonly AttentionCandidate[] {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, Object.freeze([]))
  if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit these views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')
  const ordered = orderAttentionCandidates(normalized.attentionCandidates)
  if (ordered.kind !== 'ok') throw new Error('expected the A3 total order to be total')
  return ordered.orderedCandidates
}

function onlyCandidate(candidate: QuestCandidate): AttentionCandidate {
  const ordered = orderedCandidates([candidate])
  const only = ordered[0]
  if (only === undefined) throw new Error('expected exactly one normalized candidate')
  return only
}

/** Every legal field populated, plus private fields the view must never carry. */
const FULLY_POPULATED = createProofQuestCandidate({
  id: 'quest-public-open',
  type: 'reputation_repair',
  status: 'open',
  openedAtLsn: 37,
  openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
  legallyVisibleParties: ['warden', 'Player'],
  legallyVisiblePublicStakes: 'restore-public-trust',
  legallyVisibleOriginConsequenceReference: 'consequence-public-37',
  privateParties: ['warden-confidant'],
  secretOpeningDetail: 'private-belief-overturn',
})

/** Only the fields A1 admission itself guarantees: provenance, and nothing else. */
const MINIMALLY_POPULATED = createProofQuestCandidate({
  id: 'quest-minimal-open',
  type: 'reputation_repair',
  status: 'open',
  openedAtLsn: 38,
  openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-38' },
  legallyVisibleParties: [],
  privateParties: ['sealed-witness'],
  secretOpeningDetail: 'sealed-detail',
})

function buildOrThrow(attentionCandidate: AttentionCandidate) {
  const result = buildAttentionRevealPackage(attentionCandidate, TEMPLATE_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected a package, got refusal: ' + result.reason)
  return result.revealPackage
}

describe('A4 — the package is the Stage A subset and nothing more', () => {
  it('carries exactly the four fields the controlling plan section names', () => {
    const revealPackage = buildOrThrow(onlyCandidate(FULLY_POPULATED))

    expect(Object.keys(revealPackage).sort()).toEqual([...ATTENTION_REVEAL_PACKAGE_KEYS])
    expect(ATTENTION_REVEAL_PACKAGE_KEYS).toEqual(['candidateId', 'resultTag', 'slots', 'templateVersion'])
  })

  it('adds no diegetic speaker, channel, recipient, revealer, or reveal-scope semantics', () => {
    // D8's full v0 package carries these; the Stage A subset does not, and this
    // slice may not invent presentation-legitimacy policy for them.
    const bytes = canonicalSerialize(buildOrThrow(onlyCandidate(FULLY_POPULATED)))

    for (const absent of ['channel', 'revealer', 'recipient', 'audience', 'speaker', 'revealScope', 'assertion']) {
      expect(bytes).not.toContain(absent)
    }
  })

  it('names the pinned template version and the derived candidate identity', () => {
    const attentionCandidate = onlyCandidate(FULLY_POPULATED)
    const revealPackage = buildOrThrow(attentionCandidate)

    expect(revealPackage.templateVersion).toBe(ATTENTION_TEMPLATE_VERSION)
    expect(revealPackage.candidateId).toBe(attentionCandidate.candidateId)
    // The coordinates the build accepted are the A3 pins themselves, not a
    // parallel copy that could drift from them.
    expect(attentionCandidate.canonicalizationVersion).toBe(ATTENTION_CANDIDATE_CANONICALIZATION_VERSION)
    expect(attentionCandidate.identitySchemaVersion).toBe(ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION)
    // The derived identity, never the engine-owned source id.
    expect(revealPackage.candidateId).not.toBe(attentionCandidate.sourceId)
  })
})

describe('A4 — approved slots, fixed order, legal values only', () => {
  it('emits present slots in the pinned order', () => {
    const revealPackage = buildOrThrow(onlyCandidate(FULLY_POPULATED))

    expect(revealPackage.slots.map((slot) => slot.slotId)).toEqual([
      'opening-provenance-id',
      'legally-visible-parties',
      'legally-visible-public-stakes',
      'legally-visible-origin-consequence-reference',
    ])
    expect(ATTENTION_REVEAL_SLOT_ORDER).toEqual([
      'opening-provenance-id',
      'legally-visible-parties',
      'legally-visible-public-stakes',
      'legally-visible-origin-consequence-reference',
    ])
  })

  it('copies legal values verbatim, in the canonical order A3 already fixed', () => {
    const attentionCandidate = onlyCandidate(FULLY_POPULATED)
    const revealPackage = buildOrThrow(attentionCandidate)

    expect(revealPackage.slots.map((slot) => [slot.slotId, [...slot.values]])).toEqual([
      ['opening-provenance-id', ['consequence-public-37']],
      // A3 canonicalizes by UTF-16 code unit, so 'Player' precedes 'warden'.
      // A locale collation would order these the other way round; the package
      // re-sorts nothing and simply carries A3's canonical order.
      ['legally-visible-parties', ['Player', 'warden']],
      ['legally-visible-public-stakes', ['restore-public-trust']],
      ['legally-visible-origin-consequence-reference', ['consequence-public-37']],
    ])
    expect([...attentionCandidate.legallyVisibleParties]).toEqual(['Player', 'warden'])
  })

  it('never carries a private party or a secret opening detail', () => {
    const bytes = canonicalSerialize(buildOrThrow(onlyCandidate(FULLY_POPULATED)))

    expect(bytes).not.toContain('warden-confidant')
    expect(bytes).not.toContain('private-belief-overturn')
    expect(bytes).toContain('consequence-public-37')
  })

  it('leaves a legally absent field absent rather than inventing a value for it', () => {
    const revealPackage = buildOrThrow(onlyCandidate(MINIMALLY_POPULATED))
    const bytes = canonicalSerialize(revealPackage)

    expect(revealPackage.slots.map((slot) => slot.slotId)).toEqual(['opening-provenance-id'])
    expect(bytes).not.toContain('legally-visible-parties')
    expect(bytes).not.toContain('legally-visible-public-stakes')
    expect(bytes).not.toContain('legally-visible-origin-consequence-reference')
    // No placeholder, redaction marker, or stand-in prose took the absent slots'
    // place either.
    for (const invented of ['unknown', 'none', 'n/a', 'redacted', 'withheld', 'null']) {
      expect(bytes).not.toContain(invented)
    }
  })

  it('tags a package that carries only the required slot as the deterministic fallback', () => {
    expect(buildOrThrow(onlyCandidate(MINIMALLY_POPULATED)).resultTag).toBe('presentation-fallback')
    expect(buildOrThrow(onlyCandidate(FULLY_POPULATED)).resultTag).toBe('presentation-ready')
  })
})

describe('A4 — determinism and immutability', () => {
  it('is byte-identical across repeated builds from the same committed inputs', () => {
    const first = canonicalSerialize(buildOrThrow(onlyCandidate(FULLY_POPULATED)))
    const second = canonicalSerialize(buildOrThrow(onlyCandidate(FULLY_POPULATED)))

    expect(second).toBe(first)
  })

  it('is deeply frozen, so one package cannot be edited into a second attempt', () => {
    const revealPackage = buildOrThrow(onlyCandidate(FULLY_POPULATED))
    const firstSlot = revealPackage.slots[0]
    if (firstSlot === undefined) throw new Error('expected the required slot')

    expect(Object.isFrozen(revealPackage)).toBe(true)
    expect(Object.isFrozen(revealPackage.slots)).toBe(true)
    expect(Object.isFrozen(firstSlot)).toBe(true)
    expect(Object.isFrozen(firstSlot.values)).toBe(true)
    expect(() => {
      (revealPackage as unknown as Record<string, unknown>).candidateId = 'forged'
    }).toThrow(TypeError)
  })

  it('preserves the A1 snapshot, the A2 surface, and the A3 candidate byte-for-byte', () => {
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidates: [FULLY_POPULATED, MINIMALLY_POPULATED],
    })
    const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
    if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
    const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, Object.freeze([]))
    if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit these views')
    const normalized = normalizeAttentionCandidates(surface.surface)
    if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')

    const snapshotBefore = canonicalSerialize(snapshot)
    const surfaceBefore = canonicalSerialize(surface.surface)
    const candidatesBefore = canonicalSerialize(normalized.attentionCandidates)

    for (const attentionCandidate of normalized.attentionCandidates) {
      expect(buildAttentionRevealPackage(attentionCandidate, TEMPLATE_REQUEST).kind).toBe('ok')
    }

    expect(canonicalSerialize(snapshot)).toBe(snapshotBefore)
    expect(canonicalSerialize(surface.surface)).toBe(surfaceBefore)
    expect(canonicalSerialize(normalized.attentionCandidates)).toBe(candidatesBefore)
    // The engine-owned lifecycle is untouched: the raw candidates are still
    // exactly the values the proof-local owner minted (replay spec §27 Q7).
    expect(snapshot.candidates.map((candidate) => candidate.status)).toEqual(['open', 'open'])
  })

  it('builds one package per candidate in the A3 total order, unchanged', () => {
    const ordered = orderedCandidates([MINIMALLY_POPULATED, FULLY_POPULATED])

    expect(ordered.map((attentionCandidate) => attentionCandidate.sourceId))
      .toEqual(['quest-minimal-open', 'quest-public-open'])
    expect(ordered.map((attentionCandidate) => buildOrThrow(attentionCandidate).candidateId))
      .toEqual(ordered.map((attentionCandidate) => attentionCandidate.candidateId))
  })
})

describe('A4 — missing or unsupported version coordinates refuse', () => {
  const base = onlyCandidate(FULLY_POPULATED)

  it('refuses a missing or unsupported template version', () => {
    expect(buildAttentionRevealPackage(base, { templateVersion: '   ' }))
      .toEqual({ kind: 'refused', reason: 'missing-template-version' })
    expect(buildAttentionRevealPackage(base, { templateVersion: 'attention-extradiegetic-template-v2' }))
      .toEqual({ kind: 'refused', reason: 'unsupported-template-version' })
  })

  // The cases below break exactly one field of a genuinely normalized candidate.
  // A3 cannot emit any of them today; each refusal exists so a later slice that
  // widened the normalized input would fail here rather than present under a
  // coordinate nobody declared.
  const brokenCoordinates: [string, AttentionCandidate, string][] = [
    ['a blank accessor-contract version', { ...base, accessorContractVersion: '  ' }, 'missing-accessor-contract-version'],
    ['a blank canonicalization version', { ...base, canonicalizationVersion: '' }, 'missing-canonicalization-version'],
    ['a later canonicalization version', { ...base, canonicalizationVersion: 'attention-candidate-canonicalization-v2' }, 'unsupported-canonicalization-version'],
    ['a blank identity-schema version', { ...base, identitySchemaVersion: '' }, 'missing-identity-schema-version'],
    ['a later identity-schema version', { ...base, identitySchemaVersion: 'attention-candidate-identity-schema-v2' }, 'unsupported-identity-schema-version'],
    ['a coordinate past the safe-integer ceiling', { ...base, rankingSnapshotLsn: Number.MAX_SAFE_INTEGER + 2 }, 'ranking-snapshot-lsn-out-of-range'],
    ['a negative coordinate', { ...base, rankingSnapshotLsn: -1 }, 'ranking-snapshot-lsn-out-of-range'],
    ['a fractional coordinate', { ...base, rankingSnapshotLsn: 41.5 }, 'ranking-snapshot-lsn-out-of-range'],
    ['a blank candidate id', { ...base, candidateId: ' ' }, 'missing-candidate-id'],
    ['a blank opening-provenance id', { ...base, openingProvenanceId: '' }, 'missing-opening-provenance-id'],
    ['a blank declared party', { ...base, legallyVisibleParties: ['player', ''] }, 'empty-legally-visible-slot-value'],
    ['a blank declared stakes value', { ...base, legallyVisiblePublicStakes: '  ' }, 'empty-legally-visible-slot-value'],
    ['a blank declared origin reference', { ...base, legallyVisibleOriginConsequenceReference: '' }, 'empty-legally-visible-slot-value'],
  ]

  it.each(brokenCoordinates)('refuses %s', (_label, attentionCandidate, reason) => {
    expect(buildAttentionRevealPackage(attentionCandidate, TEMPLATE_REQUEST))
      .toEqual({ kind: 'refused', reason })
  })

  it('refuses a non-numeric ranking coordinate rather than coercing it', () => {
    const notANumber = { ...base, rankingSnapshotLsn: '41' } as unknown as AttentionCandidate

    expect(buildAttentionRevealPackage(notANumber, TEMPLATE_REQUEST))
      .toEqual({ kind: 'refused', reason: 'missing-ranking-snapshot-lsn' })
  })

  it('never repairs: a refusal returns no package at all', () => {
    const result = buildAttentionRevealPackage({ ...base, openingProvenanceId: '' }, TEMPLATE_REQUEST)

    expect(result.kind).toBe('refused')
    expect(Object.keys(result).sort()).toEqual(['kind', 'reason'])
  })
})
