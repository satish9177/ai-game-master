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

/**
 * The accessor's ok result. B4 adds `openingCoordinateViews` as a **separate
 * typed collection** beside the legal views (plan §9): the legal view itself
 * does not widen, and its canonical bytes are unchanged. The two collections
 * are index-aligned and both are in the same canonical `candidateId` order, so
 * a candidate that yields no legal view yields no sidecar either.
 */
export type AttentionQuestCandidateAccessResult =
  | {
      readonly kind: 'ok'
      readonly views: readonly AttentionReadableQuestCandidateView[]
      readonly openingCoordinateViews: readonly AttentionReadableQuestOpeningCoordinateView[]
    }
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

// ---------------------------------------------------------------------------
// B4 — the quest opening-coordinate sidecar (RN019 §4.3)
//
// §9.2 key 7 orders quest candidates by their committed opening LSN. That
// coordinate does not exist on `AttentionReadableQuestCandidateView`: the
// committed legal view carries only the opaque, author-supplied
// `openingProvenanceId`. The authoritative `QuestCandidate` owns `openedAtLsn`,
// but the ordering module may not read an authoritative record and the legal
// view may not widen — its field set and canonical bytes are frozen.
//
// The sidecar is therefore a *separate* accessor-minted A-prime member, never a
// new field on the legal view. It carries exactly the four fields RN019 §4.3
// fixes and nothing else: no status, no private parties, no secret opening
// detail, no raw provenance object, no raw `QuestCandidate`.
// ---------------------------------------------------------------------------

/** The pinned sidecar contract version (RN019 §4.3; plan §3.1). */
export const ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION =
  'attention-quest-opening-coordinate-v1' as const

/** The complete, closed sidecar field set. Any other own key refuses. */
export interface AttentionReadableQuestOpeningCoordinateViewFields {
  readonly openingCoordinateContractVersion: string
  readonly candidateId: string
  readonly openingProvenanceId: string
  readonly openedAtLsn: number
}

/** The exact own keys of a minted sidecar — exported as closure evidence. */
export const ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS: readonly string[] = Object.freeze([
  'candidateId',
  'openedAtLsn',
  'openingCoordinateContractVersion',
  'openingProvenanceId',
])

/**
 * An **independent** module-private nominal mint marker, deliberately not the
 * one the legal quest view uses. Two separate symbols mean a legal quest view
 * can never answer the sidecar authority check, and a sidecar can never answer
 * the view authority check — accessor origin is proven per contract, not per
 * module. Like `ACCESSOR_MINT_MARKER` it is never exported, so no other module
 * can name the key, satisfy the branded type, or mint a value answering to it.
 */
const OPENING_COORDINATE_MINT_MARKER: unique symbol = Symbol('attentionReadableQuestOpeningCoordinate.accessorMint')

/**
 * The sidecar as it leaves the accessor: the closed four-field surface plus its
 * own accessor-origin marker. The marker is installed non-enumerably, so it is
 * absent from `Object.keys`, spread, `for...in`, and `canonicalSerialize` —
 * only the four legal fields are ever observable or serialized.
 */
export type AttentionReadableQuestOpeningCoordinateView =
  AttentionReadableQuestOpeningCoordinateViewFields
    & { readonly [OPENING_COORDINATE_MINT_MARKER]: true }

/**
 * The sole mint for a sidecar. Only the quest accessor may call it —
 * `attentionLedgerStaticClosure.test.ts` asserts that no other module in
 * `apps/web/src` so much as names it. It copies and deeply freezes the four
 * legal fields, so a minted sidecar shares no mutable state with the
 * authoritative candidate it was projected from.
 */
export function mintAttentionReadableQuestOpeningCoordinateView(
  fields: AttentionReadableQuestOpeningCoordinateViewFields,
): AttentionReadableQuestOpeningCoordinateView {
  requireNonEmptyString(fields.openingCoordinateContractVersion, 'opening coordinate contract version')
  if (fields.openingCoordinateContractVersion !== ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION) {
    throw new Error('attentionQuestCandidateContracts: unsupported opening coordinate contract version')
  }
  requireNonEmptyString(fields.candidateId, 'opening coordinate candidate id')
  requireNonEmptyString(fields.openingProvenanceId, 'opening coordinate opening provenance id')
  requireLsn(fields.openedAtLsn, 'opened-at LSN')

  const sidecar: Record<string, unknown> = {
    openingCoordinateContractVersion: fields.openingCoordinateContractVersion,
    candidateId: fields.candidateId,
    openingProvenanceId: fields.openingProvenanceId,
    openedAtLsn: fields.openedAtLsn,
  }
  Object.defineProperty(sidecar, OPENING_COORDINATE_MINT_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return Object.freeze(sidecar) as unknown as AttentionReadableQuestOpeningCoordinateView
}

/**
 * Runtime half of the sidecar's nominal boundary. A structurally identical
 * object literal, a spread copy of a genuine sidecar, and a
 * serialize/deserialize round-trip each answer `false`, because none of them
 * carries the module-private marker.
 */
export function isAccessorMintedAttentionReadableQuestOpeningCoordinateView(
  value: unknown,
): value is AttentionReadableQuestOpeningCoordinateView {
  if (typeof value !== 'object' || value === null) return false
  return (value as { readonly [OPENING_COORDINATE_MINT_MARKER]?: unknown })[OPENING_COORDINATE_MINT_MARKER] === true
}

/**
 * Structural half of the sidecar boundary, owned here rather than at the
 * A-prime constructor so that constructor never has to name `openedAtLsn` —
 * a raw authoritative field name the static closure proof forbids it from
 * mentioning at all. It admits exactly the closed four-field shape: any own key
 * outside the set, any missing key, and any ill-typed value refuse.
 *
 * The LSN check here is `Number.isInteger`, matching `requireLsn` — the
 * *safe*-integer check belongs to the candidate join (RN019 §4.3's
 * `unsafe-quest-opened-at-lsn`), so that refusal stays independently reachable
 * through the legal accessor path rather than being pre-empted here.
 */
export function isStructurallyValidAttentionReadableQuestOpeningCoordinateView(
  value: unknown,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const keys = Object.getOwnPropertyNames(value).sort()
  if (keys.length !== ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS.length) return false
  if (keys.some((key, index) => key !== ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS[index])) return false

  const record = value as Record<string, unknown>
  if (typeof record.openingCoordinateContractVersion !== 'string') return false
  if (record.openingCoordinateContractVersion.trim().length === 0) return false
  if (typeof record.candidateId !== 'string' || record.candidateId.trim().length === 0) return false
  if (typeof record.openingProvenanceId !== 'string' || record.openingProvenanceId.trim().length === 0) return false
  if (typeof record.openedAtLsn !== 'number') return false
  if (!Number.isInteger(record.openedAtLsn) || record.openedAtLsn < 0) return false
  return true
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
