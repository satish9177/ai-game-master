# Failure Modes

> Every meaningful failure mapped to: **detection → handling → user-facing
> behavior → logging.** Companion to [ARCHITECTURE](./ARCHITECTURE.md).

Status legend: ✅ behavior exists today · 🔜 planned (designed, not built) ·
❌ future (not built).

## Error-handling philosophy

- **Validate at every trust boundary.** Dynamic/external data is checked the
  moment it enters a layer (the browser via `loadRoomSpec`; the backend at its
  HTTP edge). See [BOUNDARIES](./BOUNDARIES.md).
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

## 4. Invalid generated JSON / RoomSpec ✅ v0 (assemble → repair → fallback) · 🔜 real LLM re-prompt

A generator returns malformed JSON, a schema-invalid spec, a partial spec, or
(from a future model) hostile content.

- **Detection** ✅ — implemented in `GeneratedRoomSource` + the pure `assembleRoom`
  pipeline: the generator's raw text flows through `JSON.parse` → the **same**
  `loadRoomSpec` boundary → `validateRoom`. A `JSON.parse` failure
  (`failedStage: json`) and a bad envelope (`failedStage: schema`) are caught as
  pipeline stages; bad *objects* are skipped (case 2); a generator **throw/reject**
  maps to `unavailable`. Hostile content is *still just data* — there is no code
  path to execution (see
  [ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md)). The deterministic
  fake can't actually emit bad output, but the mapping is real and **unit-tested**.
- **Handling** — ✅ v0 **no longer rejects bad content to an error screen**: an
  unrecoverable room (malformed JSON, bad envelope, or an unrepairable semantic
  fatal) is replaced by a **trusted fallback room** (`provenance: fallback`,
  `ok:true`); a salvageable room is **deterministically repaired**
  (`provenance: repaired`). The renderer always gets a valid room
  ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). Only a
  generator throw/reject still yields the `unavailable` retry path. 🔜 the bounded
  multi-attempt loop and a corrective re-prompt (with a real model) remain future
  ([ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md)).
- **User-facing** ✅ — a repaired/fallback room **renders normally**, with a small
  dismissable, static, prompt-free notice ("We couldn't build that room exactly, so
  here's a safe one. Try another prompt."). A generator-unavailable failure still
  shows the calm "Could not generate a room. Please try again." retry screen; never
  raw model output or errors.
- **Logging** ✅ — the caller logs **prompt length** and safe diagnostics only —
  provenance, failed stage, fixed issue **codes**, counts, booleans; **never** full
  prompts, raw JSON, story text, object names, keys, or PII. 🔜 model/latency/token/
  attempt metadata arrives with the real client.

## 4b. Valid RoomSpec but a bad room ✅ v0 (validator + deterministic repair/fallback) · 🔜 reviewer + LLM repair

The spec is valid JSON and passes the schema, yet the room is **unplayable or
poor**. **Valid JSON does not mean a room is playable or good.** This is the gap
the generation pipeline closes; full design in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md). The
deterministic code validator
([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)) detects it, and
the deterministic **repair + trusted fallback room**
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)) now
resolve it so an unplayable room never reaches — and never blocks — the renderer.

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
  | **Room-level, repairable** | spawn outside the room, object/light over the hard budget | ✅ v0 deterministic `repairRoom` (clamp spawn / truncate over-budget objects/lights) → re-validate → render (`provenance: repaired`) |
  | **Room-level, unrepairable** | unwalkable / pathological size (no resize), or a fatal that survives one repair pass | ✅ v0 → **trusted fallback room** (`provenance: fallback`); 🔜 LLM repair/regenerate within the attempt budget |
  | **Prompt mismatch / too empty/boring** | output doesn't match the prompt; room is dull | 🔜 reviewer rejects → repair/regenerate |
  | **Repeated failure** | still unacceptable after max attempts | ✅ deterministic safe fallback room now ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)); 🔜 the LLM attempt budget + retry |

- **v0 handling** ✅ — `GeneratedRoomSource` runs the pure `assembleRoom` pipeline:
  it `loadRoomSpec`s then `validateRoom`s; a **fatal** (room-level) issue triggers a
  single deterministic `repairRoom` pass and a re-validate — if that clears the
  fatal the **repaired** room renders, otherwise the **trusted fallback** room
  renders. **Warnings** (object-level) are logged as counts/codes and the room
  still loads. Neither `repairRoom` nor the pipeline mutates its inputs (repair
  returns a narrowed copy); warnings are not surfaced in the UI yet
  ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)).
