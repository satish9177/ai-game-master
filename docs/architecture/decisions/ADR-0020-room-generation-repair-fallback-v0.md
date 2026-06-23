# ADR-0020: Room Generation Repair & Fallback v0 — deterministic assembly pipeline

- **Status:** Accepted — **implemented** (Room Generation Repair & Fallback v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

[Semantic Room Validator v0](./ADR-0011-semantic-room-validator-v0.md) shipped
**stage 2** of the [ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)
pipeline: a pure `validateRoom` answers *is this room playable?* after
`loadRoomSpec` answers *is it well-formed?*. But its only response to a bad room
was rejection — a fatal semantic issue (or malformed JSON, or a bad envelope)
folded into the `invalid-room` `RoomLoadResult`, and the host showed the safe
"could not be loaded" screen.

That leaves the two remaining deterministic stages of ADR-0007 unbuilt: a
**bounded repair** of a salvageable room, and a **safe fallback room** when no
acceptable room can be produced. ADR-0007 promised that "the renderer only ever
sees a validated, accepted spec" *and* that "the user is never stuck" — today the
user is stuck with an error screen whenever generated content is bad.

We now close that gap with the **deterministic** subset of those stages. The real
LLM, a corrective re-prompt, an LLM reviewer, and an attempt budget/loop stay
future (they need a real model that can produce bad-but-valid rooms and be
re-prompted). This is the deterministic core they will later wrap.

## Decision

Ship **Room Generation Repair & Fallback v0**: a pure, synchronous domain
`assembleRoom` pipeline that turns raw, untrusted generated text into a room the
renderer can always safely consume, plus an authored trusted fallback room and a
single deterministic repair pass. `GeneratedRoomSource` routes generated text
through it; `App` injects the fallback and shows a small static notice when a
room had to be repaired or replaced.

```
generator.generate(prompt) → raw untrusted JSON text
  → assembleRoom(rawText, fallbackRoom)            ✅ pure domain (NEW)
       1. JSON.parse        fail → fallback (failedStage 'json')
       2. loadRoomSpec      throw → fallback (failedStage 'schema')   [schema boundary]
       3. validateRoom      ok    → generated                        [semantic boundary]
       4. fatal → repairRoom (one pass) → validateRoom again
                            ok    → repaired
                            fatal → fallback (failedStage 'semantic')
       └─ returns { room, diagnostics }  — ALWAYS a valid, zero-fatal room
  → RoomLoadResult { ok:true, room, provenance }   (generated | repaired | fallback)
  → existing trusted Three.js renderer              (untouched)
```

### What v0 is

- **A pure domain pipeline** `assembleRoom(rawText: string, fallbackRoom:
  LoadedRoom): { room, diagnostics }` in `domain/assembleRoom.ts`. It composes the
  existing boundaries (`JSON.parse` → `loadRoomSpec` → `validateRoom` →
  `repairRoom` → re-`validateRoom`), is synchronous, does no I/O, imports no
  React/Three.js/renderer/logger/DB, and **never logs** — it returns problems as
  **data** like its peers ([ADR-0003](./ADR-0003-logging-abstraction.md)). It
  **always returns a valid `LoadedRoom` with zero fatal semantic issues**, so the
  renderer can never receive an invalid room.
- **An authored fallback room** `domain/examples/fallbackRoom.ts` — a trusted,
  data-only literal (the `throneRoom` authoring pattern): a small 8×8×4 m stone
  antechamber, spawn centered and in bounds, one declared exit, a handful of
  safe known-type objects. Neutral id/name, **no prompt text and no generated
  story text**. Authored to raise **zero fatal and zero warning** semantic issues,
  guarded by a test. The caller (the host) validates it once through
  `loadRoomSpec` and injects it; the pipeline treats it as the trusted last resort.
- **Deterministic repair only** `domain/repairRoom.ts` — a pure, non-mutating
  function (the code peer of `validateRoom`) that applies a few **safe, narrowing**
  fixes and only ever *removes or clamps*, never invents content. The v0 rules,
  each mapping to a repairable `validateRoom` fatal:
  - `spawn-out-of-bounds` → **clamp** spawn X/Z into the walkable AABB, using the
    **same** margin `validateRoom` uses (`wallThickness/2 + WALL_CLEARANCE`).
  - `object-budget-hard-exceeded` → **truncate** `objects` to `MAX_OBJECTS_HARD`.
  - `light-budget-hard-exceeded` → **drop** `torch` objects beyond
    `MAX_LIGHTS_HARD` (non-torch objects preserved, order preserved).
  - **No room-dimension resizing** — resizing would dislocate spawn/objects, so
    `room-too-small` / `room-too-large` stay unrepairable and route to the
    fallback. Reachability, collision, and quest consistency are not repaired.
- **One repair attempt, then re-validate.** Repair is a single pass — no loop, no
  attempt budget. The pipeline re-runs `validateRoom`; if a fatal issue survives,
  it falls back. (The bounded multi-attempt loop with a corrective re-prompt is an
  LLM concern and stays future per ADR-0007.)
- **Fallback on any unrecoverable failure** — malformed JSON, a bad envelope, or a
  fatal semantic issue that repair could not clear all return the injected
  fallback room.
- **`provenance` + a static notice.** `GeneratedRoomSource` returns
  `provenance: 'generated' | 'repaired' | 'fallback'` on the **ok** result;
  generated/repaired/fallback are **all `ok:true`** (a valid room every time).
  `App` shows a small **dismissable, static** notice — *"We couldn't build that
  room exactly, so here's a safe one. Try another prompt."* — for `repaired` or
  `fallback`, and nothing for `generated`. The copy is fixed and **prompt-free**:
  it never echoes the prompt, the raw output, or any diagnostic detail.
- **Generator throw/reject stays `unavailable`.** Only an *infrastructure* failure
  (today never; later a network/LLM error) is `ok:false` `unavailable` → the
  existing retry path. Bad *content* never becomes `unavailable`; it becomes a
  repaired or fallback room. This keeps "can't reach the generator" cleanly
  separate from "the generator produced something bad".
- **Safe diagnostics only.** `assembleRoom` returns, and `GeneratedRoomSource`
  logs (one line per call: `info` for `generated`, `warn` for `repaired`/
  `fallback`), only: `provenance`, `failedStage` (`json`|`schema`|`semantic`),
  `initialFatalCodes`/`residualFatalCodes` (the fixed `RoomIssueCode` enum),
  `repairAttempted`, object/skipped/warning **counts**, and booleans. It **never**
  includes raw JSON, prompt text, story text, object names, or free-form
  parse/schema error messages ([FAILURE-MODES](../FAILURE-MODES.md) cases 4 / 4b).
- **Tested with Vitest.** `repairRoom` (clamp, truncate, drop, determinism, no
  mutation, no-op equivalence); `fallbackRoom` (loads clean, zero fatal, zero
  warning, no story text); `assembleRoom` (one test per branch — generated,
  invalid JSON, invalid schema, repairable→repaired, unrepairable→fallback,
  repair-then-still-fatal→fallback — plus a matrix proving the returned room is
  always valid and a guard that diagnostics carry only safe codes/counts/booleans);
  `GeneratedRoomSource` (invalid JSON/schema → `ok:true` fallback, repairable →
  `ok:true` repaired, generator reject → `ok:false` unavailable, no leakage of
  prompt/raw JSON/story text/object names, fake happy path → generated); and the
  pure `shouldShowFallbackNotice` decision + exact static copy.

### What v0 is **not** (deliberately deferred)

- **No real LLM, corrective re-prompt, or LLM-driven repair** — repair is the
  deterministic clamp/truncate/drop subset only.
- **No bounded retry loop, attempt budget, or time cap** — a single repair pass,
  not the ADR-0007 max-3-attempts / ~60s policy (which is an LLM concern).
- **No LLM reviewer / creative-quality judgment** ("too empty / boring").
- **No new repair rules beyond the three above** — no dimension resizing,
  reachability, object↔object collision, or quest-item repair (collision/geometry
  would need the renderer's builders, which the domain must not import,
  [ADR-0008](./ADR-0008-renderer-portability-strategy.md)).
- **No adjacent-room pre-generation** ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md))
  and **no backend generation endpoint** — generation stays a browser-side,
  in-memory path; the Node API ([ADR-0019](./ADR-0019-backend-world-session-api-v0.md))
  is untouched.
