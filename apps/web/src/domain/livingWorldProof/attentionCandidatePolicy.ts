/**
 * Stage A / A3 — the single immutable Stage A policy module for the derived
 * (B-domain) attention candidate. This is not a production module, reducer,
 * event, or persistence contract; it is proof-local to `domain/livingWorldProof`.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D5 source-kind preservation, D6 identity-schema and canonicalization
 *    versions, D14 stable total order);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§4 declared replay inputs, §13.1 total-order tie-break family,
 *    §14 candidate identity fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 obligations, §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * Every value here is a pinned, versioned constant. ADR-0013 D6 requires that
 * canonicalization and identity-schema versions stay *distinct and never
 * collapsed* — a change to either is an explicit, auditable version bump, never
 * a silent format drift — so they are declared separately and the ordering
 * version is declared separately again.
 *
 * Deliberately absent, because no controlling plan section authorizes them:
 * ranking weights or score policy, resource/candidate caps, template assertion
 * caps, window-density limits, cooldown/retirement thresholds, and the A5 trace
 * pins. ADR-0013 open questions 1-3 leave every one of those experiment-owned
 * and unpinned; inventing one here would put a constant nobody chose into every
 * later cache key and trace.
 *
 * The A4 block at the end of this file adds exactly the three pin families the
 * controlling A4 plan section authorizes — "`attentionCandidatePolicy.ts` only
 * for approved template/channel, exposure, and ledger-policy version pins" — and
 * nothing else. No vocabulary, slot order, template text, or ledger field set
 * lives here; each of those is owned by the A4 module that defines it.
 */

/**
 * The versioned canonical byte rule (ADR-0013 D6). It covers *how* an identity
 * input is turned into bytes: deep key sorting, the collection canonical form
 * in `attentionCandidateIdentity.ts`, and the hash encoding those bytes feed.
 */
export const ATTENTION_CANDIDATE_CANONICALIZATION_VERSION = 'attention-candidate-canonicalization-v1' as const

/**
 * The versioned shape of the quest candidate ID itself (ADR-0013 D6) — which
 * fields are identity-affecting, and how the resulting ID string is encoded.
 * Distinct from the canonicalization version above and never collapsed into it.
 * The B4 pattern branch has its own disjoint schema version below; this one
 * remains exactly the committed Stage A quest identity schema so quest
 * candidate IDs stay byte-identical.
 */
export const ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION = 'attention-candidate-identity-schema-v1' as const

/**
 * B4 — the disjoint, versioned pattern candidate identity schema (plan §3.1,
 * §6). A normalized `narrative_pattern_instance` candidate ID is minted under
 * this schema and never under the quest schema above, and the pattern branch
 * never invents an `openingProvenanceId` sentinel to reuse the quest schema.
 */
export const ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION =
  'attention-pattern-candidate-identity-schema-v1' as const

// ---------------------------------------------------------------------------
// B2 pins — narrative-pattern instance contracts and lifecycle only
// ---------------------------------------------------------------------------

/** The semantic contract version of the three closed v0 narrative patterns. */
export const ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION = 1 as const

/** The versioned identity field-set for a derived NarrativePatternInstance. */
export const ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION =
  'attention-narrative-pattern-identity-schema-v1' as const

/** The pure coordinate-based monitor rule used by the B2 lifecycle helpers. */
export const ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION =
  'attention-narrative-pattern-monitor-v1' as const

/** The exact coordinate horizons owned by the B2 narrative-pattern monitor. */
export const ATTENTION_NARRATIVE_PATTERN_STALL_LSN_DELTA = 4 as const
export const ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA = 12 as const
export const ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA = 16 as const

export type AttentionNarrativePatternDerivedAnnotation =
  | 'active'
  | 'stalled'
  | 'expired'
  | 'abandoned'

/**
 * The single B2 annotation rule after callers have validated the three
 * coordinates. Structural abandonment wins over coordinate-derived expiry and
 * stall; strict expiry starts only after the inclusive deadline.
 */
