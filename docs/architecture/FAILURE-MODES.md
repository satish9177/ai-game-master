# Failure Modes

> Every meaningful failure mapped to: **detection → handling → user-facing
> behavior → logging.** Companion to [ARCHITECTURE](./ARCHITECTURE.md).

Status legend: ✅ behavior exists today · 🔜 planned (designed, not built) ·
❌ future (not built).

## Error-handling philosophy

- **Validate at every trust boundary.** Dynamic/external data is checked the
  moment it enters a layer (the browser via `loadRoomSpec`; later the backend at
  its HTTP edge). See [BOUNDARIES](./BOUNDARIES.md).
- **Degrade, don't crash.** A single bad *object* must never take down a room. A
  bad *room* must never take down the app — it shows a safe failure screen.
- **Two error classes.** *Expected* failures (invalid input, a missing room, a
  network blip) are modeled as data/typed results and handled deliberately.
  *Unexpected* failures (bugs) bubble to an error boundary that fails safe.
- **Separate what's shown from what's logged.** Users see a calm, actionable
  message. Logs get the detail (stack, context). **Never leak stack traces,
  internal paths, prompts, or secrets to the end user.**

---

## 1. Malformed RoomSpec *envelope* (required fields invalid)

The shell, spawn, lighting, or top-level fields fail schema validation.

- **Detection** ✅ — `RoomSpecSchema.parse(raw)` in `loadRoomSpec` throws a
  `ZodError`. The envelope is validated **strictly**: a broken envelope is a
  hard error (there is no safe partial room to show).
- **Handling** — Today ✅ the throw propagates (data is hardcoded, so this can't
  occur in practice). 🔜 The composition root will `try/catch` the load and a
  React **error boundary** will catch anything unexpected.
- **User-facing** 🔜 — a safe "This room could not be loaded" screen, not a
  white page. No raw error text.
- **Logging** 🔜 — `logger.error('room envelope invalid', { issues })` with the
  zod issues as structured context.

## 2. Malformed or unknown RoomSpec *object*

One entry in `objects[]` has an unknown `type` or fails its schema.

- **Detection** ✅ — `loadRoomSpec` validates each object **independently**
  (`safeParse`). Failures are collected into `skipped[]` and `warnings[]` instead
  of throwing. A valid `type` that simply has no builder yet is also handled.
- **Handling** ✅ — the object renders as a **magenta placeholder box**
  (`buildPlaceholder`) so unsupported content is *visible*, never fatal. The rest
  of the room loads normally.
- **User-facing** ✅ — a clearly-wrong magenta box at the object's position;
  everything else works.
- **Logging** ✅ — the missing-builder case logs `logger.warn(…, { objectType,
  objectId })` and room load logs `logger.info('room received', …)` through the
  Logger adapter (no direct `console.*`). 🔜 surfacing `warnings[]` to the UI as
  structured data (e.g. a dev overlay) remains future.

## 3. WebGL unavailable or context lost

The browser can't create a WebGL context, or the GPU drops the context at runtime.

- **Detection** — ❌ **not handled today.** Constructing
  `new THREE.WebGLRenderer()` can throw if WebGL is unavailable, and a
  `webglcontextlost` event can fire later; neither is currently caught. 🔜 add a
  capability check before constructing the engine and a `webglcontextlost`
  listener.
- **Handling** 🔜 — on unavailable: skip engine construction, show a fallback.
  On context lost: stop the render loop and dispose cleanly (the engine's
  `dispose()` is already total).
- **User-facing** 🔜 — "3D rendering isn't available in this browser/device"
  with guidance, instead of a blank canvas or an uncaught error.
- **Logging** 🔜 — `logger.error('webgl unavailable' | 'webgl context lost', …)`.

## 4. Invalid generated JSON / RoomSpec ✅ v0 handling · 🔜 real LLM + repair

A generator returns malformed JSON, a schema-invalid spec, a partial spec, or
(from a future model) hostile content.

- **Detection** ✅ — implemented in `GeneratedRoomSource`: the generator's raw
  text flows through the **same** `loadRoomSpec` boundary. `JSON.parse` failure
  and a bad envelope both map to a typed `invalid-room` result (case 1); bad
  objects are skipped (case 2); a generator throw maps to `unavailable`. Hostile
  content is *still just data* — there is no code path to execution (see
  [ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md)). The deterministic
  fake can't actually emit bad output, but the failure mapping is real and
  **unit-tested**.
