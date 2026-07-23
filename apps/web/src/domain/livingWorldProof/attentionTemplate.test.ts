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
import { ATTENTION_TEMPLATE_VERSION } from './attentionCandidatePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import { buildAttentionRevealPackage } from './attentionRevealPackage'
import type { AttentionRevealPackage, AttentionRevealSlotId } from './attentionRevealPackage'
import {
  ATTENTION_TEMPLATE_SLOT_LABELS,
  renderAttentionRevealPackage,
} from './attentionTemplate'

/**
 * A4 — the deterministic extradiegetic template.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D18 deterministic templates only and no call to any generative service in
 *    the accepted v0 path, D10 extradiegetic presentation, D8 the approved
 *    artifact is the package rather than the prose);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§26 "Template and phrasing isolation" T1-T7, §13 D4 byte-identical cold
 *    replay);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 finite template, fixed slot order, deterministic fallback; §9 A4
 *    slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

const TEMPLATE_REQUEST = { templateVersion: ATTENTION_TEMPLATE_VERSION } as const

function normalizedCandidate(candidate: QuestCandidate): AttentionCandidate {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: [candidate],
  })
  const access = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (access.kind !== 'ok') throw new Error('expected the A1 accessor to admit this fixture')
  const surface = constructAttentionReadableSurface(A1_REQUEST, access.views, Object.freeze([]))
  if (surface.kind !== 'ok') throw new Error('expected the A2 boundary to admit this view')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected A3 normalization to succeed')
  const only = normalized.attentionCandidates[0]
  if (only === undefined) throw new Error('expected exactly one normalized candidate')
  return only
}

function packageFor(candidate: QuestCandidate): AttentionRevealPackage {
  const result = buildAttentionRevealPackage(normalizedCandidate(candidate), TEMPLATE_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected a package, got refusal: ' + result.reason)
  return result.revealPackage
}

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

function renderOrThrow(revealPackage: AttentionRevealPackage) {
  const result = renderAttentionRevealPackage(revealPackage, TEMPLATE_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected rendered output, got refusal: ' + result.reason)
  return result
}

describe('A4 — the finite template renders exactly the approved package', () => {
  it('produces the pinned line shape, in the pinned slot order', () => {
    const revealPackage = packageFor(FULLY_POPULATED)
    const rendered = renderOrThrow(revealPackage)

    expect(rendered.output).toBe([
      'attention-reveal/attention-extradiegetic-template-v1',
      'candidate/' + revealPackage.candidateId,
      'opening-provenance/consequence-public-37',
      // A3's canonical UTF-16 code-unit order, carried through verbatim: a host
      // locale collation would put 'Player' after 'warden'.
      'parties/Player|warden',
      'public-stakes/restore-public-trust',
      'origin-consequence/consequence-public-37',
    ].join('\n'))
    expect(rendered.resultTag).toBe('presentation-ready')
  })

  it('renders the deterministic fallback for a package with no optional slot', () => {
    const revealPackage = packageFor(MINIMALLY_POPULATED)
    const rendered = renderOrThrow(revealPackage)

    expect(rendered.output).toBe([
      'attention-reveal/attention-extradiegetic-template-v1',
      'candidate/' + revealPackage.candidateId,
      'opening-provenance/declassification-38',
    ].join('\n'))
    expect(rendered.resultTag).toBe('presentation-fallback')
  })

  it('leaves legally absent information absent instead of writing prose for it', () => {
    const rendered = renderOrThrow(packageFor(MINIMALLY_POPULATED))

    for (const label of ['parties', 'public-stakes', 'origin-consequence']) {
      expect(rendered.output).not.toContain(label)
    }
    for (const invented of ['unknown', 'none', 'redacted', 'withheld', 'no ']) {
      expect(rendered.output).not.toContain(invented)
    }
  })

  it('adds no assertion: every content token came from the package', () => {
    const revealPackage = packageFor(FULLY_POPULATED)
    const rendered = renderOrThrow(revealPackage)

    const packageValues = new Set(revealPackage.slots.flatMap((slot) => [...slot.values]))
    const renderedValues = rendered.lines
      .slice(2)
      .flatMap((line) => (line.split('/')[1] ?? '').split('|'))

    expect(new Set(renderedValues)).toEqual(packageValues)
    // The only non-package tokens are the pinned version, the candidate id, and
    // the pinned labels — the finite template's whole vocabulary.
    const labels = rendered.lines.slice(2).map((line) => line.split('/')[0])
    expect(labels.every((label) => Object.values(ATTENTION_TEMPLATE_SLOT_LABELS).includes(label ?? ''))).toBe(true)
  })

  it('never carries a private party or secret detail into the output', () => {
    const rendered = renderOrThrow(packageFor(FULLY_POPULATED))

    expect(rendered.output).not.toContain('warden-confidant')
    expect(rendered.output).not.toContain('private-belief-overturn')
  })
})

describe('A4 — the template version participates in output identity', () => {
  it('names the pinned version in the first line and in the identity', () => {
    const rendered = renderOrThrow(packageFor(FULLY_POPULATED))

    expect(rendered.lines[0]).toBe('attention-reveal/' + ATTENTION_TEMPLATE_VERSION)
    expect(rendered.templateVersion).toBe(ATTENTION_TEMPLATE_VERSION)
    expect(rendered.outputIdentity.startsWith(ATTENTION_TEMPLATE_VERSION + ':')).toBe(true)
  })

  it('gives different packages different identities, and identical inputs identical ones', () => {
    const full = renderOrThrow(packageFor(FULLY_POPULATED))
    const minimal = renderOrThrow(packageFor(MINIMALLY_POPULATED))
    const fullAgain = renderOrThrow(packageFor(FULLY_POPULATED))

    expect(full.outputIdentity).not.toBe(minimal.outputIdentity)
    expect(fullAgain.outputIdentity).toBe(full.outputIdentity)
    expect(fullAgain.output).toBe(full.output)
  })

  it('is byte-identical across repeated cold renders', () => {
    const runs = [0, 1, 2].map(() => canonicalSerialize(renderOrThrow(packageFor(FULLY_POPULATED))))

    expect(new Set(runs).size).toBe(1)
  })
})

describe('A4 — an unrenderable package refuses and changes nothing', () => {
  const revealPackage = packageFor(FULLY_POPULATED)

  function withSlots(slots: AttentionRevealPackage['slots']): AttentionRevealPackage {
    return { ...revealPackage, slots }
  }

  it('refuses a missing, unsupported, or mismatched template version', () => {
    expect(renderAttentionRevealPackage(revealPackage, { templateVersion: ' ' }))
      .toEqual({ kind: 'refused', reason: 'missing-template-version' })
    expect(renderAttentionRevealPackage(revealPackage, { templateVersion: 'attention-extradiegetic-template-v2' }))
      .toEqual({ kind: 'refused', reason: 'unsupported-template-version' })
    expect(renderAttentionRevealPackage(
      { ...revealPackage, templateVersion: 'attention-extradiegetic-template-v0' },
      TEMPLATE_REQUEST,
    )).toEqual({ kind: 'refused', reason: 'template-version-mismatch' })
  })

  // Each malformed package below is built by breaking exactly one property of a
  // genuinely built package. `buildAttentionRevealPackage` cannot emit any of
  // them; the refusals exist so the renderer never repairs a package it did not
  // approve, whatever a later slice hands it.
  const malformed: [string, AttentionRevealPackage, string][] = [
    ['a package tagged as already failed', { ...revealPackage, resultTag: 'presentation-failed' }, 'unrenderable-result-tag'],
    ['a blank candidate id', { ...revealPackage, candidateId: '  ' }, 'missing-candidate-id'],
    [
      'an unknown slot',
      withSlots([{
        slotId: 'private-parties' as unknown as AttentionRevealSlotId,
        values: ['warden-confidant'],
      }]),
      'unknown-template-slot',
    ],
    [
      'a repeated slot',
      withSlots([
        { slotId: 'opening-provenance-id', values: ['consequence-public-37'] },
        { slotId: 'opening-provenance-id', values: ['consequence-public-37'] },
      ]),
      'duplicate-template-slot',
    ],
    [
      'slots out of the pinned order',
      withSlots([
        { slotId: 'legally-visible-public-stakes', values: ['restore-public-trust'] },
        { slotId: 'opening-provenance-id', values: ['consequence-public-37'] },
      ]),
      'template-slot-out-of-order',
    ],
    [
      'a slot with no values',
      withSlots([{ slotId: 'opening-provenance-id', values: [] }]),
      'missing-template-slot-value',
    ],
    [
      'a slot with a blank value',
      withSlots([{ slotId: 'opening-provenance-id', values: [' '] }]),
      'missing-template-slot-value',
    ],
    [
      'no opening-provenance slot at all',
      withSlots([{ slotId: 'legally-visible-public-stakes', values: ['restore-public-trust'] }]),
      'missing-required-template-slot',
    ],
  ]

  it.each(malformed)('refuses %s', (_label, broken, reason) => {
    expect(renderAttentionRevealPackage(broken, TEMPLATE_REQUEST)).toEqual({ kind: 'refused', reason })
  })

  it('a refusal returns no output, no identity, and no partial lines', () => {
    const result = renderAttentionRevealPackage({ ...revealPackage, candidateId: '' }, TEMPLATE_REQUEST)

    expect(result.kind).toBe('refused')
    expect(Object.keys(result).sort()).toEqual(['kind', 'reason'])
  })

  it('leaves the package and its candidate byte-identical whether it renders or refuses', () => {
    const attentionCandidate = normalizedCandidate(FULLY_POPULATED)
    const built = buildAttentionRevealPackage(attentionCandidate, TEMPLATE_REQUEST)
    if (built.kind !== 'ok') throw new Error('expected a package')
    const candidateBefore = canonicalSerialize(attentionCandidate)
    const packageBefore = canonicalSerialize(built.revealPackage)

    renderAttentionRevealPackage(built.revealPackage, TEMPLATE_REQUEST)
    renderAttentionRevealPackage(built.revealPackage, { templateVersion: 'attention-extradiegetic-template-v2' })

    expect(canonicalSerialize(attentionCandidate)).toBe(candidateBefore)
    expect(canonicalSerialize(built.revealPackage)).toBe(packageBefore)
  })
})
