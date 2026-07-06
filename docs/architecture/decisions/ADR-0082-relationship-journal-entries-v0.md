# ADR-0082: Relationship journal entries are a pure, dry, familiarity-only candidate contract in v0

- **Status:** Accepted / Docs-first — **NOT IMPLEMENTED** (design approved; pure
  contract, dry-at-runtime, to be built in a separately-approved Slice 1)
- **Date:** 2026-07-06
- **Deciders:** Project owner
- **Builds on:**
  [`npc-relationship-state-v0`](../implementation-plans/npc-relationship-state-v0.md),
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)),
  [`relationship-visible-feedback-v0`](../implementation-plans/relationship-visible-feedback-v0.md)
  ([ADR-0079](./ADR-0079-relationship-visible-feedback-v0.md)),
  and [`npc-relationship-persistence-v0`](../implementation-plans/npc-relationship-persistence-v0.md)
  ([ADR-0081](./ADR-0081-npc-relationship-persistence-v0.md)); clones the
  dry contract-first pattern of
  [`valenced-dialogue-effect-candidates-v0`](../implementation-plans/valenced-dialogue-effect-candidates-v0.md)
  ([ADR-0075](./ADR-0075-valenced-dialogue-effect-candidates-v0.md)) and
  [`room-environment-transition-model-dry-v0`](../implementation-plans/lazy-room-environment-transitions-v0.md)
  ([ADR-0078](./ADR-0078-room-environment-transition-model-dry-v0.md)).

> Full plan, candidate/template shapes, rules, test plan, and slices live in
> [`relationship-journal-entries-v0`](../implementation-plans/relationship-journal-entries-v0.md).
> This ADR records the decision and the boundary rationale. It documents a
> **design-start / docs-first** decision; the closeout record will be added when
> Slice 1 lands.

---

## Context

We want players to be able to **review social consequences** — e.g. an NPC
growing more familiar (and, in the motivating examples, more wary / more afraid /
more trusting) — as journal-style entries, not just a single transient line.

Two facts constrain a safe v0:

1. **Only `familiarity` moves at runtime.** Per ADR-0077, the signed valenced
   rows of `RELATIONSHIP_EFFECT_DELTA_TABLE`
   (`domain/npcRelationship/reducer.ts`) stay dry because `classifyDialogueTurn`
   emits only the two neutral interaction signals. `dialogueContext.ts` hardcodes
   `trustBucket: 'neutral'`, `respectBucket: 'neutral'`, `fearBucket: 'none'`, and
   there are **no** trust/respect/fear bucket helpers. `familiarity` is
   **monotonic non-decreasing** and the only bucketed axis
   (`familiarityBucket → 'none' | 'low' | 'medium' | 'high'`). A trust/respect/fear
   journal today would be dead code requiring helpers that do not exist.

2. **The existing journal system is a re-projection, not an append path.** Three
   producers (`projectJournal`, `generatedConsequenceJournal`,
   `eventConsequenceJournal`) all emit the same
   `JournalView = { journalId, title, entries: { id, text }[] }` into the App's
   single `journal` slot, each **recomputed from authoritative `WorldState` /
   event-log** on refresh, with entry text drawn only from closed hand-written
   phrase tables. There is no journal store and no append/mutate API, and
   `JournalEntryView` carries no npcId/axis/bucket/timestamp field.

Relationship state is deliberately **non-authoritative and not event-logged**,
and it records only *current* axes + `interactionCount` — never the *history* of
bucket crossings. A bucket crossing is therefore an **event**, not a
re-derivable state: it cannot be reconstructed from current relationship state,
so a relationship journal cannot be a pure re-projection like the three existing
journals, and it cannot ride the `WorldEvent` log without turning
non-authoritative relationship movement into authoritative events — a boundary
violation.

This is exactly the situation `valenced-dialogue-effect-candidates-v0` and
`room-environment-transition-model-dry-v0` shipped into safely: model the
mechanic as a pure, closed, tested contract now, and keep it **dry at runtime**
until a separately-approved wiring feature exists.

## Decision

Add **only a pure domain helper** in v0, and keep it **dry at runtime**.