- **Handling** — ✅ v0 surfaces the typed failure to the host, which shows the safe
  room-load screen. 🔜 the bounded retry/repair loop and a fallback known-good room
  (with a real model) remain future
  ([ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md)).
- **User-facing** ✅ — a calm "This room could not be loaded." / "Could not
  generate a room. Please try again." screen; never raw model output or errors.
- **Logging** ✅ — the caller logs **prompt length** and safe result counts/codes
  only; **never** full prompts/keys/PII. 🔜 model/latency/token/attempt metadata
  arrives with the real client.

## 4b. Valid RoomSpec but a bad room ✅ v0 (code validator) · 🔜 reviewer + repair

The spec is valid JSON and passes the schema, yet the room is **unplayable or
poor**. **Valid JSON does not mean a room is playable or good.** This is the gap
the generation pipeline closes; full design in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md). A first
slice of the deterministic code validator now closes part of it
([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)).

- **Detection** — two checks *beyond* schema validation, kept distinct:
  - ✅ a **deterministic code validator** (**not** an LLM) for semantic
    playability — implemented in v0 as `validateRoom` (a pure domain function):
    sane dimensions, spawn inside the walkable bounds, anchors within the
    footprint and under the ceiling, object/light budgets, usable interactions
    (non-empty prompt, a dialogue body, a named NPC). 🔜 deeper reachability,
    object↔object collision, and quest-item consistency;
  - 🔜 an **optional LLM reviewer** for creative/story quality — coherent,
    on-prompt, interesting; it returns a verdict, it does not edit the spec.
- **Handling** — by the severity of the problem:

  | Class | Examples | Handling |
  | --- | --- | --- |
  | **Object-level** (room still playable) | one NPC clipping a wall, an overlapping prop, a light over the soft budget | ✅ log a `warning` (counts/codes), keep the room |
  | **Room-level** (not playable) | unwalkable size, spawn outside the room, object/light over the hard budget | ✅ v0 fatal → `invalid-room` (no render); 🔜 repair or regenerate within the attempt budget |
  | **Prompt mismatch / too empty/boring** | output doesn't match the prompt; room is dull | 🔜 reviewer rejects → repair/regenerate |
  | **Repeated failure** | still unacceptable after max attempts | 🔜 safe fallback room / retry |

- **v0 handling** ✅ — `GeneratedRoomSource` runs `validateRoom` right after
  `loadRoomSpec`: a **fatal** (room-level) issue folds into the existing
  `invalid-room` result so the room never renders; **warnings** (object-level) are
  logged as counts/codes and the room still loads. The room is never mutated and
  warnings are not surfaced in the UI yet.
- **Retry/repair policy (v1)** 🔜 — fast model first → one fast repair attempt →
  slow/better model fallback only if needed; **no infinite retries, max 3
  attempts**; target **10–30s** for the first room, **~60s** hard cap. After a
  hard failure: a **safe error with a retry button or a fallback demo room**.
- **User-facing** — ✅ on a fatal semantic issue, the same safe "This room could
  not be loaded." screen as case 4; warnings are not shown in the UI yet (a dev
  overlay stays future). 🔜 a brief wait, then the room, with repair behind the
  scenes; on hard failure, a retryable error or a fallback room — never a broken or
  unplayable room.
- **Logging** — ✅ v0 logs one safe line: `code: 'invalid-room'`, fatal/warning
  counts, and the distinct fatal issue **codes** (a fixed enum) — never issue
  message text, full prompts, raw generated JSON, keys, or PII; the success line
  carries `semanticWarningCount`. 🔜 per-attempt validator/reviewer outcomes,
  which class failed, attempt count, model, latency arrive with the real pipeline.

## 5. Backend / network failure ❌ (future)

The app can't reach the backend, or it returns 5xx / times out.

- **Detection** — HTTP status, timeouts, and aborts surfaced by the
  `RoomSource`/API client as typed results (not thrown strings).
- **Handling** — loading/error/retry states at the host; idempotent generation
  jobs so a retry can't double-charge or duplicate work; offline detection.