export function deriveAttentionNarrativePatternAnnotation(
  evaluationSnapshotLsn: number,
  lastProgressLsn: number,
  expiryDeadlineLsn: number,
  structurallyAbandoned: boolean,
): AttentionNarrativePatternDerivedAnnotation {
  if (structurallyAbandoned) return 'abandoned'
  if (evaluationSnapshotLsn > expiryDeadlineLsn) return 'expired'
  if (
    evaluationSnapshotLsn - lastProgressLsn
      >= ATTENTION_NARRATIVE_PATTERN_STALL_LSN_DELTA
  ) return 'stalled'
  return 'active'
}

/**
 * The versioned total-order key sequence (ADR-0013 D14). Ordering is ranking
 * policy, so ADR-0013 D6 forbids it from reaching candidate identity: this
 * version is deliberately not an identity input.
 */
export const ATTENTION_CANDIDATE_ORDERING_VERSION = 'attention-candidate-ordering-v2' as const

/**
 * The two cache-key schema versions (ADR-0013 D15; plan §6 "View-cache identity
 * ... Ranking-cache identity"). They are separate pins because the two keys have
 * different semantic dependencies and must be able to move independently. Each
 * is prefixed onto its key, so a key minted under a later schema can never be
 * compared equal to one minted under this schema.
 */
export const ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION =
  'attention-candidate-derivation-cache-key-v2' as const

export const ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION =
  'attention-candidate-ranking-cache-key-v2' as const

/**
 * The bounds on the one numeric field Stage A actually owns: the ranking
 * snapshot coordinate. Plan §6 requires "checked range validation and a typed
 * refusal on overflow", and that "Zero/negative/overflow ... return a typed
 * ineligible/refusal outcome, never an unbounded fallback".
 *
 * Provenance of each bound, stated because neither is a product value the plan
 * pins as a number:
 *
 *  - the minimum is `0`, carried unchanged from A1's committed coordinate rule
 *    (`attentionQuestCandidateContracts.requireLsn`: a non-negative integer);
 *  - the maximum is the JavaScript safe-integer ceiling. It is the only ceiling
 *    under which ADR-0013 D13's "arithmetic cannot overflow within those ranges"
 *    is checkable at all: past it, integers are no longer distinct values, so
 *    two different coordinates could compare and serialize identically.
 *
 * ADR-0013 open questions 1-3 leave every *product* numeric bound — ranking
 * score cutpoints, candidate cap, template assertion cap, window density limit,
 * retirement and cooldown thresholds — explicitly experiment-owned and unpinned.
 * None of them is invented here; see the A3 report for the exact missing
 * decisions.
 */
export const ATTENTION_RANKING_SNAPSHOT_LSN_MIN = 0

export const ATTENTION_RANKING_SNAPSHOT_LSN_MAX = Number.MAX_SAFE_INTEGER

/**
 * The shared bounded-integer check for that coordinate. `Number.isSafeInteger`
 * is false for `NaN`, `Infinity`, `-Infinity`, any fractional value, and any
 * magnitude past the safe ceiling, so a single predicate closes every case the
 * plan names. Nothing here clamps, wraps, truncates, or repairs: a caller either
 * supplies a value inside the range or receives a typed refusal.
 */
export function isAttentionRankingSnapshotLsnInRange(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= ATTENTION_RANKING_SNAPSHOT_LSN_MIN
    && value <= ATTENTION_RANKING_SNAPSHOT_LSN_MAX
}

/**
 * ADR-0013 D5 requires two source kinds for the complete v0 surface. B4 adds
 * the second family, `narrative_pattern_instance`, beside the committed
 * `quest_candidate`. Both flow through one common candidate pipeline.
 */
export type AttentionCandidateSourceKind = 'quest_candidate' | 'narrative_pattern_instance'

/**
 * ADR-0013 D5: "Normalization must never erase whether the source is
 * authoritative (`QuestCandidate`) or derived (`NarrativePatternInstance`)." A
 * quest candidate is authoritative; a narrative-pattern instance is derived.
 */
export type AttentionCandidateSourceAuthority = 'authoritative' | 'derived'