- **Retry/repair policy** — ✅ v0 is a **single** deterministic repair pass then
  re-validate, then fallback (no loop, no attempt budget). 🔜 the v1 LLM policy —
  fast model first → one fast corrective re-prompt → slow/better model fallback;
  **no infinite retries, max 3 attempts**; target **10–30s** for the first room,
  **~60s** hard cap; on hard failure a **safe error with a retry button or a
  fallback room** — needs a real, non-deterministic model.
- **User-facing** — ✅ a repaired or fallback room **renders normally**, with a
  small dismissable, static, prompt-free notice; an unplayable room no longer shows
  an error screen. Warnings are not shown in the UI yet (a dev overlay stays
  future). 🔜 with a real model, a brief wait then the room, repair behind the
  scenes — never a broken or unplayable room.
- **Logging** — ✅ v0 logs one safe line per call: `provenance`, `failedStage`, the
  distinct fatal issue **codes** (a fixed enum), `repairAttempted`, and
  object/skipped/warning counts — never issue message text, full prompts, raw
  generated JSON, object names, keys, or PII. 🔜 per-attempt validator/reviewer
  outcomes, which class failed, attempt count, model, latency arrive with the real
  pipeline.

## 5. Backend / network failure ✅ API edge v0 · 🔜 browser client

The Node API edge exists, but the browser does not call it yet. v0 therefore
covers safe server-side request and infrastructure failure handling; client
timeouts, offline handling, retry UX, and hosted-network behavior remain future.

- **Detection** ✅ — method/path routing, bounded JSON parsing, zod request
  contracts, typed world-session/store results, and a health probe.
- **Handling** ✅ — invalid input/commands map to `400`, missing resources to
  `404`, revision conflicts to `409`, and unexpected/corrupt-state failures to a
  safe `500` envelope. An unhealthy dependency makes `GET /health` return `503`.
- **User-facing** 🔜 — there is no browser API client yet. Future wiring needs
  typed HTTP results, abort/timeouts, offline detection, and retryable UI states.
- **Logging** ✅ — structured ids/counts/codes only; request bodies, RoomSpec
  story content, SQL details, and stack traces are never returned or logged.
  Correlation ids and latency telemetry remain future.

## 6. Persistence / database failure ✅ v0 (headless, Node-only) · 🔜 hosted backend

The headless SQLite layer ([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md))
is the first durable store: a `node:sqlite` connection + forward-only migration
runner, `SqliteWorldStore` (the unchanged `WorldStore` port), and `SqliteRoomStore`
(the new `RoomStore` port). The Node API composes these adapters and maps
request-time faults to safe envelopes. Persistence remains browser-excluded, so
there is still no frontend user-facing surface.

**Two error classes at the persistence boundary** (mirrors ADR-0013): expected
content/concurrency outcomes are **typed results**; genuine infrastructure faults
(DB cannot open, migration failure, corrupted *session* JSON) **fail fast / throw**.

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| DB cannot open / unavailable | `open` / `runMigrations` throws | **fail fast** before listen — the API never starts against an unavailable or unmigrated DB | code only |
| Migration fails midway | per-migration `withTransaction` (`BEGIN IMMEDIATE`) | the migration **rolls back wholesale**, records nothing, and `runMigrations` rethrows; the DB stays at the prior version (refuse a half-migrated DB) | migration `version` only |
| Unknown stored `schema_version` | read-boundary check | reject rather than silently migrate; tolerate the current version | code only |
| Corrupt session snapshot / event JSON | read-boundary `JSON.parse` + `safeParse` | **throw** — corruption is a fault, never masked as `null` / `not-found`; the row text is never included in the error or logs | code only |
| Concurrent world append | CAS `UPDATE … WHERE revision = expected` → 0 rows | existence probe → typed `conflict` (stale) or `not-found` (no row); `UNIQUE(session_id, seq)` backstops a racing writer; the snapshot update rolls back | ids / revision / code |
| Append + snapshot atomicity | one transaction per `commit` | append and snapshot replace are **both-or-neither**; the projection-consistency test and `projectWorldState` re-projection detect any drift | ids / seq / revision |
| Append-only violation attempt | `BEFORE UPDATE`/`BEFORE DELETE` triggers on `world_events` | the DB `RAISE(ABORT)`s; the adapter also exposes no event mutation/delete path | code only |
| Corrupt **stored room** JSON/envelope | `getRoom` `JSON.parse` → `loadRoomSpec` | typed `invalid-stored-room` (an **expected** content failure, unlike a session fault) | `roomId` / code |
| Room not found | `getRoom` lookup miss | typed `not-found` | `roomId` / code |
| Duplicate room id | `saveRoom` `ON CONFLICT(room_id) DO UPDATE` | create-or-replace, last-writer-wins (rooms are content, not event-sourced truth) | `roomId` only |
| Cross-session / room leakage | every query scoped by `session_id` / `room_id` | sessions and rooms never see each other; SQLite returns freshly parsed objects (no aliasing) — isolation tests | ids only |

