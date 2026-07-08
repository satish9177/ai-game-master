# Implementation Plan — `feature/hostile-npc-chase-demo-opt-in-v0`

> Status: **IMPLEMENTED. All slices complete; Slice 3 (debug indicator) intentionally
> skipped.**
> This plan exposes the already-implemented `hostile-npc-chase-lite-v0` foundation
> through a controlled, default-off, demo/dev-safe opt-in path so chase can be
> visibly tested in real gameplay (`npm run dev`) without making chase global,
> content-derived, or dangerous.
> See [ADR-0086](../decisions/ADR-0086-hostile-npc-chase-demo-opt-in-v0.md).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on
> [`hostile-npc-chase-lite-v0`](./hostile-npc-chase-lite-v0.md)
> ([ADR-0084](../decisions/ADR-0084-hostile-npc-chase-lite-v0.md)) and
> [`npc-player-awareness-v0`](./npc-player-awareness-v0.md)
> ([ADR-0083](../decisions/ADR-0083-npc-player-awareness-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved as a demo/dev-only, default-off, closed-allowlist, id-only
visibility path over the existing `chaseOptInNpcIds` seam.** These invariants may not
be relaxed without explicit maintainer approval:

- **Default off.** With `VITE_AIGM_DEMO_CHASE` unset/falsy, the computed opt-in set is
  always empty and gameplay is byte-identical to today.
- **Closed allowlist only.** The set of NPC ids that can ever be opted in is a small,
  frozen, hand-authored constant — never derived, discovered, inferred, or expanded at
  runtime.
- **Id-only selection.** The selector reads NPC **ids** and the active room's present-id
  set only. It never reads NPC name, room description/text, prompt text, provider
  output, generated content, relationship state, dialogue text, or any other
  content-bearing field to decide eligibility.
- **Movement/intent only.** This slice adds no new chase behavior. It only threads an
  id set into the existing, unchanged `chaseOptInNpcIds` seam
  (`chaseStep.ts` → `WanderMotor` → `Engine`). No combat, damage, HP change, injury,
  item loss, capture, death, encounter, or quest effect — contact remains inert
  exactly as ADR-0084 defined it.
- **Same-room only, awareness-gated, no teleport, home-leashed.** All unchanged from
  ADR-0084/ADR-0083: chase activates only for a same-room opted-in NPC whose awareness
  tier is `aware`/`alerted`, stops on `nearby`/`unaware`, is capped/re-validated each
  step (never teleports), and stays inside `NPC_WANDER.MAX_RADIUS_FROM_HOME = 2.5`.
- **No authoritative/persistence/provider surface.** No `WorldState`, `WorldEvent`,
  `WorldCommand`, event log, SQLite, memory, fact, `fact_visibility`, save-game, or
  `RoomSpec`/schema change; no `schemaVersion` bump; no LLM/provider/prompt change.
- **No relationship-driven, prompt-derived, or generated-intent-driven hostility.**
  Eligibility never reads `NpcRelationshipState`, dialogue history, generated room
  text, story anchors, or any provider/LLM signal.
- **Do not weaken existing safety tests.** `chaseStep.test.ts`, `WanderMotor.test.ts`,
  and `Engine.test.ts` stay green, unmodified in their existing assertions.
- **Full suite stays green** at every slice (baseline: 3576/3576 passed, no known red
  tests).

**Scope honesty:** this feature is **visibility/wiring only**. It does not invent a
real hostility source, does not change what chase *does*, and does not touch anything
below the existing `SetRoomOptions.chaseOptInNpcIds` seam. It answers only "which ids,
if any, get passed into the seam that already exists," under a default-off gate.

---

## 1. Title and status

- **Feature:** `hostile-npc-chase-demo-opt-in-v0` — Controlled demo/dev-only visibility
  path for `hostile-npc-chase-lite-v0`, gated by a default-off env flag and a closed,
  id-only allowlist.
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** IMPLEMENTED — Slices 1, 2, 4, and 5 shipped; Slice 3 (debug indicator)
  skipped by design (see §12).
- **ADR:** [ADR-0086](../decisions/ADR-0086-hostile-npc-chase-demo-opt-in-v0.md).

## 2. Problem statement

`hostile-npc-chase-lite-v0` (ADR-0084) landed a complete, tested, deterministic chase
movement override — but its only activation path is the internal
`SetRoomOptions.chaseOptInNpcIds` seam, which is **never wired through `App`/
`RoomViewer`** by design. That means nobody can see chase happen in real gameplay
(`npm run dev`) without a one-off test harness; the feature is verified only at the
unit/integration-test level.

We want a **narrow, safe, explicitly gated exception** to that "never wired" rule: a
demo/dev-only path that lets a maintainer flip one env var and see one or two
authored, allowlisted NPCs chase in the actual running app — while keeping every hard
boundary from ADR-0084 intact and keeping the feature **off by default** so normal
players, CI, and any built/deployed bundle see no behavior change.

This is explicitly **not**:
- A real hostility system.
- A step toward relationship-, prompt-, or generated-content-driven hostility.
- A change to what chase does once active (movement model, leash, standoff, contact
  behavior are all unchanged from ADR-0084).
- A player-facing feature or toggle.

## 3. Current architecture/code recap

Everything below the seam already exists and is unchanged by this feature (verified by
inspection during design):

- **Pure pursuit reducer** — `renderer/engine/npc/chaseStep.ts`
  (`CONTACT_STANDOFF = 0.8`), reusing the deterministic wander kernel
  (`isWanderPositionAllowed`, `isWanderSegmentAllowed`, `NPC_WANDER.MAX_SPEED`,
  `MAX_RADIUS_FROM_HOME = 2.5`). No randomness; illegal candidate → hold.
- **`WanderMotor` chase capability** — an entry gains `chaseEligible` at registration;
  `update()` takes an optional chase context (`playerPosition`, `isChaseActive`) and
  branches to `chaseStep` only when both the entry is eligible and the context reports
  active; otherwise the entry runs its identical existing wander/patrol path.
- **`Engine` seam** — `SetRoomOptions.chaseOptInNpcIds?: ReadonlySet<string>` (mirrors
  the ADR-0080 `patrolOptInNpcIds` precedent). `registerWanderNpcs` marks
  `chaseEligible = chaseOptInNpcIds?.has(objectId) === true`. `updateNpcWander`
  (already, unconditionally) passes `playerPosition` from `this.player.position` and
  `isChaseActive = (id) => tier === 'aware' || tier === 'alerted'` reading
  `NpcAwarenessTracker.levelOf(id)` (the prior frame's tier — accepted, deterministic
  staleness per ADR-0084/ADR-0083). Eligibility is cleared with the rest of
  `wanderMotor` state on `setRoom`/`dispose`.
- **The one open gap:** `RoomViewer.tsx`'s single `engine.setRoom(result.room, options)`
  call currently only ever forwards `resolvedObjectIds` into `SetRoomOptions`. Nothing
  in `App.tsx` or `RoomViewer.tsx` ever supplies `chaseOptInNpcIds` — that prop simply
  does not exist yet on `RoomViewerProps`. This is the **only** unwired seam this
  feature closes, and only under a default-off gate with a closed id allowlist.
- **Existing analogous pattern to reuse:** `app/llmConfig.ts` — a pure,
  `import.meta.env`-reading, unit-testable config function with an explicit
  injected-env parameter and a safe default (`fake` provider / off). This feature's
  gate reader follows the identical shape (one pure function, injectable env, safe
  default).
- **Existing authored NPC ids available as allowlist candidates** —
  `domain/examples/throneRoom.ts` defines authored NPCs with stable ids
  (`herald-asha`, `steward-malik`) already present in the default bootstrap room.

**Conclusion:** no new runtime behavior is required anywhere in `chaseStep.ts`,
`WanderMotor.ts`, or `Engine.ts`. This feature is entirely: one pure selector, one
threaded prop, one computed value in `App`.

## 4. Proposed v0 scope

- **Slice 1 — Pure demo opt-in selector + tests** (`app/demoChaseOptIn.ts`):
  - A frozen, closed, id-only allowlist constant.
  - A pure env-gate reader (`VITE_AIGM_DEMO_CHASE`, default off, injectable env param,
    mirrors `llmConfig.ts`).
  - A pure selector: `{ enabled, presentNpcIds, allowlist? } → ReadonlySet<string>`,
    returning the intersection of the allowlist and the room's present NPC ids when
    enabled, and the empty set when disabled. No I/O, no logging, no content reads.
- **Slice 2 — App/RoomViewer/Engine wiring + tests:**
  - `RoomViewer.tsx` gains an optional `chaseOptInNpcIds?: ReadonlySet<string>` prop,
    merged into the existing `SetRoomOptions` object passed to `engine.setRoom(...)`
    (alongside the existing `resolvedObjectIds` merge), and added to the effect's
    dependency array.
  - `App.tsx` computes the demo set once (memoized off the gate value and the active
    room's NPC ids) using the Slice 1 selector, and passes it to `RoomViewer` only when
    non-empty (mirroring the existing conditional-spread pattern already used for
    `resolvedObjectIds`).
  - **`Engine.ts` itself requires no code change** — the seam it already exposes
    (`SetRoomOptions.chaseOptInNpcIds`) is sufficient. Only its existing doc comment
    is updated in Slice 5 (docs closeout) to describe the new, narrow, gated caller.
- **Slice 3 — Optional debug indicator, only if needed:** deferred by default; add only
  if manual smoke testing shows the demo path is hard to visually confirm without one.
  If added, it must be a presentation-only, read-only, non-authoritative indicator
  (e.g., a safe enum/boolean overlay) with no new logging of content, no `WorldState`
  read/write, and no new UI-projection authority — subject to a separate go/no-go at
  Slice 2 closeout.
- **Slice 4 — Safety/eval tests:** a dedicated regression pass proving (a) the gate
  defaults off and the app is behaviorally identical to pre-feature when off, (b) the
  allowlist cannot be exceeded by any input, (c) no new log line contains
  prompt/provider/dialogue/room/NPC-name/content text, (d) the existing
  `chaseStep`/`WanderMotor`/`Engine` safety-test suites are unmodified and still green.
- **Slice 5 — Docs closeout:** flip this plan and ADR-0086 to Implemented; update the
  `SetRoomOptions.chaseOptInNpcIds` doc comment in `Engine.ts` to describe the gated
  demo caller; move the ARCHITECTURE.md status line from planned to implemented.

## 5. Explicit non-goals

- No new chase behavior, model, radius, standoff, or leash change — ADR-0084's model
  is reused byte-for-byte.
- No relationship-driven hostility (no read of `NpcRelationshipState` or familiarity
  buckets to decide eligibility).
- No prompt-derived or generated-room-intent-driven hostility (no read of prompt text,
  provider output, generated room text, story anchors, or theme signals).
- No dialogue-derived hostility (no read of dialogue turns/history/text).
- No contact consequences of any kind (combat, damage, HP, injury, item loss, capture,
  death, encounter, quest effect) — contact stays inert exactly as ADR-0084 defined.
- No persistence, schema, save-game, or `RoomSpec` change; no `schemaVersion` bump.
- No `WorldState`, `WorldEvent`, or `WorldCommand` read/write.
- No memory, fact, or `fact_visibility` read or write.
- No LLM/provider/prompt behavior change; the demo gate reads only its own env var.
- No raw prompt/provider/dialogue/room-text logging; any new log stays enum/boolean/
  count-only.
- No player-facing UI/toggle; no real-room auto-enable; no expansion of the allowlist
  beyond a small, explicit, hand-authored constant.
- No change to `chaseStep.ts`, `WanderMotor.ts`, or `Engine.ts` runtime logic.

## 6. Demo opt-in model

New (composition-layer only, `app/demoChaseOptIn.ts`):

```
DEMO_CHASE_NPC_IDS: ReadonlySet<string>   // frozen, closed, hand-authored, e.g. {'herald-asha'}

readDemoChaseEnabled(env = import.meta.env) -> boolean
  // true only when VITE_AIGM_DEMO_CHASE, trimmed+lowercased, ∈ {'1','true'}
  // default false; no I/O beyond reading the passed-in env object

selectDemoChaseOptInNpcIds({ enabled, presentNpcIds, allowlist = DEMO_CHASE_NPC_IDS })
  -> ReadonlySet<string>
  // enabled === false  -> empty set
  // enabled === true   -> allowlist ∩ presentNpcIds
  // reads ids only; never name/text/relationship/dialogue/provider/room content
```

Nothing below this helper changes. The returned set flows, unmodified, into the
existing `SetRoomOptions.chaseOptInNpcIds` seam, which already enforces (unchanged)
same-room-only registration, awareness gating, home leash, no-teleport stepping, and
inert contact.

## 7. Activation rules (unchanged from ADR-0084, restated for completeness)

The demo path changes **only** which ids reach `chaseOptInNpcIds`. Once an id is
present in that set:

1. `Engine.registerWanderNpcs` marks the matching NPC's `WanderMotor` entry
   `chaseEligible: true` if and only if that NPC is present in the currently loaded
   room (id match against `objectId`).
2. Each frame, `Engine.updateNpcWander` passes `playerPosition` and
   `isChaseActive(npcId)` (tier `aware`/`alerted`, prior-frame read) unconditionally,
   exactly as today.
3. `WanderMotor.update` runs `chaseStep` only for eligible + active entries; all other
   entries take the identical existing wander/patrol path.
4. `nearby`/`unaware` deactivates chase and resumes wander/patrol from the current
   legal position (existing resume-compatible behavior).

No step in this list is modified by this feature.

## 8. Authority/ephemeral model

- The demo selector produces a plain, ephemeral `ReadonlySet<string>` recomputed on
  each relevant `App` render (memoized) — it is not stored, persisted, or exposed to
  save/load.
- It has no authoritative surface of its own: no `WorldState`, `WorldEvent`,
  `WorldCommand`, event log, SQLite, memory, fact, `fact_visibility`, save-game, or
  `RoomSpec`; no `schemaVersion` bump.
- **Fail safe:** if the env var is malformed/unset, the gate reads `false` and the
  selector returns the empty set — identical to the feature being absent. If a
  configured allowlist id is not present in the current room, it is silently excluded
  by the intersection (no error, no fallback content).

## 9. Runtime/composition integration seams

- **`app/demoChaseOptIn.ts`** — new pure module; imports nothing from React, Three.js,
  `world-session`, `memory`, `dialogue`, `generation`, or `persistence`. Reads only an
  injectable env object (default `import.meta.env`), mirroring `llmConfig.ts`.
- **`RoomViewer.tsx`** — new optional prop `chaseOptInNpcIds?: ReadonlySet<string>` on
  `RoomViewerProps`; merged into the single existing `SetRoomOptions` object built
  before `engine.setRoom(...)`; added to the room-load effect's dependency array
  (mirrors the existing `resolvedObjectIds` handling exactly).
- **`App.tsx`** — computes the demo set from `readDemoChaseEnabled()` (called once) and
  the active room's present NPC ids (derived from the already-loaded, validated
  `activePlay.room.objects`, filtered to `type === 'npc'`), memoized, and passed to
  `RoomViewer` only when non-empty.
- **`Engine.ts`** — no code change in Slices 1–4; only its existing
  `SetRoomOptions.chaseOptInNpcIds` doc comment is updated in Slice 5 to note the new,
  narrow, gated demo caller (the comment currently says the seam is "never wired
  through RoomViewer/App composition," which needs a precise amendment — see §12).

No new engine lifecycle, no new React seam beyond one optional prop, no persistence,
no per-frame logging.

## 10. Logging/debug safety

- **No per-frame logging** (parity with the existing movement stack).
- If Slice 3's optional debug indicator is added, or if any new log line is added
  anywhere in this feature, it must use the logger abstraction with **safe values
  only** (e.g., `demoChaseEnabled: boolean`, `demoChaseOptInCount: number`). **Never**
  log NPC ids as free text if they could be considered content-bearing beyond a
  count, never log coordinates, distances-as-narrative, room/object/NPC names,
  dialogue, prompts, provider bodies, memory text, or PII. **Never** frame
  chase/contact as a combat/damage event.
- The env var itself (`VITE_AIGM_DEMO_CHASE`) is a boolean-shaped flag, not a secret;
  it may be logged as a boolean if ever logged at all.

## 11. Test/verification plan

**`app/demoChaseOptIn.test.ts` (Slice 1):**

- `readDemoChaseEnabled` defaults to `false` on empty/undefined env.
- `readDemoChaseEnabled` returns `true` only for recognized truthy values
  (`'1'`, `'true'`, case/whitespace-insensitive); anything else (including `'yes'`,
  `'TRUE '` edge cases as appropriate) is decided deterministically and tested.
- `selectDemoChaseOptInNpcIds` returns the empty set when `enabled: false`, regardless
  of `presentNpcIds`.
- `selectDemoChaseOptInNpcIds` returns exactly the intersection of `allowlist` and
  `presentNpcIds` when `enabled: true`.
- `selectDemoChaseOptInNpcIds` never returns an id outside the supplied/default
  allowlist (fuzz-style assertion over a few `presentNpcIds` variations).
- `DEMO_CHASE_NPC_IDS` is a small, non-empty, frozen constant (structural test, not a
  content test).
- The module performs no I/O and imports nothing outside the allowed composition-layer
  set (documented assertion / import-boundary note, not necessarily a runtime test).

**`RoomViewer` (targeted, extend existing test file, Slice 2):**

- When `chaseOptInNpcIds` prop is supplied non-empty, the mock `engine.setRoom` is
  called with that value present in its options.
- When the prop is absent/empty, `engine.setRoom` options omit `chaseOptInNpcIds`
  (parity with current `resolvedObjectIds` behavior).

**`App` (targeted, Slice 2):**

- With the gate off (default), the computed set passed toward `RoomViewer` is empty
  for the bootstrap/authored room.
- With the gate simulated on (via injected env in a test-only seam) and the authored
  throne room active, the computed set equals the allowlist ∩ present ids (i.e.
  `{'herald-asha'}` given the current authored room and allowlist).

**Safety/eval regression (Slice 4):**

- Full existing `chaseStep.test.ts`, `WanderMotor.test.ts`, `Engine.test.ts` suites
  pass **unmodified**.
- A dedicated "gate off ⇒ no behavior change" test at the App/RoomViewer level.
- A dedicated "allowlist cannot be exceeded" test (selector never returns an id not in
  the allowlist, for arbitrary `presentNpcIds`).
- A dedicated log-safety scan (reuse the project's existing log-content-safety test
  pattern, if any, or a targeted assertion) confirming no new log call in this
  feature's files contains free-text content.

**Verification commands (targeted first, from `apps/web`):**

```bash
# Slice 1
npx vitest run src/app/demoChaseOptIn.test.ts

# Slice 2
npx vitest run src/renderer/RoomViewer.test.tsx
npx vitest run src/App.test.tsx   # exact filename to be confirmed at Slice 2 start

# Regression (unchanged, must stay green)
npx vitest run src/renderer/engine/npc/chaseStep.test.ts
npx vitest run src/renderer/engine/npc/WanderMotor.test.ts
npx vitest run src/renderer/engine/Engine.test.ts
npx vitest run src/renderer/engine/npc/awarenessTracker.test.ts

# Type/lint per changed file
npx tsc --noEmit -p tsconfig.json
npx eslint <the changed/added files>
```

Before closeout at Slice 4/5:

```bash
npm run lint
npm run build
npm run test        # full suite; must remain green (baseline 3576/3576)
```

## 12. Implementation slices

1. **Slice 1 — Pure demo opt-in selector + tests. DONE.** `app/demoChaseOptIn.ts`
   (`DEMO_CHASE_NPC_IDS`, `readDemoChaseEnabled`, `selectDemoChaseOptInNpcIds`) and
   `app/demoChaseOptIn.test.ts`. No `App`/`RoomViewer`/`Engine` change.
2. **Slice 2 — App/RoomViewer wiring using the existing `chaseOptInNpcIds` seam +
   tests. DONE.** `RoomViewer.tsx` optional prop + `setRoom` options merge; `App.tsx`
   computes and conditionally passes the set. Extended `RoomViewer`/`App` tests. No
   `Engine.ts` code change (the seam already existed).
3. **Slice 3 — Optional debug indicator, only if needed. SKIPPED.** At Slice 2
   closeout, manual smoke testing showed the demo path was easy to visually confirm
   (the allowlisted NPC's wander-vs-chase transition is directly observable) without a
   dedicated indicator, so the optional slice was not built. No new UI/presentation
   surface was added for this feature.
4. **Slice 4 — Safety/eval tests. DONE.** Dedicated regression pass: gate-off parity,
   allowlist-cannot-exceed, log-safety scan (`src/redteam/demoChase.redteam.test.ts`),
   and a confirmation run of the unmodified `chaseStep`/`WanderMotor`/`Engine`/
   `awarenessTracker` suites.
5. **Slice 5 — Docs closeout only. DONE (this update).** Flipped this plan and
   ADR-0086 to Implemented; moved the ARCHITECTURE.md status line from planned to
   implemented. No behavior code in this slice — see §18 for a note on the
   `Engine.ts` doc-comment amendment originally scoped here.

Each slice was independently reviewable and kept the full suite green.

## 13. Safety invariants (must hold at every slice)

- Default off: `VITE_AIGM_DEMO_CHASE` unset/false ⇒ byte-identical behavior to before
  this feature existed.
- Closed allowlist only; id-only selection; no content-derived eligibility of any kind
  (not prompt, not provider output, not room text, not NPC name, not relationship
  state, not dialogue, not generated text).
- Movement/intent only — reuses ADR-0084's chase model verbatim; contact stays inert.
- Same-room only; awareness-gated (`aware`/`alerted` only); stops on
  `nearby`/`unaware`; no teleport; home-leashed to the existing
  `MAX_RADIUS_FROM_HOME = 2.5`.
- No `WorldState`/`WorldEvent`/`WorldCommand`/`applyEvent`.
- No persistence/schema/save-game/`RoomSpec` mutation; no `schemaVersion` bump.
- No memory/fact/`fact_visibility` read or write.
- No LLM/provider/prompt behavior change.
- No raw prompt/provider/dialogue/room-text logging; any new log stays enum/boolean/
  count-only.
- Existing `chaseStep`/`WanderMotor`/`Engine`/`awarenessTracker` safety tests remain
  green and unmodified.
- Full suite stays green at every slice.

## 14. Known limitations (inherited, unchanged from ADR-0084)

- Chase is short-range/"lite" (home-leash reuse); a player just outside ~2.5 m of the
  NPC's home is not reachable.
- Distance-only awareness (no walls/occluders/facing).
- One-frame awareness staleness (deterministic, harmless).
- No real hostility source exists or is added; the allowlist remains a hand-authored,
  demo-only constant, not a gameplay design surface.

## 15. Manual smoke plan (for Slice 2/3 closeout, not automatable)

Run `npm run dev` from `apps/web` with a local `.env.local` setting
`VITE_AIGM_DEMO_CHASE=1` (gitignored, dev-only — never committed, never present in a
deployed/built bundle per the same BYOK caveat as `llmConfig.ts`). Verify by eye,
recording only safe observations (tier transitions, behavior seen — never coordinates,
room/NPC names, or narrative text):

1. **Gate off (no `.env.local` flag):** the allowlisted NPC wanders/patrols exactly as
   before; no chase is observed under any player approach.
2. **Gate on, approach triggers chase:** walking the player toward the allowlisted NPC
   causes it to turn from wander/patrol to moving toward the player once in range.
3. **No teleport; standoff; inert contact:** identical to the ADR-0084 manual smoke
   plan — continuous motion, ~0.8 m standoff, no HUD/health/inventory/quest/encounter/
   dialogue change on contact.
4. **Leash and awareness-drop resume:** identical to ADR-0084 — leash holds at the
   edge; walking away resumes wander/patrol without a stall.
5. **Non-allowlisted/non-present NPCs unchanged:** any NPC not in the allowlist, or an
   allowlisted id not present in the current room, never chases.
6. **Room swap:** navigating away and back shows no stale chaser; a room without a
   matching allowlisted NPC has no chasers regardless of the gate.

## 16. Risk analysis

| Risk | Mitigation |
| --- | --- |
| Feature accidentally active in a shipped/deployed build | Default-off env var, `VITE_*` BYOK/dev-only caveat identical to `llmConfig.ts`; documented as never-commit-`.env.local` (§15). Even if active, chase remains fully inert on contact per ADR-0084. |
| Allowlist scope creep into a real hostility system | Allowlist is a small, frozen, hand-authored constant with no derivation path; any expansion requires its own maintainer-approved change, not a config edit alone. |
| Eligibility drifting to read content (name/prompt/relationship/dialogue) | Selector signature only accepts id sets; enforced by the Slice 1 test suite and this plan's explicit non-goals (§5). |
| Boundary drift vs. ADR-0084's "never wired through App/RoomViewer" | ADR-0086 records this as the sole, controlled, default-off, id-only, closed-allowlist exception; ADR-0084 gets a short amendment note (§ below) rather than a silent contradiction. |
| Contact-consequence creep introduced "while we're in there" | Explicitly out of scope (§5); no file in `chaseStep.ts`/`WanderMotor.ts`/`Engine.ts` runtime logic changes in Slices 1–4. |
| Regression in existing chase/awareness safety tests | Slice 4 dedicated regression pass; existing test files are not modified, only run. |

## 17. Open questions

None. Slice 3 (debug indicator) was resolved at Slice 2 closeout — skipped, see §12.

## 18. Slice 5 closeout — verification results

All commands run from `apps/web` against the state at commit `f2ac1775` (tip of the
work described by this plan, still on `main`):

- `npx vitest run src/app/demoChaseOptIn.test.ts` — 1 file, 14 tests passed.
- `npx vitest run src/App.test.tsx` — 1 file, 177 tests passed.
- `npx vitest run src/renderer/RoomViewer.test.ts` — 1 file, 33 tests passed.
- `npx vitest run src/renderer/engine/npc/chaseStep.test.ts src/renderer/engine/npc/WanderMotor.test.ts src/renderer/engine/Engine.test.ts src/renderer/engine/npc/awarenessTracker.test.ts` —
  4 files, 90 tests passed, unmodified.
- `npx vitest run src/redteam/demoChase.redteam.test.ts` — 1 file, 8 tests passed
  (gate-off parity, allowlist-cannot-exceed, log-safety boundaries).
- `npm run lint` — clean, no errors/warnings.
- `npm run build` — succeeded (`tsc -b && vite build`).
- `npm run test` (full suite) — 210 files, 3607 tests passed.

**Deferred item:** §9/§12 of this plan originally scoped a Slice 5 update to the
`SetRoomOptions.chaseOptInNpcIds` doc comment in `Engine.ts` (production code) to
describe the new gated demo caller. The Slice 5 closeout instructions given to the
implementing agent restricted this pass to docs files only, so that comment update was
**not** made. `Engine.ts`'s doc comment still reads "never wired through
RoomViewer/App composition," which is now imprecise in light of ADR-0086's narrow
exception (ADR-0086 and this plan are the source of truth in the meantime). This is a
docs-only follow-up, not a behavior change, and is left for explicit maintainer
approval before touching production code.
