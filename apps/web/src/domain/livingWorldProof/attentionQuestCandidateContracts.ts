/**
 * Stage A proof-local authoritative QuestCandidate input and its legal view.
 * This is not a production quest API, WorldEvent, WorldState field, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2 surface enumeration, D3 type-level admission, D4 accessor contract);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§7 "S1", §8 "S2 — A′-construction closure");
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§4 A1, §9 A1/A2 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 */
export const ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION = 'attention-quest-candidate-accessor-v1' as const

export type QuestCandidateStatus = 'open' | 'resolved'

export type QuestCandidateOpeningProvenance =
  | { readonly visibility: 'public' | 'declassified'; readonly provenanceId: string }
  | { readonly visibility: 'private' | 'unobserved' }

/** Authoritative only inside this proof rig. */
export interface QuestCandidate {
  readonly id: string
  readonly type: 'reputation_repair'
  readonly status: QuestCandidateStatus
  readonly openedAtLsn: number
  readonly openingProvenance: QuestCandidateOpeningProvenance
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
  readonly privateParties: readonly string[]
  readonly secretOpeningDetail?: string
}

export interface QuestCandidateInput {
  readonly id: string
  readonly type: 'reputation_repair'
  readonly status: QuestCandidateStatus
  readonly openedAtLsn: number
  readonly openingProvenance: QuestCandidateOpeningProvenance
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
  readonly privateParties?: readonly string[]
  readonly secretOpeningDetail?: string
}

export interface ProofQuestCandidateSnapshot {
  readonly accessorContractVersion: string
  readonly snapshotLsn: number
  readonly candidates: readonly QuestCandidate[]
}

export interface ProofQuestCandidateSnapshotInput {
  readonly accessorContractVersion: string
  readonly snapshotLsn: number
  readonly candidates: readonly QuestCandidate[]
}

/**
 * The closed set of legally visible view fields (ADR-0013 D4). This is the
 * *shape* of a legal view; on its own it confers no attention-readability.
 */
export interface AttentionReadableQuestCandidateViewFields {
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
  readonly candidateId: string
  readonly openingProvenanceId: string
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
}

/**
 * Module-private nominal mint marker. It is deliberately **not exported**, so
 * no other module — proof-local or production — can name this key, satisfy the
 * branded type, or mint a value that answers to it.
 *
 * ADR-0013 D2 admits into A′ only "`AttentionReadableQuestCandidateView`s ...
 * *obtained from the engine-owned snapshot accessor* (D4)", and D3 requires
 * that admission be "impossible at the accepted input type ... never by a
 * privacy filter a reviewer must police". A purely structural interface cannot
 * carry that: TypeScript's structural typing lets any matching object literal
 * satisfy it, which would let a fabricated candidate bypass D4's
 * open-plus-public/declassified-opening-provenance gate. The marker makes the
 * view nominal, so accessor origin is checkable both at the type level and,
 * because the marker is a real runtime symbol, at the A′ input boundary.
 *
 * A module-private symbol was chosen over a process-global registry (WeakSet or
 * map): it needs no mutable shared state, cannot be enumerated or reached by
 * `Symbol.for`, travels on the already-frozen view itself, and keeps the whole
 * mechanism deterministic and replay-safe.
 */
const ACCESSOR_MINT_MARKER: unique symbol = Symbol('attentionReadableQuestCandidateView.accessorMint')

/**
 * The only Stage A value that may leave the proof-local candidate owner: the
 * legal field surface plus the accessor-origin marker. The marker is
 * non-enumerable, so it is absent from `Object.keys`, object spread, `for...in`,
 * `JSON.stringify`, and `canonicalSerialize` — only the legal string-keyed
 * fields are ever observable.
 */
export type AttentionReadableQuestCandidateView =
  AttentionReadableQuestCandidateViewFields & { readonly [ACCESSOR_MINT_MARKER]: true }

export interface AttentionQuestCandidateAccessRequest {
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
}

export type AttentionQuestCandidateAccessRefusal =
  | 'missing-accessor-contract-version'
  | 'accessor-contract-version-mismatch'
  | 'missing-ranking-snapshot-lsn'
  | 'ranking-snapshot-lsn-mismatch'

export type AttentionQuestCandidateAccessResult =
  | { readonly kind: 'ok'; readonly views: readonly AttentionReadableQuestCandidateView[] }
  | { readonly kind: 'refused'; readonly reason: AttentionQuestCandidateAccessRefusal }

function requireNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error('attentionQuestCandidateContracts: ' + name + ' must be non-empty')
  }
}

function requireLsn(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('attentionQuestCandidateContracts: ' + name + ' must be a non-negative integer')
  }
}

