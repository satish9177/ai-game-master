# ADR-0086: Hostile NPC chase demo opt-in is a default-off, closed-allowlist, id-only visibility path — no new chase behavior, no new gameplay authority

- **Status:** Accepted - Implemented
- **Date:** 2026-07-08
- **Deciders:** Project owner
- **Builds on:** the deterministic, home-leashed, same-room chase movement override
  and its internal, unwired `chaseOptInNpcIds` seam
  (`apps/web/src/renderer/engine/npc/chaseStep.ts`,
  `apps/web/src/renderer/engine/npc/WanderMotor.ts`,
  `apps/web/src/renderer/engine/Engine.ts`) from
  [`hostile-npc-chase-lite-v0`](../implementation-plans/hostile-npc-chase-lite-v0.md)
  ([ADR-0084](./ADR-0084-hostile-npc-chase-lite-v0.md)), and the advisory same-room
  proximity signal from
  [`npc-player-awareness-v0`](../implementation-plans/npc-player-awareness-v0.md)
  ([ADR-0083](./ADR-0083-npc-player-awareness-v0.md)).

> Full plan — selector API, gate design, App/RoomViewer wiring, test plan, manual
> smoke plan, and slices — lives in
> [`hostile-npc-chase-demo-opt-in-v0`](../implementation-plans/hostile-npc-chase-demo-opt-in-v0.md).
> This ADR records the decision and boundaries only.

---

## Context

ADR-0084 shipped a complete, deterministic, tested chase movement override, but
deliberately gave it **only** an internal test/fixture seam
(`SetRoomOptions.chaseOptInNpcIds`), explicitly **never** wired through `App` or
`RoomViewer`. That was the correct choice at the time: it let chase land, be proven
correct by unit/integration tests, and ship with zero real-gameplay risk.

The consequence is that nobody can currently *see* chase happen by running the app —
verification lives entirely in the test suite. We want a way to visibly exercise the
feature in real gameplay (`npm run dev`) for manual QA/demo purposes, without
reopening any of the authority questions ADR-0084 closed.

Several facts shape a safe design:

1. **The chase model itself is not in question.** `chaseStep`, `WanderMotor`'s chase
   branch, and `Engine`'s awareness-gated `isChaseActive` wiring are already
   implemented, tested, and unchanged by this feature. This ADR is about **which ids
   reach the existing seam**, not about chase behavior.
2. **"Never wired through App/RoomViewer" was a blanket statement, not an absolute
   one.** ADR-0084 wrote that clause to rule out *real, content-driven, always-on*
   wiring. A narrow, default-off, closed-allowlist, id-only exception for demo/dev
   visibility does not violate the *intent* of that clause (no real room ever
   auto-enables chase; no player-visible behavior change in a normal/deployed build) —
   but it does contradict its *literal wording*, so that wording needs an explicit,
   documented amendment rather than silent drift.
3. **A safe precedent already exists.** `app/llmConfig.ts` (ADR-0023) is a pure,
   `import.meta.env`-reading, unit-testable, default-off gate for an even
   higher-risk capability (a real network-backed LLM call with a BYOK secret). The
   same shape — pure function, injectable env, safe default, dev-only/BYOK caveat —
   is sufficient here, where the gated capability is strictly less risky (an inert,
   local, non-networked movement change).
4. **Eligibility must stay id-only to avoid becoming a hostility design surface.** If
   the selector read NPC name, room text, relationship state, or dialogue, this
   feature would quietly become the "real hostility source" ADR-0084 explicitly
   deferred. Restricting it to a frozen, hand-authored allowlist of ids, intersected
   with the current room's present ids, keeps it a pure visibility toggle with no
   content-derivation path.

A naive version of this feature would (a) read room/prompt/relationship/dialogue
content to decide eligibility, (b) default the gate on or omit a gate entirely, (c)
let the allowlist grow implicitly (e.g., "all NPCs" or a config-free heuristic), or
(d) change chase behavior "while we're in there." Each is rejected below.

---

## Decision

Adopt a **default-off, closed-allowlist, id-only demo/dev visibility path** that
threads an ephemeral `ReadonlySet<string>` into the existing, unchanged
`SetRoomOptions.chaseOptInNpcIds` seam. No chase behavior changes.

