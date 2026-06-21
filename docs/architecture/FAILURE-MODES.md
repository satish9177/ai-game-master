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

## 4. Invalid LLM JSON / generated RoomSpec ❌ (future)

A future generator returns malformed JSON, a schema-invalid spec, a partial
spec, or hostile content.

- **Detection** — the generated spec flows through the **same** `loadRoomSpec`
  boundary. Bad JSON fails to parse; a bad envelope throws (case 1); bad objects
  are skipped (case 2). Hostile content is *still just data* — there is no code
  path to execution (see
  [ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **Handling** — retry with a corrective prompt (bounded attempts); if it still
  fails, surface a generation error and fall back to a known-good room. Never
  ship unvalidated model output to the renderer.
- **User-facing** — "Couldn't generate a room, try again" (or a fallback room),
  never raw model output or errors.
- **Logging** — model, latency, token counts, validation outcome, attempt count;
  **never** log full prompts/keys/PII.

## 4b. Valid RoomSpec but a bad room ❌ (future)

The spec is valid JSON and passes the schema, yet the room is **unplayable or
poor**. **Valid JSON does not mean a room is playable or good.** This is the gap
the generation pipeline closes; full design in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md).

- **Detection** — two checks *beyond* schema validation, kept distinct:
  - a **deterministic code validator** (**not** an LLM) for semantic
    playability — reachable exit, no NPC/object inside a wall, quest items
    actually placed, object/light counts within budget, spawn inside the room;
  - an **optional LLM reviewer** for creative/story quality — coherent,
    on-prompt, interesting; it returns a verdict, it does not edit the spec.
- **Handling** — by the severity of the problem:

  | Class | Examples | Handling |
  | --- | --- | --- |
  | **Object-level** (room still playable) | one NPC clipping a wall, an overlapping prop, a light over budget | skip / placeholder / log a warning, keep the room |
  | **Room-level** (not playable) | no reachable exit, spawn outside the room, quest item missing, impossible danger/encounter | repair or regenerate within the attempt budget |
  | **Prompt mismatch / too empty/boring** | output doesn't match the prompt; room is dull | reviewer rejects → repair/regenerate |
  | **Repeated failure** | still unacceptable after max attempts | safe fallback room / retry |

- **Retry/repair policy (v1)** — fast model first → one fast repair attempt →
  slow/better model fallback only if needed; **no infinite retries, max 3
  attempts**; target **10–30s** for the first room, **~60s** hard cap. After a
  hard failure: a **safe error with a retry button or a fallback demo room**.
- **User-facing** — a brief wait, then the room; on hard failure, a retryable
  error or a fallback room — never a broken or unplayable room.
- **Logging** — per-attempt validator/reviewer outcomes, which class failed,
  attempt count, model, latency; **never** full prompts/keys/PII.

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

---

## Summary

| # | Failure | Detection | Degrades to | Status |
| --- | --- | --- | --- | --- |
| 1 | Bad envelope | `parse` throws | safe "couldn't load" screen | 🔜 |
| 2 | Bad/unknown object | per-object `safeParse` | magenta placeholder | ✅ |
| 3 | WebGL unavailable/lost | capability check + event | fallback message | 🔜 |
| 4 | Invalid LLM JSON | same `loadRoomSpec` boundary | retry / fallback room | ❌ |
| 4b | Valid spec, bad room | code validator + LLM reviewer | repair → fallback room | ❌ |
| 5 | Backend/network | typed HTTP results | retry state | ❌ |
| 6 | DB failure | adapter → typed error | read-only / safe error | ❌ |
| 7 | Pre-gen not ready | room status at door | "Opening the way…" / fallback | ❌ |

The through-line: **validate at the boundary, degrade visibly and safely, log
the detail, show the user calm.**