- **API-facing** ✅ / **browser-facing** 🔜 — API callers receive safe error
  envelopes, never SQL or stack details; no frontend error surface is wired yet.
- **Logging** ✅ — ids / counts / codes only (`sessionId`, `roomId`, `revision`,
  `eventCount`, error `code`, migration `version`); **never** event payloads, item
  names, `reason` strings, room `name`, dialogue, or any story content.
- **🔜 hosted backend** — a startup migration check on a shared DB, read-only
  degradation when the store is down, and the dual-dialect PostgreSQL path
  ([ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md)) remain future.

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

## 15. NPC dialogue resolution ✅

NPC dialogue is a read-only conversation path over the existing interaction
intent ([ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Object/NPC has no `dialogue` | composition dialogue-lookup miss | `rejected: missing-dialogue`; fall through to effect or plain panel | reason code only |
| Id-less or unknown NPC id | lookup skip/miss | `rejected: missing-dialogue`; never key by an id-less object | reason code only |
| Missing session on read | `getWorldState` → not-found | `failed: not-found`; no append | ids/code only |
| Provider throws/unavailable | service catch | `failed: provider-unavailable`; calm panel message | ids/code only |
| Repeated talk | repeatable component action | fresh deterministic reply; no event, flag, or world-state change | ids/turn count only |
| Generated-room NPC | no authored dialogue marker | existing effect/plain-panel path | reason code only |

`NPCDialogueService` receives only the `getWorldState` read capability. Repeated
replies leave the authoritative event log and projected snapshot unchanged;
conversation history resets with component state. Dialogue text, NPC names,
personas, greetings, prompt labels, player lines, item names, and status strings
never reach logs.

---

## Summary

| # | Failure | Detection | Degrades to | Status |
| --- | --- | --- | --- | --- |
| 1 | Bad envelope | `parse` throws | safe "couldn't load" screen | 🔜 |
| 2 | Bad/unknown object | per-object `safeParse` | magenta placeholder | ✅ |
| 3 | WebGL unavailable/lost | capability check + event | fallback message | 🔜 |
| 4 | Invalid generated JSON | `assembleRoom`: parse/schema/semantic stages → typed result | repaired or trusted fallback room + static notice; generator-unavailable → retry | ✅ v0 |
| 4b | Valid spec, bad room | `validateRoom` (semantic) + deterministic `repairRoom` / fallback; 🔜 LLM reviewer | fatal → repair → render, else trusted fallback room | ✅ v0 |
| 5 | Backend/network | validated API requests + typed results | safe API envelope; browser retry state 🔜 | ✅ API edge v0 |
| 6 | DB / persistence failure | typed results (rooms, conflicts) + fail-fast throws (open/migration/corrupt session) | safe API error; no browser surface yet | ✅ API-backed v0 |
| 7 | Pre-gen not ready | room status at door | "Opening the way…" / fallback | ❌ |
| 8 | Iso camera/player presentation | resize→frustum; player-position proximity; scene-graph disposal; cutaway curbs | stable framing, no occlusion or leak | ✅ |
| 9 | Concurrent world append | optimistic revision check | typed conflict; neither event nor snapshot committed | ✅ headless |
| 10 | Save integrity mismatch | validate log + seed + projected snapshot | reject whole save | ✅ headless |
| 11 | Unsupported save version | envelope version check | typed rejection; no silent migration | ✅ headless |
| 12 | Object interaction resolution | pure effect plan + sequential typed appends | no-op/rejection/conflict/partial result; safe panel message | ✅ |
| 13 | Encounter resolution | pure encounter plan + shared `applyCommands` typed appends | already-resolved/rejection/conflict/partial result; safe panel message; health clamps, no death state | ✅ |
| 14 | Multi-room navigation | cache/registry resolve before `WorldSession.move` | rejection/failure with no move, or cached room + persistent flags | ✅ |
| 15 | NPC dialogue resolution | read-only world context + provider reply | typed failure or component-only conversation; no event/state change | ✅ |

The through-line: **validate at the boundary, degrade visibly and safely, log
the detail, show the user calm.**