/**
 * The versioned source-kind order — key 3 of the nine-key D14 tuple (plan §7).
 * `quest_candidate < narrative_pattern_instance` is an experiment-owned
 * continuity default (RN019 §9.2), not a claim that quests are narratively
 * more important; it exists to force a real source-kind tie-break. The
 * comparator consults this pinned table rather than an implicit constant.
 */
export const ATTENTION_CANDIDATE_SOURCE_KIND_ORDER: readonly AttentionCandidateSourceKind[] = Object.freeze([
  'quest_candidate',
  'narrative_pattern_instance',
])

/** Source authority per kind, preserved through normalization (ADR-0013 D5). */
export const ATTENTION_CANDIDATE_SOURCE_AUTHORITY: Readonly<
  Record<AttentionCandidateSourceKind, AttentionCandidateSourceAuthority>
> = Object.freeze({ quest_candidate: 'authoritative', narrative_pattern_instance: 'derived' })

// ---------------------------------------------------------------------------
// A4 pins — template/channel, exposure, and ledger policy versions
//
// Added by the A4 slice, which the controlling plan section allows to modify
// this file "only for approved template/channel, exposure, and ledger-policy
// version pins". Each is a declared replay input in Attention Ledger Replay v0
// §4, so a run that cannot name its exact pin is not a declared run at all.
// ---------------------------------------------------------------------------

/**
 * The versioned deterministic template (ADR-0013 D18; replay spec §4 "deterministic
 * template version", §26 T3 "the template version is recorded in the trace").
 *
 * D18 fixes the accepted v0 renderer as "deterministic templates or direct
 * structured rendering ... a mechanical, versioned mapping from assertion
 * structure to presented text/UI", with no call to any generative service
 * anywhere in the accepted path. This pin is that mapping's version: it names
 * both the fixed slot labels and the fixed line shape, so any change to either
 * is a visible version bump rather than silent output drift, and it participates
 * in rendered-output identity so two versions can never render byte-identically.
 */
export const ATTENTION_TEMPLATE_VERSION = 'attention-extradiegetic-template-v1' as const

/**
 * The versioned template/channel policy (ADR-0013 D15 ranking-cache identity;
 * plan §6 "template/channel policy version").
 *
 * Stage A presents extradiegetically only (ADR-0013 "Staged implementation",
 * Stage A: "extradiegetic deterministic presentation (D10/D18) only ... no
 * diegetic channel"), so this pin records *which* channel policy a rendered
 * result and its ledger record were produced under. It deliberately introduces
 * no channel, revealer, recipient, audience-scope, or reveal-scope value: D9/D10
 * make those a diegetic and Stage C surface, and ADR-0013 D2's B-domain
 * enumeration gives Stage A no coordinate to fill them from. A pin is a version
 * coordinate, not a capability.
 */
export const ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION = 'attention-template-channel-policy-v1' as const

/**
 * The versioned exposure policy (ADR-0013 D13/D17; plan §6 "exposure-policy
 * version", plan §7 "exposure/cooldown/repetition/non-engagement").
 *
 * D17 permits the ledger to influence "only later attention ranking and
 * presentation-density decisions, and only through already-declared, versioned
 * deterministic features". This pin is the version those declared features are
 * declared under. It fixes no *threshold*: ADR-0013 open question 3 leaves the
 * cooldown and retirement constants experiment-owned, so the A4 ledger exposes
 * the feature inputs and pins none of the numbers a later policy will compare
 * them against.
 */
export const ATTENTION_EXPOSURE_POLICY_VERSION = 'attention-exposure-policy-v1' as const

/**
 * The versioned ledger policy (ADR-0013 D15 ranking-cache identity and D17;
 * plan §6 "ledger/exposure-policy version", §7 the replay-local ledger).
 *
 * It covers the closed ledger record field set, the append-sequence rule, and
 * the record-identity rule in `attentionLedger.ts`. It is prefixed onto every
 * record identity, so a record minted under a later policy can never compare
 * equal to one minted under this policy — the same discipline D6 requires of the
 * identity-schema version, applied to a non-authoritative, replay-local sequence
 * that no authoritative reducer, store, migration, or event log ever sees.
 */
export const ATTENTION_LEDGER_POLICY_VERSION = 'attention-ledger-policy-v1' as const