- **User-facing** — a retryable error state; never a frozen UI.
- **Logging** — request id / correlation id, status, latency; server logs the
  full error, the client logs a summary.

## 6. Persistence / database failure ❌ (future)

The DB is unavailable, a migration mismatch occurs, or a stored spec is an older
`schemaVersion`.

- **Detection** — repository adapters translate driver errors into typed domain
  errors at the persistence boundary; a startup migration check detects schema
  drift; reads check `schemaVersion`.
- **Handling** — degrade to read-only or a safe error if the store is down;
  refuse to start on migration mismatch (fail fast, server-side); migrate or
  tolerate old `schemaVersion` on read rather than mutating rows silently.
- **User-facing** — "temporarily unavailable", never a SQL error.
- **Logging** — server-side structured error with context; no secrets/PII.

## 7. Adjacent-room pre-generation not ready at a door ❌ (future)

The player reaches an exit before the next room finished pre-generating, or its
pre-generation failed. Design in
[ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

- **Detection** — each room carries an explicit status:
  `not_started → generating → validating → repairing → ready`, or `failed`. The
  transition handler reads the status of the room behind the door.
- **Handling** — by status: `ready` → instant transition; `generating` /
  `validating` / `repairing` → a short "Opening the way…" wait; `failed` → retry
  or fallback room (case 4/4b); `not_started` → generate on demand. Parallel
  pre-gen is capped (1–3 jobs) and limited to the nearby frontier, so a backtrack
  wastes little work.
- **User-facing** — at worst a short "Opening the way…" pause, never a freeze or
  a broken room.
- **Logging** — room id, status at the door, wait time, pre-gen hit/miss; reuse
  the generation logging from case 4/4b.

## 8. Isometric camera / player presentation ✅

The renderer's default view is a fixed orthographic isometric camera following a
player object ([ADR-0012](./decisions/ADR-0012-isometric-camera-foundation.md)).
A handful of invariants keep it robust; all are ✅ today.

- **Orthographic frustum must track viewport resize.** ✅ The `ResizeObserver`
  calls `CameraController.resize(aspect)`, which recomputes the orthographic
  frustum (`orthographicFrustum`) and `updateProjectionMatrix()`, so world units
  never stretch on a non-square or resized window.
- **Player and camera must initialize safely before *and* after room load.** ✅
  Both are constructed up front — the player marker is added to the scene and the
  camera frames it at the origin — so the first frame before any room is valid; on
  `setRoom` the player is placed at spawn and the camera snaps to it. No frame
  reads a null camera/player.
- **Interaction proximity must use the player, not the camera.** ✅ `updateProximity`
  and the E/F open-key read `player.position`. A regression here (reading the
  camera, which now sits tens of meters away at the isometric offset) would
  silently break every HUD prompt — so it is called out explicitly.
- **The player marker must dispose with the scene/engine.** ✅ The marker is part
  of the scene graph, so the engine's total `dispose()` (`disposeObject(scene)` +
  `scene.clear()`) frees its geometry/material like any other mesh — no separate
  teardown path and no leak under StrictMode's mount → dispose → mount.
- **Cutaway walls must prevent occlusion without destroying readability.** ✅ The
  camera-facing south/east walls drop to a 0.4 m curb (well below the ~1.4 m marker
  and ~1.76 m NPCs at the ~35° camera angle), while the far north/west walls stay
  full height to show the room's shape. Too tall a near wall hides the player; too
  much removed loses the footprint — the curb is the middle.
- **No camera/player data may leak into the domain or RoomSpec.** ✅ Camera mode
  and the marker are renderer-internal presentation; the schema has no
  camera/player fields and the model never directs the camera (see
  [BOUNDARIES](./BOUNDARIES.md)).

## 9. Concurrent world-session append ✅ (headless)

Two callers attempt to append from the same cached revision.

- **Detection** ✅ — `WorldStore.commit` compares `expectedRevision` with the
  current snapshot revision. A mismatch returns the typed `conflict` code; the
  event and snapshot are both left unchanged.
- **Handling** ✅ — the in-memory adapter commits append + projected snapshot as
  one atomic unit, both or neither. The caller may re-read and deliberately retry;
  no automatic replay exists in v0.
