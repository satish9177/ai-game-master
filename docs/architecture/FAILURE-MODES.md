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

## 4c. World Bible seeding failure ✅ non-blocking v0

The prompt-path seeder rejects, returns schema-invalid data, or projection fails.
The deterministic fake validates internally and should not fail in normal use, but
the composition boundary treats failure as an expected degradable outcome
([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).

- **Detection** ✅ — `prepareGeneratedRoomSeed` awaits the `WorldBibleSeeder` and
  projection inside one `try/catch`; `FakeWorldBibleSeeder` parses through
  `WorldBibleSeedSchema` before returning.
- **Handling** ✅ — restore the previous behavior: use the raw prompt as the
  `FakeRoomGenerator` seed, omit `ActivePlay.worldBible`, and continue through
  unchanged `GeneratedRoomSource → assembleRoom → repair/fallback`. Gameplay is
  never blocked by bible availability.
- **User-facing** ✅ — no separate UI or error state. The generated room loads
  through the same normal/repaired/fallback experience.
- **Authority** ✅ — a successful bible is initial canon in generated-play
  composition memory only; `WorldSession`, its event log, and `WorldState` remain
  authoritative. Failure creates no event/state/persistence placeholder.
- **Logging** ✅ — success logs only theme/tone enums, counts, and derived-seed
  length; failure logs fixed code `world-bible-unavailable`. Never raw prompt,
  derived seed, title/premise/conflict/opening-arc/NPC/faction/location/keyword
  text, generated JSON, or thrown error details.


## 4d. Real room generator provider failure ✅ opt-in v0 (degrade / unavailable)

The opt-in `OpenAICompatibleRoomGenerator` (OpenAI/DeepSeek; off by default) makes
one real network call on the PromptBar-generated room path. It is **strictly
additive and non-blocking**: missing or incomplete config, or any request failure,
degrades to today's behavior, and malformed output flows through the unchanged
repair/fallback pipeline ([ADR-0023](./decisions/ADR-0023-real-room-generator-provider-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Incomplete config (provider/key/model) | `app/llmConfig` + `selectRoomGenerator` (trimmed completeness check) | select `FakeRoomGenerator`; deterministic, offline, never blocked | `provider:'fake'`, fixed reason `config-disabled` |
| Network error / non-2xx / non-JSON body | `OpenAICompatibleRoomGenerator` | throw fixed-code `Error` → `GeneratedRoomSource` maps to `unavailable` (retry screen) | existing `unavailable` line, fixed code `llm-request-failed` only |
| Hard timeout (abort) | `AbortController` (`timeoutMs`, default 25s), `timedOut` flag | same: throw → `unavailable` | fixed code `llm-timeout` only |
| Empty / missing `choices[0].message.content` | response content check | same: throw → `unavailable` | fixed code `llm-empty-response` only |
| Malformed / non-JSON completion text | unchanged `assembleRoom` | `repaired` or `fallback` room (`ok:true`) + existing static notice (case 4/4b) | provenance/codes (unchanged) |
| Valid clean JSON completion | unchanged | `generated` room, no notice | provenance (unchanged) |

- **Bounded:** one call, **no retry**, hard timeout (~25s default; within ADR-0007's
  10–30s target for the first room). Adjacent pre-generation stays fake, so warming
  never calls the provider or spends.
- **Sanitized errors are a hard requirement.** The provider catches everything and
  rethrows a fixed-shape `Error` whose `message` is one of three safe codes —
  carrying **no** key, request/response body, prompt/seed, or model output. Because
  `GeneratedRoomSource` logs `err.message` on `unavailable`, this keeps that existing
  line safe with **no change** to `GeneratedRoomSource`. A unit test asserts the
  thrown message contains no substring of the key, seed, or body.
- **Selection log safety.** The composition root logs only
  `{ provider, model, maxTokens, timeoutMs }` (real) or
  `{ provider:'fake', reason:'config-disabled' }`. **Never logged:** the API key,
  raw prompt, world-bible text, derived seed, provider request/response body,
  generated JSON, completion text, or raw error details.
- **Dev-only key caveat.** `VITE_*` keys are inlined into a built browser bundle; v0
  is local-dev/BYOK only and a real-key bundle must never be deployed. Hosted
  production moves the provider server-side later.

## 4e. Generated room layout normalization ✅ v0 (benign pre-semantic, always `generated`)

Real LLM providers produce valid `RoomSpec` JSON that still has **spatial layout
problems**: floor dimensions outside the playable envelope, objects placed beyond
the wall faces, too many objects, a spawn position crowded by a pillar or NPC, or
exit arches in the middle of the floor instead of at wall faces. These are not
playability fatals caught by `validateRoom`, so neither `repairRoom` nor the
fallback applies — but they do produce an unpleasant or unnavigable room.

The **layout contract** ([ADR-0031](./decisions/ADR-0031-generated-room-layout-contract-v0.md))
normalizes all five classes as **benign pre-semantic steps** around the stage 2.7
composition pass in `assembleRoom`, before `validateRoom` runs. Unlike
`repairRoom`, these
normalizations never raise `provenance: repaired` or trigger the dismissable
notice — they are silently corrective and keep `provenance: generated`.

| Layout problem | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Floor too small or too large | `clampGeneratedShell` (stage 2.5): width/depth outside `[14..24]` m | clamp to `[14..24]`; height unchanged | `sizeRepaired: true` bool only |
| Object outside floor bounds | `repairGeneratedObjects` (stage 2.6): object footprint outside playable area | position object so its full footprint (rotation-invariant per-type radius, scaled and padded) stays inside walkable floor; decorative objects whose footprint cannot fit are dropped | `objectsRepaired: true` bool only |
| Too many objects (> 30) | `repairGeneratedObjects` (stage 2.6): list exceeds `MAX_OBJECTS` cap | drop decorative first, then structural; critical objects are never dropped | `objectsRepaired: true` bool only |
| Wall-light (e.g. torch) in floor interior | `repairGeneratedObjects` (stage 2.6): wall-light anchor farther than `WALL_LIGHT_BAND` from any wall edge | nudge toward nearest wall/side edge (deterministic); lights already near a wall are left in place | `objectsRepaired: true` bool only |
| Skipped/malformed placeholder anchor outside floor | `repairGeneratedObjects` (stage 2.6): skipped object anchor beyond playable area (using placeholder cube footprint) | clamp anchor inside playable floor; placeholder still renders as magenta cube, just inside bounds | `objectsRepaired: true` bool only |
| Unsafe or crowded spawn | `repairGeneratedSpawn` (stage 2.8): spawn X/Z outside floor or within `SPAWN_CLEARANCE` of a blocking object | clamp to floor, then search deterministic candidate set (origin, ±step cardinal); fall back to clamped position | `spawnRepaired: true` bool only |
| Exit arch misplaced | `repairGeneratedExits` (stage 2.9): exit-carrying object not on a wall face | snap to nearest wall face (north/south/east/west; ties north > south > east > west) | `exitsRepaired: true` bool only |

- **Provenance** is always `generated` after layout normalization. A separate
  `repairRoom` pass (stage 4) is the only thing that yields `repaired`, and
  the pipeline failure path (stages 1–4 exhausted) is the only thing that yields
  `fallback`. The host shows no notice for a layout-normalized-only room.
- **Scope.** Normalization runs **only** inside `assembleRoom` for generated rooms.
  `validateRoom`, `repairRoom`, the fallback room, and the renderer are unchanged.
  Authored/static/fallback rooms are never touched.
- **Logging.** The four boolean flags (`sizeRepaired`, `objectsRepaired`,
  `spawnRepaired`, `exitsRepaired`) are the only new surface. They never carry raw
  generated JSON, prompt text, provider body, room names, object content, or keys.
- **Known follow-up.** Stage 2.6 currently clamps exit-carrying objects inward
  before stage 2.9 snaps them back to a wall face. This can cause both
  `objectsRepaired` and `exitsRepaired` to be true for an arch that only needed
  wall-snapping, and a small nearest-wall drift near corners. Both effects are
  harmless; a future cleanup can make stage 2.6 skip exit-carrying objects.

## 4f. Generated room composition normalization ✅ v0 (benign, always `generated`)

A generated room can be spatially safe under the layout contract yet still feel
like a random prop cluster: eligible clutter blocks the central route, a throne
has no focal placement, NPCs stand in the path, or interactables are hard to read.

The pure composition pass
([ADR-0032](./decisions/ADR-0032-generated-room-composition-v0.md)) runs after
generated object legality repair and before spawn/exit finalization. It arranges
existing objects only; it does not generate or remove content.

| Composition condition | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Eligible object in central corridor | `composeGeneratedRoom` role classification + corridor test | relocate the existing object to its deterministic role zone | `composed: true` bool only |
| Throne present outside anchor zone | first `anchor` role is not north-center | relocate that existing throne to the anchor zone | `composed: true` bool only |
| NPC or interactable in corridor | `npc` / `interactable` role inside corridor | move off-path to a deterministic flank | `composed: true` bool only |
| Missing anchor | no `anchor` role | accept room unchanged; never repair or fallback | `lacksAnchor: true` bool only |
| Missing interactable | no `interactable` role | accept room unchanged; never repair or fallback | `lacksInteractable: true` bool only |

- **Provenance.** Composition-only relocation keeps `provenance: generated`, sets
  no `failedStage`, and shows no repaired/fallback notice. Existing repair and
  fallback notice behavior is unchanged.
- **Content boundary.** Object count and every non-position field are preserved.
  No NPC, anchor, clue, chest, light, resource, interaction, or quest object is
  invented. Missing roles are diagnostics, not failures.
- **Scope.** Only generated rooms inside `assembleRoom` are composed.
  Authored/static/fallback rooms and the renderer are untouched; there is no
  provider prompt, backend, API, persistence, memory, world-session, or gameplay
  change.
- **Logging.** `composed`, `lacksAnchor`, and `lacksInteractable` are fixed
  booleans only. Logs never include raw prompts, provider bodies, generated JSON,
  room/object text, API keys, or PII.

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

## 7. Adjacent-room pre-generation not ready at a door ✅ v0 (browser/session-cache) · 🔜 backend status lifecycle

The player reaches an exit before its room finished warming, the target was never
warmed, or warming failed. v0 ships the deterministic browser subset
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)); the parallel
real-LLM status lifecycle remains the future shape of
[ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

- **Detection** ✅ — there is no per-room status machine in v0; the single
  `AdjacentRoomPregenerator.resolveRoom(id)` seam serves both the door and the
  background warmer over **one** cache and **one** in-flight map. A door request
  is a cache hit, or **joins** an in-flight warm for the same id, or runs a fresh
  resolve. Every generated adjacent room must pass through `GeneratedRoomSource →
  assembleRoom → repairRoom → fallbackRoom` before it can enter the cache;
  authored adjacents warm through `RoomRegistry` and are never fake-generated.
- **Handling** ✅ — by case: **warmed** → instant cache hit; **warming in flight**
  → the door joins that one job (no duplicate generation); **never warmed**
  (authored *or* non-authored) → resolved on demand, generating safely if
  non-authored; a generator **throw/reject** → typed `unavailable` (nothing
  cached, the next attempt retries). Bad *content* never blocks — `assembleRoom`
  yields a repaired/fallback room (case 4/4b). Warming is **fire-and-forget,
  capped at `maxJobs` (default 3)**, deduped against cache + in-flight, and
  **depth-1** (a warmed room never warms its own neighbours), so a backtrack
  wastes little work and pre-generation cannot fan out.
- **User-facing** ✅ — with the synchronous deterministic generator a transition is
  either an instant cache hit or an on-demand resolve in the same tick, so there is
  no "Opening the way…" state to show in v0; the player never freezes or sees a
  broken room. In the authored two-room loop both rooms warm through the registry,
  so behavior is unchanged. 🔜 with a slow real model, the ADR-0009 status
  lifecycle (`not_started → generating → validating → repairing → ready` / `failed`)
  and a short "Opening the way…" wait become observable.
- **Logging** ✅ — ids / codes / counts / booleans / provenance only: `room
  resolved` (`roomId`, `source`, `cacheHit`, optional `provenance`), `room resolve
  failed` (`roomId`, `source`, `code`), `adjacent warm requested` (`adjacentCount`,
  `started`). The generation seed is the **structural room id** (`adjacent:${id}`),
  never a user prompt; **no raw prompt/seed text, generated JSON, story text, or
  object names** are logged (reuses the case 4/4b discipline). 🔜 per-room status,
  wait time, and model/latency arrive with the backend pipeline.

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

## 16. NPC memory persistence ✅ v0 (headless)

NPC memory is a durable, scoped store of inert memory records — **supporting
context only, never world truth** ([ADR-0024](./decisions/ADR-0024-npc-memory-persistence-v0.md)).
The `NpcMemoryService` has no `WorldSession` reference and no append path; writes go
through the pure write firewall, reads through a scoped query plus the read firewall.
Memory's absence or failure never blocks play and never alters truth.

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Invalid memory write | `validateMemoryDraft` (write firewall) | `rejected: <reason>` (`invalid-scope`/`invalid-kind`/`invalid-source`/`empty-text`/`text-too-long`/`invalid-confidence`/`invalid-provenance`); nothing stored | kind/source/reason code only |
| Missing session (FK) | `record` session pre-check (`SqliteNpcMemoryStore`) | `failed: session-not-found`; nothing stored (the FK to `world_sessions` backs it) | sessionId/code only |
| Concurrent seq collision | `UNIQUE(session_id, npc_id, seq)` from a true concurrent writer | `failed: conflict`; the insert rolls back | sessionId/code only |
| Unknown/empty scope on recall | scoped query returns nothing | `recalled` with `memories: []` — **not** an error | count (0) only |
| Corrupt or scope-divergent stored row | read-boundary `safeParse` + JSON-scope re-assertion against the queried SQL scope | **skip** that row, return the valid rest — an **expected** content failure (contrast a session/event fault, which still throws) | memoryId / `invalid-stored-memory` |
| Attempted memory mutation | `BEFORE UPDATE` trigger + no update/delete on the port | the DB `RAISE(ABORT)`s; the adapter exposes no mutation path (DELETE left open for a future forgetting slice) | — |
| Cross-world/session/NPC leak | exact-triple SQL filter + `filterMemoriesForScope` + adapter JSON-scope re-assertion | recall returns only the queried NPC's rows; FK ties memory to a real session; leak tests cover both stores | ids only |
| Memory used as truth (player claim / NPC belief / summary / `source:'llm'`) | structural — no append path, no `WorldCommand`/`WorldEvent` mapping | the memory is stored/recalled only; the event log and snapshot are unchanged | enums/ids/seq/counts/codes only |

Logs carry `memoryId`/`worldId`/`sessionId`/`npcId`/`kind`/`source`/`confidence`/
`seq`/`count`/`code` only — **never** memory `text`, player lines, NPC/room names,
provider prompts/responses, generated JSON, API keys, or PII. The firewall and the
in-memory store are silent; the service and the SQLite store are the only loggers.

## 17. Room memory persistence ✅ v0 (headless)

Room memory is a durable, scoped store of inert room memory records — **supporting
context only, never room truth** ([ADR-0025](./decisions/ADR-0025-living-world-room-memory-v0.md)).
The `RoomMemoryService` has no `WorldSession` reference and no append path;
`WorldState.roomStates` (`.visited`, `.flags`) remains the only authoritative per-room
state. Memory's absence or failure never blocks play and never alters truth.

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Invalid memory write | `validateRoomMemoryDraft` (write firewall) | `rejected: <reason>` (`invalid-scope`/`invalid-kind`/`invalid-source`/`empty-text`/`text-too-long`/`invalid-confidence`/`invalid-provenance`); nothing stored | kind/source/reason code only |
| Missing session (FK) | `record` session pre-check (`SqliteRoomMemoryStore`) | `failed: session-not-found`; nothing stored (the FK to `world_sessions` backs it) | sessionId/code only |
| Concurrent seq collision | `UNIQUE(session_id, room_id, seq)` from a true concurrent writer | `failed: conflict`; the insert rolls back | sessionId/roomId/code only |
| Unknown/empty scope on recall | scoped query returns nothing | `recalled` with `memories: []` — **not** an error (an unknown `room_id` is valid — room memory has no FK to `rooms`) | count (0) only |
| Corrupt or scope-divergent stored row | read-boundary `safeParse` + JSON-scope re-assertion against the queried SQL scope | **skip** that row, return the valid rest — an **expected** content failure (contrast a session/event fault, which still throws) | memoryId / `invalid-stored-memory` |
| Attempted memory mutation | `BEFORE UPDATE` trigger + no update/delete on the port | the DB `RAISE(ABORT)`s; the adapter exposes no mutation path (DELETE left open for a future forgetting slice) | — |
| Cross-world/session/room leak | exact-triple SQL filter + `filterRoomMemoriesForScope` + adapter JSON-scope re-assertion | recall returns only the queried room's rows; FK ties memory to a real session; leak tests cover both stores | ids only |
| Memory used as truth (player claim / room observation / room note / summary / `source:'llm'`) | structural — no append path, no `WorldCommand`/`WorldEvent` mapping; `WorldState.roomStates` is the sole truth source | the memory is stored/recalled only; the event log, snapshot, and `roomStates` are unchanged | enums/ids/seq/counts/codes only |

Logs carry `memoryId`/`worldId`/`sessionId`/`roomId`/`kind`/`source`/`confidence`/
`seq`/`count`/`code` only — **never** memory `text`, player lines, room/NPC display
names, provider prompts/responses, generated JSON, API keys, or PII. The firewall and
the in-memory store are silent; the service and the SQLite store are the only loggers.

## 18. Player HUD display ✅

The read-only `StatusHud` overlay reflects in-memory `WorldState` projected by the
pure `projectPlayerHud` function. Its absence, stale state, or empty fields never block
play; it has no write path and cannot corrupt truth
([ADR-0026](./decisions/ADR-0026-inventory-health-ui-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| No active session / HUD not yet seeded | `playerHud === null` in `App` | `StatusHud` not rendered; no crash | — |
| Empty inventory | `view.items.length === 0` | explicit "No items" empty state rendered | — |
| Empty status set | `view.statuses.length === 0` | status chip row omitted entirely | — |
| Player state changed (item/health/status) | interaction/encounter `applied`/`already-resolved` → `onWorldStateChange(result.state)` | `App` re-projects via `projectPlayerHud`; `StatusHud` re-renders from fresh view | — |
| Navigation (`moved-to-room`) | does not touch player fields | HUD persists unchanged; `App` does not reset `playerHud` | — |
| Health clamped to `0` (lethal encounter) | reducer clamp (existing; `applyEvent`) | bar empty, label `0 / max`; **no death/game-over state** (out of scope) | — |
| Stale HUD after unexpected non-mutating resolve | result.status not `applied`/`already-resolved` | `onWorldStateChange` not called; last known view persists; no write-back possible | — |

The HUD is a pure render cache (`playerHud: PlayerHudView | null` in `App`). It only
renders after a `WorldState` that has already passed schema validation exists — there is
no path where a rendered HUD encounters absent or schema-invalid player fields.
`projectPlayerHud` is silent (pure function); `StatusHud` is presentational. No new
log lines were added to `App`/`RoomViewer`. Item names/ids, health values/deltas, and
status strings are never logged.

## 19. Browser session save/load ✅ v0 (browser)

Manual save/load via a single named `localStorage` slot, round-tripped through the existing
`SaveGameService` integrity boundary. `localStorage` is a byte parking spot; only `saveGameJson`
is read on load; the slot wrapper metadata is display-only and never trusted
([ADR-0027](./decisions/ADR-0027-session-save-load-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Corrupt save (bad JSON / wrong shape) | `loadSaveGame`: `invalid-json` / `invalid-schema` | calm "couldn't load"; **nothing restored**; current play untouched (cases 10/11) | error `code` only |
| Unsupported version | `loadSaveGame`: `unsupported-version` | calm "couldn't load"; no silent migration (case 11) | `code` only |
| Integrity mismatch (log/seed/snapshot disagree) | `loadSaveGame`: `integrity-mismatch` | reject whole save; nothing restored (case 10) | `code` (+ `sessionId` if known) |
| Same session already loaded | `restoreSession` → `already-exists` | calm "this session is already loaded"; no-op | `sessionId` / `code` |
| Generated room cache missing | by design — content was never saved | re-resolve via `AdjacentRoomPregenerator.resolveRoom`; fallback room + `FALLBACK_NOTICE`; correct authoritative state | seam ids/`source` only |
| Current room cannot be resolved | `resolveRoom` → `{ ok:false }` (`invalid-room`/`unavailable`) | substitute fallback under `currentRoomId`; `degraded:true` → notice; authoritative state still correct | `roomId` / `reason` |
| Load while a session is active (unsaved progress loss) | always after boot | different `sessionId` restores; `ActivePlay` replaced; unsaved current progress lost (documented behavior) | `sessionId` only |
| `localStorage` unavailable / blocked | `SaveSlotStore` get/set wrapped in try/catch | reads → treat as no slot (Continue hidden); writes → calm "couldn't save"; never throws into render | `code` only |
| `localStorage` quota exceeded on save | write throws `QuotaExceededError` | calm "couldn't save your game"; existing slot left intact | `code` only |

- **Authority unchanged.** No load path shows unverified bytes; no UI action has a write path to
  the event log or store beyond the normal validated `appendEvent`/`restoreSession`.
- **Logging discipline.** `handleSave`/`handleLoad` log ids/counts/codes/enums only — never the
  SaveGame JSON, slot wrapper, seed name, event payloads, item names/ids, room names, dialogue,
  prompt text, or any narrative/PII.
- **Known limitations.** One local slot only; no file import/export; no session list/browser; no
  backend/cloud sync; generated room content is not byte-restored; only authoritative
  state/event log is restored faithfully.

## 20. Quest tracker display ✅ v0 (browser)

The read-only `QuestTracker` overlay reflects the `QuestView` projected by the pure
`evaluateQuest` function from authoritative `WorldState`. Its absence, stale state, or
incomplete objectives never block play; it has no write path and cannot corrupt truth
([ADR-0028](./decisions/ADR-0028-demo-quest-loop-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| No active session / spec not yet attached | `quest === null` in `App` | `QuestTracker` not rendered; no crash | — |
| Prompt-generated session | no `QuestSpec` attached (anchor-room gate: `'throne-room' not in state.roomStates`) | tracker not rendered; never wrong | — |
| Missing room / flag / visited | defensive optional chaining in `evaluateQuest` | condition evaluates `false`; quest stays `active`; no throw | — |
| Player has not yet acted | conditions read `false` | objectives show incomplete; quest stays `active` | — |
| Objective 1 done, coin spent via `negotiate` | Obj 1 gates on permanent pickup flag, not held inventory | Objective 1 stays `done`; flag is permanent | — |
| Navigation to safehouse (Objective 3) | `App.handleNavigate` calls `refreshDerivedViews(result.state)` on `navigated` | Objective 3 flips `done` immediately; if re-projection omitted, next resolve refreshes it — never wrong, only lagged | — |
| All objectives done (quest `complete`) | `status: 'complete'` in `QuestView` | tracker shows "Complete" state; play continues normally, no gate | — |
| Already-done objective re-triggered | re-project is idempotent; `already-resolved` carries `state` | objective stays `done`; no state change | — |
| Loaded mid-quest | `refreshDerivedViews(restoredState)` on load | exact mid-quest progress; no special handling | — |

The tracker is read-only with no append path, so no displayed quest state can corrupt truth.
`evaluateQuest` is pure and silent; `QuestTracker` is presentational. No new log lines were
added to `App`/`RoomViewer`. Quest/objective text, ids, flag keys, item names/ids, status
strings, room display names, and narrative content are never logged.

## 21. Consequence journal display ✅ v0 (browser)

The collapsible read-only `JournalPanel` overlay reflects the `JournalView` projected by the
pure `projectJournal` function from authoritative `WorldState`. Its absence, stale state, or
empty entry list never block play; it has no write path and cannot corrupt truth
([ADR-0029](./decisions/ADR-0029-consequence-journal-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| No active session / spec not yet attached | `journal === null` in `App` | panel not rendered; no crash | — |
| Prompt-generated session | no `JournalSpec` attached (anchor-room gate: `'throne-room' not in state.roomStates`) | panel not rendered; never wrong | — |
| Nothing has happened yet | all conditions read `false` → `entries: []` | expanded panel shows "Nothing of consequence yet."; collapsed toggle shows `Journal (0)` | — |
| Missing room / flag / visited / status / item | defensive optional chaining in `evaluateCondition` | condition evaluates `false`; entry omitted; never throws | — |
| Loaded mid-play | `refreshDerivedViews(restoredState)` on load | exact entries reproduced; no special handling | — |
| Navigation (`entered-safehouse`) | `App.handleNavigate` calls `refreshDerivedViews(result.state)` on `navigated` | "You entered the ruined safehouse." appears immediately; if omitted, next resolve refreshes it — never wrong, only lagged | — |
| Entry already shown, re-triggered resolve | re-project is idempotent; `already-resolved` carries `state` | entry stays shown; no state change | — |
| Status/item later removed (future `clear-status`/consume) | condition re-reads `false` | entry disappears — honest reflection of current truth; no authored removal path exists in the demo world | — |

The panel is read-only with no append path, so no displayed journal state can corrupt truth.
`projectJournal` is pure and silent; `JournalPanel` is presentational. No new log lines were
added to `App`/`RoomViewer`. Journal title/entry text, ids, flag keys, item names/ids, status
strings, room display names, and narrative content are never logged — mirrors the
ADR-0013/0014/0015/0026/0028 content-free log discipline.

## 22. Usage guardrail ✅ v0 (browser)

The local request-count safety guardrail applies only when a real provider is selected
(`guardEnabled`). When the fake (default) provider is active the entire guard is inert; the
fake-provider experience is completely unchanged
([ADR-0030](./decisions/ADR-0030-cost-usage-guardrails-v0.md)).

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Fake provider selected | `guardEnabled === false` (module-level; `provider !== 'fake'` at startup) | guard fully inert: no count, no `UsageMeter`, no `PromptBar` disable, no gate | — |
| Real attempt counted | `handlePrompt`, before `getRoom()` resolves | incremented before the async call so `unavailable` / repaired / fallback outcomes all count; repair/fallback pipeline unchanged | `logger.info('usage attempt', { count, cap, status })` |
| Approaching cap (`count === cap − 1`) | `evaluate(state, config)` → `'approaching'` | `UsageMeter` shows approaching warning copy; no gate; PromptBar remains enabled | — |
| At cap (`count >= cap`) | `evaluate` → `'at-cap'`; `confirmGrantedRef.current === false` | prompt stored in `pendingPromptRef`; `handlePrompt` returns without firing a call; `UsageMeter` shows at-cap warning + "Generate anyway" confirm | — |
| User confirms "Generate anyway" | `handleGenerateAnyway`: sets `confirmGrantedRef`, replays pending prompt | one further real attempt proceeds and still increments; confirm flag cleared before the call | `logger.info('usage attempt', …)` for the replayed call |
| Double-click / second call in flight | `inFlightRef.current === true` at top of `handlePrompt` | early return; no second generation fired; independent of the cap | — |
| In-flight lock not cleared on error | `finally` block in `handlePrompt` | `inFlightRef ← false`, `setInFlight(false)` in all code paths when `guardEnabled` | — |
| Reset usage | `handleResetUsage` | `usageCountRef.current = 0`; `setUsageCount(0)`; clears `confirmGrantedRef` and `pendingPromptRef`; count resets in current App lifetime only | — |
| Page reload | browser navigation | all guardrail state is in-memory and lost; count resets to 0 | — |

- **No persistence.** Guardrail state lives only in `App` component memory. It is never written
  to `localStorage`, `SaveGame`, SQLite, or any backend; it does not affect `WorldState` or the
  event log; "session" here means App/page lifetime, not `WorldSession`.
- **Not billing truth.** The count is a local safety counter — not authoritative about actual
  provider calls, tokens, or cost.
- **Known limitations.** No cross-session quota; no hosted enforcement; resets on reload; no
  token-accurate cost; no estimated cost display; fake provider shows no meter.

---

## Summary

| # | Failure | Detection | Degrades to | Status |
| --- | --- | --- | --- | --- |
| 1 | Bad envelope | `parse` throws | safe "couldn't load" screen | 🔜 |
| 2 | Bad/unknown object | per-object `safeParse` | magenta placeholder | ✅ |
| 3 | WebGL unavailable/lost | capability check + event | fallback message | 🔜 |
| 4 | Invalid generated JSON | `assembleRoom`: parse/schema/semantic stages → typed result | repaired or trusted fallback room + static notice; generator-unavailable → retry | ✅ v0 |
| 4b | Valid spec, bad room | `validateRoom` (semantic) + deterministic `repairRoom` / fallback; 🔜 LLM reviewer | fatal → repair → render, else trusted fallback room | ✅ v0 |
| 4c | World Bible seeding | schema validation + composition catch | raw-prompt generator seed; no stored bible; normal room pipeline | ✅ non-blocking v0 |
| 4d | Real room provider | completeness check; fixed-code throw on network/timeout/empty/non-JSON | incomplete → fake (`config-disabled`); request failure → `unavailable` retry; malformed text → repaired/fallback | ✅ opt-in v0 (dev-only) |
| 4e | Generated room layout normalization | shell clamp (2.5); footprint-aware object bounds + count cap + wall-light nudge + placeholder clamp (2.6); spawn safe-area repair (2.8); exit wall-snap (2.9) — all pre-semantic | benign normalization keeps `provenance: generated` and shows no notice; authored/fallback rooms untouched | ✅ v0 |
| 4f | Generated room composition normalization | role classification + deterministic zones (2.7), after object legality and before spawn/exit finalizers | existing objects repositioned only; missing anchor/interactable accepted; `provenance: generated`, no notice; authored/static/fallback untouched | ✅ v0 |
| 5 | Backend/network | validated API requests + typed results | safe API envelope; browser retry state 🔜 | ✅ API edge v0 |
| 6 | DB / persistence failure | typed results (rooms, conflicts) + fail-fast throws (open/migration/corrupt session) | safe API error; no browser surface yet | ✅ API-backed v0 |
| 7 | Pre-gen not ready | one `resolveRoom` seam: cache hit / in-flight join / on-demand resolve (capped, depth-1 warming) | instant cached room, or safe on-demand resolve/generate; never a freeze | ✅ v0 (browser); status lifecycle 🔜 |
| 8 | Iso camera/player presentation | resize→frustum; player-position proximity; scene-graph disposal; cutaway curbs | stable framing, no occlusion or leak | ✅ |
| 9 | Concurrent world append | optimistic revision check | typed conflict; neither event nor snapshot committed | ✅ headless |
| 10 | Save integrity mismatch | validate log + seed + projected snapshot | reject whole save | ✅ headless |
| 11 | Unsupported save version | envelope version check | typed rejection; no silent migration | ✅ headless |
| 12 | Object interaction resolution | pure effect plan + sequential typed appends | no-op/rejection/conflict/partial result; safe panel message | ✅ |
| 13 | Encounter resolution | pure encounter plan + shared `applyCommands` typed appends | already-resolved/rejection/conflict/partial result; safe panel message; health clamps, no death state | ✅ |
| 14 | Multi-room navigation | cache/registry resolve before `WorldSession.move` | rejection/failure with no move, or cached room + persistent flags | ✅ |
| 15 | NPC dialogue resolution | read-only world context + provider reply | typed failure or component-only conversation; no event/state change | ✅ |
| 16 | NPC memory persistence | write firewall + scoped read firewall + FK/UNIQUE/no-update trigger; read-boundary re-validate + JSON-scope re-assert | rejected/failed/empty-recall typed results; corrupt or scope-divergent row skipped; no path to truth | ✅ headless |
| 17 | Room memory persistence | write firewall + scoped read firewall + FK/UNIQUE/no-update trigger (no FK to `rooms`); read-boundary re-validate + JSON-scope re-assert | rejected/failed/empty-recall typed results; corrupt or scope-divergent row skipped; no path to truth; `roomStates` unchanged | ✅ headless |
| 18 | Player HUD display | `playerHud === null` guards render; `projectPlayerHud` is pure/silent; `onWorldStateChange` fires only on `applied`/`already-resolved` variants carrying `state` | HUD absent until seeded; empty inventory/status degrade gracefully; health `0/max` renders empty bar; persists across navigation; no write path | ✅ browser |
| 19 | Browser session save/load | `SaveSlotStore` try/catch for `localStorage`; `loadSaveGame` integrity boundary; `restoreSession` typed results; `resolveRoom` total seam | corrupt/unsupported/mismatch → calm error, nothing restored; same session → calm notice; generated room → re-resolve + notice; unavailable/quota → calm error, play untouched | ✅ v0 browser |
| 20 | Quest tracker display | `quest === null` guards render; `evaluateQuest` is pure/total/silent; anchor-room gate; defensive optional chaining on all condition reads | absent/null → tracker hidden; missing room/flag/visited → objective `false`; navigation immediately re-projects Obj 3; all idempotent; no write path | ✅ browser |
| 21 | Consequence journal display | `journal === null` guards render; `projectJournal` is pure/total/silent via shared `evaluateCondition`; anchor-room gate; defensive optional chaining on all condition reads | absent/null → panel hidden; all conditions `false` → empty state "Nothing of consequence yet."; navigation re-projects safehouse entry immediately; all idempotent; no write path | ✅ browser |
| 22 | Usage guardrail | `guardEnabled` (provider !== `'fake'`); `evaluate(state, config)` derives status per render; `inFlightRef` lock; `confirmGrantedRef` + `pendingPromptRef` for at-cap gate | fake → fully inert; real → count/cap/status drive `UsageMeter`; `at-cap` gates prompt until confirm; in-flight lock prevents double-click; never persisted; reset in-memory only | ✅ browser |

The through-line: **validate at the boundary, degrade visibly and safely, log
the detail, show the user calm.**
