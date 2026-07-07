# ADR-0085: Relationship journal runtime v0 makes the dry familiarity candidate visible as an ephemeral, session-scoped, name-free panel

- **Status:** Accepted - Implemented (Slices 1–5 landed on `main`, each
  maintainer-approved; this closeout records Slice 5)
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
> This ADR records the decision and the boundary rationale. It was created **as
> Proposed / Accepted-Planned**, before code, and now flips to
> **Accepted-Implemented** at Slice 5 closeout.

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

Slices 1–5 landed on `main` exactly as designed in the
[implementation plan](../implementation-plans/relationship-journal-runtime-v0.md),
with no invariant relaxed:

- `app/relationshipJournalRuntime.ts` holds the pure, total
  `accumulateRelationshipJournal` reducer and `toRelationshipJournalView`,
  consuming `buildRelationshipJournalCandidate` /
  `renderRelationshipJournalText` from the unmodified
  `domain/npcRelationship/relationshipJournalCandidate.ts` unchanged. Dedupe is
  keyed on `candidate.dedupeKey`, kept internally on each entry; the rendered
  `entry.id` is an opaque `relationship-journal-entry-{a, b, c, …}` surrogate
  (base-26 ordinal letters) carrying no scope id, npcId, bucket word, or score.
  The list is bounded to `RELATIONSHIP_JOURNAL_MAX_ENTRIES = 32`, drop-oldest.
- `App.tsx` adds one `relationshipJournal` state slot
  (`useState<RelationshipJournalState>`, initialized to
  `INITIAL_RELATIONSHIP_JOURNAL_STATE`), a single `setRelationshipJournal(prev
  => accumulateRelationshipJournal(prev, …))` call inside
  `handleNpcDialogueResolved` immediately after the existing relationship
  feedback update (reusing the already-computed `prevBucket`/`nextBucket`, no
  new relationship read), and resets to `INITIAL_RELATIONSHIP_JOURNAL_STATE` at
  exactly the two session-boundary sites (`handlePrompt`, `handleLoad`) —
  **not** at `enterActivePlay`/room entry.
- `renderer/ui/JournalPanel.tsx` gained the optional presentational `label`
  (default `"Journal"`), `className`, and `live` props with no change to the
  existing instance's default rendering. A second `JournalPanel` instance
  renders in `App.tsx` only when `relationshipJournal.entries.length > 0`,
  titled "Relationships", with `live={false}` so it does not carry
  `aria-live`/`role="status"` and cannot double-announce over the transient
  feedback line.
- Slice 4 safety/eval coverage extends `evaluation/noSideEffects.eval.test.ts`
  and `evaluation/logSafety.eval.test.ts` with dedicated relationship-journal
  cases, and `JournalPanel.test.tsx` covers the expanded-DOM leak surface via
  the hookless `JournalPanelBody` export.
- The shared `journal` slot, its three producers (`projectJournal`,
  `generatedConsequenceJournal`, `eventConsequenceJournal`), and
  `refreshDerivedViews`/`applyEventJournalFromSession` are untouched — the
  relationship journal never calls `setJournal`.

### Final behavior summary

- The only entry a player can ever see is the frozen line "Someone here seems
  more familiar with you.", added on a strictly upward `familiarity` bucket
  crossing for the active dialogue NPC.
- The "Relationships" panel accumulates across rooms within a session
  (survives `enterActivePlay`) and resets to empty only on a new prompt or a
  load — a loaded session always starts with an empty relationship journal, no
  crossing replay.
- Repeated crossings at the same bucket, or re-derivation from restored
  relationship state on load, never produce a duplicate entry.
- Trust/respect/fear stay dry (ADR-0077); no template or entry path exists for
  them.

### Safety boundaries (confirmed unchanged)

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` write or
  derivation; no memory / `Fact` / `fact_visibility` write.
- No persistence: no save-game/sidecar/SQLite/`localStorage`/migration/
  `RoomSpec`/`QuestSpec` change; no `schemaVersion` bump anywhere.
- No NPC display name/id, room/object name, raw score/delta/
  `interactionCount`, bucket enum word, dialogue/provider/prompt text, effect
  payload, or relationship-feedback line text ever reaches rendered DOM or a
  log line — only the frozen template string and the opaque entry id.
- No `hostile-npc-chase-lite-v0` (ADR-0084) / `npc-player-awareness-v0`
  (ADR-0083) / combat/encounter behavior change.
- `domain/npcRelationship/relationshipJournalCandidate.ts` is consumed, not
  modified; the existing `journal` slot and its producers are untouched.

### Known limitations / deferred work (unchanged from the plan)

- Session-ephemeral only: crossing history is not persisted, so it does not
  survive a page refresh without Save/Load re-crossing; persisting crossing
  history remains a separate, future decision.
- Single template: only `familiarity_increased` is reachable; trust/respect/
  fear entries wait on those axes becoming runtime-emittable.
- No NPC display-label policy: entries stay generic/name-free by design; a
  future name-bearing feature needs its own approved safe display-label policy.
- Richer templates, grouping, timestamps, or a unified journal UX are each
  deferred to their own approved slice.

## Verification

All commands below were run from `apps/web` at Slice 5 closeout:

```bash
npm run test -- relationshipJournalCandidate   # 18 passed
npm run test -- relationshipJournalRuntime     # 14 passed
npm run test -- JournalPanel                   # 14 passed
npm run test -- App                            # 175 passed
npm run test -- noSideEffects logSafety         # 18 passed (both eval suites)
npm run lint                                    # eslint . — clean, no new block
npm run build                                   # tsc -b && vite build — passed
npm run test                                    # full suite: 3575/3576 passed
```

The one full-suite failure, `src/redteam/feedback.redteam.test.ts:69`, asserts
a literal `MemoryFeedback` JSX wiring string that predates this feature's
`selectTransientFeedbackMessage(memoryFeedbackState.message,
relationshipFeedbackState.message)` call site; it is pre-existing and
unrelated to the relationship journal runtime.