- **No renderer/engine/builder change** and **no UI beyond the one static notice**
  (no dev warning overlay; warnings remain logged counts only).
- **No new `RoomSource` error code or schema change** — the port gains only an
  optional `provenance` on the **success** result; static/preloaded sources omit
  it and stay compatible.

### Invariants this preserves

- **The trust boundary is unchanged.** Repair and fallback run over already-loaded,
  already-validated data and only ever *narrow or replace* it; no raw or
  unvalidated data reaches the renderer, which still executes only trusted
  hand-written builders ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **Boundaries hold.** `assembleRoom`/`repairRoom`/`fallbackRoom` obey the same
  domain rules as `loadRoomSpec`/`validateRoom` (pure, return data, never log);
  orchestration, logging, and the fallback injection stay in the composition layer
  (`room/`, `app/`) ([BOUNDARIES](../BOUNDARIES.md)). No new dependency rule is
  needed.
- **Prompt safety holds.** Diagnostics and logs carry codes/counts/booleans only —
  never prompt text, raw JSON, story text, object names, or error messages
  ([FAILURE-MODES](../FAILURE-MODES.md) case 4).
- **The renderer never receives an invalid room.** `assembleRoom` is total over
  its inputs: every path returns a zero-fatal `LoadedRoom`.

## Consequences