function requireSupportedAccessorContractVersion(value: string): void {
  requireNonEmptyString(value, 'accessor contract version')
  if (value !== ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION) {
    throw new Error('attentionQuestCandidateContracts: unsupported accessor contract version')
  }
}

function freezeStrings(values: readonly string[], name: string): readonly string[] {
  values.forEach((value) => requireNonEmptyString(value, name))
  return Object.freeze([...values])
}

function freezeOpeningProvenance(provenance: QuestCandidateOpeningProvenance): QuestCandidateOpeningProvenance {
  if (provenance.visibility === 'public' || provenance.visibility === 'declassified') {
    requireNonEmptyString(provenance.provenanceId, 'opening provenance id')
    return Object.freeze({ visibility: provenance.visibility, provenanceId: provenance.provenanceId })
  }
  return Object.freeze({ visibility: provenance.visibility })
}

export function createProofQuestCandidate(input: QuestCandidateInput): QuestCandidate {
  requireNonEmptyString(input.id, 'candidate id')
  requireLsn(input.openedAtLsn, 'opened-at LSN')
  if (input.legallyVisiblePublicStakes !== undefined) {
    requireNonEmptyString(input.legallyVisiblePublicStakes, 'legally visible public stakes')
  }
  if (input.legallyVisibleOriginConsequenceReference !== undefined) {
    requireNonEmptyString(input.legallyVisibleOriginConsequenceReference, 'legally visible origin consequence reference')
  }

  return Object.freeze({
    id: input.id,
    type: input.type,
    status: input.status,
    openedAtLsn: input.openedAtLsn,
    openingProvenance: freezeOpeningProvenance(input.openingProvenance),
    legallyVisibleParties: freezeStrings(input.legallyVisibleParties, 'legally visible party'),
    ...(input.legallyVisiblePublicStakes === undefined ? {} : { legallyVisiblePublicStakes: input.legallyVisiblePublicStakes }),
    ...(input.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: input.legallyVisibleOriginConsequenceReference }),
    privateParties: freezeStrings(input.privateParties ?? [], 'private party'),
    ...(input.secretOpeningDetail === undefined ? {} : { secretOpeningDetail: input.secretOpeningDetail }),
  })
}

/**
 * The sole mint for an attention-readable legal view (ADR-0013 D4). Only the
 * A1 accessor may call it — `attentionLedgerStaticClosure.test.ts` asserts that
 * no other module in `apps/web/src` so much as names it. It copies and freezes
 * the legal fields, so a minted view shares no mutable state with the
 * authoritative candidate it was projected from.
 *
 * The marker is installed non-enumerably and the result is frozen, so the mark
 * can be neither observed as data, copied by spread, nor forged afterwards.
 * This is the one place a cast is required: the marker key is module-private,
 * so no literal outside this file can be written to satisfy the branded type.
 */
export function mintAttentionReadableQuestCandidateView(
  fields: AttentionReadableQuestCandidateViewFields,
): AttentionReadableQuestCandidateView {
  const view: Record<string, unknown> = {
    accessorContractVersion: fields.accessorContractVersion,
    rankingSnapshotLsn: fields.rankingSnapshotLsn,
    candidateId: fields.candidateId,
    openingProvenanceId: fields.openingProvenanceId,
    legallyVisibleParties: Object.freeze([...fields.legallyVisibleParties]),
    ...(fields.legallyVisiblePublicStakes === undefined
      ? {}
      : { legallyVisiblePublicStakes: fields.legallyVisiblePublicStakes }),
    ...(fields.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: fields.legallyVisibleOriginConsequenceReference }),
  }
  Object.defineProperty(view, ACCESSOR_MINT_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return Object.freeze(view) as unknown as AttentionReadableQuestCandidateView
}

/**
 * Runtime half of the nominal boundary: does this value actually carry the
 * module-private accessor mark? A structurally identical object literal, a
 * spread copy of a minted view, or any other independently constructed value
 * answers `false`. The A′ boundary calls this; nothing else needs to.
 */
export function isAccessorMintedAttentionReadableQuestCandidateView(
  value: unknown,
): value is AttentionReadableQuestCandidateView {
  if (typeof value !== 'object' || value === null) return false
  return (value as { readonly [ACCESSOR_MINT_MARKER]?: unknown })[ACCESSOR_MINT_MARKER] === true
}

export function createProofQuestCandidateSnapshot(
  input: ProofQuestCandidateSnapshotInput,
): ProofQuestCandidateSnapshot {
  requireSupportedAccessorContractVersion(input.accessorContractVersion)
  requireLsn(input.snapshotLsn, 'snapshot LSN')
  return Object.freeze({
    accessorContractVersion: input.accessorContractVersion,
    snapshotLsn: input.snapshotLsn,
    candidates: Object.freeze([...input.candidates]),
  })
}
