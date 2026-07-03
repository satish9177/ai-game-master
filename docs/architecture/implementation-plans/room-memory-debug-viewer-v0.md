# Implementation Plan — `feature/room-memory-debug-viewer-v0`

> Status: **DRAFT — docs-only. Not approved. No code until the maintainer approves this plan.**
>
> File location note: repo convention places implementation plans under
> `docs/architecture/implementation-plans/` (all siblings live here). The task
> named `docs/implementation-plans/…`; this plan is placed in the established
> directory. Move on request.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
>
> Direct precedent and dependencies:
> - `living-world-room-memory-v0` ([ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md))
>   defines the `RoomMemoryRecord` contract (inert `text`, closed-enum metadata,
>   `(worldId, sessionId, roomId)` scope) this viewer reads.
> - `runtime-room-memory-persistence-v0` ([ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md))
>   is why a browser-side runtime room-memory store now exists at all
>   (`InMemoryRoomMemoryStore`, wired in `App.tsx`), plus the `snapshotAll()`
>   read helper.
> - `room-memory-visible-feedback-v0` ([ADR-0071](../decisions/ADR-0071-room-memory-visible-feedback-v0.md))
>   is the read-only presentational overlay precedent (`MemoryFeedback.tsx`,
>   `role="status"`, presentational prop-only component + pure `app/` gate).
> - `memory-poisoning-redteam-v0` ([ADR-0072](../decisions/ADR-0072-memory-poisoning-redteam-v0.md))
>   is the boundary armour this feature must not regress (logging, memory-text
>   containment, authoritative-state isolation).

---

## Goal

Add a **read-only, developer/debug UI** that displays the **sanitized room-memory
records currently held in the browser runtime**, so a developer can see what room
memory exists for the active session without reading logs, opening a debugger, or
guessing from dialogue behaviour.

The defining property: **the viewer is a passive lens, not a system.** It reads a
snapshot of the already-wired browser `RoomMemoryStore`, projects it through a pure
sanitizer, and renders it. It performs **no memory write, no `remember`/`recall`
side effect, no `WorldState`/event-log touch, no provider call, and no persistence
access.** It cannot change gameplay, cannot become truth, and has no write path of
any kind.

The work is small and additive because the read source already exists:
`App` owns a runtime `InMemoryRoomMemoryStore` per active play (`App.tsx:169-175`),
and that store already exposes a clone-returning `snapshotAll()`
(`InMemoryRoomMemoryStore.ts:80-82`) built for exactly this kind of consumer. The
only genuinely new pieces are (a) a pure sanitizer/view-model projection, (b) a
presentational panel, (c) a thin, dev-gated App seam, and (d) tests.

---

## Why now

- **The read source just became real.** Before `runtime-room-memory-persistence-v0`
  room memory was headless/Node-only. Now a browser runtime store holds live
  records for the active session, but there is **no way to observe it** except log
  counts (which deliberately never include text). A debug viewer closes that
  observability gap directly.
- **It de-risks every downstream memory feature.** Recall ranking, dedupe,
  promotion, and dialogue grounding are all hard to trust when the underlying
  records are invisible. A sanitized viewer makes the memory layer inspectable
  during development without weakening any boundary.
- **It is the lowest-risk possible slice against the memory layer:** strictly
  read-only, reusing an existing snapshot API and an existing overlay pattern, with
  no schema, persistence, provider, or authority surface touched.

---

## Non-goals

Explicitly **out of scope** for v0 (call them out to prevent scope creep):

- **No memory writes / editing / deletion.** The viewer never calls `remember`,
  never mutates the store, and adds no "delete this memory" affordance.
- **No recall invocation.** It does not call `RoomMemoryService.recall` or
  `recallRoomMemoryContext`; it reads a raw store snapshot only. (Recall runs
  ranking/limits that are a *different* view; mixing them in is a later slice.)
- **No NPC-memory viewer.** Room memory only. NPC memory (`NpcMemoryService`) is a
  separate scope and a separate future slice.
- **No SQLite / persistence / Node reach.** The browser viewer reads the in-memory
  browser store only. It never imports `persistence/**`, `server/**`, `node:sqlite`,
  or `node:http`.
- **No provider/LLM behaviour change**, no prompt change, no cost-meter interaction.
- **No schema / save-load change.** No `RoomMemoryRecord`, `SaveGame`,
  `roomMemoryJson`, `WorldState`, or `RoomSpec` field is added or bumped.
- **No player-facing feature.** This is a dev/debug surface, gated off in
  production builds and behind an explicit opt-in env flag (Decision D1, locked).
  It is **not** the Consequence Journal.
