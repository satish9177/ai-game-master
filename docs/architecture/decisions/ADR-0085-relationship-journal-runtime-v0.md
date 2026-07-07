# ADR-0085: Relationship journal runtime v0 makes the dry familiarity candidate visible as an ephemeral, session-scoped, name-free panel

- **Status:** Proposed / Accepted-Planned (Slice 0 — docs-first; implementation
  Slices 1–5 land separately on `main`, each maintainer-approved)
- **Date:** 2026-07-07
- **Deciders:** Project owner
- **Builds on:**
  [`relationship-journal-entries-v0`](../implementation-plans/relationship-journal-entries-v0.md)
  ([ADR-0082](./ADR-0082-relationship-journal-entries-v0.md)) — the pure, dry
  familiarity-only candidate/template contract this feature makes visible;
  [`relationship-visible-feedback-v0`](../implementation-plans/relationship-visible-feedback-v0.md)
  ([ADR-0079](./ADR-0079-relationship-visible-feedback-v0.md)) — the App-owned
  transient-slot wiring pattern reused here;
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)) — why only
  `familiarity` is runtime-emittable;
  [`npc-relationship-state-v0`](../implementation-plans/npc-relationship-state-v0.md)
  — the ephemeral, session-scoped `relationshipsRef` lifecycle this journal
  mirrors;
  [`npc-relationship-persistence-v0`](../implementation-plans/npc-relationship-persistence-v0.md)
  ([ADR-0081](./ADR-0081-npc-relationship-persistence-v0.md)) — the
  feedback-silent hydration boundary this journal preserves.

> Full plan, helper/state shapes, behavior contract, test plan, safety invariants,
> risks, manual smoke plan, and deferred work live in
> [`relationship-journal-runtime-v0`](../implementation-plans/relationship-journal-runtime-v0.md).
> This ADR records the decision and the boundary rationale. It is created **now,
> as Proposed / Accepted-Planned**, before code; it flips to Accepted-Implemented
> at Slice 5 closeout.

---

## Context

`relationship-journal-entries-v0` (ADR-0082) landed a pure, closed, tested
candidate contract — `buildRelationshipJournalCandidate` +
`renderRelationshipJournalText` — that maps a strictly upward `familiarity` bucket
crossing to one generic, name-free line, but keeps it **dry at runtime** (proven
by a scan test). Players therefore never see it. Social progress is currently
surfaced only as a **single transient, auto-dismissing line**
(`relationship-visible-feedback-v0`, ADR-0079).

Two facts constrain a safe v0, unchanged from ADR-0082:

1. **Only `familiarity` moves at runtime.** The signed valenced reducer rows stay
   dry (ADR-0077) because `classifyDialogueTurn` emits only neutral structural
   events, and `dialogueContext.ts` exposes no trust/respect/fear bucket helpers.
   `familiarity` is monotonic non-decreasing and the only bucketed axis.
2. **A relationship crossing is an event with no re-derivable authoritative
   source.** Relationship state is a non-authoritative projection holding only
   *current* axes, never crossing history. The three existing journal producers
   are **re-projections** of authoritative `WorldState` / the `WorldEvent` log
   into a single overwritten `journal` slot; there is no append path, and the
   event-log route is closed by boundary (routing crossings through `WorldEvent`s
   would make non-authoritative relationship movement authoritative — an
   ADR-0077/0079/0081 violation).

ADR-0082 explicitly pre-authorized the going-live path: an **ephemeral
accumulation store** fed from `handleNpcDialogueResolved`, **reset-mirrored** like
`relationshipFeedbackState`/`relationshipsRef` and **silent on hydration/load**,
plus a rendering decision. This ADR takes that path.

The derivation point already exists: `handleNpcDialogueResolved` computes
`prevBucket`/`nextBucket` for the feedback slot, so the journal is a **second,
pure accumulation call on the same two buckets plus the `{worldId, sessionId,
npcId}` scope** — no new relationship read.

## Decision

Wire the dry candidate contract into a **runtime-only, session-scoped, ephemeral
relationship journal** with its own state slot and its own panel, and change no
authority/persistence/chase boundary.

- **Consume, do not modify, the candidate contract.**
  `domain/npcRelationship/relationshipJournalCandidate.ts` is unchanged; the
  feature calls its builder and renderer only.