- **One pure module.** `domain/npcRelationship/relationshipJournalCandidate.ts`
  builds candidate *data* and renders *closed text*. It is total and
  deterministic — no I/O, `Date.now`, `Math.random`, logger, React, Three.js,
  world-session, or persistence import — and imports only sibling domain types
  (`FamiliarityBucket`) plus its own frozen tables.
- **Familiarity-up only, one candidate per call.** The builder returns exactly
  one `RelationshipJournalCandidate` on a **strictly upward familiarity bucket
  crossing** (`rank(toBucket) > rank(fromBucket)` over
  `none < low < medium < high`), and `null` for same-bucket or downward inputs.
  The headline case is the first-interaction `none → low`.
- **Closed candidate shape, IDs internal only.** `schemaVersion: 1`,
  `kind: 'npc_relationship_journal_candidate'`, `axis: 'familiarity'`,
  `direction: 'increased'`, `fromBucket`, `toBucket`, `templateId`, and a stable
  `dedupeKey`
  (`relationship-journal:{worldId}:{sessionId}:{npcId}:{axis}:{direction}:{toBucket}`).
  `npcId` is a safe internal slug for scoping/dedupe (the same identifier
  `deriveAndReduceRelationship` already logs) and is **never** rendered to the
  player. No numeric axis value, delta, `interactionCount`, effect id,
  confidence, or `worldTime` appears in the candidate.
- **Closed, generic, name-free template rendering.**
  `RELATIONSHIP_JOURNAL_TEMPLATES` is a frozen table; v0 ships one reachable
  entry, `familiarity_increased → "Someone here seems more familiar with you."`
  `renderRelationshipJournalText` returns text **exclusively** from this table,
  never from any candidate field value or external input.
- **Dry at runtime.** No production runtime/composition code imports the module,
  proven by a dedicated dry-at-runtime scan test over both `.ts` and `.tsx`
  sources (mirroring ADR-0078), not merely asserted. `App.tsx`,
  `derivedViews.ts`, the journal producers, `JournalPanel`, and the persistence
  load path are untouched.
- **No append/authority/persistence surface.** No `JournalView`/`JournalPanel`
  producer or shape change, no `WorldState` field, `WorldEvent`, `WorldCommand`,
  `applyEvent`, memory, `Fact`/`fact_visibility`, save-game/sidecar/migration, or
  `RoomSpec` change. No `schemaVersion` bump on any existing schema (the
  candidate carries its own local `NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION`).
- **No LLM / provider / prompt / network involvement, no clock, no NPC-name or
  raw-text inference.** Text is a total function of the closed enum; it is never
  derived from generated/dialogue/prompt text, object names, or an LLM label.

The helper becomes live behavior only when a future, separately-approved
`relationship-journal-runtime-v0` slice adds an ephemeral accumulation store in
`handleNpcDialogueResolved` (reset-mirrored like `relationshipFeedbackState`,
silent on hydration/load) and a rendering decision for the single `journal`
slot / a separate panel.

## Why v0 is dry / familiarity-only