- **No consequence-journal overlap.** The Consequence Journal
  ([ADR-0029](../decisions/ADR-0029-consequence-journal-v0.md)) is a *player-facing*
  projection of authoritative `WorldState`. This viewer is a *developer* projection
  of *non-authoritative memory*. They share no data source, no component, and no
  code path; this plan adds nothing to the journal projector or `JournalPanel`.

---

## Safety boundaries (must remain unchanged)

This feature is a strict subset of "read-only projection" rules
([AGENTS.md](../../../AGENTS.md) "UI projection rules"). The following must hold and
be verified in review:

1. **Memory firewall unchanged.** The viewer lives in UI + App composition. It
   imports `domain/memory` contracts/helpers (allowed) and reads the App-held
   store snapshot. It does **not** relax the `src/memory/**` import ban on
   `world-session`/`interactions`/`encounters`/`dialogue`, and adds no write path.
2. **No memory mutation.** Only `snapshotAll()` (clone-returning) and pure
   projection are used. No `record`, `restoreAll`, `remember`, or store field
   mutation.
3. **No authoritative-state touch.** No `WorldSession`, `WorldStore`,
   `WorldCommand`, `WorldEvent`, `WorldState`, interaction, encounter, or navigation
   call. Zero events, zero commands.
4. **No provider / cost / network / persistence.** No generator, dialogue provider,
   usage meter, `fetch`, SQLite, or server call.
5. **No raw leakage into logs.** The viewer logs **nothing** by default; if any
   diagnostic is added it is counts/enums/booleans only — **never** memory `text`,
   room/NPC names, player lines, ids-as-content, or PII. This preserves the
   `memory-poisoning-redteam-v0` logging gate.
6. **Sanitized display only (D2, locked).** Rendered text passes through a pure
   display sanitizer (strip control/newline chars, collapse whitespace, truncate
   long safe text) reusing the existing line-safety notion
   (`hasRoomMemoryControlCharacters`, `roomFirewall.ts`). Any unknown / raw /
   prompt-like / provider-like field — or a record that fails re-validation —
   renders as `[redacted]`, never the raw value. No raw prompt, provider body, or
   generated JSON is ever in scope — those are not part of a `RoomMemoryRecord`.
7. **Dev-gated (D1, locked).** The panel renders only when
   `import.meta.env.DEV && VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true'`; it does not
   render in production builds and is not a shipped player surface.
8. **UI boundary intact.** The panel is presentational (props only), imports no
   `three`, no engine internals, no env directly, and no persistence/server code.
   Env/gate reading and snapshot wiring happen in the App composition root.

---

## Current repo facts (verified against source)

- **A browser runtime room-memory store already exists.** `App.tsx:169-175`
  (`createRoomMemoryRuntime`) constructs `new InMemoryRoomMemoryStore()` and a
  `RoomMemoryService` over it, per the runtime-persistence wiring.
- **`snapshotAll()` is purpose-built for a read-only consumer.**
  `InMemoryRoomMemoryStore.ts:80-82` returns **clones** in a deterministic order
  (`worldId`, `sessionId`, `roomId`, `seq` asc, `memoryId` tie-break), so a consumer
  cannot alias or mutate internal state.
- **`RoomMemoryRecord` is closed and bounded** (`roomContracts.ts:68-86`): enum
  `kind`/`source`/`confidence`, `text` ≤ `MAX_ROOM_MEMORY_CHARS` (280), scope triple,
  `seq`, `createdAt`. Nothing in the record is executable or a raw prompt.
- **Line-safety helper already exists.** `hasRoomMemoryControlCharacters`
  (`roomFirewall.ts`, re-used by `roomMemorySaveState.ts`) is the existing
  control/newline predicate the sanitizer should reuse rather than reinvent.
- **A read-only overlay precedent exists.** `MemoryFeedback.tsx` is a
  presentational, prop-only, `role="status"` overlay; `app/memoryFeedback.ts` holds
  its pure gate. This is the shape to mirror.
- **No existing dev-gate pattern.** There is no `import.meta.env.DEV` usage in
  `src/**` today; `app/llmConfig.ts` is the only browser module that reads
  `import.meta.env`. The dev gate is therefore composed in a sibling config helper
  (`app/debugConfig.ts`), not read inside the UI component (Decision D1, locked).

---

## Minimum Safe Change Check (required by AGENTS.md)

- **Reused existing code:** `InMemoryRoomMemoryStore.snapshotAll()` (read source);
  `RoomMemoryRecord` contract + enums; `hasRoomMemoryControlCharacters` (line
  safety); `MemoryFeedback.tsx` overlay pattern + `app/memoryFeedback.ts` pure-gate
  pattern; App's existing per-play runtime store ownership.
