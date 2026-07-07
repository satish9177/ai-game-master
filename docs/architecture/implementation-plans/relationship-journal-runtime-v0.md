# Implementation Plan — `relationship-journal-runtime-v0`

> `relationship-journal-runtime-v0` is the **feature name**, not a Git branch —
> this work lands directly on `main`.

> Status: **IMPLEMENTED — Slices 1–5 landed on `main`.**
> See [§11 Slice 5 closeout](#11-slice-5-closeout) for the final file list,
> behavior summary, safety boundaries, known limitations, and verification
> results.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Decision record: [ADR-0085](../decisions/ADR-0085-relationship-journal-runtime-v0.md)
> (Proposed / Accepted-Planned).
> Builds directly on the closed-out
> `relationship-journal-entries-v0`
> ([plan](./relationship-journal-entries-v0.md) · [ADR-0082](../decisions/ADR-0082-relationship-journal-entries-v0.md)),
> which shipped the pure, dry candidate contract this feature makes visible.
> Mirrors the runtime-wiring spine of
> `relationship-visible-feedback-v0`
> ([plan](./relationship-visible-feedback-v0.md) · [ADR-0079](../decisions/ADR-0079-relationship-visible-feedback-v0.md))
> and the session-scoped ephemeral-projection lifecycle of
> `npc-relationship-state-v0` ([plan](./npc-relationship-state-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **locked**. These invariants may not be relaxed without explicit
maintainer approval:

- **Consume the existing candidate contract unchanged.**
  `domain/npcRelationship/relationshipJournalCandidate.ts` is not modified. This
  feature only *calls* `buildRelationshipJournalCandidate` and
  `renderRelationshipJournalText`.
- **Familiarity-only.** The only entry that can ever appear is an **upward
  familiarity bucket crossing** (`none→low→medium→high`). Trust/respect/fear are
  dry today (`relationship-valence-reducer-v0`, ADR-0077) and remain **deferred**.
- **Dedupe by `candidate.dedupeKey`.** Runtime accumulation dedupes on the stable
  `dedupeKey` produced by the candidate builder — never on rendered text, array
  index, or a re-derived key.
- **Generic, name-free, closed text only.** Rendered player-facing text is
  exclusively the frozen template string. No NPC display names/ids, room/object
  names, dialogue/provider text, scores, deltas, `interactionCount`, effect/source
  kinds, bucket enum words, or relationship-feedback line text appears in rendered
  UI.
- **Runtime-only, session-scoped, no persistence.** The journal is an ephemeral
  in-memory projection for the life of the session. It is **not** persisted to
  save-game, sidecar, SQLite, `localStorage`, schema, or any migration in v0.
- **No append path into authoritative state.** No `WorldState`, `WorldEvent`,
  `WorldCommand`, `applyEvent`, memory, `Fact`/`fact_visibility`,
  persistence/save-game/`RoomSpec`/`QuestSpec` change, and no `schemaVersion` bump.
- **Session-boundary reset only.** The journal state resets on **new prompt** and
  **load** (mirroring `relationshipsRef`), **never** on room entry.
- **No chase/combat/awareness change.** `hostile-npc-chase-lite-v0` (ADR-0084),
  `npc-player-awareness-v0` (ADR-0083), and all combat/encounter behavior are
  untouched.
- **Reuse over new abstraction.** Reuse the candidate builder/renderer, the
  `JournalView`/`JournalPanel` UI shape, the `prevBucket`/`nextBucket` values
  already computed in `handleNpcDialogueResolved` for feedback, and the
  session-reset sites already used by `relationshipsRef`.

---

## 1. Problem

`relationship-journal-entries-v0` (ADR-0082) shipped a pure, closed, tested
candidate contract that turns a strictly upward familiarity bucket crossing into
one generic, name-free journal line — but it is **dry at runtime**: nothing
imports it, so a player never sees it. Social progress with an NPC is currently
surfaced only as a **single transient line** (`relationship-visible-feedback-v0`)
that auto-dismisses and is gone.

We want the player to **review** accumulated safe relationship milestones — "someone
here seems more familiar with you" — as a small, persistent-within-the-session
list, without inventing storage/authority, leaking any raw relationship data, or
touching any world/memory/persistence/chase boundary.

This feature is the exact `relationship-journal-runtime-v0` slice ADR-0082
pre-authorized (§Decision, §Consequences "the path to going live"): an ephemeral
accumulation store fed from `handleNpcDialogueResolved`, reset-mirrored and
hydration-silent, plus a small rendering decision.

---

## 2. Context / current architecture

### 2.1 The candidate contract is ready to consume as-is

`domain/npcRelationship/relationshipJournalCandidate.ts`:

- `buildRelationshipJournalCandidate({ worldId, sessionId, npcId, fromBucket, toBucket })`
  returns exactly one `RelationshipJournalCandidate` on a strictly upward
  familiarity crossing, else `null`. It reads closed `FamiliarityBucket` enum
  values only — never a raw score or delta.
- Stable
  `dedupeKey = relationship-journal:{worldId}:{sessionId}:{npcId}:familiarity:increased:{toBucket}`.
- `renderRelationshipJournalText(candidate)` returns text **exclusively** from the
  frozen `RELATIONSHIP_JOURNAL_TEMPLATES` table
  (`familiarity_increased → "Someone here seems more familiar with you."`).

It is proven dry at runtime by a dedicated scan test. Wiring it is precisely this
feature.

### 2.2 The runtime derivation point already computes everything needed

`handleNpcDialogueResolved` (App.tsx) already derives, for the
relationship-visible-feedback slot:

```
priorRelationship          = relationshipsRef.current.get(npcId) ?? neutral
relationshipResult.state   = deriveAndReduceRelationship(...)
prevBucket = familiarityBucket(priorRelationship.axes.familiarity)
nextBucket = familiarityBucket(relationshipResult.state.axes.familiarity)
```

The journal accumulation is a **second reducer call on the same two buckets plus
the `{ worldId, sessionId, npcId }` scope** — no new read of relationship
internals, no new derivation, no new score/delta access.

### 2.3 The transient-feedback pattern is the template — but the lifecycle differs

`relationship-visible-feedback-v0` (App.helpers.ts + App.tsx) is App-owned state
+ a pure helper + reset + auto-dismiss. The journal reuses the *shape* of that
pattern but differs in **lifecycle**:

- The **feedback line** is **per-room**: `relationshipFeedbackOnRoomEntry` fires
  at every `enterActivePlay`.
- The **journal must accumulate across rooms within a session**. Its correct
  lifecycle twin is `relationshipsRef`, which is **session-scoped** and reset only
  at:
  - `handlePrompt` (new generated session)
  - `handleLoad` (load)

  On load, `relationshipsRef` re-seeds **silently** (never through the reducer or
  feedback derivation). The journal mirrors this: it resets to empty on
  prompt/load and does **not** replay crossings on hydration.

### 2.4 The existing `journal` slot cannot be reused

All three journal producers (`projectJournal`, `generatedConsequenceJournal`,
`eventConsequenceJournal`) **re-project** authoritative `WorldState` / the
`WorldEvent` log into the single `journal` state, which `refreshDerivedViews` and
`applyEventJournalFromSession` overwrite on every state change. A relationship
crossing is an **event with no re-derivable authoritative source** (ADR-0082
§"Why the existing journal is not an append path"). The relationship journal
therefore needs its **own accumulation state and its own panel instance** and must
never touch `setJournal` / `refreshDerivedViews`.

### 2.5 `JournalView` / `JournalPanel` are reusable for rendering

`JournalView = { journalId, title, entries: { id, text }[] }`; `JournalPanel`
renders a collapsed-by-default list. We build a `JournalView` from accumulated
entries and render a **second** `JournalPanel` instance. Two presentational
caveats are handled in Slice 3: the toggle label is hardcoded `"Journal"`, and
both instances share `.journal-panel` CSS positioning.

### 2.6 Anti-spam is inherent

Familiarity is monotonic non-decreasing, so there are at most **three** upward
crossings per NPC per session (`none→low→medium→high`); non-crossings return
`null` and add nothing. `dedupeKey` guards against any double-fire.

---

## 3. Exact behavior contract

### 3.1 Pure accumulation helper — `app/relationshipJournalRuntime.ts`

State shape (ephemeral, App-owned):

```
type RelationshipJournalEntry = { id: string; text: string }
type RelationshipJournalState = Readonly<{ entries: readonly RelationshipJournalEntry[] }>
const INITIAL_RELATIONSHIP_JOURNAL_STATE: RelationshipJournalState = { entries: [] }
const RELATIONSHIP_JOURNAL_MAX_ENTRIES = 32
```

`accumulateRelationshipJournal(state, input)` — total, pure, deterministic, no
I/O / clock / randomness / logger:

- `input = { worldId, sessionId, npcId, prevBucket, nextBucket }`.
- Call `buildRelationshipJournalCandidate({ worldId, sessionId, npcId, fromBucket: prevBucket, toBucket: nextBucket })`.
- If `null` → return `state` **unchanged (same reference)** so React does not
  re-render on a non-crossing turn.
- Else compute `dedupeKey = candidate.dedupeKey`, `text = renderRelationshipJournalText(candidate)`.
- **Dedupe by `dedupeKey`.** If an entry with that identity already exists →
  return `state` unchanged.
- Else append a new entry (see §3.2 for `entry.id`). If the resulting length
  exceeds `RELATIONSHIP_JOURNAL_MAX_ENTRIES`, drop the **oldest** so the array is
  bounded.
- Entry order is chronological (append order).

`toRelationshipJournalView(state): JournalView`:

- Returns `{ journalId: 'relationship-journal', title: 'Relationships', entries: [...state.entries] }`.
- `entries` already carry `{ id, text }`; `text` is always a frozen-table string.

### 3.2 Rendered entry identity (`entry.id`) — opaque, safe by default

`entry.id` is used only as (a) the dedupe/React key and (b) the `JournalPanel`
list `key`. It is **never** rendered as visible text and **never** logged.

**Decision:** dedupe is keyed on `candidate.dedupeKey` (an invariant), but the
**rendered `entry.id` is an opaque, scope-free surrogate**, not the raw
`dedupeKey`. `dedupeKey` embeds `worldId`/`sessionId`/`npcId`; keeping those ids
out of the rendered entity entirely is the smallest-surface, defense-in-depth
choice and does not conflict with ADR-0082 (which sanctions—not requires—encoding
dedupe in `id`).

- The helper keeps the `dedupeKey` internally for dedupe (e.g. a `Set` / map of
  seen keys, or a private field on the accumulator), and assigns each surfaced
  entry an opaque id such as `relationship-journal-entry-{ordinal}` where
  `ordinal` is a monotonic per-session counter with **no scope ids, npcId, bucket
  word, or score in it**.
- **If a future decision instead uses the raw `dedupeKey` as `entry.id`**, this
  plan **requires** the DOM-leak and log-leak tests in §5 to prove the id is never
  rendered to the DOM and never logged. Absent those proofs, the raw-key form is
  not permitted.

### 3.3 Runtime wiring — `App.tsx`

- New App-owned state slot: `relationshipJournal` (`useState<RelationshipJournalState>`),
  initialized to `INITIAL_RELATIONSHIP_JOURNAL_STATE`. A parallel ref is used only
  if a stable-closure read is required; otherwise the functional-update form
  (`setRelationshipJournal(prev => accumulate(prev, ...))`) is preferred.
- Inside `handleNpcDialogueResolved`, **after** the existing
  `setRelationshipFeedbackState(...)` call, add:

  ```
  setRelationshipJournal(prev =>
    accumulateRelationshipJournal(prev, {
      worldId: state.worldId,
      sessionId: state.sessionId,
      npcId: event.npcId,
      prevBucket,   // reused, already computed for feedback
      nextBucket,   // reused, already computed for feedback
    }),
  )
  ```

  `prevBucket`/`nextBucket` are the **same values** already computed for the
  feedback slot; no new relationship read is introduced.
- **Reset to `INITIAL_RELATIONSHIP_JOURNAL_STATE` at exactly two sites**, mirroring
  the `relationshipsRef = new Map()` resets:
  - `handlePrompt` (new generated session)
  - `handleLoad` (load start)

  **Do not** reset in `enterActivePlay` / on room entry.
- On load, the journal stays empty (no crossing replay); `relationshipsRef`
  re-seeds silently exactly as today. No journal wiring is added to the sidecar
  restore path.

### 3.4 Rendering — `JournalPanel` reuse

- Add an optional presentational `label?: string` (default `"Journal"`) and an
  optional `className` / variant to `JournalPanel` so the second instance reads
  `"Relationships"` and does not visually collide with the existing journal panel.
  No behavioral change to the existing instance (default label preserved).
- Render:

  ```
  {relationshipJournal.entries.length > 0 && (
    <JournalPanel
      view={toRelationshipJournalView(relationshipJournal)}
      label="Relationships"
      className="relationship-journal-panel"
    />
  )}
  ```

- **Safe degradation:** zero entries → the panel does not render at all.
- **No re-announcement:** the relationship panel must not use `aria-live`
  (the transient feedback line already announced the crossing; a live journal
  would double-announce). It stays collapsed by default and is a static log when
  expanded.

### 3.5 Logging

- The accumulation helper is pure and logs nothing.
- No new log lines are added in `App.tsx` for this feature. The existing
  `deriveAndReduceRelationship` log shape is untouched.
- If any diagnostic is ever added, it is **count-only** (e.g. entry count) and
  carries no id/text/bucket/score.

---

## 4. Non-goals

- **Not** a multi-axis journal. Trust/respect/fear are dry (ADR-0077) and produce
  no candidate; no template or entry for them exists.
- **Not** persisted. No save-game field, sidecar, SQLite row, migration,
  `localStorage`, or `schemaVersion` bump. A loaded session starts with an empty
  relationship journal.
- **Not** an append into authoritative state. No `WorldState`/`WorldEvent`/
  `WorldCommand`/`applyEvent`, memory, `Fact`/`fact_visibility`.
- **Not** a change to the existing `journal` slot, its three producers,
  `projectJournal`, or the `JournalView`/`JournalEntryView` shape.
- **Not** an NPC display-name feature. No name interpolation; there is no existing
  safe display-label policy to draw on, so entries stay generic and name-free.
- **Not** an LLM/provider/prompt/network feature. No generated or dialogue text
  reaches the journal.
- **Not** a chase/awareness/combat change. `hostile-npc-chase-lite-v0` (ADR-0084)
  and `npc-player-awareness-v0` (ADR-0083) are untouched.
- **Not** a scope change to the candidate contract module.

---

## 5. Slice plan

- **Slice 0 — Docs-first (this document + ADR-0085).** No code. Approved before
  any implementation. Honors AGENTS.md "design first" and the docs-plan-before-code
  convention.
- **Slice 1 — Pure accumulation helper + tests.**
  `app/relationshipJournalRuntime.ts` + `app/relationshipJournalRuntime.test.ts`.
  No App wiring. Green in isolation.
- **Slice 2 — App/runtime wiring + tests.** New `relationshipJournal` state slot,
  the single `accumulate` call in `handleNpcDialogueResolved` reusing existing
  buckets, and the two session-boundary resets. Assert state transitions via test;
  no UI yet.
- **Slice 3 — Panel rendering + tests.** `JournalPanel` optional `label`/`className`;
  the second panel instance; empty-state degradation; no `aria-live`.
- **Slice 4 — Safety/eval tests.** No-leak, no-side-effect, no-persistence,
  no-world/memory/fact-write, log-safety, and save-game-unchanged proofs (extend
  the existing `evaluation/noSideEffects` + `evaluation/logSafety` patterns; add a
  targeted DOM-leak scan; optionally a `redteam` case).
- **Slice 5 — Docs closeout.** Flip ADR-0085 to Accepted-Implemented, add the
  ARCHITECTURE.md status line, and record the final file list + verification
  results in this plan.

Each code slice lands one at a time, small and independently testable, on `main`.

---

## 6. Test plan

### 6.1 Helper unit (`relationshipJournalRuntime.test.ts`)

- `none→low` adds exactly one entry whose text is the frozen constant
  (`"Someone here seems more familiar with you."`).
- Same-bucket and downward inputs add nothing and return the **identical state
  reference** (no re-render churn).
- **Dedupe:** the same crossing applied twice yields one entry (keyed on
  `dedupeKey`).
- Distinct crossings (`none→low`, `low→medium`, `medium→high`) accumulate in order.
- Different NPCs accumulate independently (distinct `dedupeKey` scope).
- **Cap:** more than `RELATIONSHIP_JOURNAL_MAX_ENTRIES` distinct entries drops the
  oldest; length never exceeds the cap.
- **Leak (state):** `JSON.stringify(state)` and every `entry.text` contain no
  `npc-` / npcId / digit / `none|low|medium|high` / `delta` / `score` /
  `interactionCount` / `worldId` / `sessionId`.
- **Entry id:** `entry.id` contains no scope id, npcId, bucket word, or score
  (opaque-surrogate invariant, §3.2).
- `toRelationshipJournalView` returns fixed `journalId`/`title`; every entry text
  ∈ the frozen table.

### 6.2 App wiring (`App.test.tsx` / App-level)

- A resolved dialogue producing a `none→low` crossing renders the "Relationships"
  panel with one entry.
- No crossing → panel absent (degradation).
- Journal **survives a room entry** (`enterActivePlay`) — asserts it is **not**
  reset on room entry.
- Journal **resets to empty on new prompt** and **on load**.
- On load, the panel is empty even though `relationshipsRef` re-seeds from the
  sidecar.
- Repeated dialogue at the same bucket yields a single entry end-to-end (dedupe).

### 6.3 Safety / eval (Slice 4)

- **DOM-leak:** with the panel expanded, rendered DOM text contains only the
  frozen line — no scope ids, npcId, digits, bucket words, dialogue text, provider
  output, effect payloads, or the relationship-feedback line text. If a future
  change uses raw `dedupeKey` as `entry.id`, an explicit assertion proves the id is
  absent from rendered DOM (§3.2).
- **No side effects:** accumulation triggers no `WorldState`/`WorldEvent`/
  `WorldCommand`, memory, `Fact`/`fact_visibility`, persistence, or network call
  (extend `evaluation/noSideEffects`).
- **Log-safety:** no new log line carries id/text/bucket/score (extend
  `evaluation/logSafety`); if raw `dedupeKey` is ever used as `entry.id`, prove it
  is never logged.
- **Save-game unchanged:** the `SaveGame` blob and all sidecars are byte-identical
  to the pre-feature format; the relationship journal is not present in any saved
  bytes.

### 6.4 Verification commands (per slice)

```bash
npm run test -- relationshipJournalRuntime
npm run test -- relationshipJournal
npm run test -- App
npm run lint
npm run build
```

---

## 7. Safety invariants

1. **No raw relationship data in rendered UI:** no scores, deltas,
   `interactionCount`, bucket enum words, effect/source kinds.
2. **No identity leakage in rendered UI:** no NPC display names or ids, room/object
   names, `worldId`/`sessionId`.
3. **No content leakage in rendered UI:** no dialogue text, provider/LLM output,
   prompt text, effect payloads, or relationship-feedback line text — only the
   frozen template string.
4. **Dedupe uses `candidate.dedupeKey`** — the stable key from the candidate
   contract.
5. **No authoritative writes:** no `WorldState`, `WorldEvent`, `WorldCommand`,
   `applyEvent`, memory, `Fact`, or `fact_visibility` write or derivation.
6. **No persistence:** no save-game/sidecar/SQLite/`localStorage`/migration/schema
   change; no `schemaVersion` bump. Runtime-only, session-scoped.
7. **Session-boundary reset only:** reset on new prompt and load; never on room
   entry. Hydration is journal-silent.
8. **No provider/prompt/network/clock/randomness** in the accumulation path.
9. **No chase/combat/awareness change:** ADR-0083/ADR-0084 behavior byte-identical;
   this feature adds no engine or awareness code.
10. **Candidate contract module unchanged:** `relationshipJournalCandidate.ts` is
    consumed, not edited.
11. **Existing `journal` slot untouched:** `setJournal`/`refreshDerivedViews`/the
    three producers are not modified; the relationship journal is a separate slot.

---

## 8. Known risks / limitations

- **R1 — Wrong reset scope.** Resetting on room entry would wipe the journal each
  navigation. *Mitigation:* reset only at `handlePrompt`/`handleLoad`; a test
  asserts survival across `enterActivePlay`.
- **R2 — Entry-id leakage.** `entry.id` could embed scope ids if the raw
  `dedupeKey` were used. *Mitigation:* use an opaque scope-free surrogate id by
  default (§3.2); if raw key is ever adopted, DOM/log leak tests are mandatory.
- **R3 — Accidental reuse of the shared `journal` slot.** *Mitigation:* separate
  state slot + separate panel; never call `setJournal`/`refreshDerivedViews`.
- **R4 — Double screen-reader announcement.** *Mitigation:* the relationship panel
  omits `aria-live`; the transient line remains the single announcement.
- **R5 — CSS collision of two `.journal-panel` elements.** *Mitigation:* distinct
  `className` variant / offset; visual check in Slice 3.
- **R6 — Scope creep into trust/respect/fear.** Those axes are dry (ADR-0077).
  *Mitigation:* familiarity-only; the builder cannot produce other axes.
- **R7 — Persistence temptation.** No journal store exists; the relationship
  sidecar holds current axes, not crossing history. *Mitigation:* runtime-only;
  save-game-unchanged test.
- **Limitation — session-ephemeral.** The journal is empty after load/refresh.
  This is intended for v0; persistence is deferred (§10).
- **Limitation — single template.** Only `familiarity_increased` renders; other
  milestones await runtime-emittable axes.

---

## 9. Manual smoke plan

Run `npm run dev` in `apps/web` (fake providers, no keys required):

1. Generate a room via the PromptBar; approach an NPC and open dialogue.
2. Exchange enough turns to cross `none→low` familiarity. Confirm the transient
   feedback line appears **and** a "Relationships" panel appears; expand it and
   confirm exactly one generic entry ("Someone here seems more familiar with
   you."), with no name, number, or bucket word.
3. Continue dialogue at the same bucket; confirm **no duplicate** entry is added.
4. Navigate to an adjacent room and back; confirm the panel and its entry
   **persist** (not reset on room entry) while the transient line is gone.
5. If reachable, cross `low→medium`; confirm a second entry accumulates in order.
6. Submit a **new prompt**; confirm the relationship journal **resets to empty**.
7. Save, then Load; confirm the relationship journal is **empty after load** (no
   replay) while other loaded state restores normally.
8. Spot-check the console/logger output during all of the above: no npcId, bucket
   word, score, delta, dialogue text, or entry id appears in any log line.

---

## 10. Deferred work

- **Persistence of crossing history** (save-game/sidecar) — its own decision; the
  current relationship sidecar stores only current axes, not history.
- **Trust/respect/fear entries** — unlocked only when those axes become
  runtime-emittable (a separate feature widening `dialogueContext.ts` and making
  the valenced reducer rows live).
- **NPC display-label policy** — name-bearing entries require a separately-approved
  safe display-label policy that does not exist today.
- **Richer templates / grouping / timestamps** — v0 is one closed line; any
  expansion is a later, separately-approved slice and must not widen
  `JournalEntryView` unsafely.
- **Shared-slot / unified journal UX** — v0 keeps a dedicated panel; any merge with
  the existing consequence journal is deferred.

---

## 11. Slice 5 closeout

Slices 1–4 landed on `main`, one at a time, each maintainer-approved, with no
invariant in §0 relaxed. This section is the closeout record required by
AGENTS.md's design-first/docs-plan-before-code convention.

### 11.1 Implemented files

- `apps/web/src/app/relationshipJournalRuntime.ts` — pure
  `accumulateRelationshipJournal` reducer + `toRelationshipJournalView`,
  consuming the unmodified `domain/npcRelationship/relationshipJournalCandidate.ts`.
- `apps/web/src/app/relationshipJournalRuntime.test.ts` — helper unit tests.
- `apps/web/src/App.tsx` — new `relationshipJournal` state slot, the single
  accumulation call inside `handleNpcDialogueResolved`, the two
  session-boundary resets (`handlePrompt`, `handleLoad`), and the second
  `JournalPanel` render.
- `apps/web/src/renderer/ui/JournalPanel.tsx` — additive optional `label` /
  `className` / `live` props; default rendering for the existing instance is
  unchanged.
- `apps/web/src/renderer/ui/JournalPanel.test.tsx` — panel rendering,
  empty-state degradation, and expanded-DOM leak coverage.
- `apps/web/src/evaluation/noSideEffects.eval.test.ts`,
  `apps/web/src/evaluation/logSafety.eval.test.ts` — extended with
  relationship-journal cases (Slice 4).
- This plan and [ADR-0085](../decisions/ADR-0085-relationship-journal-runtime-v0.md)
  (Slice 5 docs closeout).

No changes to `domain/npcRelationship/relationshipJournalCandidate.ts`, the
`journal` slot/its three producers, schema, save-game, persistence, provider,
or any chase/awareness/combat file.

### 11.2 Final behavior summary

- The only reachable entry is the frozen line "Someone here seems more
  familiar with you.", added on a strictly upward `familiarity` bucket
  crossing for the active dialogue NPC.
- Dedupe uses the candidate contract's stable `dedupeKey` internally; the
  rendered `entry.id` is an opaque, scope-free surrogate
  (`relationship-journal-entry-{a, b, c, …}`).
- The "Relationships" panel accumulates across rooms within a session
  (confirmed to survive `enterActivePlay`/room entry) and resets to empty only
  on a new prompt or a load. A loaded session always starts with an empty
  relationship journal — no crossing replay on hydration.
- Zero entries → the panel does not render (safe degradation). The panel is
  collapsed by default, has no `aria-live`, and cannot double-announce over the
  transient relationship-feedback line.
- UI text is closed-template only: no NPC names, raw scores, numeric deltas,
  bucket words, dialogue text, provider output, effect payloads, or feedback
  text ever appear.

### 11.3 Safety boundaries (confirmed unchanged at closeout)

- No `WorldState`/`WorldEvent`/`WorldCommand`/`applyEvent`, memory,
  `Fact`/`fact_visibility` write or derivation.
- No persistence: no save-game/sidecar/SQLite/`localStorage`/migration/schema
  change; no `schemaVersion` bump.
- No provider/prompt/LLM/network/clock/randomness in the accumulation path.
- No `hostile-npc-chase-lite-v0` (ADR-0084) / `npc-player-awareness-v0`
  (ADR-0083) / combat/encounter behavior change.
- Existing `journal` slot, its three producers, and
  `refreshDerivedViews`/`applyEventJournalFromSession` untouched.

### 11.4 Known limitations (unchanged from §8/§10)

- Session-ephemeral only — no crossing-history persistence in v0.
- Single template (`familiarity_increased`) — trust/respect/fear remain dry
  (ADR-0077) and deferred.
- No NPC display-label policy — entries stay generic/name-free.
- Richer templates/grouping/timestamps/unified journal UX are deferred to
  future, separately-approved slices.

### 11.5 Verification results

Run from `apps/web`:

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

The single full-suite failure (`src/redteam/feedback.redteam.test.ts:69`) is a
pre-existing, unrelated assertion on a literal `MemoryFeedback` JSX wiring
string that predates this feature's
`selectTransientFeedbackMessage(memoryFeedbackState.message,
relationshipFeedbackState.message)` call site.