- **One pure accumulation helper.** `app/relationshipJournalRuntime.ts` holds a
  total, deterministic reducer `accumulateRelationshipJournal(state, input)` (no
  I/O, clock, randomness, logger) plus `toRelationshipJournalView`. It wraps the
  candidate builder, **dedupes on `candidate.dedupeKey`**, bounds the list to
  `RELATIONSHIP_JOURNAL_MAX_ENTRIES = 32` (drop-oldest), and returns the identical
  state reference on a non-crossing/duplicate turn.
- **Familiarity-only, one closed line.** The only reachable entry text is the
  frozen `familiarity_increased` template (`"Someone here seems more familiar with
  you."`). Trust/respect/fear stay dry and produce no candidate.
- **Fed from the existing derivation point.** `handleNpcDialogueResolved` adds a
  single `setRelationshipJournal(prev => accumulate(prev, …))` call **after** the
  existing feedback update, reusing the already-computed `prevBucket`/`nextBucket`.
- **Session-scoped lifecycle, reset only at session boundaries.** The journal
  state resets to empty at `handlePrompt` (new prompt) and `handleLoad` (load),
  mirroring `relationshipsRef` — and **never** on room entry, so it accumulates
  across rooms within a session. On load it starts empty; crossings are not
  replayed, preserving the feedback-silent hydration boundary (ADR-0081).
- **Own state slot, own panel — the shared `journal` slot is untouched.** The
  relationship journal never calls `setJournal`/`refreshDerivedViews` and does not
  modify the three journal producers or the `JournalView`/`JournalEntryView`
  shape. Rendering reuses `JournalPanel` via a small optional presentational
  `label`/`className` addition (default `"Journal"` preserved), rendered only when
  there is at least one entry (safe degradation), collapsed by default, and
  **without `aria-live`** so it does not double-announce over the transient line.
- **Opaque, scope-free rendered entry id.** Dedupe is keyed on
  `candidate.dedupeKey` (which embeds `worldId`/`sessionId`/`npcId`), but the
  **rendered `entry.id` is an opaque surrogate** carrying no scope id, npcId,
  bucket word, or score. This is the smallest-leak-surface choice and is
  consistent with ADR-0082, which *sanctions but does not require* encoding dedupe
  in `id`. If a later decision instead uses the raw `dedupeKey` as `entry.id`, the
  plan **requires** DOM-leak and log-leak tests proving the id is never rendered or
  logged.
- **No new logs.** The helper logs nothing; no new `App.tsx` log line is added; the
  existing `deriveAndReduceRelationship` log shape is untouched. Any future
  diagnostic is count-only.
- **No authority / persistence / provider / chase change.** No `WorldState`,
  `WorldEvent`, `WorldCommand`, `applyEvent`, memory, `Fact`/`fact_visibility`
  write or derivation; no save-game/sidecar/SQLite/`localStorage`/migration/
  `RoomSpec`/`QuestSpec` change and no `schemaVersion` bump; no provider/prompt/
  network/clock/randomness; and no `hostile-npc-chase-lite-v0` (ADR-0084) /
  `npc-player-awareness-v0` (ADR-0083) / combat/encounter behavior change.

## Why session-scoped, ephemeral, and not persisted in v0

- The journal is a **living session log**, not a per-room transient, so it resets
  on session boundaries (prompt/load), not room entry — the exact lifecycle of the
  ephemeral `relationshipsRef` projection.
- Persisting crossing history is a separate decision: the relationship sidecar
  (ADR-0081) stores only *current* axes, not history, and inventing a
  history-persistence path would widen the persistence/authority surface. v0 keeps
  the visible mechanic reviewed and tested while deferring persistence to its own
  slice — the same staging ADR-0075/0078/0082 used.

## Why the existing journal slot / event-log route is still rejected

Unchanged from ADR-0082: the three journal producers re-project authoritative
state into one overwritten slot with no append API, and relationship crossings are
not re-derivable from current state. Minting crossings as `WorldEvent`s to feed
`eventConsequenceJournal` would make non-authoritative relationship movement
authoritative, violating ADR-0077/0079/0081. The relationship journal therefore
gets its **own** ephemeral slot, never touching `journal`.

## Why trust / respect / fear are deferred

Those axes are dry (ADR-0077): the signed valenced kinds never emit and
`dialogueContext.ts` exposes no trust/respect/fear buckets, so entries or templates
for them would be dead code. They are deferred until a separately-approved feature
makes those axes runtime-emittable.