- **User-facing** — no UI is wired in this headless slice. A future host maps the
  typed conflict to retry/reload behavior rather than exposing internals.
- **Logging** ✅ — session id, expected revision, and `conflict` code only; never
  command payload, item names, reasons, or narrative content.

## 10. SaveGame integrity mismatch ✅ (headless)

The top-level seed differs from the first event, the log shape is malformed, or
the cached snapshot differs from `projectWorldState(log)`.

- **Detection** ✅ — after strict v1 schema validation, `loadSaveGame` runs
  `validateEventLog`, structurally compares both seed copies, reconstructs the
  snapshot from the authoritative log, and compares it with key-order-independent
  JSON equality.
- **Handling** ✅ — reject the entire document with typed `integrity-mismatch`;
  nothing is restored and no partial state is accepted or repaired.
- **User-facing** — no UI exists yet. The typed error is safe for a future host to
  map to “save could not be loaded” without echoing save content.
- **Logging** ✅ — error code and, when known, session id/revision/event count
  only. The save JSON, seed name, event payloads, and narrative text are never
  logged.

## 11. Unsupported SaveGame version ✅ (headless)

A parsed SaveGame declares a top-level `schemaVersion` other than `1`.

- **Detection** ✅ — the load boundary validates the minimal envelope first, then
  checks its version before attempting the strict current-version schema.
- **Handling** ✅ — reject with typed `unsupported-version`; never silently
  migrate, coerce, or mutate the document.
- **User-facing** — no UI exists yet. A future host can explain that the save was
  produced by an unsupported game version.
- **Logging** ✅ — stable error code only; never the document or embedded content.

## 12. Object interaction resolution ✅