- **Minimum new code needed:** one pure projector
  (`domain/memory/roomMemoryDebugView.ts` — record[] → sanitized view-model[]); one
  presentational panel (`renderer/ui/RoomMemoryDebugPanel.tsx`); a thin dev-gated
  App seam (open/refresh state + snapshot read + gate); a small CSS block; tests.
- **Safety boundaries unchanged:** firewall, authoritative state, provider,
  persistence, schema, save-load, logging redaction — all untouched (see Safety
  Boundaries).
- **Targeted tests prove it:** projector sanitization/ordering unit tests; panel
  render test; gate test; a redteam-style assertion that the viewer path logs no
  text and issues no write. (See Tests.)

---

## Proposed slices

Kept small and independently reviewable. Each slice is a stop point.

### Slice 1 — Pure sanitizing projector (domain, no UI)
`domain/memory/roomMemoryDebugView.ts`: a pure function
`toRoomMemoryDebugView(records: readonly RoomMemoryRecord[]): RoomMemoryDebugRow[]`.
- Maps each record to a display row where **metadata is primary** — closed-enum
  `kind`, `source`, `confidence`, plus `seq`, `roomId`, short `memoryId`,
  `createdAt` — followed by a **sanitized `text`** field (Decision D2, locked:
  show sanitized text, not metadata-only).
- **Sanitizer contract (D2, locked):** text is displayed **only after** the pure
  sanitizer/projection. Steps: reuse `hasRoomMemoryControlCharacters` line-safety;
  replace control/newline chars with spaces; collapse whitespace; **truncate long
  safe text** (clamp to `MAX_ROOM_MEMORY_CHARS`, appending a bounded ellipsis
  marker so truncation is visible). Any field that is unknown, raw, or
  prompt-/provider-like (i.e. not a validated `RoomMemoryRecord` closed field, or a
  record that fails re-validation) renders as the literal string **`[redacted]`** —
  never the raw value. Pure: no I/O, no logger, no mutation of input.