- Only `familiarity` is runtime-emittable (ADR-0077); trust/respect/fear rows are
  frozen-dry and lack bucket helpers, so entries for them would be unreachable
  dead code — a Minimum Safe Change Rule violation ("no future-proof
  abstractions without current use").
- A relationship crossing is an event with no authoritative or re-derivable
  source, so nothing can safely *drive* a visible journal in v0 without inventing
  storage/authority. Landing the closed contract now keeps the mechanic reviewed
  and tested while deferring the storage/UI decision to its own slice — the exact
  play run by ADR-0075 and ADR-0078.

## Why the existing journal is not an append path

All three journal producers **recompute** a `JournalView` from authoritative
`WorldState` / the append-only `WorldEvent` log on each refresh; none exposes an
append, insert, or storage call, and entry text is always a closed phrase table.
Relationship state lives outside authoritative state and holds no crossing
history, so it cannot be re-projected the same way. Reusing "the existing journal
append path" is therefore not possible — there is none — and v0 explicitly does
not create one.

## Why the WorldEvent / event-log route is rejected

`eventConsequenceJournal` reads the authoritative `WorldEvent` log. Routing
relationship crossings through it would require minting relationship changes as
`WorldEvent`s (or `WorldCommand`s), which contradicts the deliberate design that
relationship state is a **non-authoritative projection**, never a `WorldEvent`,
`WorldCommand`, or `WorldState` field (ADR-0077/ADR-0079/ADR-0081). The event-log
route is closed by boundary, not by convenience.

## Why trust / respect / fear are deferred

Those axes are dry (ADR-0077): `classifyDialogueTurn` never emits the signed
valenced kinds, and `dialogueContext.ts` exposes no trust/respect/fear buckets.
Entries or templates for them today would be dead code needing new bucket
helpers. They are deferred until a separately-approved feature makes the valenced
rows runtime-emittable and widens `dialogueContext.ts`; only then do
"more wary / more afraid / more trusting" entries have a live path.

## Safety boundaries

Unchanged in v0:

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No memory / `Fact` / `fact_visibility` write or derivation.
- No persistence / sidecar / migration / save-game / `RoomSpec` change; no
  `schemaVersion` bump on any existing schema.
- No `JournalView` / `JournalPanel` / journal-producer change; no `App.tsx`
  change; no visible UI.
- No provider / prompt / LLM / network call; no world clock; no NPC display name
  or raw generated/dialogue/prompt text; no raw scores/deltas/effect payloads.
- No new log lines; the existing `deriveAndReduceRelationship` log shape is
  untouched.
- The `domain/**` lint block already forbids the module from importing
  `react`/`three`/`renderer`/`platform`; a boundary-import test additionally
  documents that it pulls in no application layer.

## Alternatives considered

- **Ship a visible multi-axis journal now.** Rejected: trust/respect/fear are
  dry (dead code + missing bucket helpers), and a visible journal needs a storage
  path the architecture does not provide.
- **Reuse an existing journal producer / append path.** Rejected: the journal
  system is re-projection-only with no append API, and relationship crossings are
  not re-derivable from current state.
- **Emit relationship crossings as `WorldEvent`s so the event journal picks them
  up.** Rejected: violates the non-authoritative relationship boundary.
- **Add an ephemeral accumulation store + panel in this feature.** Deferred:
  that is new stateful wiring (reset discipline, slot precedence, hydration
  silence) warranting its own approval; v0 stays a pure contract.
- **Persist journal entries in the relationship sidecar.** Rejected for v0: the
  sidecar holds only current axes, not crossing history; persistence is its own
  decision.
- **Plan-only, no ADR.** Rejected: this establishes the relationship-journal
  candidate/template contract and the authority/append boundary rationale, which
  warrants a decision record consistent with ADR-0075/ADR-0078.

## Consequences

- **No visible gameplay effect yet.** No journal entry, panel, or line renders;
  no HUD/renderer/authoritative-state change. This is intended.
- **A safe, closed, reviewed contract exists for future runtime wiring.** The
  candidate shape, closed template, upward-crossing rule, and dedupe key are
  fixed and testable now, so the later accumulation/rendering/persistence slices
  are small and low-risk.
- **The path to going live is explicit:** (1) an ephemeral accumulation store in
  `handleNpcDialogueResolved`, reset-mirrored and hydration-silent; (2) a
  rendering decision for the single `journal` slot or a new panel (dedupe encoded
  in the `id` field, never widening `JournalEntryView`); (3) an optional
  NPC-label policy; (4) an optional persistence decision; (5) trust/respect/fear
  entries once those axes are live — each separately approved.
- **Build stays green.** One new pure module + its test; no runtime, schema,
  lint, provider, or UI change.
- **ARCHITECTURE.md is not updated yet** (implemented-only convention); the
  status line and this ADR's closeout land with Slice 2.

## Verification

Not implemented yet — docs-first. Planned verification for Slice 1 (from the
implementation plan §11–§12):

```bash
npm.cmd run test -- relationshipJournalCandidate
npm.cmd run lint
npm.cmd run build
```

The closeout record (files changed, dry-at-runtime scan result, and confirmed
unchanged boundaries) will be appended when Slice 1 lands.