An interaction may be presentation-only, already consumed, missing a stable
one-shot id, inventory-gated, or interrupted while applying multiple commands.
The renderer only reports intent; detection and state changes happen in the pure
planner and headless application service ([ADR-0014](./decisions/ADR-0014-object-interactions-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Re-open one-shot inspect | current-room flag already true | `already-resolved`; append nothing; panel body remains visible | status code/count only |
| Repeat item pickup | `take-item` idempotency flag already true | `already-resolved`; no second `item-added` | status code/count only |
| Interaction has no effect | service before state read | `rejected: missing-effect`; presentation-only panel still opens | reason code only |
| One-shot has no stable id/key | pure planner | `rejected: missing-id`; never generate a random ref | reason code only |
| Too few items for `use-item` | planner held check, then `appendEvent` defense | `rejected: insufficient-item`; append nothing | reason code only |
| First append sees stale revision | `WorldSession.appendEvent` | `failed: conflict`; no retry | ids/reason/count only |
| Later append fails | service command index | `failed: partial`; keep committed prefix, do not retry | ids/reason/count only |

For v0, the app is a single in-process writer and `InteractionService` threads
each returned revision into the next append, making a mid-sequence conflict
practically unreachable. Multi-event effects are not transactionally atomic:
if an unexpected later append fails, the typed `partial` result exposes that
fact without inventing a retry or alternate write path. Logs never include item
names, panel prompt/body/title, health deltas, or other narrative/user content.

## 13. Encounter resolution ✅

A two-phase encounter (present the threat + choices, then resolve the picked
one) may be re-triggered after resolution, lack a stable id, name an unknown
choice, fail an inventory gate, or be interrupted while applying multiple
commands. The renderer only reports intent; detection and state changes happen
in the pure `planEncounter` and the headless `EncounterService`
([ADR-0015](./decisions/ADR-0015-encounter-system-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Re-trigger a resolved encounter | current-room flag already set | `already-resolved`; append nothing; panel still shows `description` | status code/count only |
| Object has no `encounter` | service step 1 | `rejected: missing-encounter`; effect path or plain panel | reason code only |
| Encounter has no stable id/ref | pure planner | `rejected: missing-id`; never generate a random key (decision 7) | reason code only |
| Choice id not in encounter | pure planner | `rejected: unknown-choice`; append nothing | reason code only |
| Choice gate not met (too few items) | planner `requires` held-check, then `appendEvent` defense | `rejected: insufficient-item`; append nothing | reason code only |
| First append sees stale revision | `WorldSession.appendEvent` → `conflict` | `failed: conflict`; no retry | ids/reason/count only |
| Later append fails | `applyCommands` command index | `failed: partial`; keep committed prefix, do not retry | ids/reason/count only |
| Lethal damage | `applyEvent` health clamp | health clamps to `0`; **no death/game-over state** (decision 4) | code only |

`EncounterService` shares the `world-session/applyCommands` revision-threading
helper with `InteractionService`, so the same single-writer atomicity reasoning
as case 12 applies: outcome effects are ordered first and the resolution flag
last, threaded from each returned revision, making a mid-sequence conflict
practically unreachable; an unexpected later failure surfaces as `partial`
without a new write path. Authored encounter text (`description`, `title`,
choice `label`, `resultText`, status strings, item names) is display-only and
never reaches the logger; the chosen genre-neutral `action` is the only
choice-derived value logged.

## 14. Multi-room navigation ✅

An authored interaction exit is resolved through the session cache and room
registry before the existing `moved-to-room` event is appended
([ADR-0016](./decisions/ADR-0016-multi-room-navigation-cache-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Object has no exit | composition lookup miss | `rejected: missing-exit`; fall through to encounter/effect/plain panel | reason code only |
| Target is unknown | registry/cache miss | `rejected: unknown-room`; append nothing; calm blocked message | code, `toRoomId` |
| Target spec is invalid/unavailable | room-load boundary | typed `failed`; append nothing; safe message | ids/codes only |
| Target is current room | self-navigation guard | `rejected: already-here`; append nothing | ids/code only |
| Move revision is stale | `WorldSession.move` | `failed: conflict`; no retry | ids/code/revision only |
| Session is missing | state read or move | `failed: not-found` | ids/code only |
| Return to visited room | cache hit + persistent session | reuse cached room; visited and resolution flags remain intact | ids/code/`cacheHit` only |

Target resolution always happens before append, so the authoritative log never
claims the player entered an unrenderable room. Successful navigation appends
only the existing `moved-to-room`; visited marking is the reducer's existing
behavior. The active cached room rebuilds the engine for presentation, while the
session/cache persist and the renderer remains intent-only.

---

## Summary

| # | Failure | Detection | Degrades to | Status |
| --- | --- | --- | --- | --- |
| 1 | Bad envelope | `parse` throws | safe "couldn't load" screen | 🔜 |
| 2 | Bad/unknown object | per-object `safeParse` | magenta placeholder | ✅ |
| 3 | WebGL unavailable/lost | capability check + event | fallback message | 🔜 |
| 4 | Invalid generated JSON | same `loadRoomSpec` boundary → typed result | safe load screen; retry/fallback 🔜 | ✅ v0 |
| 4b | Valid spec, bad room | `validateRoom` (semantic) + 🔜 LLM reviewer | fatal → `invalid-room`; 🔜 repair/fallback | ✅ v0 |
| 5 | Backend/network | typed HTTP results | retry state | ❌ |
| 6 | DB failure | adapter → typed error | read-only / safe error | ❌ |
| 7 | Pre-gen not ready | room status at door | "Opening the way…" / fallback | ❌ |
| 8 | Iso camera/player presentation | resize→frustum; player-position proximity; scene-graph disposal; cutaway curbs | stable framing, no occlusion or leak | ✅ |
| 9 | Concurrent world append | optimistic revision check | typed conflict; neither event nor snapshot committed | ✅ headless |
| 10 | Save integrity mismatch | validate log + seed + projected snapshot | reject whole save | ✅ headless |
| 11 | Unsupported save version | envelope version check | typed rejection; no silent migration | ✅ headless |
| 12 | Object interaction resolution | pure effect plan + sequential typed appends | no-op/rejection/conflict/partial result; safe panel message | ✅ |
| 13 | Encounter resolution | pure encounter plan + shared `applyCommands` typed appends | already-resolved/rejection/conflict/partial result; safe panel message; health clamps, no death state | ✅ |
| 14 | Multi-room navigation | cache/registry resolve before `WorldSession.move` | rejection/failure with no move, or cached room + persistent flags | ✅ |

The through-line: **validate at the boundary, degrade visibly and safely, log
the detail, show the user calm.**