- Deterministic order (accept the store's snapshot order; do not re-sort by content).
- Domain-pure: imports only `zod`-adjacent sibling contracts; imports no
  React/three/logger/persistence. **No `WorldCommand`/`WorldEvent`-producing export.**

### Slice 2 — Presentational panel (UI, no wiring)
`renderer/ui/RoomMemoryDebugPanel.tsx`: prop-only component
`{ rows: RoomMemoryDebugRow[]; open: boolean; onToggle: () => void; onRefresh: () => void }`.
- Collapsible; renders a bounded list/table of rows with **metadata primary** and
  sanitized text secondary; explicit **Refresh** control (D3); empty state when no
  rows.
- Presentational only: it renders the already-sanitized view-model verbatim and
  performs **no** sanitization, redaction, or memory logic of its own. No `three`,
  no engine internals, no env read, no store/service import.
- Mirror `MemoryFeedback.tsx` styling conventions; add a small scoped CSS block.

### Slice 3 — Thin dev-gated App seam
- **Gate (D1, locked):** a single central config helper (a tiny
  `app/debugConfig.ts`, mirroring `app/llmConfig.ts` as the env-reading seam)
  exposes one boolean derived from **both** gates:
  `import.meta.env.DEV && import.meta.env.VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true'`.
  The UI never reads env; only this helper does.
- **Snapshot cadence (D3, locked):** on-demand only. App reads `activePlay`'s
  runtime store `snapshotAll()` **once when the panel opens**, projects it via the
  Slice 1 projector into memoized rows, and re-reads **only** when the developer
  clicks Refresh. **No polling, no subscriptions, no live event hooks.** App holds
  only minimal `open` + last-snapshot state; no reactive re-projection on
  `WorldState` changes and no refactor of existing App flows (keeps the App seam
  minimal per the "avoid App.tsx-heavy work" constraint).
- When gated off: render nothing — no panel, no snapshot read, no projector call,
  no cost.

### Slice 4 — Tests + docs closeout
Targeted tests (below) + ADR + ARCHITECTURE/BOUNDARIES/AGENTS closeout notes.
No ADR/architecture edits land before maintainer approval of this plan.

---

## Acceptance criteria

- The panel renders **only** when both gates are true
  (`import.meta.env.DEV && VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true'`); with either
  gate false (production build, or dev without the opt-in flag) it does not render
  and no snapshot is read.
- With the gate on and room memories present, the panel lists them with metadata
  primary and sanitized text secondary, in the store's deterministic snapshot order.
- Snapshot is taken **once on open** and **only** re-taken on Refresh — no polling,
  no subscription, no re-projection on `WorldState` change.
- Opening/refreshing/closing the panel causes **zero** memory writes, **zero**
  `recall` calls, **zero** events/commands, and **zero** provider/network/persistence
  calls (verified by test spies).
- Rendered text never contains control/newline characters and never exceeds
  `MAX_ROOM_MEMORY_CHARS`; truncated text shows a visible marker; unknown / raw /
  prompt-like / provider-like fields render as `[redacted]`, never the raw value.
- No log line emitted by the viewer path contains memory `text`, room/NPC names,
  player lines, or PII (counts/enums/booleans only, or nothing).
- `npm run build`, `npm run lint`, `npm run test` pass; no new lint boundary
  violation; no schema/save-load change.

---

## Tests

Targeted, deterministic, mirroring existing memory/UI test placement:

- **`domain/memory/roomMemoryDebugView.test.ts`** (pure): control/newline chars
  stripped; whitespace collapsed; length clamped to 280 with a visible truncation
  marker; enum metadata passed through unchanged; unknown / raw / prompt-like /
  provider-like or re-validation-failing fields → `[redacted]`; input array not
  mutated; empty input → empty output; order preserved from snapshot.
- **`renderer/ui/RoomMemoryDebugPanel.test.tsx`**: renders rows (metadata primary,
  sanitized text secondary); empty state; toggle/refresh callbacks fire; no
  memory-text control chars in DOM; no `three` import.
- **App gate test** (extend `App.test.tsx` minimally): both gates required — panel
  absent and `snapshotAll` not called when either gate is off; present with
  projected rows when both on; Refresh re-reads `snapshotAll` and open does not
  subscribe/poll.
- **Redteam-aligned assertion** (`redteam/` or the App test): opening/refreshing the
  viewer issues no `record`/`remember`, no `WorldSession` call, and the logger
  receives no memory-text argument on the viewer path.

Verification commands (targeted first, per AGENTS.md):

```bash
npm run test -- roomMemoryDebugView
npm run test -- RoomMemoryDebugPanel
npm run test -- App
npm run lint
npm run build
```

---

## Locked decisions (resolved by maintainer)

- **D1 — Gate mechanism (LOCKED).** A single central config helper
  (`app/debugConfig.ts`, the only env-reading seam) exposes one boolean:
  `import.meta.env.DEV && import.meta.env.VITE_ROOM_MEMORY_DEBUG_VIEWER === 'true'`.
  Both gates must be true — the panel is off in any production build and requires an
  explicit opt-in env flag even in dev. The UI never reads env.
- **D2 — Sanitized text, not metadata-only (LOCKED).** The viewer shows record
  `text`, but **only after** the pure sanitizer/projection. Metadata stays primary;
  sanitized text is secondary. Unknown / raw / prompt-like / provider-like fields
  (anything not a validated `RoomMemoryRecord` closed field, or a record failing
  re-validation) render as `[redacted]`, never the raw value. Long safe text is
  truncated. Nothing is ever logged.
- **D3 — On-demand refresh (LOCKED).** Snapshot once when the panel opens, then only
  when the developer clicks Refresh. No polling, no subscriptions, no live event
  hooks, no App.tsx-heavy state plumbing.

---

## Review checklist

Before handing off (extends [AGENTS.md](../../../AGENTS.md) review checklist):

- [ ] Slice scope only; no unrelated files changed; no App-flow refactor.
- [ ] No memory write path introduced (no `remember`/`record`/`restoreAll`/mutation).
- [ ] No `recall` invocation; viewer reads raw `snapshotAll()` only.
- [ ] No `WorldSession`/event-log/`WorldState`/interaction/encounter/navigation touch.
- [ ] No provider/LLM/cost/network/persistence/server/`node:sqlite` access.
- [ ] Memory firewall unchanged; `src/memory/**` import bans intact.
- [ ] No schema, `SaveGame`, `roomMemoryJson`, or save-load change; no `schemaVersion`
      bump.
- [ ] Projector is pure (no I/O, no logger, no input mutation) and exports no
      command/event-producing function.
- [ ] Panel is presentational: no `three`, no engine internals, no env read, no
      store/service import.
- [ ] Dev-gated; renders nothing (and reads nothing) when gated off.
- [ ] Rendered text sanitized (control/newline-free, ≤ `MAX_ROOM_MEMORY_CHARS`).
- [ ] No unsafe logging: no memory text/names/player lines/PII in any log; viewer
      logs counts/enums/booleans only, or nothing.
- [ ] No consequence-journal code path or `JournalPanel` touched.
- [ ] Tests cover sanitization, ordering, gate, and the no-write/no-log-leak
      invariants; build/lint/test reported honestly.