- A generated room that is malformed, schema-invalid, or fatally unplayable no
  longer ends at an error screen: a salvageable room is **repaired** and kept; an
  unrecoverable one is replaced by the **trusted fallback room** with a calm,
  dismissable notice. The user is never stuck and never sees a broken room — the
  ADR-0007 "guaranteed safe outcome" is now real for the deterministic path.
- The deterministic fake stays green: its output is playable, so every
  `FakeRoomGenerator` room is `generated` (no repair, no fallback) and the
  user-visible happy path — including the notice staying hidden — is unchanged.
- The semantic gap of [FAILURE-MODES](../FAILURE-MODES.md) cases 4 / 4b is now
  closed for the deterministic pipeline (repair + fallback ✅), not just detection.
- `assembleRoom` is a **shared, tested domain contract**: when generation moves
  server-side, the future backend edge can reuse the same pipeline with no move,
  exactly as `validateRoom` was designed to be reused.
- When a real LLM lands, this becomes the inner deterministic core: the bounded
  re-prompt loop, the reviewer, and the attempt budget wrap `assembleRoom`; the
  fallback room and the renderer contract do not move.

## Alternatives considered

- **Keep rejecting bad rooms (no repair/fallback)** — rejected: it leaves the user
  stuck at an error screen for any bad content and never delivers the ADR-0007
  guarantee of a safe outcome; the deterministic repair/fallback is the
  highest-leverage, lowest-cost way to honor it now.
- **Put `assembleRoom`/`repairRoom`/`fallbackRoom` in `generation/` or `room/`** —
  rejected: they are pure, renderer-agnostic invariants that the future backend
  reuses, so they belong in the domain beside `loadRoomSpec`/`validateRoom`; the
  generation layer can't even import the logger, and `room/` is composition wiring
  ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md), [ADR-0011](./ADR-0011-semantic-room-validator-v0.md)).
- **Map bad content to `unavailable` (reuse the retry path)** — rejected: "can't
  reach the generator" and "the generator produced something bad" are different
  outcomes. The former is a genuine retry; the latter now yields a usable room, so
  conflating them would either hide a usable fallback or offer a pointless retry.
- **Repair room dimensions too (resize a too-small/large room)** — rejected:
  resizing dislocates the spawn and every object anchor, risking new fatals;
  replacing the whole room with the trusted fallback is simpler and provably safe.
- **A bounded multi-attempt repair loop now** — rejected as premature: with a
  deterministic generator and deterministic repair, a second identical pass changes
  nothing. The loop is meaningful only with a non-deterministic model and a
  corrective re-prompt, so it stays future with the real LLM
  ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)).
- **Surface diagnostics in the UI / a dynamic notice** — rejected: a static,
  prompt-free notice avoids any chance of leaking prompt or generated content to
  the user; a richer dev overlay remains future ([FAILURE-MODES](../FAILURE-MODES.md)
  cases 2 / 4b).