- **Default off via env gate.** A new `VITE_AIGM_DEMO_CHASE` env var (read by one pure
  function mirroring `llmConfig.ts`'s pattern) defaults to `false`. When false, the
  computed opt-in set is always empty and gameplay is byte-identical to before this
  feature existed.

- **Closed, hand-authored allowlist.** A frozen `DEMO_CHASE_NPC_IDS` constant lists a
  small number of specific, existing authored NPC ids (e.g. `herald-asha`). It is not
  derived, discovered, or expanded at runtime, and is not configurable via env.

- **Id-only selection, intersected with the current room.** The selector takes the
  gate value and the active room's present NPC ids and returns
  `allowlist ∩ presentNpcIds` when enabled, `∅` when disabled. It reads no name, text,
  relationship, dialogue, prompt, or provider signal — ids only.

- **No new chase behavior.** The selector's output flows unmodified into the existing
  `chaseOptInNpcIds` seam. Every ADR-0084 invariant — same-room-only registration,
  awareness-gated activation (`aware`/`alerted` only), deterministic non-teleporting
  pursuit, home-leash to `MAX_RADIUS_FROM_HOME = 2.5`, `CONTACT_STANDOFF = 0.8`,
  inert contact, existing pause gates — is reused verbatim. `chaseStep.ts`,
  `WanderMotor.ts`, and `Engine.ts` runtime logic are not modified by this feature.

- **Composition-layer wiring only.** `RoomViewer.tsx` gains one optional prop
  (`chaseOptInNpcIds?: ReadonlySet<string>`) merged into the single existing
  `SetRoomOptions` object already built for `resolvedObjectIds`. `App.tsx` computes
  the demo set and passes it only when non-empty. This is the **only** literal
  wiring-through-`App`/`RoomViewer` this ADR authorizes, and only in this narrow,
  gated shape.

- **Dev-only / BYOK-style caveat.** Like `VITE_AIGM_LLM_*`, Vite inlines `VITE_*`
  values into the built bundle. `VITE_AIGM_DEMO_CHASE=1` must live only in a
  gitignored `.env.local`, used with `npm run dev`; a bundle built and deployed with
  the flag on would make the demo NPC(s) chase for real players. This is documented
  as a hard operational rule, not enforced by code in v0 (matching the existing
  `llmConfig.ts` precedent, where the same caveat is likewise documentation-only).

- **Hard boundaries preserved (all inherited from ADR-0084, none loosened):** no
  combat / damage / HP / injury / item loss / capture / death / encounter / quest
  effect; no `WorldState` mutation; no `WorldEvent` / `WorldCommand`; no memory / fact
  / `fact_visibility` read or write; no persistence / schema / save-game / `RoomSpec`
  change and no `schemaVersion` bump; no LLM / provider / prompt change; no
  relationship-driven, prompt-derived, or generated-room-intent-driven hostility; no
  raw prompt/provider/dialogue/room-text logging; no cross-room chase.

---

## Amendment to ADR-0084

ADR-0084 states: *"[eligibility] is not RoomSpec/schema/save-game data and is never
wired through App/RoomViewer composition."* That statement **remains true in spirit
and in the general case**: no real room, no content signal, and no default
configuration ever auto-enables chase. ADR-0086 introduces the **sole, narrow,
documented exception** — a default-off, closed-allowlist, id-only demo/dev path,
introduced and bounded by this ADR. `SetRoomOptions.chaseOptInNpcIds`'s doc comment in
`Engine.ts` was scoped (Slice 5 of the companion plan) to be updated to name this ADR
as the one authorized caller shape, rather than silently contradicting the original
comment. **That specific comment edit was deferred** — the Slice 5 closeout pass was
restricted to docs files and did not touch `Engine.ts` (production code). This ADR and
the companion plan are the authoritative record in the meantime; the stale wording in
`Engine.ts` is a known, tracked follow-up (see the companion plan's §18), not a silent
contradiction.

---

## Consequences

- **Chase becomes visible in real gameplay, for the first time, under an explicit
  opt-in gate.** A maintainer can set one env var locally and manually verify the
  ADR-0084 behavior end-to-end in the running app.
- **No behavior change for any normal player, CI run, or default/deployed build.**
  The gate defaults off; with it off, `App`/`RoomViewer`/`Engine` behave identically
  to immediately before this feature existed.
- **No new authority surface.** This feature adds one pure selector and one threaded
  prop. It has no path to `WorldState`, persistence, memory, or provider systems.
- **The "never wired" rule gets a precise, bounded exception instead of silent
  drift.** Future readers of ADR-0084 see exactly what changed and why, rather than
  discovering a contradiction.

### Known limitations

- **Still not a real hostility source.** The allowlist is a hand-authored demo
  constant, not a content/authoring system; a real hostility source remains deferred
  to its own future, maintainer-approved feature (per ADR-0084 §Deferred).
- **Dev-only enforcement is documentation, not code**, matching the existing
  `llmConfig.ts` precedent — a maintainer could still misuse the flag in a built
  bundle. The risk is bounded because the gated behavior is inert on contact.
- **All ADR-0084 known limitations still apply unchanged** (short-range/"lite" leash,
  distance-only awareness, one-frame staleness).

### Deferred (each its own maintainer-approved feature/ADR)

- A real hostility source / trusted metadata replacing both the internal seam and this
  demo allowlist.
- Any relationship-, prompt-, dialogue-, or generated-content-driven hostility signal.
- A player-facing toggle or UI surface for chase.
- Contact consequences of any kind.
- A runtime/configurable (vs. hand-authored-constant) allowlist.

---

## Alternatives considered

- **Wire `chaseOptInNpcIds` directly from room content (e.g., all NPCs, or NPCs
  matching a name/type heuristic).** Rejected: this would be exactly the
  content-derived "real hostility source" ADR-0084 deferred, introduced through a
  side door under a "demo" label.
- **Default the gate on, or omit a gate and always pass the allowlist.** Rejected:
  would make chase visible to every developer/tester/CI run by default, violating
  "default off" and risking accidental shipped-build activation.
- **Make the allowlist itself configurable via env (a list of ids in an env var).**
  Rejected as unnecessary surface for v0: a hand-authored constant is simpler, fully
  closed, and sufficient for demo/manual-QA purposes; a configurable list is a small
  future extension if ever needed, not required now.
- **Add a real in-app dev-only UI toggle instead of an env var.** Rejected for v0:
  more UI/composition surface than needed; the env-var pattern already has a proven,
  reviewed precedent (`llmConfig.ts`) and satisfies "visible in gameplay via
  `npm run dev`."
- **Silently leave ADR-0084's "never wired" clause as-is and treat this as an
  unrelated addition.** Rejected: the literal wording would then be false; an explicit
  amendment note keeps the decision record honest and greppable.
- **Fold this into ADR-0084 as an update instead of a new ADR.** Rejected: ADR-0084 is
  Accepted/Implemented and describes a shipped, closed slice; this is materially new
  scope (a new composition-layer wiring decision) and warrants its own record, with
  ADR-0084 only lightly amended.

---

## Verification

Implemented files:

- `apps/web/src/app/demoChaseOptIn.ts` — pure allowlist constant (`DEMO_CHASE_NPC_IDS
  = {'herald-asha'}`), env gate reader (`readDemoChaseEnabled`), and id-intersection
  selector (`selectDemoChaseOptInNpcIds`).
- `apps/web/src/app/demoChaseOptIn.test.ts` — selector/gate unit coverage.
- `apps/web/src/renderer/RoomViewer.tsx` — optional `chaseOptInNpcIds` prop threaded
  into the existing `SetRoomOptions` merge, added to the room-load effect's
  dependency array.
- `apps/web/src/App.tsx` — computes the demo set from present, validated room NPC ids
  and passes it to `RoomViewer` only when non-empty.
- `apps/web/src/redteam/demoChase.redteam.test.ts` — dedicated safety/eval regression
  (gate-off parity, allowlist-cannot-exceed, log-safety boundaries).
- Targeted extensions to the existing `RoomViewer`/`App` test files.

Slice 3 (optional debug indicator) was evaluated and **skipped**: manual smoke
testing showed the wander-vs-chase transition was directly observable without one, so
no new presentation/UI surface was added.

Verification results (run from `apps/web`):

- `npx vitest run src/app/demoChaseOptIn.test.ts` — 14 tests passed.
- `npx vitest run src/App.test.tsx` — 177 tests passed.
- `npx vitest run src/renderer/RoomViewer.test.ts` — 33 tests passed.
- `npx vitest run src/renderer/engine/npc/chaseStep.test.ts src/renderer/engine/npc/WanderMotor.test.ts src/renderer/engine/Engine.test.ts src/renderer/engine/npc/awarenessTracker.test.ts` —
  90 tests passed, unmodified.
- `npx vitest run src/redteam/demoChase.redteam.test.ts` — 8 tests passed.
- `npm run lint` — clean.
- `npm run build` — succeeded.
- `npm run test` (full suite) — 210 files, 3607 tests passed.

Boundaries re-confirmed at closeout (all still hold):

- Default off; closed allowlist; id-only selection.
- Movement/intent only; no chase-behavior change; contact remains inert.
- Same-room only; awareness-gated; no teleport; home-leashed.
- No `App` composition change beyond one optional prop and one computed value; no
  `Engine.ts` runtime-logic change.
- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No persistence / schema / save-game / `RoomSpec` mutation; no `schemaVersion` bump.
- No memory / fact / `fact_visibility` read or write.
- No LLM / provider / prompt change.
- No raw prompt/provider/dialogue/room-text logging.
- Existing `chaseStep` / `WanderMotor` / `Engine` / `awarenessTracker` safety tests
  remain green and unmodified.
- Full suite remains green.