## Safety boundaries

Unchanged in v0:

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No memory / `Fact` / `fact_visibility` write or derivation.
- No persistence / sidecar / SQLite / `localStorage` / migration / save-game /
  `RoomSpec` / `QuestSpec` change; no `schemaVersion` bump on any existing schema.
- No change to the existing `journal` slot, its three producers, `projectJournal`,
  or the `JournalView` / `JournalEntryView` shape.
- No NPC display name/id, room/object name, dialogue/provider/prompt text, raw
  score/delta/`interactionCount`, bucket enum word, effect payload, or
  relationship-feedback line text in rendered UI — only the frozen template string.
- No provider / prompt / LLM / network call; no world clock; no randomness.
- No new log lines; existing `deriveAndReduceRelationship` log shape untouched.
- No chase / awareness / combat / encounter behavior change (ADR-0083, ADR-0084).
- The candidate contract module (`relationshipJournalCandidate.ts`) is consumed,
  not modified.
- The `app/**` composition root may already import `domain/**` and `renderer/ui`,
  so no new lint block is required; the accumulation helper imports only the
  candidate contract, the `JournalView` type, and sibling domain types.

## Alternatives considered

- **Reuse the shared `journal` slot / an existing producer.** Rejected: those are
  re-projections of authoritative state and would overwrite accumulated entries on
  every `refreshDerivedViews`; crossings are not re-derivable.
- **Emit crossings as `WorldEvent`s for the event journal.** Rejected: violates the
  non-authoritative relationship boundary (ADR-0077/0079/0081).
- **Persist the journal in the relationship sidecar / a new save-game field.**
  Deferred: the sidecar holds only current axes; history persistence is its own
  decision and would widen the persistence surface.
- **Reset on room entry (like the transient feedback line).** Rejected: that would
  wipe the running log every navigation; the journal is session-scoped like
  `relationshipsRef`.
- **Use the raw `dedupeKey` as the rendered `entry.id`.** Not chosen for v0: it
  embeds scope ids; an opaque surrogate keeps the leak surface minimal. Permitted
  only with mandatory DOM/log leak tests if adopted later.
- **A live (`aria-live`) journal panel.** Rejected: it would double-announce over
  the transient feedback line; the panel is a static, collapsed-by-default log.
- **Plan-only, no ADR / ADR only at closeout.** Rejected: the maintainer directed
  an ADR now (Proposed / Accepted-Planned) so the runtime/authority/persistence
  boundary is recorded before code, consistent with ADR-0082's staging.

## Consequences

- **A visible, safe, session-scoped relationship journal exists** once Slices 1–3
  land: accumulated familiarity milestones are reviewable in a small collapsed
  panel, name-free and number-free, with inherent anti-spam (monotonic familiarity
  + `dedupeKey` dedupe) and safe degradation to no-panel when empty.
- **No authoritative/persistent/chase footprint.** No world/memory/fact write, no
  saved bytes, no schema bump, no engine/awareness/combat change; a loaded session
  starts with an empty journal.
- **The path stays incremental.** Persistence, trust/respect/fear entries, an
  NPC-label policy, and richer templates are each deferred to their own approved
  slices.
- **Build stays green.** One new pure helper + tests, a small App wiring, and a
  small optional `JournalPanel` prop; no runtime authority, schema, lint, provider,
  or existing-journal change.
- **ARCHITECTURE.md status line is added at Slice 5 closeout**, per the
  implemented-only convention, alongside this ADR's flip to Accepted-Implemented.

## Implementation outcome

_Pending._ This ADR is **Proposed / Accepted-Planned** at Slice 0 (docs-first).
No `App.tsx`, `app/relationshipJournalRuntime.ts`, `JournalPanel`, or test edits
exist yet. The [implementation plan](../implementation-plans/relationship-journal-runtime-v0.md)
carries the full behavior contract, test plan, safety invariants, and manual smoke
plan; the Slice 5 closeout will record the final file list and verification
results here and flip the status.

## Verification

_Planned (per slice); to be recorded at closeout._

```bash
npm run test -- relationshipJournalRuntime   # Slice 1 helper unit
npm run test -- relationshipJournal          # accumulation + candidate suites
npm run test -- App                          # Slice 2/3 wiring + render
npm run lint                                  # eslint . — no new block expected
npm run build                                 # tsc -b && vite build
```
