# Architecture Overview

> Entry point for the AI Game Master architecture docs.
> See also: [BOUNDARIES](./BOUNDARIES.md) · [CONVENTIONS](./CONVENTIONS.md) ·
> [FAILURE-MODES](./FAILURE-MODES.md) · [decisions/](./decisions/) ·
> [reviews/](./reviews/) (advisory review records, not ADRs).
> Contributor & coding-agent rules live in [/AGENTS.md](../../AGENTS.md).

## Purpose

This document describes how the project is structured, why the structure is
what it is, and where future features (AI generation, a backend, a database)
will plug in **without** corrupting the boundaries that already exist.

The guiding idea: this is built to become a real long-term product, not a demo.
Every layer has a single responsibility, dependencies point in one direction,
and the highest-value safety property — *the renderer only ever runs trusted,
hand-written code* — is preserved as the system grows.

## Status legend

Throughout these docs:

- ✅ **Implemented** — exists today in `apps/web` (Renderer Foundation v0;
  Generation Foundation v0; Semantic Room Validator v0; Room Generation Repair &
  Fallback v0; Generated Room Layout Contract v0, Generated Room Composition v0,
  Generated Room Visual Vocabulary v0, and Generated Room Story Anchors v0 —
  generated-room assembly pipeline,
  browser; World Bible Seed v0 —
  browser-only; Isometric Camera
  Foundation; World State & Event Log v0; Object
  Interactions v0; Encounter System v0; Multi-Room Navigation & Cache v0; NPC
  Dialogue Foundation v0; Adjacent-Room Pre-generation v0 — browser/session-cache;
  Backend SQLite Persistence v0 — headless, Node-only;
  Backend World Session API v0 — headless, Node-only;
  Real Room Generator Provider v0 — opt-in, browser-direct/dev-only BYOK;
  NPC Memory Persistence v0 — headless, Node-only, browser-unwired;
  Living-World Room Memory v0 — headless, Node-only, browser-unwired;
  Inventory & Health UI v0 — browser;
  Session Save/Load v0 — browser;
  Demo Quest Loop v0 — browser;
  Demo Quest Mechanical Reactivity v0 — browser composition/UI;
  Consequence Journal v0 — browser;
  Cost/Usage Guardrails v0 — browser;
  Room Inspect Summary v0 — browser;
  Generated Room Interaction Affordances v0 — browser;
  Generated Room Object Purpose v0 — generated assembly/domain;
  Generated Room Explore Loop v0 — generated assembly/domain + existing browser UI;
  Generated Room NPC Presence v0 — generated assembly/domain;
  Generated Room Exit Navigation v0 — generated assembly/domain + existing browser navigation;
  Generated Room Bidirectional Links v0 — browser/app composition + domain helper;
  Return Exit Visual Affordance v0 — domain + renderer presentation;
  Generated Room Display Sanitization v0 — generated assembly/domain;
  Adjacent Room Theme Continuity v0 — browser composition/domain projection;
  Generated Room Theme Vocabulary v0 — fake/generated assembly + browser composition;
  Generated Story Threading v0 — generated adjacent rooms only, closed-enum
  seed phrase + composition anchor bias;
  Generated Room Objective Target Enrichment v0 — generated assembly/domain;
  Real Generated Objective Provider v0 — generation + app composition;
  Generated Objective Per Room v0 — browser/app composition;
  Generated Room Consequence Journal v0 — browser/app composition + pure
  generated journal projector;
  NPC Dialogue Room Context v0 — browser/domain/dialogue;
  Real NPC Dialogue + Room-Memory Awareness v0 — opt-in real dialogue provider,
  browser/app composition + generation;
  Generated Room NPC Objective Awareness v1 — browser/domain/dialogue;
  Generated Story Objective Contract v0 — domain/quests/assembly + dialogue/UI;
  Multi-Call Usage Guardrails / Optional Objective Budget v0 — browser/session-local
  ([ADR-0050](./decisions/ADR-0050-multi-call-usage-guardrails-v0.md));
  Generated Room Bidirectional Links v0 — deterministic, data-only return exits for
  generated-play adjacent rooms
  ([ADR-0052](./decisions/ADR-0052-generated-room-bidirectional-links-v0.md));
  Generated Room Object State v0 - read-only generated-play presentation projection
  over existing `WorldState.roomStates[roomId].flags`
  ([ADR-0054](./decisions/ADR-0054-generated-room-object-state-v0.md));
  Generated Room Entry Intro Polish v0 - pure presentation-layer `introRoomNoun`
  normalization for room-entry intro text
  ([ADR-0055](./decisions/ADR-0055-generated-room-entry-intro-polish-v0.md));
  Return Exit Visual Affordance v0 — purple return arches plus pink return rings,
  with forward/authored exits unchanged
  ([ADR-0053](./decisions/ADR-0053-return-exit-visual-affordance-v0.md));
  Generated Quest Save/Load v0 — parked `GeneratedQuestSaveState` blob restores
  generated quest, room, story markers, and resolved-object state across
  Save/Continue/Load with no `SaveGame` schema change and no LLM call on load;
  missing or invalid blob degrades safely to authored-world fallback
  ([ADR-0059](./decisions/ADR-0059-generated-quest-save-load-v0.md));
  Generated Room Cache Save/Load v0 — optional `generatedRoomCacheJson` sidecar
  restores visited generated rooms for stable cached backtracking after load,
  gated by `generatedQuestJson`, with no `SaveGame` schema change and no provider
  or cost call on load/cached backtracking
  ([ADR-0060](./decisions/ADR-0060-generated-room-cache-save-load-v0.md));
  Runtime Room Memory Persistence v0 - optional `roomMemoryJson` sidecar restores
  browser runtime room memories after authoritative load, scoped to the restored
  `worldId/sessionId`, with no `SaveGame` schema change, no SQLite migration, no
  memory authority change, and no raw memory-text logging
  ([ADR-0070](./decisions/ADR-0070-runtime-room-memory-persistence-v0.md));
  Generated Mechanical Gate Contract v0 — pure domain contract in
  `domain/generatedMechanicalGate.ts` plus tests for a `locked-exit` gate whose state derives from
  existing `WorldState.roomStates[roomId].flags` via `evaluateCondition`; `room-flag` is the only
  condition kind and `unlock-exit` is a declarative governed-exit effect; satisfiability checks
  room id, a reachable flag-writing interaction, and a real exit target; no runtime enforcement,
  no generated-room insertion, no objective integration, and no provider/LLM/cost/schema/save-load/
  navigation/renderer/backend changes yet
  ([ADR-0061](./decisions/ADR-0061-generated-mechanical-gate-contract-v0.md)).
- ✅ **Implemented** — Generated Mechanical Gate Fake v0 —
  deterministic builder + off-by-default diagnostic only. A pure
  `buildGeneratedMechanicalGate(room)` derives a contract-valid, satisfiable `locked-exit` gate
  from a generated room's existing inspectable flag-writer (`enrichObjectiveTarget`) and ensured
  exit (`ensureGeneratedExitNavigation`), gated behind
  `AssembleRoomOptions.deriveMechanicalGateDiagnostic`
  (default `false`; `true` only in `buildPromptGeneratedRoomSource`) and surfaced as the boolean
  `mechanicalGateAvailable` diagnostic only; the room is returned unchanged and the gate is never
  stored, persisted, or enforced — no room mutation, no schema/save-load/navigation/renderer/
  provider/cost change
  ([ADR-0062](./decisions/ADR-0062-generated-mechanical-gate-fake-v0.md)).
- ✅ **Implemented** — Generated Mechanical Gate Runtime v0 — deterministic runtime enforcement at
  the existing `navigateWithExitGate` seam, generated rooms only (`objectivesPerRoom === true`).
  `evaluateGeneratedExitGate` re-derives the gate from the in-memory `activePlay.room` on each
  navigation attempt, evaluates it against a freshly fetched `WorldState`, and returns
  `reason:'gate-locked'` only when a valid/satisfiable gate governs the attempted exit and the
  unlock flag is absent/false; all other cases (fail, null gate, different exit, flag set) navigate
  normally. Save/load stores no gate data: restored generated rooms re-derive the gate from the
  restored `LoadedRoom`, and lock state comes from restored `WorldState` flags. Authored/demo gate
  path is byte-identical. No schema, persistence, renderer, or provider/cost change
  ([ADR-0063](./decisions/ADR-0063-generated-mechanical-gate-runtime-v0.md)).
- ✅ **Implemented** — Generated Mechanical Gate Provider v0 — real provider may propose only
  structural generated-gate data; the proposal is transient sidecar state. The app derives the full
  `GeneratedMechanicalGate`, then the frozen gate contract plus satisfiability check remain the trust
  boundary. `providerGateStatus` is transient only: rejected/unsafe provider gates fail open and do
  not fall back to the deterministic gate, while disabled/not-attempted preserves ADR-0063
  deterministic behavior. No `RoomSpec`/`SaveGame`/`WorldState`/`QuestSpec`, backend, renderer, or
  persistence schema change
  ([ADR-0064](./decisions/ADR-0064-generated-mechanical-gate-provider-v0.md)).
- ✅ **Implemented** — Generated NPC Dialogue Seed Variety v0 — the single NPC
  `ensureGeneratedNpcPresence` inserts into a prompt-generated room now varies its name, persona,
  greeting, body line, and starter-prompt labels deterministically by `room.id` hash and the
  existing `themePack`/story-anchor-type signals, instead of always inserting the fixed
  `'Mira'` / `'generated-room-guide'` template. Prompt ids stay `ask-room`/`ask-help`; no
  provider/LLM call, no schema, memory, or persistence change
  ([ADR-0066](./decisions/ADR-0066-generated-npc-dialogue-seed-variety-v0.md)).
- ✅ **Implemented** — Real NPC Dialogue + Room-Memory Awareness v0 — an
  `OpenAICompatibleNPCDialogueProvider` now exists behind the unchanged
  `NPCDialogueProvider` port, selected only by `selectDialogueProvider` when the
  existing dev-only/BYOK `LlmConfig` is complete. The deterministic
  `FakeNPCDialogueProvider` remains the default. Real prompts include recalled
  room memory as bounded, hedged, non-authoritative BACKGROUND context only;
  SQLite/current state plus the `WorldEvent` log remain authoritative, dialogue
  output is text-only display data, and no memory/schema/migration path changed
  ([ADR-0065](./decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md)).
- ✅ **Implemented** — Generated NPC Dialogue Spec v0 — a new sibling normalizer,
  `ensureGeneratedNpcDialogue`, runs unconditionally in `assembleRoom` Stage 2.12.2 and
  assigns a collision-safe `id` and/or a deterministic closed-table `interaction.dialogue`
  to any generated-room NPC missing either, so generated NPCs open `NPCDialoguePanel`
  (greeting + two prompt buttons) instead of falling through to the plain `DialoguePanel`.
  Prompt ids stay `ask-room`/`ask-help`; count-only diagnostic `npcDialogueNormalizedCount`;
  no provider/LLM call, no schema, memory, or persistence change
  ([ADR-0067](./decisions/ADR-0067-generated-npc-dialogue-spec-v0.md)).
- ✅ **Implemented** — Dialogue Usage Guardrails v0 — opening an NPC dialogue now
  shows only the static greeting and makes no provider call; the surviving
  user-triggered calls (prompt buttons, Continue) route through an `App`-owned
  `requestDialogueAttempt` gate. Fake-provider dialogue stays zero-cost and
  uncounted; real-provider dialogue shares the existing session usage
  meter/cap from ADR-0030/ADR-0050 and records usage before the provider call;
  at cap the provider is not called and a calm in-panel `DIALOGUE_AT_CAP_MESSAGE`
  shows instead. No `NPCDialogueService`/provider, schema, save-load,
  persistence, memory, or `WorldState` change
  ([ADR-0068](./decisions/ADR-0068-dialogue-usage-guardrails-v0.md)).
- ✅ **Implemented** — NPC Dialogue Free Text Input v0 — `NPCDialoguePanel` now
  supports one bounded single-line player utterance through the same guarded
  dialogue path as prompt buttons and Continue. Prompt buttons split structural
  routing (`promptId`) from player-facing text (`playerLine`), and service
  history contains previous turns only so real prompts do not duplicate the
  current player line. Free text is normalized by `normalizePlayerFreeText`
  (trim, control chars to spaces, whitespace collapse, clamp to 240, trim,
  empty -> `null`); empty sends do not consume usage. Dialogue remains
  non-authoritative display text only: no memory write, `WorldState` mutation,
  persistence, schema, renderer-engine, generated-room, App gating, or provider
  selection change
  ([ADR-0069](./decisions/ADR-0069-npc-dialogue-free-text-input-v0.md)).
- ❌ **Not built** — future shape only; documented so we don't paint into a corner.

## Status today (Renderer Foundation v0)

A single Vite application at `apps/web`:

- **React 19 + TypeScript + Vite** — application shell and UI overlay.
- **Vanilla Three.js 0.184** (not react-three-fiber) — the rendering engine.
- **zod 4** — RoomSpec validation at the data boundary.
- **Node/TypeScript API + SQLite persistence** — headless, browser-excluded
  server build units under `src/server/**` and `src/persistence/**`.
- **No browser API client, and the real LLM is opt-in / dev-only.** Browser
  gameplay still uses the in-memory world/session and room/cache adapters. A real
  OpenAI-compatible room generator now exists behind the unchanged `RoomGenerator`
  port, but it is **off by default** — selected only with a complete dev-only/BYOK
  config — and affects the PromptBar-generated room path alone (Real Room Generator
  Provider v0, [ADR-0023](./decisions/ADR-0023-real-room-generator-provider-v0.md)).
- **World Bible Seed v0** deterministically derives validated, bounded initial
  canon for PromptBar-generated rooms; it has no backend persistence or UI.

It proves one thing: a hardcoded **RoomSpec** (pure data) can be turned into a
walkable low-poly 3D room rendered entirely by **trusted Three.js code**, with
no arbitrary code execution anywhere in the pipeline.

## Generation Foundation v0

✅ **Implemented.** The first generation seam now runs end-to-end **without a
real LLM**: a user prompt becomes a validated room through a deterministic,
*fake* generator.

```
User prompt
  → PromptBar              (app composition chrome — not renderer UI)
  → App composition root
  → FakeWorldBibleSeeder   (behind WorldBibleSeeder; deterministic, validated)
  → WorldBibleSeed         (bounded initial canon, not current truth)
  → worldBibleToGeneratorSeed (title-first compact seed, ≤160 chars)
  → FakeRoomGenerator      (behind RoomGenerator; seeded by the projection)
  → raw, untrusted JSON text
  → GeneratedRoomSource
  → assembleRoom           (parse → generated normalizers → schema → semantic → repair → fallback)
  → RoomLoadResult         (valid generated/repaired/fallback room or unavailable)
  → existing trusted Three.js renderer
```

What it proves — and what it deliberately is **not**:

- **Deterministic fake only.** `FakeRoomGenerator` is pure: seed string → seeded
  PRNG → RoomSpec data. The same seed yields a byte-identical room. This generation
  path uses **no real LLM, API key, network call, database, or memory**.
- **Deterministic initial canon.** `FakeWorldBibleSeeder` implements the
  `WorldBibleSeeder` port, validates through `WorldBibleSeedSchema`, and projects
  title/theme/tone/opening context/premise/keywords to a stable ≤160-character
  generator seed. The bible is held only on generated `ActivePlay`; event-sourced
  `WorldState` remains authoritative ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).
- **The generator returns raw, untrusted JSON *text*** — the exact shape a future
  LLM completion would have. It emits **data, never code** ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **`GeneratedRoomSource` owns safe assembly.** It routes raw text through
  `assembleRoom` (`JSON.parse` → generated alias repair → generated optional
  transform repair → `loadRoomSpec` → generated-room normalization →
  `validateRoom` → deterministic repair → fallback). Bad content still yields a
  valid room; only a generator
  throw/reject is `unavailable`. The renderer executes only trusted, hand-written
  builders.
- **Semantic validation (`validateRoom`) is the new playability boundary.** A pure
  domain function checks an already-loaded room for *playability* — sane
  dimensions, spawn inside the walkable bounds, object/light budgets, usable
  interactions. A **fatal** issue folds into the existing `invalid-room` outcome so
  an unplayable room never renders; **warnings** are logged as counts and the room
  still loads. `loadRoomSpec` answers *well-formed?*; `validateRoom` answers
  *playable?* ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)).
- **Logging is length-only.** The prompt *text* is never logged — only its length
  and safe result counts/codes ([ADR-0003](./decisions/ADR-0003-logging-abstraction.md)).
- **Tested.** Vitest covers the seeded PRNG, the fake generator (determinism,
  known-vocabulary-only, passes `loadRoomSpec`, data-only round-trip), and the
  `GeneratedRoomSource` failure paths (bad JSON, bad envelope, generator throws,
  lenient object-skip).

The deterministic validator, one-pass repair/fallback, adjacent-room browser
warming, and World Bible seed now ship. The **real LLM**, deeper
reachability/collision checks, LLM reviewer, and bounded multi-attempt
repair/re-prompt loop remain **planned / not built** — see
[Generation pipeline](#generation-pipeline-planned),
[ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md), and
[ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md).

## World Bible Seed v0

✅ **Implemented, deterministic and browser-local.** The PromptBar-generated-room
path now derives a compact, validated `WorldBibleSeed` before calling the existing
room generator ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).

- **Pure domain contract.** `domain/worldBible/` owns the strict bounded schema
  and the pure `worldBibleToGeneratorSeed` projection; `WorldBibleSeeder` is a
  domain port.
- **Deterministic fake.** `FakeWorldBibleSeeder` uses the seeded PRNG, maps only
  `fantasy-keep` / `post-apoc`, validates internally, and performs no network,
  database, clock, global-randomness, or logger work. No real LLM is present.
- **Prompt path only.** `App.handlePrompt` stores the bible on the fresh generated
  play and sends its ≤160-character title-first projection to `FakeRoomGenerator`.
  Authored bootstrap and `AdjacentRoomPregenerator` do not use the bible.
- **Initial canon, not current truth.** The bible is not an event, `WorldState`,
  `CanonSeed`, save-game field, API payload, or SQLite row. `WorldSession` and its
  event-log projection remain authoritative; no UI displays the bible.
- **Non-blocking.** Seeding failure restores the previous raw-prompt generator
  seed and stores no bible. Logs contain only safe enums/counts/lengths or a fixed
  failure code—never prompt, bible, seed, generated JSON, or error text.

## Real Room Generator Provider v0

✅ **Implemented, opt-in and browser-direct (dev-only / BYOK).** The first
**real, network-backed** `RoomGenerator` now exists behind the unchanged port: a
single generic `OpenAICompatibleRoomGenerator` that calls any OpenAI-compatible
chat-completions endpoint (OpenAI or DeepSeek). It is **off by default** and
preserves every safety boundary
([ADR-0023](./decisions/ADR-0023-real-room-generator-provider-v0.md)).

- **One generic adapter for OpenAI + DeepSeek.** They differ only by base URL +
  key + model, all injected — no per-provider subclass, **no SDK dependency**. It
  makes **one** non-streaming `POST {baseUrl}/chat/completions` (raw `fetch` over an
  injected transport seam) with a hard `AbortController` timeout and **no retry**,
  and returns `choices[0].message.content` **verbatim** as `Promise<string>`.
- **Raw text only — the trust boundary does not move.** The provider does **no**
  parsing, validation, repair, fence-stripping, or structured output. Its string is
  raw and untrusted exactly like the fake's, and flows through the unchanged
  `GeneratedRoomSource → assembleRoom → loadRoomSpec/validateRoom → repairRoom →
  fallbackRoom`. Hostile/malformed output is just data that repairs or falls back.
- **Fake remains default; real is completeness-gated.** `app/llmConfig.ts` is the
  only browser module that reads `import.meta.env`; `app/selectRoomGenerator.ts`
  picks the real generator **only** when `provider ∈ {openai, deepseek}` **and** the
  matching key **and** the model are all non-empty. Any incomplete config →
  `FakeRoomGenerator` with the fixed reason `config-disabled`. Gameplay is never
  blocked by the provider's absence.
- **Prompt path only; adjacent stays fake.** `App` uses the selected generator for
  the PromptBar-generated `GeneratedRoomSource` alone; `AdjacentRoomPregenerator`
  keeps a separate `FakeRoomGenerator`, so background warming makes no network calls
  and never spends.
- **Fixed safe error codes + safe selection log.** On any failure the provider
  throws a fixed-shape `Error` whose message is one of `llm-request-failed` /
  `llm-timeout` / `llm-empty-response` — never the key, prompt/seed, request/response
  body, model output, or raw error. `GeneratedRoomSource` maps a throw/reject to the
  existing `unavailable` retry path, and its `err.message`-only log line stays safe
  with **no change**. The composition root logs only
  `{ provider, model, maxTokens, timeoutMs }` (real) or
  `{ provider:'fake', reason:'config-disabled' }`.
- **Dev-only / BYOK caveat.** Vite inlines `VITE_*` keys into the built bundle, so
  v0 is local-dev only: real keys live in a gitignored `.env.local`, used with
  `npm run dev`; never deploy a bundle compiled with a real key. **Hosted production
  must move the provider server-side later.**
- **Unchanged / future.** The `RoomGenerator`/`RoomSource` ports,
  `FakeRoomGenerator`, the assembly/repair/fallback pipeline, the renderer/engine,
  world-session, and the Node API are untouched. Anthropic (non-OpenAI-compatible),
  a multi-provider router, a cross-provider fallback chain, a cost optimizer, a
  retry loop, streaming, a backend generation endpoint, the `max_completion_tokens`
  field mapping, and server-side hosting remain **future**.

## Room Generation Repair & Fallback v0

✅ **Implemented.** The **deterministic** remainder of the
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md) pipeline
now ships: a bad generated room is no longer just rejected to an error screen — it
is **repaired** when salvageable or replaced by a **trusted fallback room**, so the
renderer always receives a valid, playable room
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)).

- **A pure domain pipeline `assembleRoom(rawText, fallbackRoom)`** composes the
  existing boundaries in order — `JSON.parse` → `loadRoomSpec` → `validateRoom` →
  `repairRoom` → re-`validateRoom` → fallback — and **always returns a valid,
  zero-fatal `LoadedRoom`** plus safe diagnostics. It is synchronous, does no I/O,
  imports no logger/React/Three.js/DB, and never logs (problems are returned as
  data, like `loadRoomSpec`/`validateRoom`).
- **Deterministic repair only (`repairRoom`).** A pure, non-mutating function that
  only *removes or clamps*, never invents content: clamp `spawn` into the walkable
  AABB (the same margin `validateRoom` uses), truncate objects to the hard object
  budget, and drop torches beyond the hard light budget. It **does not resize
  rooms** — `room-too-small` / `room-too-large` stay unrepairable and route to the
  fallback. Repair is **one pass**, then re-validate; no loop, no attempt budget.
- **An authored fallback room (`domain/examples/fallbackRoom.ts`).** A trusted,
  data-only literal — a small stone antechamber with a centered in-bounds spawn —
  authored to raise zero fatal and zero warning semantic issues, with no prompt or
  story text. The host validates it once and injects it.
- **Provenance + a static notice.** `GeneratedRoomSource` runs the generator, then
  `assembleRoom`, and returns `provenance` (`generated` | `repaired` | `fallback`)
  on an **`ok:true`** result — all three are valid rooms. Only a generator
  **throw/reject** stays `ok:false` `unavailable` (the retry path); bad *content*
  never becomes `unavailable`. `App` injects the fallback and shows a small
  **dismissable, static, prompt-free** notice for `repaired`/`fallback`, nothing
  for `generated`.
- **Safe diagnostics/logging only** — provenance, the failed stage, fixed
  `RoomIssueCode` values, counts, and booleans; never prompt text, raw JSON, story
  text, object names, or free-form parse/schema errors.
- **Unchanged:** the renderer/engine/builders, the schema and semantic boundaries,
  the `RoomSource` port (gains only an optional success-result `provenance`), the
  deterministic fake (every `FakeRoomGenerator` room is still `generated`), and the
  Node API. A **real** LLM repair/re-prompt, an LLM reviewer, a bounded
  multi-attempt loop, adjacent-room pre-generation, and a backend generation
  endpoint remain **future**.

## Generated Room Layout Contract v0

✅ **Implemented.** Real LLM providers (e.g., DeepSeek) produce valid `RoomSpec`
JSON that passes schema and semantic validation, yet the rooms are still
**spatially broken in practice**: floors too small or too large to navigate, objects
placed outside the room boundary, too many objects, spawn positions crowded by a
pillar or NPC, and exit arches floating in open floor space instead of at walls.
The **layout contract** normalizes all of these as **benign pre-semantic steps** in
`assembleRoom` so the renderer always receives a spatially sane room and the
generated-room pipeline never triggers a repair/fallback notice for a purely
geometric mismatch
([ADR-0031](./decisions/ADR-0031-generated-room-layout-contract-v0.md)).

- **Generated-room size envelope:** default **18 × 18 m**, min/max **14 × 24 m**.
  Floor width and depth are clamped individually; height is unconstrained.
  Authored, static, and fallback rooms are **never** subject to this envelope.
- **Four benign layout normalizers** (`domain/generatedRoomLayout.ts`) run around
  composition in `assembleRoom`, before semantic validation at stage 3:
  - **Shell clamp** (`clampGeneratedShell`): width/depth → `[14..24]`.
  - **Object bounds + count cap** (`repairGeneratedObjects`): each object
    positioned so its full **footprint** (rotation-invariant radius per object
    type, scaled and padded) stays inside the walkable floor; decorative objects
    whose footprint cannot fit are dropped. Total capped at **30 objects** (drops
    decorative first, then structural; never critical — NPC, scroll, interactive
    arch, interactive crate/barrel/debris/barricade/zombie). Wall-light objects
    such as torches generated in the floor interior are nudged toward a wall/side
    position. Skipped/malformed mystery-marker anchors are also clamped inside the
    room bounds.
  - **Spawn safe-area repair** (`repairGeneratedSpawn`, stage 2.8): spawn X/Z clamped into
    the playable floor area, then nudged away from any spawn-blocking object via
    a small deterministic candidate set (origin, ±step in four cardinal
    directions); falls back to the clamped position if all candidates are crowded.
  - **Exit placement repair** (`repairGeneratedExits`, stage 2.9): each exit-carrying object
    snapped to the nearest wall face (north/south/east/west; ties broken north >
    south > east > west). Y is preserved.
- **Provenance stays `generated`.** All four stages are benign: they run on every
  generated room, report via four safe boolean diagnostics (`sizeRepaired`,
  `objectsRepaired`, `spawnRepaired`, `exitsRepaired`), and the host shows **no
  notice** for a normalized-only room. Only `repairRoom` (stage 4) yields
  `repaired`; only a pipeline failure yields `fallback`.
- **Safe diagnostics only.** The four boolean flags are the only new log surface.
  They never carry raw generated JSON, prompt text, provider body, room names,
  object text, or API keys.
- **Scope boundary.** Normalization runs only inside `assembleRoom` for generated
  rooms. `validateRoom`, `repairRoom`, the fallback room, `GeneratedRoomSource`,
  and the renderer are unchanged. No backend, provider, memory, gameplay, or
  persistence change.
- **Known follow-up.** Object-bounds repair (stage 2.6) clamps exit-carrying
  objects inward before exit repair (stage 2.9) snaps them back to a wall. This
  can cause both `objectsRepaired` and `exitsRepaired` to be true for an arch that
  only needed wall-snapping, or a small nearest-wall drift near corners. Both
  effects are harmless; a future cleanup can make stage 2.6 skip exit-carrying
  objects.

## Generated Room Composition v0

✅ **Implemented.** The layout contract made generated rooms safe, but valid rooms
could still read as random prop clusters. A pure deterministic composition pass
now arranges existing generated-room objects into readable zones before spawn and
exit finalization
([ADR-0032](./decisions/ADR-0032-generated-room-composition-v0.md)).

- **Pipeline position:** `clampGeneratedShell` → `repairGeneratedObjects` →
  `composeGeneratedRoom` → `repairGeneratedSpawn` → `repairGeneratedExits` →
  `validateRoom`. Composition runs after object legality repair and before the
  spawn/exit finalizers get the final safety say.
- **Existing objects only:** the pass clears eligible clutter from the central
  corridor, places the selected story anchor in the north-center focal zone when
  present, moves NPCs off-path, makes interactables more readable, and pushes
  eligible decorative/structural-looking clutter toward side zones. The anchor
  selector is pure and deterministic, uses validated `RoomObject.type` only, and
  keeps the original authority/ritual priority (`throne` > `altar` > `statue`)
  before broader narrative candidates. It preserves object count and every
  non-position field.
- **No content invention or quality fallback:** it never creates NPCs, anchors,
  clues, chests, lights, resources, interactions, or quest objects. Missing anchor
  or interactable roles do not trigger repair or fallback.
- **Provenance stays `generated`:** composition-only relocation sets no
  `failedStage` and shows no repaired/fallback notice. Existing `repaired` and
  `fallback` notice behavior is unchanged.
- **Safe diagnostics only:** `composed`, `lacksAnchor`, and `lacksInteractable`
  are fixed booleans. They never contain prompt/provider content, generated JSON,
  room/object text, API keys, or PII.
- **Scope boundary:** authored/static/fallback rooms are untouched. There are no
  prompt, provider, renderer, backend, API, persistence, memory, world-session, or
  gameplay changes.

## Generated Room Visual Vocabulary v0

✅ **Implemented.** Layout and composition made generated rooms spatially safe and
arranged, but many generated objects still looked like placeholders or repeated
mystery markers. Visual Vocabulary v0 expands the safe RoomSpec vocabulary and
trusted renderer builders so generated rooms read as intentional, recognizable
spaces
([ADR-0033](./decisions/ADR-0033-generated-room-visual-vocabulary-v0.md)).

- **First-class visual vocabulary:** generated rooms can now validate and render
  `book`, `paper`, `map`, `chest`, `corpse`, `table`, `altar`, `statue`,
  `machine`, `artifact`, and `candle` in addition to the existing room object
  types. `schemaVersion` remains **1** because the change is additive to the
  generated object vocabulary.
- **Trusted procedural builders only:** every current `RoomObject["type"]` has a
  registered renderer builder. The new builders are hand-written Three.js
  primitives/materials; there are no external assets, textures, GLTF imports,
  shaders, fonts, labels, new dependencies, or LLM-generated renderer code.
- **Mystery marker fallback:** skipped/unknown/malformed objects still remain in
  `LoadedRoom.skipped`, are non-interactive, and render as a bounded mystery
  marker instead of the old neon/magenta placeholder cube. The marker never
  displays raw skipped type/name/id text and never promotes skipped data into a
  valid object.
- **Generated-room-only pre-validation normalizers:** before `loadRoomSpec`,
  generated rooms get two benign normalizers: allowlisted type-only alias repair
  (for common natural nouns such as desk/skeleton/floor plan/generator) and
  optional transform repair (malformed optional `scale`/`rotationY` removed so
  schema defaults apply). Required fields such as `position` and `interaction`
  are not repaired; strict `loadRoomSpec` behavior remains authoritative.
- **Provider and fake coverage:** the fake generator deterministically exercises a
  small sample of the expanded vocabulary, while the real provider prompt now
  advertises the full safe allowlist and synonym guidance. The prompt remains
  data-only JSON and does not expose builder names or renderer instructions.
- **Provenance and notices:** benign vocabulary, alias, and optional-transform
  normalization keeps `provenance: generated`, sets no repaired/fallback notice,
  and does not change gameplay semantics. Only the existing repair/fallback paths
  produce `repaired` or `fallback`.
- **Safe diagnostics only:** `aliasesRepaired`, `objectTransformsRepaired`, and
  `skippedObjectReasonCounts` are count/boolean-only surfaces. Logs never include
  raw prompts, provider bodies, generated JSON, raw skipped objects, room/object
  names, API keys, or content-bearing text.
- **Known limitation:** real providers can still produce a small number of
  skipped objects, especially malformed `interaction` fields. Interaction repair
  is intentionally deferred because it is gameplay/content-bearing.

## Generated Room Story Anchors v0

✅ **Implemented.** Layout, composition, and visual vocabulary made generated
rooms safe, arranged, and recognizable, but they could still feel purposeless.
Story Anchors v0 is a foundation feature that nudges generated rooms toward one
clear narrative focal idea without adding gameplay systems
([ADR-0034](./decisions/ADR-0034-generated-room-story-anchors-v0.md)).

- **Existing RoomSpec data only:** the feature uses room name, existing objects,
  and an optional existing `interaction.body` on the selected anchor. There is no
  `roomIntent`, `storyRole`, `anchorKind`, or other schema field; `schemaVersion`
  remains **1**.
- **Prompt guidance:** the real room prompt asks for one dominant story anchor
  when appropriate, a room name that reflects the anchor/event/purpose, and
  secondary objects that support the main anchor rather than compete with it. An
  anchor interaction is optional; if present, `interaction.body` should be short
  flavor text explaining what happened or why the object matters.
- **Deterministic selector:** `composeGeneratedRoom` derives the single story
  anchor from validated `RoomObject.type` only. It never reads object names,
  prompts, `interaction.body`, raw generated JSON, provider text, or inferred
  purpose. The priority is `throne` > `altar` > `statue` > `corpse` >
  `machine`/`artifact` > `chest` > `table`/`map`/`book`/`paper`, with lowest
  object index as the tie-breaker within a tier.
- **Composition behavior:** the selected anchor uses the existing north-center
  focal placement. Extra candidate objects remain secondary support objects and
  do not become additional focal anchors.
- **Benign absence:** missing anchors are allowed. They set the existing
  `lacksAnchor` diagnostic but do not trigger repair, fallback, a user notice, or
  any new diagnostic.
- **No gameplay semantics:** anchors do not create quests, objectives, clues,
  rewards, inventory, loot, combat, story state, living-world simulation, memory,
  or NPC dialogue context. Visible story presentation is intentionally deferred to
  a later `room-inspect-summary-v0` feature.

## Generated Room Theme Vocabulary v0

âœ… **Implemented, fake/generated assembly + browser composition.** Generated Room
Theme Vocabulary v0 uses the existing structured World Bible `themePack` to keep
fake prompt-generated rooms and their generated adjacent rooms within the current
theme vocabulary
([ADR-0044](./decisions/ADR-0044-generated-room-theme-vocabulary-v0.md)).

```text
WorldBible themePack
  -> themeVocabulary(themePack)
  -> FakeRoomGenerator(vocabulary)
  -> generated JSON
  -> assembleRoom(..., { themePack })
  -> theme-aware composition
  -> trusted renderer
```

- **Existing theme packs only:** v0 supports `fantasy-keep` and `post-apoc`.
  Sci-fi/spaceship is deferred because the current theme schema has no sci-fi
  pack; prompts for those concepts still classify into the existing packs until a
  later theme-pack/classifier/content-pack feature.
- **Constructor DI for the fake:** `FakeRoomGenerator` consumes
  `GeneratedRoomThemeVocabulary` by constructor injection. Missing vocabulary
  falls back to the existing/default fantasy behavior, so existing callers keep
  working.
- **Primary + adjacent consistency:** `App` resolves vocabulary from
  `prepared.worldBible?.themePack` for prompt-generated fake rooms and injects the
  same vocabulary into that generated play's adjacent fake generator. The authored
  example pregenerator remains default.
- **Theme-aware composition:** `assembleRoom` passes optional structured
  `themePack` to `composeGeneratedRoom`. `post-apoc` prioritizes `machine` and
  `corpse` as story anchors; missing theme and `fantasy-keep` preserve the
  existing `throne`/`altar`/`statue` priority.
- **Safety boundaries unchanged:** no `RoomSpec` schema change, renderer/builder
  change, assets/GLTF/textures, real-provider prompt theming, backend, memory,
  quest, inventory, or combat change. Diagnostics remain count/boolean/provenance
  only and never log raw prompt, seed strings, room/object names, generated JSON,
  provider output, or interaction body/title text.

## Generated Story Threading v0

✅ **Implemented, generated adjacent rooms only.** Generated Story Threading v0
uses the closed `WorldBibleSeed.openingArc.pattern` enum plus structural
adjacent-room depth to make fake adjacent rooms feel connected without adding
quest state, memory, backend persistence, or provider work
([ADR-0057](./decisions/ADR-0057-generated-story-threading-v0.md)).

- **Pure domain contract:** `domain/generatedStoryThread.ts` derives a transient
  `GeneratedStoryRoomContext` from only the closed story kind and structural
  `roomId` depth. Depth 1 is `threshold`, depths 2-3 are `developing`, and depth
  4+ is `deeper`; pressure is derived from that role only.
- **Adjacent seed guidance:** generated-play adjacent seeds may include one
  bounded, hand-written phrase from a fixed table, ordered after the existing
  theme seed and before `adjacent:${roomId}`. Missing World Bible or missing
  pattern degrades to the previous seed exactly.
- **Composition anchor bias:** adjacent generated-room assembly passes the
  closed story kind into `composeGeneratedRoom`, which uses fixed priority
  tables to prefer fitting existing anchor object types. `escape` intentionally
  falls back to the theme/default anchor priority because escape pressure is
  expressed through exits and seed variety, not a special focal prop.
- **Generation guidance only:** story threading is not quest state, objective
  state, world truth, NPC knowledge, memory, save data, or a RoomSpec field. It
  never creates, completes, targets, or mutates objectives, flags, objects,
  dialogue, memory, or world/session state.
- **Safety boundaries unchanged:** no raw prompt, WorldBible free-text arc
  fields (`hook`, `firstObjective`, `pressure`, `premise`, `title`,
  `majorConflict`, `canonNotes`), generated descriptions, provider output,
  object ids, flag text, objective JSON, or RoomSpec schema change. There is no
  new LLM call and no new logging surface for story kind, role, pressure, or
  phrase text.
- **Scope boundary:** only generated adjacent rooms in prompt-generated play use
  the thread context. Authored rooms, demo rooms, fallback rooms, restored rooms,
  and the first prompt-generated room remain unchanged.

## Generated Room Consequence Journal v0

✅ **Implemented, browser/app composition + pure domain projector.** Generated
Room Consequence Journal v0 gives prompt-generated sessions a read-only journal
surface using the existing `JournalView` and unchanged `JournalPanel`
([ADR-0058](./decisions/ADR-0058-generated-room-consequence-journal-v0.md)).

- **Pure projector:** `domain/journal/generatedConsequenceJournal.ts` derives a
  `JournalView` from only `WorldState`, the current validated `LoadedRoom`,
  `QuestView.status`, and optional closed `GeneratedStoryRoomContext`.
- **Existing render path:** generated play passes a generated journal input
  through `computeDerivedViews`; the existing `{journal && <JournalPanel />}`
  render path displays it. No new UI component was added.
- **Mutual exclusion:** authored sessions still use `demoJournalSpec` +
  `projectJournal`; generated sessions use the generated projector. The two
  journal sources are not combined.
- **Read-only, not truth:** the generated journal is derived UI only. It stores
  no journal state, appends no events, emits no commands, mutates no
  objective/object-state/NPC/world/memory data, and writes nothing to backend,
  persistence, save-game, or schemas.
- **Safe content:** journal text comes only from closed hand-written templates
  and safe counts. The projector does not read or output raw prompt, generated
  descriptions, provider output, room or object names, `QuestView` title or
  objective text, raw objective JSON, object ids, objective ids, flag text, or
  WorldBible free text.
- **No cost impact:** no new LLM, provider, network, or I/O call.

## Generated Quest Save/Load v0

✅ **Implemented, browser/app composition + domain restore-model aid.** Generated
Quest Save/Load v0 closes the gap recorded in ADR-0058: generated quest state
(`questSpec`, `storyKind`, `objectivesPerRoom`, `hints`) and the current generated
room survive a Save/Continue/Load cycle without changing the authoritative `SaveGame`
schema or calling any LLM or generator on load
([ADR-0059](./decisions/ADR-0059-generated-quest-save-load-v0.md)).

- **Parked restore-model blob.** `buildGeneratedQuestSaveState` projects the
  live generated `ActivePlay` fields into a `GeneratedQuestSaveState`
  (`schemaVersion 1`) and parks it as `generatedQuestJson` alongside `saveGameJson`
  in the existing `SlotWrapper`. The `SaveGame` schema, `SaveGameService`, and the
  integrity check are **unchanged**. Authored saves never write the field; their
  wrapper is byte-identical to today.
- **Load path.** On Continue/Load, after the authoritative `WorldState` is restored
  from the event log, `loadGeneratedQuestSaveState` re-validates the blob. If valid,
  `restoreGeneratedQuestPlay` calls `loadRoomSpec` (not `assembleRoom`, not any
  generator) to re-validate the parked room, recomputes `resolvedObjectIds` from the
  restored `WorldState` flags, and returns the `ActivePlay` fields for generated play.
  The restored room's object ids match the surviving flags so interaction rings
  correctly reflect pre-save state.
- **Safe degradation.** Missing or invalid `generatedQuestJson` → authored-world
  fallback exactly as before. No error is surfaced; a `degraded` notice is shown for
  non-authored loads (same as today). Older saves, authored saves, and
  schema-mismatched blobs all degrade silently.
- **Authority invariants.** The parked blob is never truth. `WorldSession`, the
  event log, and the projected `WorldState` remain authoritative. `evaluateQuest`
  and `resolvedObjectIds` semantics are unchanged; the parked room only supplies the
  correct object ids that match the already-correct flags. No `WorldEvent`,
  `WorldCommand`, NPC memory, room memory, or cost meter is touched on load.
- **No schema change.** `SaveGame`, `WorldState`, `RoomSpec`, and `QuestSpec`
  `schemaVersion` fields all remain `1`.
- **No cost impact.** `recordAttempt` is not called on load; the usage meter is
  unchanged.
- **Relationship to generated room cache restore.** This blob remains the gate for
  generated restore. ADR-0060 may additionally restore visited generated rooms from
  `generatedRoomCacheJson`, but only after this `generatedQuestJson` path succeeds.
  If the quest blob is missing or corrupt, the cache blob is ignored.

## Generated Room Cache Save/Load v0

✅ **Implemented, browser/app composition + local sidecar.** Generated Room Cache
Save/Load v0 extends the ADR-0059 sidecar pattern with an optional
`generatedRoomCacheJson` blob beside `saveGameJson` and `generatedQuestJson`
([ADR-0060](./decisions/ADR-0060-generated-room-cache-save-load-v0.md)).

- **Non-authoritative byte parking.** `generatedRoomCacheJson` is local
  `SlotWrapper` sidecar data only. `saveGameJson`, `SaveGameService`,
  `WorldSession`, the event log, and projected `WorldState` remain authoritative.
  No `SaveGame`, `WorldState`, `RoomSpec`, or `QuestSpec` schema changes were made.
- **Gated by ADR-0059.** `generatedQuestJson` remains the gate for generated
  restore. A valid cache blob is processed only after generated quest restore
  succeeds; a missing/corrupt quest blob ignores the cache blob and falls through
  to the authored-world path.
- **Visited rooms only.** Save includes the current generated room first, then
  cached generated rooms whose `WorldState.roomStates[roomId]?.visited === true`.
  Warmed/unvisited adjacent rooms are not persisted. The hard cap is 16.
- **Deterministic ordering, not MRU.** Ordering is current-room-first plus
  deterministic snapshot/cache order. It is not true most-recently-used ordering;
  rooms beyond the cap may regenerate on deep backtracking.
- **Restore behavior.** Valid cache blobs are re-validated through
  `loadGeneratedRoomCacheSaveState`, restored via `restoreGeneratedRoomCache`, and
  served through a generated `AdjacentRoomPregenerator`/`NavigationService` over the
  rehydrated `SessionRoomCache`. Missing or corrupt cache blobs degrade to the
  ADR-0059 current-room-only generated restore with no user-facing error.
- **No provider or cost path.** Load and cached backtracking do not call providers,
  LLMs, `FakeRoomGenerator.generate`, `GeneratedRoomSource.resolve`, objective
  generation, `warmAdjacent`, or `recordAttempt`. Cached backtracking resolves from
  the restored cache.
- **Objective UI safety.** The restored current room keeps its ADR-0059 quest
  attachment when `questSpec` exists, even if hints are absent. Restored non-current
  cached rooms seed `null` objective memo entries, clearing stale current-room
  objective UI and preventing objective regeneration/cost on backtrack.
- **Prompt/content exclusion.** `WorldBibleSeed` free text and `adjacentThemeSeed`
  are not restored. Logs/UI must not expose raw prompt, provider output, raw
  objective JSON, seeds, WorldBible free text, object IDs, flag text, room names, or
  object names. Stored `RoomSpec` may contain object IDs internally only so
  `resolvedObjectIds` can match authoritative flags again.

## Runtime Room Memory Persistence v0

✅ **Implemented, browser/app composition + local sidecar.** Runtime Room Memory
Persistence v0 extends the save-slot sidecar pattern with optional
`roomMemoryJson`, allowing browser runtime room memories to survive
Save/Continue/Load without changing authoritative save state
([ADR-0070](./decisions/ADR-0070-runtime-room-memory-persistence-v0.md)).

- **Non-authoritative byte parking.** `roomMemoryJson` sits beside
  `saveGameJson`, `generatedQuestJson`, and `generatedRoomCacheJson` in the
  `SlotWrapper`. `saveGameJson`, `WorldSession`, the event log, and projected
  `WorldState` remain authoritative; room memory remains inert supporting
  context.
- **Strict restore.** On load, the in-memory room-memory store is cleared before
  restore. A valid sidecar is parsed, schema-validated, scoped to the restored
  `worldId/sessionId`, and restored through `InMemoryRoomMemoryStore.restoreAll`.
  Missing, invalid, unsupported, mismatched, `source:'llm'`, or unsafe-text
  records degrade to an empty or filtered store while the game still loads.
- **No room-truth coupling.** Restore does not cross-check `roomId` against
  loaded rooms. Memories never mutate rooms, flags, quests, gates, items,
  dialogue effects, reducers, or events.
- **No backend/schema change.** No SQLite migration, persistence adapter change,
  `RoomMemoryStore` port change, `SaveGame` schema change, provider call, or
  usage-meter change. Logs carry only safe status/reason/counts, never raw
  memory text or sidecar JSON.

## Room Inspect Summary v0

✅ **Implemented, browser.** Story Anchors v0 made generated rooms more often
center on one focal object, but that foundation was invisible to the player.
Room Inspect Summary v0 surfaces a brief deterministic observational summary at
every room entry as a dismissible intro panel — no LLM, no schema fields, no
gameplay semantics
([ADR-0035](./decisions/ADR-0035-room-inspect-summary-v0.md)).

- **Pure domain summary builder.** `buildRoomSummary(room: LoadedRoom) →
  RoomSummary | null` is total, deterministic, and side-effect-free. It selects a
  focal object (reusing `selectGeneratedStoryAnchorIndex`; fallback: first
  non-exit interactable or NPC) and up to two supporting objects from
  `room.objects`. Summary text uses the room `name`, a closed hand-written
  `NOUNS` table keyed on `RoomObject['type']`, and inferred cardinal directions
  from each object's `position`. Returns `null` when no qualifying focal object
  exists; null is safe and non-fatal.
- **No LLM-generated text; no raw generated text.** The noun table, verbs, and
  direction phrases are hand-written and finite. The function never reads
  `object.name`, `interaction.title`, `interaction.body`, `interaction.prompt`,
  skipped objects, or raw generated JSON — only validated `LoadedRoom` data.
- **No schema fields or storage.** `RoomSummary` is a transient computation
  result. `schemaVersion` remains `1`. No new backend, API, or memory field.
- **Presentational `RoomIntroPanel`.** Receives `{ summary: RoomSummary | null,
  roomKey?: string }`. Renders nothing when `summary` is absent or text is
  empty. Shows the summary text with a dismiss button (`role="status"` +
  `aria-live="polite"`). Dismissal is tracked in component-local
  `RoomIntroPanelState` keyed by `resetKey`; it is never persisted.
- **Dismissal resets on room entry.** `buildRoomIntroView(room, sessionId,
  entrySeq) → RoomIntroView` derives a `roomKey` of `sessionId:room.id:entrySeq`.
  A key change (new room or new session) resets the dismissed state — the panel
  re-appears for each new room, even if previously dismissed.
- **Path-agnostic App wiring.** `AppRoomIntro` is rendered for every active room
  via `AppRoomEntryOverlay`, covering bootstrap/authored, prompt-generated,
  navigated, and restore/load paths. The existing fallback/repaired notice and the
  intro panel coexist independently inside `AppRoomEntryOverlay`; neither
  suppresses the other.
- **Not changed:** `domain/roomSpec.ts` · `domain/assembleRoom.ts` ·
  `domain/validateRoom.ts` · `domain/repairRoom.ts` · `domain/generatedRoomComposition.ts`
  · `world-session/**` · `interactions/**` · `encounters/**` · `dialogue/**` ·
  `memory/**` · `persistence/**` · `server/**` · `renderer/engine/**` ·
  `eslint.config.js` · `package.json`. No new gameplay, schema, backend, memory,
  or generated code.

## Generated Room Interaction Affordances v0

✅ **Implemented, browser.** Generated Room Interaction Affordances v0 makes the
existing E/F interaction surface easier to read without adding gameplay systems
([ADR-0036](./decisions/ADR-0036-generated-room-interaction-affordances-v0.md)).

- **Pure structured classifier.** `affordanceFor(interaction, objectType)` derives
  one of `inspect` / `talk` / `take` / `use` / `exit` / `approach` from validated
  interaction structure only: `exit`, `encounter`, `dialogue`, `effect.kind`, and
  `object.type === 'npc'` for the NPC default. It never parses `prompt`, `title`,
  `body`, object names, skipped objects, provider output, or raw generated JSON.
- **View-model only.** The derived `affordance` field lives on the neutral
  `Interactable` view-model produced from validated `RoomObject` data. It is not
  a `RoomSpec` field, save field, backend/API field, memory field, or gameplay
  fact. `schemaVersion` remains `1`.
- **HUD presentation.** The HUD still shows the existing key and generated prompt,
  and now adds a deterministic verb chip from `AFFORDANCE_LABEL`. Prompt text is
  preserved exactly; the chip does not replace or rewrite it.
- **Renderer presentation.** Existing floor indicators remain exactly one
  `interactable-indicator` ring per interactable object. The renderer tints that
  existing ring from a fixed `AFFORDANCE_RING_COLOR` map keyed by the derived
  affordance. Non-interactable objects still get no ring.
- **Opening precedence unchanged.** Interaction resolution and opening behavior
  still live in the composition root and keep the same precedence:
  `exit → encounter → dialogue → effect`. Affordances describe the already-existing
  capability; they do not create new semantics.
- **Safe fallback.** Ambiguous or body-only interactions default to `inspect`.
  Missing affordance data never triggers repair, fallback, a generated-room notice,
  or logging.

## Generated Room Object Purpose v0

✅ **Implemented, generated assembly/domain.** Generated Room Object Purpose v0
adds a deterministic generated-room-only enrichment stage so safe generated props
can receive existing interaction rings and HUD prompts without adding gameplay
semantics
([ADR-0037](./decisions/ADR-0037-generated-room-object-purpose-v0.md)).

- **Pipeline position:** `assembleRoom` runs `assignGeneratedObjectPurpose` after
  generated-room composition, spawn repair, and exit repair, and before final
  `validateRoom`. Authored/static/default/restored rooms use `loadRoomSpec`
  directly and are unchanged; the trusted fallback room is never enriched.
- **Validated data only:** the stage receives `LoadedRoom` data and reads only
  validated `RoomObject.type` plus whether an interaction already exists. It does
  not read object names, generated descriptions, provider output, skipped objects,
  raw generated JSON, or user prompt text.
- **Presentation-only synthesis:** it adds `{ key: 'E', prompt, title, body }`
  only for allowlisted objects that currently lack interaction. `book`/`paper`/
  `map` use `Read`; `chest`/`crate`/`barrel`/`corpse`/`table`/`machine` use
  `Inspect`; `altar`/`statue`/`artifact` use `Examine`. `title` equals the safe
  verb and `body` comes from a fixed hand-written table. Existing interactions,
  including existing generated `title`/`body`/`effect`, are preserved.
- **No schema or gameplay change:** `RoomSpec.schemaVersion` remains `1`; `title`
  and `body` already exist on the shared `Interaction` schema. The synthesized
  interaction has no effect, encounter, dialogue, exit, item, inventory, quest,
  combat, event write, memory, backend, or world-state mutation.
- **Best-effort diagnostics:** unsupported or excluded object types are left
  unchanged. Missing purpose never causes repair, fallback, a generated-room
  notice, or validation failure. `purposesAssigned` is count-only; all fallback,
  JSON/schema, semantic fallback, and unavailable paths report `0`.
- **Downstream consumers stay downstream:** affordance classification, renderer
  rings, and HUD chips consume the final validated interactions. They still do
  not invent interactions themselves.
- **Diagnostic timing note:** `composeGeneratedRoom` computes `lacksAnchor` and
  `lacksInteractable` before purpose assignment. `lacksInteractable` describes
  the raw generated/composed output, not necessarily the final `LoadedRoom` after
  safe synthesized interactions.

## Generated Room Explore Loop v0

✅ **Implemented, generated assembly/domain + existing browser UI.** Generated
Room Explore Loop v0 extends ADR-0037 so synthesized generated-object purpose
interactions now carry the safe panel text needed for a complete local explore
loop ([ADR-0038](./decisions/ADR-0038-generated-room-explore-loop-v0.md)).

- **Safe title/body close the loop:** generated synthesized interactions are now
  `{ key: 'E', prompt, title, body }`, where `title` equals the safe verb
  (`Read` / `Inspect` / `Examine`) and `body` comes only from the fixed
  hand-written table. Pressing E therefore opens an existing panel with safe text
  instead of relying on generic fallback body copy or an object label/name title.
- **Existing open-interaction path:** `buildInteractables` projects validated
  interactions into the neutral `Interactable` view-model; the renderer surfaces
  the ring/HUD and emits intent; `RoomViewer` opens the existing `DialoguePanel`.
  No new resolver, LLM call, backend/API call, memory lookup, or stateful system
  was added.
- **Presentation-only:** the synthesized interactions carry no `effect`,
  `encounter`, `dialogue`, `exit`, inventory, loot, quest, combat, event, memory,
  backend, API, or world-state mutation data. They are deterministic local display
  data only.
- **No generated text leakage:** the enrichment does not read object names,
  generated descriptions, generated prompt/title/body text, provider output, raw
  generated JSON, or user prompt text for synthesized display text. It closes the
  generated-object-name panel-title leak for synthesized object-purpose
  interactions.
- **Unchanged paths:** authored/default/restored rooms still bypass generated
  purpose assignment; fallback rooms are not enriched; existing generated
  interactions are preserved exactly.

## Generated Room NPC Presence v0

✅ **Implemented, generated assembly/domain.** Generated Room NPC Presence v0
lets PromptBar-generated rooms include a real TALK NPC when the raw user prompt
clearly asks for a living/interactable person, without passing prompt text into
the generated-room domain pipeline
([ADR-0040](./decisions/ADR-0040-generated-room-npc-presence-v0.md)).

- **Boolean-only prompt boundary:** `App` classifies the raw prompt with
  `detectsNpcRequest(prompt)` before world-bible seed/projection can lose NPC
  intent. Only the boolean `requestsNpc` crosses into `GeneratedRoomSource` and
  `assembleRoom`; matched keywords and prompt text do not.
- **Pipeline position:** `assembleRoom` runs `ensureGeneratedNpcPresence` after
  generated-object purpose enrichment and before final `validateRoom`. The
  inserted NPC is therefore checked by the existing final validation step.
- **Trusted enrichment:** when `requestsNpc` is true and no NPC already exists,
  the pure deterministic enrichment inserts at most one safe NPC if a valid tile
  exists. Existing generated NPCs are preserved and no duplicate is inserted.
  If no safe tile exists, no NPC is inserted and the room still loads normally.
- **Existing NPC shape:** the inserted NPC uses the same authored working pattern
  as existing NPCs: `type: 'npc'`, key `F`, fixed authored name/color, fixed
  interaction prompt/body, and `interaction.dialogue` with fixed persona,
  greeting, and canned prompts. No RoomSpec schema change is required.
- **No text leakage:** inserted NPC strings come only from fixed authored text.
  The enrichment does not read or copy room names, object names, generated
  descriptions, existing interaction prompt/title/body text, raw JSON, provider
  output, matched terms, or user prompt text.
- **Safe diagnostics:** `npcInserted` is boolean-only. Logs and diagnostics must
  not contain prompt text, matched keywords, generated text, object names,
  provider JSON, or feature details.
- **Adjacent rooms default false:** adjacent pregeneration keeps `requestsNpc`
  false because it has structural room ids, not deliberate raw prompt intent.
- **Soft cap note:** the inserted NPC is added after the soft generated object cap
  but before hard final validation. This is intentional so an explicitly
  requested NPC is not dropped by soft composition trimming.

## Generated NPC Dialogue Seed Variety v0

✅ **Implemented, generated assembly/domain.** Generated NPC Dialogue Seed Variety v0 replaces
the single hardcoded NPC template `ensureGeneratedNpcPresence` (above) inserted with a small
deterministic builder, so the inserted NPC's name/persona/greeting/prompt labels vary instead of
always resolving to `'Mira'` / `'generated-room-guide'`
([ADR-0066](./decisions/ADR-0066-generated-npc-dialogue-seed-variety-v0.md)).

- **Structural selection only:** a local `stableIndex(room.id, ...)` hash and the existing
  `themePack` (`'fantasy-keep' | 'post-apoc' | undefined`) enum select from closed, hand-written
  `Object.freeze`d tables (`NPC_NAMES`, `NPC_PERSONAS`, `NPC_GREETINGS`, `NPC_BODIES`,
  `ANCHOR_PROMPTS`, `GENERIC_ROOM_PROMPTS`, `HELP_PROMPTS`). The safe object **type** of the
  room's existing derived story anchor (via unmodified `selectGeneratedStoryAnchorIndex`) picks
  the first starter-prompt line. No room/object name, prompt/title/body text, or generated free
  text is ever read.
- **Prompt ids unchanged:** `'ask-room'` and `'ask-help'` remain fixed; only `label` text varies,
  so dialogue routing, `NPCDialogueService`, and `RoomViewer`'s `onSay(prompt.id)` wiring are
  unaffected.
- **`assembleRoom` threading:** Stage 2.12 now passes `themePack: options.themePack` into
  `ensureGeneratedNpcPresence` — the only change to `assembleRoom.ts`.
- **`NPCDialoguePanel` cosmetic labels:** the existing `PERSONA_ROLE_LABELS` map gained entries
  for the new persona strings so each bucket's NPC shows a subtitle; unrecognized personas still
  render none.
- **No new safety surface:** `ensureGeneratedNpcPresence` stays pure/synchronous with no I/O; no
  schema, memory, persistence, save/load, or `WorldState` change. Authored/demo NPC dialogue is
  unaffected (same "no existing NPC" guard as ADR-0040).

## Generated NPC Dialogue Spec v0

✅ **Implemented, generated assembly/domain.** A generator-emitted NPC can carry
`interaction.body` but no `interaction.dialogue`, and can carry no `id` at all — both of
which made `buildDialogueLookup`/`RoomViewer` fall through to the plain `body`/`Close`
`DialoguePanel` instead of `NPCDialoguePanel`. Generated NPC Dialogue Spec v0 closes this
gap with a new pure sibling normalizer, co-located with the ADR-0066 tables it reuses
([ADR-0067](./decisions/ADR-0067-generated-npc-dialogue-spec-v0.md)).

- **`ensureGeneratedNpcDialogue`:** a new pure, synchronous function in
  `ensureGeneratedNpcPresence.ts` that assigns a collision-safe `id` (mirroring the
  `nextObjectiveTargetId`-style pattern) where absent/blank, and a deterministic
  `interaction.dialogue` — built from the existing closed ADR-0066 persona/prompt tables
  plus one new nameless, per-theme-bucket `NPC_DIALOGUE_GREETINGS` table — where
  `interaction.dialogue` is absent. The validated generated-room `RoomSpec` NPC schema
  requires `interaction`, so `ensureGeneratedNpcDialogue` reads `object.interaction.dialogue`
  directly; an NPC with both `id` and `dialogue` already present is untouched.
- **Unconditional Stage 2.12.2:** runs in `assembleRoom` immediately after Stage 2.12
  (`ensureGeneratedNpcPresence`) and before Stage 2.12.5 (objective target enrichment), on
  every generated room — including adjacent-style rooms generated without a `requestsNpc`
  signal, since generator-emitted NPCs are not gated by that flag.
- **Count-only diagnostic:** `RoomDiagnostics.npcDialogueNormalizedCount` counts only NPCs
  that received a **new dialogue spec**, not id-only fixes; it is `0` on every fallback
  branch and present on all three result shapes (`generated`/`repaired`/`fallback`).
- **Prompt ids unchanged:** `'ask-room'` / `'ask-help'` stay fixed, so `NPCDialogueService`,
  `FakeNPCDialogueProvider` reply routing, and `RoomViewer`'s `onSay(prompt.id)` wiring are
  unaffected.
- **No new safety surface:** deterministic/closed-table only, no provider/LLM, no free-text
  input, no click-to-talk, no `WorldState` mutation, no memory writes, no schema/save-load/
  persistence change, and no `RoomViewer`/`App.tsx`/`NPCDialoguePanel` change — those
  consumers already worked correctly once an NPC has both `id` and `interaction.dialogue`.

## Generated Story Objective Contract v0

✅ **Implemented, domain/quests/assembly + dialogue/UI.** Generated Story Objective Contract v0
delivers a narrow, validated data contract for a generated story objective proposal and a pure
validate-or-drop assembler that converts a valid proposal into the existing trusted `QuestSpec`,
enabling prompt-generated rooms to carry one small story beat without changing the quest engine
([ADR-0047](./decisions/ADR-0047-generated-story-objective-contract-v0.md)).

- **Two independent pipelines:** room assembly (unchanged) and objective assembly (new, runs
  after a valid generated room exists). A dropped or missing objective leaves the room playing
  normally; it never affects room provenance, the renderer, or world state.
- **`GeneratedObjectiveSpec` schema:** a narrow, strict proposal schema (`interact-object`,
  `resolve-encounter`, `visit-room` condition kinds; all text fields bounded). The generator
  names an `objectId` or `roomId`; the trusted assembler derives the internal flag key. No
  raw flag strings, no code, no open enums.
- **`assembleObjective`:** pure, total, throw-free pipeline — parse → schema → satisfiability
  check → text sanitization → build `QuestSpec`. An unsatisfiable condition is dropped, never
  invented. Returns `{ spec: QuestSpec | null; hint; completionHint; diagnostics }`.
- **`FakeObjectiveGenerator`:** deterministic fake source behind a new `ObjectiveGenerator`
  port. References only objects with stable ids and the required interaction. Returns
  `Promise<string | null>`.
- **NPC hint wiring:** `QuestDialogueContext` gains optional `hint` and `completionHint`
  fields (inert display only, never logged). `FakeNPCDialogueProvider` prefers the generated
  hint over the authored `QUEST_CLUE` table when present; absent → byte-identical to today.
- **Quest tracker:** the hardcoded authored completion sentence is replaced with the generic
  `{view.title} is complete.` so the tracker works for any `QuestSpec`.
- **Authority unchanged:** `WorldSession` + event log + reducers remain sole truth. Generated
  objectives observe flags that existing interactions already set; they append nothing.
- **No generated gate:** navigation remains free on all generated-room paths.

## Generated Room Objective Target Enrichment v0

✅ **Implemented, generated assembly/domain.** Generated Room Objective Target Enrichment v0 closes the gap
between `assembleObjective` (which requires an eligible object in the room) and real-LLM rooms
(which typically lack the stable `id` and `interaction.effect` the assembler requires), by
promoting exactly one eligible generated-room object to objective-ready as a benign normalization
stage in `assembleRoom`
([ADR-0048](./decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md)).

- **Promote-only, never invent:** the stage (`ensureGeneratedObjectiveTarget`) operates on the
  existing assembled object list. It adds a stable id (if missing) and `effect: { kind: 'inspect' }`
  to one eligible purpose-type object; it never creates a new object or sets `effect.flag`.
- **Boolean-option gate:** controlled by `AssembleRoomOptions.enrichObjectiveTarget` (default
  `false`; `true` on the prompt-generated first-room path and on generated-play adjacent
  room sources only). Authored/demo adjacent pregeneration, repaired, and fallback paths
  are unaffected.
- **Stage 2.12.5 in `assembleRoom`:** after `ensureGeneratedNpcPresence` and before
  `sanitizeGeneratedDisplayText` / final `validateRoom`. The promoted object is validated with
  the rest of the room.
- **Short-circuit for fake rooms:** `FakeRoomGenerator` rooms already carry an objective-ready
  `objective-document` object; the stage no-ops immediately, output byte-identical.
- **Benign normalization:** keeps `provenance: generated`, shows no notice, reports only
  `objectiveTargetEnriched: boolean`.

## Real Generated Objective Provider v0

✅ **Implemented, generation + app composition.** Real Generated Objective Provider v0 wires a
real, network-backed `ObjectiveGenerator` (`OpenAICompatibleObjectiveGenerator`) behind the
unchanged `ObjectiveGenerator` port so prompt-generated DeepSeek/OpenAI rooms can receive
objective proposals from the same configured real provider family, while the deterministic
fake remains the default/fallback
([ADR-0049](./decisions/ADR-0049-real-generated-objective-provider-v0.md)).

- **Same port, same safety gate.** `OpenAICompatibleObjectiveGenerator` implements the unchanged
  `ObjectiveGenerator` port. `buildGeneratedObjectiveAttachment` and `assembleObjective`
  remain the sole trust and satisfiability gate: parse, strict schema, satisfiability, and text
  sanitization. A hallucinated or ineligible `objectId`, invalid JSON, unsafe JSON, schema
  violation, provider failure, timeout, empty output, or unsatisfiable condition all degrade to
  `null` / no quest.
- **Mirrors the real room provider (ADR-0023).** One non-streaming POST to any
  OpenAI-compatible chat-completions endpoint; injected `LlmTransport` seam; hard
  `AbortController` timeout (`OBJECTIVE_TIMEOUT_MS = 12_000` ms); no retry; returns
  `choices[0].message.content` verbatim. Fixed-code error throws only
  (`objective-llm-request-failed` / `objective-llm-timeout` / `objective-llm-empty-response`);
  no API key, request/response body, or generated text in errors.
- **`selectObjectiveGenerator(config)`** mirrors `selectRoomGenerator`. Reuses the same
  `LlmConfig` / `isRealProviderComplete` / `REAL_PROVIDER_BASE_URLS` — no new `VITE_*`
  environment variables. `FakeObjectiveGenerator` is selected when config is incomplete.
- **Closed structural digest only.** `buildObjectivePromptMessages` projects only
  `listInteractObjectiveCandidates(room) → [{ objectId, type }]` into the prompt. No raw room
  JSON, user prompt, room/object names, descriptions, interaction prompt/title/body text, hints,
  generated text, or provider output reaches the objective prompt or logs.
- **Provider is raw-text only.** It returns `choices[0].message.content` verbatim and does not
  parse, repair, strip code fences, or validate objective JSON. The unchanged assembler owns
  every semantic decision.
- **`interact-object` only in v0.** ADR-0048 enrichment guarantees one eligible
  `interact-object` target; `resolve-encounter` and `visit-room` generation are deferred.
- **Prompt-generated plays only.** App keeps the `result.provenance === 'generated'`
  gate. Authored/demo/restored plays keep their authored or absent quest behavior. Generated
  adjacent rooms can receive an objective only on room entry through the App composition root;
  background `warmAdjacent` remains provider-free and never calls the objective provider.
- **Room-entry timing.** Objective generation for the prompt-generated first room is still
  awaited before initial room entry. Generated adjacent rooms use the per-room on-enter path:
  the room appears first, then objective attachment completes asynchronously if allowed. There
  is no objective-specific usage meter in v0.
- **All safety properties preserved.** `assembleObjective` unchanged; no generated mechanical
  gates, navigation locks, quest engine, generated flag strings, RoomSpec/schema, world-state,
  event/reducer, SaveGame, persistence, backend, renderer, or navigation-gate changes.
- **Dev-only / BYOK caveat (same as ADR-0023).** `VITE_*` keys are inlined into the browser
  bundle; v0 is local-dev only. Hosted production moves the provider server-side later.
- **Deferred.** Objective usage meter; shared predicate extraction with `FakeObjectiveGenerator`
  / `objectiveCandidates`; generated mechanical gates; a quest engine; multi-step objectives;
  objective persistence; richer provider/router support.

## Generated Objective Per Room v0

✅ **Implemented, browser/app composition.** Generated Objective Per Room v0 extends the
existing generated-objective pipeline from the prompt-generated first room to generated rooms
entered during a prompt-generated play, without moving the trust boundary or changing the quest
engine ([ADR-0051](./decisions/ADR-0051-generated-objective-per-room-v0.md)).

- **Provenance plumbing:** `AdjacentRoomPregenerator` retains generated-room provenance
  (`generated` / `repaired` / `fallback`) per `roomId`, including cache hits.
  `NavigationService` passes that provenance through on successful `navigated` results without
  interpreting it. Authored/registry rooms expose no generated provenance.
- **Generated-play adjacents only:** the generated-play adjacent `GeneratedRoomSource` factory
  enables `enrichObjectiveTarget: true`; the authored/demo/example pregenerator remains on the
  default unenriched path. `warmAdjacent` remains provider-free and never calls the objective
  provider.
- **Prompt-generated play flag:** App marks only prompt-generated plays with
  `objectivesPerRoom: true`. Authored bootstrap, demo, restored, repaired, and fallback paths
  are excluded from per-room objective attachment.
- **Session-local memo:** App keeps an in-memory `Map<roomId, GeneratedObjectiveQuestAttachment
  | null>`. Room #1 is seeded from the existing prompt-generated objective result; revisits
  restore cached attachments synchronously, and cached `null` prevents retries. This memo is
  session-local only and is not persisted through save/load.
- **On-enter attach:** when navigation enters a generated-provenance room with no memo entry,
  App starts a fire-and-forget objective attachment after the room/state projection updates.
  The call is guarded by `canAttemptOptional({ count }, { cap, enabled })`. Allowed calls reuse
  `buildGeneratedObjectiveAttachment`; budget skips, provider failures, invalid objective JSON,
  and unsatisfiable objectives all memoize `null`.
- **Stale discard:** async results apply only if the current active play still has the same
  session id and room id. If the player moved away, the result remains memoized but does not
  update the visible `QuestTracker` or NPC hint state.
- **Boundaries unchanged:** `assembleObjective` remains the sole objective trust gate. There are
  no generated mechanical gates, quest chains, backend enforcement, token-billing changes,
  multi-objective quest engine changes, `RoomSpec` schema changes, world-event/reducer changes,
  persistence changes, or renderer changes.
- **Deferred:** generated objective save/load persistence, cross-room story threading,
  generated mechanical gates/rewards, multi-step quest chains, objective-specific usage meters,
  and server-side/hosted objective-provider execution remain future work.

## Generated Room NPC Objective Awareness v1

✅ **Implemented, browser/domain/dialogue.** Generated-room NPC dialogue can now receive an
optional closed `NPCObjectiveContext` (`kind` + `status` enums) nested in the existing
`QuestDialogueContext.objective` field
([ADR-0056](./decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md)).

- The context is derived from validated quest objective condition shape only and drives
  hand-written deterministic NPC nudge lines.
- It carries no raw objective JSON, object ids, room ids, flag values, generated hints, provider
  output, user prompt text, object names, or room descriptions.
- It is read-only dialogue context: no world-state, objective, memory, event-log, backend,
  persistence, schema, generation, or renderer mutation is introduced.

## Generated Room Object State v0

✅ **Implemented, browser/app composition + domain projection + renderer presentation.**
Generated Room Object State v0 closes the presentation gap for generated rooms that can be
revisited: objects already inspected or taken in a prior visit appear resolved on re-entry,
without adding any new persistence layer
([ADR-0054](./decisions/ADR-0054-generated-room-object-state-v0.md)).

- **Existing authoritative substrate.** `WorldState.roomStates[roomId].flags` already survives
  navigation across the full generated play — `move` events never clear flags. The one-shot
  `inspect`/`take-item` flag set by `InteractionService` → `planInteraction` →
  `room-state-changed` (ADR-0014) persists for free. This is a **presentation gap only**, not a
  persistence gap.
- **Pure domain projection.** A new pure function `resolvedObjectIds(room, roomState) →
  ReadonlySet<string>` reads the existing flags for each one-shot object with a stable id and a
  set flag key. It reuses the exported `interactionFlagKey` from `planInteraction.ts` so the
  projection cannot drift from the writer. `use-item` objects are never included (repeatable by
  design). No new event type, schema field, or state store.
- **Generated-play gate.** The `App` composition root computes the resolved set only for
  generated plays (`objectivesPerRoom === true`) at room entry. Authored/demo paths omit
  `resolvedObjectIds`, so ring colors and HUD behavior remain visually unchanged.
- **Entry-time presentation.** `RoomViewer` forwards `resolvedObjectIds` to
  `engine.setRoom(room, { resolvedObjectIds })`. `buildObjects` dims the existing
  `interactable-indicator` ring (lower opacity/emissive) for each resolved object id. `Hud.tsx`
  shows a resolved treatment for the nearest resolved interactable. The `DialoguePanel` still
  opens and still shows "Already searched." — unchanged.
- **No live in-room ring update in v0.** The ring state reflects the WorldState at room entry.
  An object resolved in the current room session sees the updated ring only on the next re-entry.
- **No mesh removal.** Taken objects remain visible. The dimmed ring is the sole visual signal.
- **Generated objective targets.** ADR-0048 objective targets carry `effect.kind = 'inspect'`.
  Completing the objective sets the same flag this projection reads, so the object correctly
  shows as resolved on return — no extra wiring needed.
- **Boundaries unchanged.** `WorldState` / event log / reducers — untouched. Engine receives a
  `ReadonlySet<string>` only; no world-session reference crosses the engine boundary.
  `domain/roomSpec.ts`, `assembleRoom`, `validateRoom`, `repairRoom`, all generation code,
  `interactions/InteractionService`, providers, backend, save/load, and all persistence layers are
  unchanged. v0 adds no DB persistence, rich object-state enum, mesh removal/hiding, live in-room
  refresh, no-effect inspect tracking, or authored/demo resolved presentation.

## Generated Room Entry Intro Polish v0

✅ **Implemented, pure domain presentation helper.** Generated Room Entry Intro Polish v0 keeps
the room-entry intro clause from displaying implementation markers such as `"Generated room"` or
pipe-separated seed tags
([ADR-0055](./decisions/ADR-0055-generated-room-entry-intro-polish-v0.md)).

- **Pure intro noun normalization.** `introRoomNoun(roomName)` lives in
  `domain/roomSummary.ts` and is used by `buildSummaryText` for the opening `"You enter ..."`
  clause. Empty or whitespace names become `"the room"`, names beginning with
  `"Generated room"` become `"the room"`, and pipe-tagged names keep only the leading prose
  segment before reusing the existing article behavior.
- **Authored names stay natural.** Normal room names still pass through the existing
  `withArticle` behavior, so examples such as `"Throne Room"`,
  `"A quiet stone antechamber"`, and `"Ashfall Market — South Gate"` keep their existing intro
  wording.
- **Boundaries unchanged.** This is source-only presentation text normalization. There are no
  generation, schema, provider prompt, navigation, objective, renderer, backend, persistence,
  App/UI plumbing, generated-room naming, logging, LLM intro, or revisit-message changes.

## Isometric Camera Foundation

✅ **Implemented.** The default view is now a **controlled 3D / isometric
2.5D-style** presentation: a fixed orthographic true-isometric camera that
**follows a player object**, replacing Renderer Foundation v0's first-person
camera. This is a **presentation** change — still vanilla Three.js, still real 3D
objects and rooms, **RoomSpec JSON unchanged**, generation still **data only**,
and the trusted renderer still owns the camera, movement, and builders. Full
rationale in [ADR-0012](./decisions/ADR-0012-isometric-camera-foundation.md).

- **Player ↔ camera decoupling (the key change).** The engine owns a `player`
  (`THREE.Object3D`) that input drives; a `CameraController` derives the camera
  transform **from** the player each frame. Input never moves the camera directly.
  On room load the player is placed at the spawn point and the camera snaps to it.
- **`IsometricCameraController`** owns an `OrthographicCamera` at the fixed
  true-isometric angle (azimuth 45°, elevation `atan(1/√2) ≈ 35.264°`); a pure,
  WebGL-free `camera/isometric.ts` module holds the offset/pose/movement/frustum
  math (unit-tested), and the controller and movement are thin adapters over it.
- **Screen-relative movement.** `MovementControls` moves the player on the ground
  plane: **W/↑ up-screen (into the scene), S/↓ toward the camera, A/← and D/→
  strafe**; diagonals normalized, delta-time scaled, clamped to the room AABB.
- **Proximity reads the player**, not the camera, so HUD prompts and E/F dialogue
  behave as before but anchor to where the player actually stands.
- **A minimal player marker** (a renderer-internal `buildPlayerMarker()` capsule
  with a facing nose) is **not RoomSpec data**; it lives in the scene graph and is
  freed by the engine's normal disposal.
- **Isometric cutaway shell.** `buildShell` lowers the camera-facing **south/east**
  near walls to a low **curb** so they can't hide the player; the **north/west far
  walls stay full height** to preserve room shape (a dollhouse, not a closed box).
  The near sides are derived from the camera's offset direction; RoomSpec is
  untouched.
- **`LookControls` is retained but not instantiated** — kept for a future
  free-camera / first-person mode behind the same `CameraController` seam.

**V1's default visual direction is controlled 3D / isometric; full first-person /
free-camera 3D remains future and optional.** Camera mode is **renderer-internal
presentation**, never room data — a RoomSpec describes *what is in the room*, not
*how it is filmed*.

## World State & Event Log v0

✅ **Implemented, headless.** Authoritative gameplay truth now lives in an
append-only `WorldEvent[]`; `WorldState` is a pure, reconstructable projection
and its stored snapshot is only a cache. `CanonSeed` initializes the first
`session-started` event and never overrides subsequent play.

`WorldSession` exposes typed use-cases over `WorldStore`, `Clock`, and
`IdGenerator` ports. `InMemoryWorldStore` proves atomic append + snapshot commit
and optimistic concurrency without adding a database. The SaveGame boundary
serializes seed + log + snapshot, rejects unsupported versions, and rejects any
document whose seed or projected snapshot fails integrity. There is no renderer,
React, `App.tsx`, HTTP, database, LLM, dialogue, or memory wiring in this slice.
See [ADR-0013](./decisions/ADR-0013-world-state-event-log-v0.md).

## Object Interactions v0

✅ **Implemented.** E/F interactions can now produce authoritative world-state
effects without moving gameplay logic into the renderer. The engine still emits
only a neutral `Interactable` intent with an optional stable object id. At the
composition root, that id selects a validated, data-only `InteractionEffect`;
the pure `planInteraction` domain function maps it to existing `WorldCommand`s,
and `InteractionService` executes them only through `WorldSession.appendEvent`.

The v0 vocabulary is `inspect`, one-shot `take-item`, and inventory-gated
`use-item` with an optional health change. One-shot idempotency reuses
`room-state-changed.flags`; ADR-0013's seven-event union is unchanged. Missing
effects/ids, insufficient inventory, conflicts, and partial multi-command
failure are typed outcomes. The renderer imports neither `world-session` nor
`interactions` and never mutates `WorldState`. See
[ADR-0014](./decisions/ADR-0014-object-interactions-v0.md).

The interaction presentation layer also derives a deterministic `Affordance`
(`inspect` / `talk` / `take` / `use` / `exit` / `approach`) from validated
interaction structure and object type only. This value lives on the neutral
`Interactable` view-model, not `RoomSpec`; the HUD displays key + verb + existing
prompt, while the renderer tints the existing floor ring from a fixed static map.
Opening and resolution precedence remains `exit → encounter → dialogue → effect`
([ADR-0036](./decisions/ADR-0036-generated-room-interaction-affordances-v0.md)).

## Encounter System v0

✅ **Implemented.** A genre-neutral **encounter** layer sits parallel to Object
Interactions v0: a *threat* with a *description*, a set of *choices* (`fight`,
`hide`, `run`, `distract`, `negotiate`), and a deterministic *authored outcome*
per choice. It differs from an interaction in exactly one way — it is
**two-phase**: present the threat and its choices, then resolve the one the
player picks. Everything else reuses the ADR-0014 blueprint.

Encounters **ride the existing `Interaction`** (`interaction.encounter?`), so no
engine or `Interactable` change was needed; pressing E/F on an object whose
interaction carries an encounter triggers it, and an encounter **takes
precedence over an `effect`** when both are present. The pure `planEncounter`
maps the chosen choice to existing `WorldCommand`s (six effect atoms — `damage`,
`heal`, `add-status`, `clear-status`, `remove-item`, `add-item` — each 1:1 with
an existing command, no new event type), gated by an optional `requires`
possession check and a stable one-shot resolution flag in
`room-state-changed.flags`. `EncounterService` executes the plan through a shared
`world-session/applyCommands` helper (extracted from `InteractionService`, which
now reuses it) and returns a typed result; health may clamp to `0` with **no
death/game-over state**. Authored text (`description`, `title`, choice `label`,
`resultText`, status strings, item names) is display-only and never logged. See
[ADR-0015](./decisions/ADR-0015-encounter-system-v0.md).

## Multi-Room Navigation & Cache v0

✅ **Implemented.** Authored objects may carry the data-only
`interaction.exit: { toRoomId }`; the two example rooms connect through stable
interactable north arches. `RoomViewer` maps the renderer's neutral object id to
exit metadata and applies composition precedence **exit → encounter → dialogue → effect**.
The engine still emits intent only and was not changed.

`RoomRegistry` validates registered example rooms through `loadRoomSpec`,
`SessionRoomCache` reuses each loaded room verbatim for one play session, and
`NavigationService` resolves the target before calling the existing
`WorldSession.move`. A failed resolve appends nothing. A successful move appends
only `moved-to-room`; the existing reducer marks the destination visited.

`App` owns the persistent example-world session and cache across transitions.
Changing the active preloaded room disposes and rebuilds the engine, while the
session's visited and interaction/encounter flags survive and returning reuses
the cached room. Prompt-generated rooms remain fresh single-room sessions with
fresh caches. See
[ADR-0016](./decisions/ADR-0016-multi-room-navigation-cache-v0.md).

## NPC Dialogue Foundation v0

✅ **Implemented.** A validated `interaction.dialogue` marker opts an NPC into a
read-only conversation path. The pure `buildDialogueContext` projection selects
current room/player facts without inventory names; `NPCDialogueService` reads
through `WorldSession.getWorldState` and delegates to the domain
`NPCDialogueProvider` port. Its deterministic fake provider performs no network
I/O and returns display text data only.

NPC dialogue can now receive an optional safe room-context packet
([ADR-0039](./decisions/ADR-0039-npc-dialogue-room-context-v0.md)). The packet is
derived only from the current validated `LoadedRoom` and contains closed enums
and small counts only: an optional focus `{ type, direction }`, notable feature
`{ type, direction }` entries, closed affordance enum values, and a capped
`npcCount`. It never includes room names, object names, generated descriptions,
interaction prompt/title/body text, raw JSON, provider output, or user prompt
text. The context is presentation/dialogue grounding only, not authoritative
memory or room truth.

The composition root resolves the renderer's neutral object id with precedence
**exit → encounter → dialogue → effect**. Dialogue-bearing NPCs open the
presentational `NPCDialoguePanel`, which offers authored canned prompts,
Continue, and a bounded single-line free-text input
([ADR-0069](./decisions/ADR-0069-npc-dialogue-free-text-input-v0.md)). Prompt
buttons send `promptId` for fake-provider routing and `playerLine` for
player-facing text; typed sends normalize/clamp through `normalizePlayerFreeText`
before the existing usage gate. Conversation history stays in component state
and resets on close or room change. Dialogue appends no event, sets no room
flag, writes no memory, and changes no world state. See
[ADR-0017](./decisions/ADR-0017-npc-dialogue-foundation-v0.md).

Real NPC dialogue now exists as an opt-in, OpenAI-compatible provider
([ADR-0065](./decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md)).
`selectDialogueProvider` keeps the fake provider as the default and selects the
real provider only when the existing dev-only/BYOK config is complete. The real
prompt may include recalled room memory as a capped, hedged, explicitly
non-authoritative BACKGROUND section; missing memory omits that section. The
provider returns dialogue text only. `NPCDialogueService` remains read-only,
`WorldSession`/`WorldEvent`/SQLite state remain authoritative, provider failures
map through the existing `provider-unavailable` path, and no memory storage,
schema, migration, or firewall changed.

## Adjacent-Room Pre-generation v0

✅ **Implemented (browser / session-cache).** The deterministic browser subset of
[ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md) now ships: while
the player explores, the rooms behind the current room's exits are **warmed in the
background**, and a room is **resolved safely on demand at the door** — including
generating a non-authored target instead of blocking
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).

- **One room-acquisition seam (`app/AdjacentRoomPregenerator.ts`).** A single
  composition-layer object serves **both** background warming and on-demand door
  resolution over **one** `SessionRoomCache` and **one** in-flight promise map, so
  a door request and a background warm for the same id collapse into a single job.
  Constructed once in `App` for the play session.
- **`resolveRoom(roomId)` is total, cache-first, in-flight-aware.** Cache hit →
  return; else join an in-flight job; else run one job (cleared in `finally`).
  Authored ids resolve through `RoomRegistry` (`registry.has` picks the branch and
  authored rooms are **never** fake-generated); non-authored/unknown ids generate
  through `GeneratedRoomSource → assembleRoom → repairRoom → fallbackRoom`. It
  **never throws** — an unexpected fault maps to a typed `unavailable` and caches
  nothing.
- **The trust boundary holds.** Every generated adjacent room passes through
  `assembleRoom` before it can enter the cache, so only valid, zero-fatal rooms
  are cached. A generated room is **id-normalized** (`withRoomId`, a fresh spread)
  so the cache key and `room.id` agree; `id` is not a `validateRoom` input, so
  this is semantics-preserving, with a defensive re-validate as a guard.
- **`warmAdjacent(room)` is bounded and fire-and-forget.** It warms the current
  room's exits in declaration order, deduped, skipping cached/in-flight ids,
  capped at **`maxJobs` (default 3)**. **Depth = 1, never recursive:** it is
  called only from the composition root (after bootstrap and after each
  navigation), never from inside `resolveRoom`, so pre-generation cannot fan out
  through the world.
- **`NavigationService` depends only on the narrow `RoomResolver` (DIP).** Room
  acquisition moved out of the service; it resolves the target (now possibly by
  generating it) before appending `moved-to-room`. A non-authored target now
  navigates via on-demand generation instead of "the way is blocked".
- **Safe logging only** — ids, codes, counts, booleans, provenance; the seed is
  the **structural room id** (`adjacent:${roomId}`), never a user prompt, and
  neither seed text, raw JSON, story text, nor object names are logged.
- **Unchanged:** the renderer/engine (still intent-only), the domain/schema, the
  `RoomSource` port, the Node API, and the PromptBar generated single-room path (a
  fresh session + cache, no navigation, no warming). In the authored two-room loop
  both rooms warm through the registry, so transitions stay instant and the
  user-visible behavior is unchanged; the generation branch is covered by unit
  tests, not the example world. A backend generation endpoint, a real LLM, the
  per-room status lifecycle / "Opening the way…" UI, a parallel-job system, and
  recursive pre-generation remain **future**.

## Generated Room Bidirectional Links v0

✅ **Implemented, browser/app composition + domain helper.** Generated-play
adjacent rooms now receive a deterministic, data-only return exit back to the
parent room before the room is cached
([ADR-0052](./decisions/ADR-0052-generated-room-bidirectional-links-v0.md)).

- **Generated-play only.** The `AdjacentRoomPregenerator` constructed inside
  `App.handlePrompt` enables return exits. The module-level authored/demo/example
  pregenerator leaves the option off, so authored/bootstrap pregeneration remains
  unchanged.
- **Structural parent detection.** The return edge is derived by parsing generated
  navigation ids built as `parentId:exit:<side>`. Nested generated ids resolve to
  the immediate parent; non-structural ids get no return exit.
- **Cache-hit backtracking.** A generated adjacent room B reached from A gets a
  return arch pointing to A, baked into B before `cache.set`. A -> B -> A is
  cache-hit based and does not regenerate A.
- **Provider-free warming remains.** `warmAdjacent` still uses the same bounded,
  depth-1, fake/generated adjacent path and makes no real-provider calls.
- **Boundaries unchanged.** No RoomSpec schema, world state/event log, backend,
  persistence, objective, provider-prompt, renderer, or navigation-contract
  change. Generated map persistence, minimap, named destination labels, authored
  bidirectional links, and renderer animation remain future/non-goals.

## Return Exit Visual Affordance v0

✅ **Implemented, presentation-only follow-up to ADR-0052.** Return exits work in
data and are now visually distinct from forward exits at range. The distinction
uses color only — no navigation, schema, affordance-union, objective, provider,
or persistence change
([ADR-0053](./decisions/ADR-0053-return-exit-visual-affordance-v0.md)).

- **Detection:** a pure domain predicate `isReturnExitObject(object)` checks
  whether `object.id` contains the structural infix `':return-exit:'`, which is
  already the exclusive id namespace for return arches (ADR-0052). The predicate is
  content-free and deterministic.
- **Return arch mesh color:** `RETURN_EXIT_ARCH_COLOR = '#c084fc'` (purple/lavender)
  wired into `ensureGeneratedReturnExit`'s inserted arch. The arch is 3.5 m tall and
  readable from across the room — the primary "at range" signal.
- **Return floor ring color:** `RETURN_EXIT_RING_COLOR = '#f472b6'` (pink/rose)
  selected in `buildObjects` when `isReturnExitObject` is true. Distinct from forward
  cyan `AFFORDANCE_RING_COLOR.exit = '#6bbcff'`.
- **Forward exits, authored exits, and all non-exit rings unchanged.** The predicate
  returns `false` for `:generated-exit:` ids and authored arch ids; they retain
  grey mesh + cyan ring.
- **Boundaries unchanged.** No RoomSpec schema change (`color` is an existing arch
  field). No `Affordance` union change. No HUD chip or prompt change. No navigation,
  objective, provider, world-state, or persistence change.
- **Deferred/non-goals:** no new affordance kind, no colorblind icon/shape support
  yet, no minimap, no animation, no authored return-exit changes, no named return
  labels, and no save/load persistence of generated map links.

## Backend SQLite Persistence v0

✅ **Implemented, headless and Node-only.** The first durable store lands as a
physically separate, browser-excluded build unit under
`apps/web/src/persistence/**` — proving ADR-0013's promise that "a server-side
SQLite adapter implements the same `WorldStore` port with **no domain change**".
The Node API composes these stores for durable session/room endpoints. The
running browser app is **not** wired to that API or SQLite; it keeps its
in-memory adapters.

- **Driver.** Node v24's built-in `node:sqlite` (`DatabaseSync`) — zero new
  runtime dependencies, no native build. `db.ts` opens a connection (file path or
  `:memory:`), sets per-connection PRAGMAs (`foreign_keys`, `busy_timeout`, WAL),
  and exposes a `withTransaction` (`BEGIN IMMEDIATE`) helper and a forward-only
  `runMigrations`. Parameterized SQL lives **only** in the adapter/migration files.
- **Migrations.** Numbered, forward-only; `0001_init` creates `world_sessions`,
  `world_events`, `rooms`, and the append-only `world_events` triggers, while
  `runMigrations` owns the idempotent `schema_migrations` bookkeeping. Each
  migration runs in one transaction and rolls back wholesale on failure.
- **`SqliteWorldStore`** implements the unchanged `WorldStore` port: append-only
  events (`UNIQUE(session_id, seq)` + DB triggers), the session-computed
  `WorldState` snapshot persisted **atomically** alongside its event, and
  optimistic concurrency as a `revision` compare-and-set. The store never computes
  projections — the `WorldSession` hands it `{ event, snapshot }`.
- **`RoomStore` + `SqliteRoomStore`** (new port) persist the validated RoomSpec
  **data document** (never renderer objects), upsert by stable `roomId`
  (last-writer-wins), and load back through the same `loadRoomSpec` boundary.
- **Provably excluded from the browser bundle:** `tsconfig.app.json` excludes
  `src/persistence`, a Node `tsconfig.persistence.json` type-checks it via
  `tsc -b`, Vite never reaches it from `main.tsx`, and bidirectional ESLint walls
  forbid the browser surface from importing `node:sqlite`/persistence and forbid
  persistence from importing React/Three/renderer/app layers. Validation happens
  at the read/write boundary; logs carry ids/counts/codes only. See
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md).

## Backend World Session API v0

✅ **Implemented, headless and Node-only.** A native `node:http` edge under
`apps/web/src/server/**` composes `WorldSession`, `SqliteWorldStore`, and
`SqliteRoomStore` without changing their ports or importing frontend/renderer
code ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).

- **Endpoints.** `GET /health`; create/read/event-list/move session routes; and
  save/get room routes. Requests are zod-validated and expected application
  outcomes map to safe 4xx envelopes; unexpected faults map to generic 5xx.
- **Startup and local run.** `npm run dev:api` uses the `tsx` devDependency.
  `AIGM_DB_PATH` overrides the default persistent
  `.data/aigm-dev.sqlite`; migrations run before the server listens and fail
  fast.
- **Physical separation.** `tsconfig.server.json` type-checks the server with
  Node types/no DOM, `tsconfig.app.json` excludes it, Vite cannot reach it from
  `main.tsx`, and reciprocal ESLint walls keep server/DB imports out of browser
  code.
- **No frontend wiring.** `App.tsx`, `RoomViewer.tsx`, navigation, and the
  renderer still use in-memory adapters. No CORS/proxy/browser fetch client,
  hosted deployment, FastAPI, or Python backend is part of this MVP path.

## NPC Memory Persistence v0

✅ **Implemented, headless and Node-only.** The first NPC memory layer lands as a
durable, scoped store of typed NPC memory records plus the pure **memory firewall**
that governs how memories are written and read. Memory is **supporting context only
and can never become world truth**: the `WorldSession` event log + reducers remain
the sole authority, and the memory layer is constructed with **no reference to
`WorldSession`/`WorldStore`/`WorldCommand`/`WorldEvent`**, so it has no code path to
mutate state ([ADR-0024](./decisions/ADR-0024-npc-memory-persistence-v0.md)). v0 adds
**no API, no frontend/dialogue wiring, and no LLM prompt injection**; the browser
stays in-memory and unwired.

- **Pure domain contracts + firewall.** `domain/memory/contracts.ts` is the strict,
  versioned schema (imports only `zod`; exports no `WorldCommand`/`WorldEvent`
  -producing function). `domain/memory/firewall.ts` is pure/total/deterministic:
  `validateMemoryDraft` (write firewall — validate + trim + default
  `confidence:'medium'`), `filterMemoriesForScope` (read firewall — exact-triple
  re-filter), and `selectRecallMemories` (the only ordering authority).
- **Strict scope `(worldId, sessionId, npcId)`.** Every read and write is filtered
  against the exact triple. **No cross-session and no cross-world memory in v0.**
- **Closed vocabularies.** Memory kinds: `player_claim` · `npc_belief` ·
  `npc_observation` · `dialogue_summary`. Source: `player` · `npc` · `game` · `llm` —
  **no `system` source** (hidden system/developer text is never stored). `confidence`
  (`low`/`medium`/`high`) is **informational only**: it does not update truth and does
  not drive recall. `text` is opaque, inert, **bounded to 280 chars**, never logged.
- **Deterministic recall.** Ordering is **`seq` desc, then `memoryId`** — never
  confidence, never recency-by-clock, never relevance. Recall defaults: `limit = 8`,
  `maxChars = 600` (cumulative `text.length` cap).
- **`NpcMemoryStore` port + headless `NpcMemoryService`.** The port mirrors
  `WorldStore`/`RoomStore` (typed results: `session-not-found`/`conflict`; insert-only,
  no update/delete). The service injects `NpcMemoryStore`, `Clock`, `IdGenerator`,
  `Logger` — **no `WorldSession` parameter and no append path** (the structural
  firewall). `InMemoryNpcMemoryStore` enables full service testing without SQLite.
- **SQLite store + migration.** `0002_npc_memories` adds the `npc_memories` table with
  a **FK to `world_sessions`**, a scope index, `UNIQUE(session_id, npc_id, seq)`, and a
  **`BEFORE UPDATE` no-update trigger** (DELETE is left open for a future
  forgetting/eviction slice). `SqliteNpcMemoryStore` pre-checks the session
  (`session-not-found`), assigns a gapless `seq`, and maps a concurrent `UNIQUE`
  violation to `conflict`. Its **read boundary re-validates each stored row through
  the schema and re-asserts the parsed JSON scope against the queried SQL scope**; a
  corrupt or scope-divergent row is an expected content failure → **skipped**
  (logged `invalid-stored-memory`), never thrown, never blocking — contrast a
  `SqliteWorldStore` session/event fault, which still throws.
- **Authority unchanged.** Player claims are claims; NPC beliefs/observations can be
  wrong; dialogue summaries cannot update truth; `source:'llm'` memories cannot apply
  state changes; reducers/event log remain the only truth-mutation path. Logs carry
  ids/enums/seq/counts/codes only — **never** memory `text`, player lines, NPC/room
  names, provider prompts/responses, generated JSON, keys, or PII.
- **Provably browser-excluded.** A new `src/memory/**` ESLint block mirrors
  `src/dialogue/**` but is **stricter — it also forbids `**/world-session/**`** (and
  `interactions`/`encounters`/`dialogue`); the engine block forbids `**/memory/**`,
  the persistence-self wall forbids the `src/memory` app layer (still allowing
  `domain/memory`), and the browser catch-all `ignores` the richer block.
  `SqliteNpcMemoryStore` is covered by the existing persistence tsconfig
  exclude + Vite reachability + reciprocal walls. No API route, no `bootstrap`
  wiring, no renderer/RoomSpec/Three.js change.

## Living-World Room Memory v0

✅ **Implemented, headless and Node-only.** The first **room** memory layer lands as a
durable, scoped store of typed room memory records plus the pure **room-memory
firewall** — the room-side sibling of `npc-memory-persistence-v0`. Room memory is
**supporting context only and can never become room truth**: `WorldState.roomStates`
(`.visited`, `.flags`) and the append-only `WorldEvent[]` remain the sole authority;
the memory layer is constructed with **no reference to `WorldSession`/`WorldStore`/
`WorldCommand`/`WorldEvent`/`WorldState`**, so it has no code path to mutate state
([ADR-0025](./decisions/ADR-0025-living-world-room-memory-v0.md)). v0 adds **no API,
no frontend/dialogue wiring, no room-generation injection, no adjacent-room
pregeneration wiring, and no LLM memory writer or prompt injection**; the browser
stays in-memory and unwired.

- **Pure domain contracts + firewall.** `domain/memory/roomContracts.ts` is the
  strict, versioned schema (imports only `zod`; exports no `WorldCommand`/`WorldEvent`
  -producing function). `domain/memory/roomFirewall.ts` is pure/total/deterministic:
  `validateRoomMemoryDraft` (write firewall — validate + trim + default
  `confidence:'medium'`), `filterRoomMemoriesForScope` (read firewall — exact-triple
  re-filter), and `selectRecallRoomMemories` (the only ordering authority). Standalone
  — does not import or alter the NPC firewall.
- **Strict scope `(worldId, sessionId, roomId)`.** Every read and write is filtered
  against the exact triple. **No cross-session and no cross-world memory in v0.**
  `roomId` is a plain non-empty string — not FK'd to the `rooms` table.
- **Closed vocabularies.** Memory kinds: `player_claim` · `room_observation` ·
  `room_note` · `room_summary`. Source: `player` · `npc` · `game` · `llm` — **no
  `system` source** (hidden system/developer text is never stored). `confidence`
  (`low`/`medium`/`high`) is **informational only**: it does not update truth and does
  not drive recall. `text` is opaque, inert, **bounded to 280 chars**, never logged.
- **Deterministic recall.** Ordering is **`seq` desc, then `memoryId`** — never
  confidence, never recency-by-clock, never relevance. Recall defaults: `limit = 8`,
  `maxChars = 600` (cumulative `text.length` cap).
- **`RoomMemoryStore` port + headless `RoomMemoryService`.** The port mirrors
  `NpcMemoryStore` (typed results: `session-not-found`/`conflict`; insert-only, no
  update/delete). The service injects `RoomMemoryStore`, `Clock`, `IdGenerator`,
  `Logger` — **no `WorldSession` parameter and no append path** (the structural
  firewall). `InMemoryRoomMemoryStore` enables full service testing without SQLite.
- **SQLite store + migration.** `0003_room_memories` adds the `room_memories` table
  with a **FK to `world_sessions`** (**no FK to `rooms`** — room memory must not
  require a persisted room row), a scope index, `UNIQUE(session_id, room_id, seq)`,
  and a **`BEFORE UPDATE` no-update trigger** (DELETE is left open for a future
  forgetting/eviction slice). `SqliteRoomMemoryStore` pre-checks the session
  (`session-not-found`), assigns a gapless `seq`, and maps a concurrent `UNIQUE`
  violation to `conflict`. Its **read boundary re-validates each stored row and
  re-asserts the parsed JSON scope against the queried SQL scope**; a corrupt or
  scope-divergent row is an expected content failure → **skipped**
  (logged `invalid-stored-memory`), never thrown, never blocking.
- **Room memory is not room truth.** `WorldState.roomStates` (`.visited`, `.flags`)
  remains the authoritative per-room state. Player claims (`player_claim`) are claims;
  `room_observation` is not authoritative truth; `room_note`/`room_summary` are inert
  supporting context; `source:'llm'` memories cannot apply state changes. The
  structural no-append-path makes this provable.
- **No `eslint.config.js` change was needed** — existing blocks cover all new files:
  `domain/memory/**` and `domain/ports/**` under `src/domain/**`; `src/memory/**`
  under the strict memory block; `SqliteRoomMemoryStore` under the persistence-self
  wall (which already re-includes `domain/memory` via negation). No API route, no
  `bootstrap` wiring, no renderer/RoomSpec/Three.js change.

## Inventory & Health UI v0

✅ **Implemented, browser.** The first **player HUD** now surfaces `player.health`,
`player.status`, and `inventory` from the existing authoritative `WorldState` — a
**display-only, read-only** overlay with no domain, event, reducer, schema, backend,
or renderer change of any kind
([ADR-0026](./decisions/ADR-0026-inventory-health-ui-v0.md)).

- **Pure projection.** `projectPlayerHud(state: WorldState) → PlayerHudView`
  (`renderer/ui/playerHud.ts`) is a total, deterministic, side-effect-free function.
  It imports only domain **types** (`WorldState`, `InventoryItem`), returns fresh
  objects/arrays (no aliasing of the input), and exports no
  `WorldCommand`/`WorldEvent`-producing function. Covered by pure Vitest tests
  (health fraction math, item mapping, status copy, purity/no-mutation, structural
  read-only); no DOM/`jsdom`/`@testing-library` dependency was added.
- **Presentational component.** `StatusHud` (`renderer/ui/StatusHud.tsx`) is
  props-in, DOM-out React only — no `three`, no engine internals, no `world-session`,
  no services, no local state beyond render. Renders: health bar + `current/max` label
  (bar width = `fraction*100%`; `0/max` graceful empty state); inventory list keyed by
  `itemId` (`name ×quantity`; explicit "No items" when empty); status chips (row
  omitted when empty). `pointer-events: none` (canvas input passes through);
  `role="status"` + `aria-live="polite"` for accessibility. Styled with `.status-hud*`
  rules in `index.css`, consistent with `.hud`/`.room-notice`.
- **`App`-owned state.** `App` holds `playerHud: PlayerHudView | null`. Seeded from
  `result.state` at both session-start sites (bootstrap + prompt) and reset to `null`
  alongside `setActivePlay(null)` on a new prompt. `StatusHud` renders as an App-level
  overlay sibling of `RoomViewer`, so it survives `RoomViewer`'s navigation remount.
  `moved-to-room` does not touch player fields, so the HUD persists across rooms with
  no special reset.
- **`RoomViewer` wiring.** A single optional
  `onWorldStateChange?: (state: WorldState) => void` prop, fired only when an
  interaction or encounter resolve returns `applied` or `already-resolved` (the
  variants that already carry `state`). `App` passes
  `onWorldStateChange={(state) => setPlayerHud(projectPlayerHud(state))}` — no extra
  `WorldSession.getWorldState` read. No other `RoomViewer` behavior changes.
- **Not changed:** `domain/world/**` · `domain/roomSpec.ts` · `world-session/**` ·
  `interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` · `persistence/**`
  · `server/**` · `renderer/engine/**` · `eslint.config.js` · `package.json`. No new
  combat, inventory economy, item actions, equipment, status-effect engine, backend
  wiring, memory integration, LLM item generation, Three.js engine change, or new
  dependency was added.
- **Log-safe.** The projection is silent; `StatusHud` is presentational; no new log
  lines were added to `App`/`RoomViewer`. Item names/ids, health values/deltas, and
  status strings are never logged (mirrors the ADR-0013/ADR-0014/ADR-0015
  content-free log discipline).

## Session Save/Load v0

✅ **Implemented, browser.** A player can now **save the current session** to a single
named `localStorage` slot and **resume it later** in the same browser, restoring from
the integrity-checked `SaveGame` document through the **already-existing, already-tested**
`SaveGameService` and `WorldStore.restoreSession`
([ADR-0027](./decisions/ADR-0027-session-save-load-v0.md)).

The defining property: **`localStorage` is a byte parking spot, never truth.** Every load
re-parses, version-checks, integrity-checks, and reconstructs the snapshot from the event log
before anything is shown. The slot wrapper's `label`/`savedAt`/`currentRoomId` are display
hints; only `saveGameJson` crosses the integrity boundary.

- **`SaveSlotStore`.** A `KeyValueStore`-seamed interface (`app/saveSlotStore.ts`) with a
  thin `LocalStorageSaveSlotStore` browser binding (key `aigm.save.slot`). `read()` returns
  the parsed wrapper or `null`; `write()` JSON-stringifies the full wrapper. All `localStorage`
  access is wrapped in try/catch: unavailable reads → treat as no slot; quota exceeded on write
  → typed `quota-exceeded` code. Never throws into the render cycle. Tested over an in-memory
  `KeyValueStore` fake; the `localStorage` binding is exercised manually.
- **`buildRestoredPlay` (pure helper).** `app/buildRestoredPlay.ts` takes `(state,
  resolveResult, fallbackRoom)` and returns `{ play: ActivePlay; degraded: boolean }`.
  `roomSource` wraps the resolved room (or the fallback under `currentRoomId` when resolution
  fails). `degraded = !resolveResult.ok || resolveResult.source !== 'registry'` — authored
  current room → `false`, generated or unresolvable → `true`. `navigation = exampleNavigation`;
  `initialPlayer = projectPlayerHud(state)`. Imports no store/service; never mutates inputs.
  Tested with Vitest (authored/generated/failed-resolve cases; purity/no-mutation).
- **`SaveLoadBar` (presentational).** `renderer/ui/SaveLoadBar.tsx` receives
  `{ canSave, hasSave, busy, error, onSave, onContinue }`. Save enabled when `canSave`;
  Continue shown/enabled only when `hasSave`; both disabled during `busy`. Calm `role="alert"`
  errors — never raw error text, never save content. App-level overlay sibling of `RoomViewer`
  and `StatusHud`.
- **`App` wiring.** `App` constructs `SaveGameService` over the existing `worldStore` and a
  `LocalStorageSaveSlotStore`. `handleSave` writes on success; `handleLoad` reads → validates
  → restores → rebuilds `ActivePlay` via `buildRestoredPlay` → `setActivePlay` /
  `setPlayerHud` / notice; bumps the existing `requestVersion` ref to prevent a stale
  in-flight bootstrap from clobbering the restored `ActivePlay`; on any typed failure shows a
  calm error, current play untouched.
- **Honest restoration.** Authored current room → faithful (`source:'registry'`, no notice).
  Generated/non-authored or unresolvable → re-resolve by id; if not through the authored path,
  `FALLBACK_NOTICE` shown and `degraded:true`. In every case the player resumes at the correct
  `currentRoomId` with correct inventory/health/status/`roomStates`; only room visuals are
  best-effort for non-authored rooms.
- **Room cache restoration.** Authored saves still restore through the existing
  current-room resolver. Generated saves may additionally park optional
  `generatedQuestJson` and `generatedRoomCacheJson` sidecars; when both validate,
  visited generated rooms are rehydrated into a generated cache for stable
  backtracking. These sidecars are local, optional, and never authoritative.
- **Not changed:** `domain/world/saveGame.ts` · `world-session/saveGame.ts` ·
  `domain/ports/WorldStore.ts` · `world-session/InMemoryWorldStore.ts` · `persistence/**` ·
  `server/**` · `renderer/engine/**` · `renderer/RoomViewer.tsx` · `eslint.config.js` ·
  `package.json`. No new dependency was added.
- **Log-safe.** `handleSave`/`handleLoad` log ids/counts/codes/enums only — never the SaveGame
  JSON, slot wrapper, seed name, event payloads, item names/ids, room names, dialogue, prompt
  text, or any narrative/PII.

## Demo Quest Loop v0

✅ **Implemented, browser.** A **deterministic authored demo quest** ("The Steward's Toll") now
surfaces as a **read-only quest tracker** overlay — a pure projection of authoritative
`WorldState` with no domain, event, reducer, schema, authored-room, backend, or renderer change
of any kind ([ADR-0028](./decisions/ADR-0028-demo-quest-loop-v0.md)).

The defining property: **the quest is a derived lens, not a system.** The tracker observes three
conditions that existing services already write; it has no write path and cannot advance an
objective itself.

- **Authored quest data + pure evaluator.** `domain/quests/questSpec.ts` defines the
  zod-validated `QuestSpec` schema with a closed condition vocabulary (`room-flag`, `room-visited`,
  `has-item`, `has-status`). `domain/examples/demoQuest.ts` holds the hand-authored
  `demoQuestSpec` literal ("The Steward's Toll"). `domain/quests/evaluateQuest.ts` is the pure,
  total, deterministic `evaluateQuest(spec, state) → QuestView` — reads defensively via optional
  chaining, never throws on absent rooms/flags/visited, imports only domain types, exports no
  `WorldCommand`/`WorldEvent`-producing function.
- **Three objectives, all gated on existing authoritative state.** Objective 1
  (`roomStates['throne-room'].flags['interaction:offering-coffer'] === true`) is written by
  `object-interactions-v0`; Objective 2
  (`roomStates['throne-room'].flags['encounter:malik-encounter'] === true`) is written by
  `encounter-system-v0`; Objective 3 (`roomStates['ruined-safehouse'].visited === true`) is
  written by `multi-room-navigation-cache-v0`. No new event, command, reducer, or authored-room
  edit was needed.
- **Presentational overlay.** `renderer/ui/QuestTracker.tsx` is props-in, DOM-out React only —
  receives `{ view: QuestView }`, renders quest title + objectives + done markers; `pointer-events:
  none`; `role="status"` + `aria-live="polite"`. Imports no `three`, engine internals,
  `world-session`, or services.
- **App-owned state, four re-projection points.** `App` holds `quest: QuestView | null`. A single
  `refreshDerivedViews(state)` helper sets both `playerHud` and (when the spec is attached)
  `quest`; it is called at bootstrap, on `onWorldStateChange` (interaction/encounter), on
  `handleNavigate` `navigated` (Objective 3 flips immediately on entering the safehouse), and on
  load.
- **Gated to the authored example world.** The spec is attached only when
  `'throne-room' in state.roomStates` — deterministic anchor-room-presence check. Prompt-generated
  sessions leave `quest === null` and never render the tracker.
- **Save/load restores quest progress for free.** `evaluateQuest` is a pure function of
  `WorldState`; the same `refreshDerivedViews` call at load re-projects exact mid-quest progress.
  No `SaveGame` schema change.
- **Not changed:** `domain/world/**` · `domain/examples/throneRoom.ts` / `ruinedRoom.ts` ·
  `domain/interactions/**` · `domain/encounters/**` · `world-session/**` ·
  `domain/world/saveGame.ts` / `world-session/saveGame.ts` · `app/NavigationService.ts` ·
  `app/buildRestoredPlay.ts` · `renderer/RoomViewer.tsx` · `renderer/engine/**` · `dialogue/**` ·
  `memory/**` · `persistence/**` · `server/**` · `eslint.config.js` · `package.json`.
- **Log-safe.** The evaluator is pure and silent; `QuestTracker` is presentational. No new log
  lines were added to `App`/`RoomViewer`. Quest/objective text, ids, flag keys, item names/ids,
  status strings, room display names, and narrative content are never logged — mirrors the
  ADR-0013/0014/0015/0026 content-free log discipline.

## Demo Quest Mechanical Reactivity v0

✅ **Implemented, browser composition/UI.** The authored demo quest now has one small mechanical
reaction: the throne-room north arch is refused until Steward Malik is resolved, then navigates as
before. The gate reads the existing authoritative
`roomStates['throne-room'].flags['encounter:malik-encounter']` flag and returns a `blocked`
navigation result before the generic navigation service is called
([ADR-0046](./decisions/ADR-0046-demo-quest-mechanical-reactivity-v0.md)).

- **Three small slices.** The feature added a pure `evaluateExitGate` predicate and blocked message,
  App/composition-root gate wiring, and an authored post-use body for the tribute coffer once the
  existing `interaction:offering-coffer` flag is set.
- **NavigationService stayed generic.** It still resolves rooms and moves sessions without quest,
  Malik, authored-room, or coffer knowledge; `blocked` is produced by the composition-root gate.
- **Authority and boundaries unchanged.** No `RoomSpec` schema, `WorldEvent`, `WorldCommand`,
  reducer, backend, persistence, save-game, generated-room, or quest-authority change. The coffer
  body swap is presentation-only on the existing `already-resolved` interaction result.

## Consequence Journal v0

✅ **Implemented, browser.** A **six-entry authored consequence journal** now surfaces as a
**collapsible read-only journal panel** — a pure projection of authoritative `WorldState` with
no domain, event, reducer, schema, authored-room, backend, or renderer change of any kind
([ADR-0029](./decisions/ADR-0029-consequence-journal-v0.md)).

The defining property: **the journal is a derived lens, not a system.** It evaluates a list of
authored consequence predicates and shows only the ones currently true, in stable authored order.
It reads truth and never writes it.

- **Authored journal data + pure projector.** `domain/journal/journalSpec.ts` defines the
  zod-validated `JournalSpec`/`JournalEntrySpec` schema, reusing the closed `ObjectiveCondition`
  vocabulary from `domain/quests/questSpec.ts`. `domain/examples/demoJournal.ts` holds the
  hand-authored `demoJournalSpec` literal (six entries). `domain/journal/projectJournal.ts` is
  the pure, total, deterministic `projectJournal(spec, state) → JournalView` — reads defensively
  via the shared exported `evaluateCondition`, never throws on absent rooms/flags/statuses/items,
  imports only domain types, exports no `WorldCommand`/`WorldEvent`-producing function.
- **Six entries, all gated on existing authoritative state.** Each condition watches an existing
  `WorldState` field written by prior ADRs:

  | Entry | Condition | Source |
  | --- | --- | --- |
  | "You claimed the tribute coin." | `room-flag` `throne-room` / `interaction:offering-coffer` | ADR-0014 |
  | "You dealt with Steward Malik." | `room-flag` `throne-room` / `encounter:malik-encounter` | ADR-0015 |
  | "You entered the ruined safehouse." | `room-visited` `ruined-safehouse` | ADR-0016 |
  | "You became infected." | `has-status` `infected` | ADR-0015 |
  | "You faced a reanimated walker." | `room-flag` `ruined-safehouse` / `encounter:walker-encounter` | ADR-0015 |
  | "You secured a royal writ." | `has-item` `royal-writ` | ADR-0015 |

  No new event, command, reducer, or authored-room edit was needed.
- **Shared condition evaluator.** `domain/quests/evaluateQuest.ts` exports its existing pure
  `evaluateCondition(condition, state): boolean` (previously private). The journal projector
  imports it; no new shared engine and no behavior change to the quest path.
- **Presentational overlay.** `renderer/ui/JournalPanel.tsx` is props-in, DOM-out React only —
  receives `{ view: JournalView }`, collapsible (collapsed by default); empty state "Nothing of
  consequence yet."; `pointer-events:none` for static text; interactive collapse toggle;
  `role="status"` + `aria-live="polite"`. Imports no `three`, engine internals, `world-session`,
  or services.
- **App-owned state, four re-projection points.** `App` holds `journal: JournalView | null`.
  The existing `refreshDerivedViews(state)` helper (introduced with ADR-0028) now also sets
  `journal` (when the spec is attached); called at bootstrap, on `onWorldStateChange`
  (interaction/encounter), on `handleNavigate` `navigated`, and on load.
- **Gated to the authored example world.** The spec is attached only when `'throne-room' in
  state.roomStates` — the same anchor-room-presence check as the quest tracker. Prompt-generated
  sessions leave `journal === null` and never render the panel.
- **Save/load restores journal for free.** `projectJournal` is a pure function of `WorldState`;
  the same `refreshDerivedViews` call at load re-projects the exact set of true entries. No
  `SaveGame` schema change.
- **Not changed:** `domain/world/**` · `domain/quests/questSpec.ts` · `domain/examples/throneRoom.ts`
  / `ruinedRoom.ts` · `domain/interactions/**` · `domain/encounters/**` · `world-session/**` ·
  `domain/world/saveGame.ts` / `world-session/saveGame.ts` · `app/NavigationService.ts` ·
  `app/buildRestoredPlay.ts` · `renderer/RoomViewer.tsx` · `renderer/engine/**` · `dialogue/**` ·
  `memory/**` · `persistence/**` · `server/**` · `eslint.config.js` · `package.json`.
- **Log-safe.** The projector is pure and silent; `JournalPanel` is presentational. No new log
  lines were added to `App`/`RoomViewer`. Journal title/entry text, ids, flag keys, item
  names/ids, status strings, room display names, and narrative content are never logged — mirrors
  the ADR-0013/0014/0015/0026/0028 content-free log discipline.

## Cost/Usage Guardrails v0

✅ **Implemented, browser.** A local request-count **safety guardrail** wraps the one path that
can make real LLM calls — the PromptBar prompt-generation path — counting real provider attempts
in the current page/App lifetime, surfacing that count against a configurable cap, warning as
the cap nears, and requiring an explicit **confirm-to-continue** at cap
([ADR-0030](./decisions/ADR-0030-cost-usage-guardrails-v0.md)).

The defining property: **this is a local UI safety counter, not billing truth.** The count is
in-memory only, never persisted, never authoritative accounting, and never inspects the
provider's response or token usage. When the **fake** (default, offline, free) provider is
selected, the entire guard is **inert** — no count, no warning, no block, no UI.

- **Pure guard module.** `domain/usage/usageGuard.ts` holds pure types (`UsageGuardConfig`,
  `UsageGuardState`, `UsageGuardStatus`) and four pure helpers (`initialUsageState`,
  `recordAttempt`, `resetUsage`, `evaluate`). Total, deterministic, no I/O, no mutation, no
  React/logger/provider import. `evaluate(state, config)` returns `'inert'` when disabled,
  `'ok'` below the threshold, `'approaching'` at `cap − 1`, and `'at-cap'` at `>= cap`.
  Covered by pure Vitest tests; no DOM dependency added.
- **Config: `VITE_AIGM_LLM_SESSION_CAP` (optional, default 10).** Read only in
  `app/llmConfig.ts` alongside the existing `VITE_*` flags, parsed with the existing
  `parsePositiveInt`. Surfaced as `llmConfig.sessionCap`. No cost-estimate flag in v0.
- **App-owned state.** `App` holds two parallel storage pairs for closure/render access:
  `usageCountRef`/`usageCount` and `inFlightRef`/`inFlight`, plus `confirmGrantedRef` and
  `pendingPromptRef`. `guardEnabled` (real provider selected) and `guardCap` are module-level
  constants derived once at startup from the selection result and `llmConfig`.
- **Count increments before `getRoom()` resolves**, so unavailable / repaired / fallback
  outcomes all count. The existing repair/fallback pipeline is unchanged.
- **In-flight lock** (`inFlightRef`) is independent of the cap: set when a real generation
  begins, cleared in `finally`. Passes `disabled={inFlight}` into `PromptBar`.
- **At-cap gate**: when `status === 'at-cap'` and confirm not yet granted, the prompt is stored
  in `pendingPromptRef` and the handler returns. `handleGenerateAnyway` grants the confirm and
  replays the stored prompt — that call still increments the count.
- **`UsageMeter` overlay** (`renderer/ui/UsageMeter.tsx`): presentational React only; rendered
  only when `guardEnabled`. Returns `null` when `status === 'inert'`. Shows `Generations: N / cap`
  always when active; static, prompt-free warning copy for `approaching`/`at-cap`; "Generate
  anyway" confirm; "Reset usage" affordance. `role="status"` + `aria-live="polite"`.
- **Fake provider is completely inert:** `guardEnabled === false` → no count, no meter, no gate,
  no in-flight lock, `PromptBar.disabled` stays `false`. Adjacent pregeneration is fake-only
  and uncounted by design.
- **No persistence.** Usage state is in-memory only; resets on page reload. No `localStorage`,
  `SaveGame`, SQLite, or backend usage state.
- **Log-safe.** One log line per real attempt: `count`/`cap`/`status` enum (non-sensitive
  counters/enums). Keys, prompts, seeds, provider bodies, generated JSON, token counts, and PII
  are never logged.
- **Not changed:** the room-generation safety pipeline (`GeneratedRoomSource → assembleRoom →
  repair/fallback`); `OpenAICompatibleRoomGenerator`; adjacent pregeneration;
  `eslint.config.js`; `package.json`. No new lint block, no new layer.

## Dialogue Usage Guardrails v0

✅ **Implemented, browser/app composition.** With a complete real-provider config,
opening an NPC dialogue used to auto-fire a provider reply before the player said
anything, and every dialogue `reply` call (open plus each prompt/Continue click)
bypassed the Cost/Usage Guardrails v0 session meter entirely — the meter could claim
the player was under cap while real dialogue spend accrued. Dialogue Usage
Guardrails v0 closes both gaps by removing the open-time call and metering the
surviving user-triggered calls against the existing meter
([ADR-0068](./decisions/ADR-0068-dialogue-usage-guardrails-v0.md)).

- **Greeting-only on open, no provider call.** `RoomViewer`'s
  `onRequestOpenInteraction` NPC-dialogue branch seeds only the static
  authored/generated `dialogue.greeting` turn and sets the target — no
  `npcDialogueService.reply` call and no pending state from opening alone, for
  either provider.
- **`App`-owned `requestDialogueAttempt` gate.** `App` exposes one stable
  `requestDialogueAttempt?: () => boolean` callback to `RoomViewer`, reusing the
  unchanged `domain/usage/usageGuard.ts` (`canAttemptOptional`/`recordAttempt`) and
  the existing `usageCountRef`/`setUsageCount`/`guardCap` (`= llmConfig.sessionCap`)
  from ADR-0030/ADR-0050 — no new usage-state store. `dialogueGuardEnabled =
  dialogueProviderSelection.kind === 'real'`.
- **Fake dialogue is zero-cost.** When the fake provider is selected, the gate
  always returns `true` and records nothing — dialogue stays fully playable and
  uncounted, matching `FakeNPCDialogueProvider`'s existing zero-cost/no-I/O
  contract.
- **Real dialogue shares the session meter.** Below cap, the gate records the
  attempt (increments the shared `usageCountRef`/`UsageMeter` count) *before*
  `RoomViewer` calls the provider, then allows the call. Dialogue shares the same
  single per-session ceiling as room/objective/gate generation — a deliberate v0
  tradeoff (one honest budget, not a separate dialogue cap).
- **At-cap block, no bypass.** At cap, `canAttemptOptional` returns `false`: the
  gate returns `false`, `RoomViewer` does not call the provider, and shows the
  fixed calm constant `DIALOGUE_AT_CAP_MESSAGE = 'They have nothing more to say
  right now.'` (new export in `app/dialogue.ts`, co-located with
  `dialogueResultMessage`) via the existing `setNPCDialogueMessage` message slot.
  Greeting, prompt buttons, and Close/Esc remain usable. There is no "continue
  anyway" override for dialogue in v0 (unlike the room-generation at-cap path).
  Because no provider call happened, the blocked prompt is never appended as a
  player turn.
- **Regression-safe.** generated-npc-dialogue-spec-v0 (ADR-0067) is unaffected:
  generated NPCs still open `NPCDialoguePanel` with a greeting and two prompt
  buttons. The `providerGateStatus`/`providerGate` carry bugfix (ADR-0064 area)
  is intentionally out of scope and shipped separately.
- **No new safety surface.** No `WorldState` mutation, no memory write, no
  schema/save-load/persistence change, and no `NPCDialogueService` or provider
  change — `FakeNPCDialogueProvider` and `OpenAICompatibleNPCDialogueProvider`
  stay byte-identical. Dialogue-attempt logs carry only a safe `{ count, cap,
  status }` shape, matching the existing usage-log discipline; no provider
  name/content, API key, prompt, or dialogue text is logged.

## Layered architecture

Dependencies point **inward**, toward the domain. Outer layers may depend on
inner layers; inner layers never depend on outer layers.

```
        ┌────────────────────────────────────────────────────────┐
        │  DOMAIN / CONTRACTS  (pure data + types, zero I/O)       │
        │  RoomSpec + World schemas · pure validators/projections  │
        │  ✅ ports: RoomSource, RoomGenerator, WorldStore, time/id │
        └────────────────────────────────────────────────────────┘
              ▲              ▲                ▲              ▲
       imports│       imports│         impl   │       impl   │ (future)
     ┌────────┴─────┐ ┌──────┴───────┐ ┌──────┴──────┐ ┌─────┴──────────┐
     │  RENDERER    │ │  UI (React)  │ │  APP /       │ │  GENERATION    │
     │  (Three.js)  │ │              │ │  COMPOSITION │ │  v0: fake gen  │
     │  no React    │ │  no Three    │ │  ROOT        │ │  BE/DB future  │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────────────────┘
            │                │                │
            └──── both may use ──► Logger (platform port) ◄──┘
```

| Layer | Responsibility | May depend on | Must NOT depend on |
| --- | --- | --- | --- |
| **Domain / Contracts** | Room, authoritative world, and initial-canon `WorldBibleSeed` contracts; pure validation/projection, types, and ports. | Nothing (only zod) | React, Three.js, DOM, network, DB |
| **Renderer** (`renderer/engine`) | Turn a validated room into a Three.js scene; own the render loop, controls, disposal. | Domain | React, network, DB |
| **UI** (`renderer/ui`) | Presentational React overlay (HUD, dialogue panel). | Domain, approved host contract | Three.js internals, network, DB |
| **App / Composition root** | Wire concrete implementations, including prompt-only bible seeding/degradation and generated-session ownership. | All of the above | — |
| ✅ **Generation (v0, fakes + opt-in real room provider)** | Prompt → validated **WorldBibleSeed data** and compact seed → **RoomSpec data**: deterministic silent fakes by default, plus an opt-in `OpenAICompatibleRoomGenerator` (raw `fetch`, dev-only) behind the same port. Output is raw text/data, never code. 🔜 more real adapters. | Domain (+ the `fetch` global) | Logger/platform, Renderer, React, DB |
| ✅ **World session (v0, headless)** | Commands → validated append-only events → pure `WorldState` projection; in-memory store and SaveGame boundary. | Domain, Logger port | React, Three.js, Renderer, DB |
| ✅ **Interactions (v0, headless)** | Pure effect plans executed through `WorldSession.appendEvent`; typed outcomes for composition. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Encounters (v0, headless)** | Pure encounter plans executed through `WorldSession.appendEvent` (shared `applyCommands`); typed two-phase outcomes for composition. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Dialogue (v0, headless)** | Pure dialogue context plus a read-only service over `WorldSession.getWorldState` and an injected provider port. | Domain, World session, Logger port | React, Three.js, Renderer, DB |
| ✅ **Memory (v0, headless)** | Scoped NPC and room memory: pure firewall/contracts, `NpcMemoryStore` and `RoomMemoryStore` ports, and `WorldSession`-free services (`NpcMemoryService`/`RoomMemoryService`, `remember`/`recall`). Supporting context only — no write path to truth. | Domain (incl. `domain/memory`), Logger port | React, Three.js, Renderer, DB, **World session**, Interactions, Encounters, Dialogue |
| ✅ **Persistence (v0, headless, Node-only)** | `node:sqlite` migrations + `SqliteWorldStore` + `SqliteRoomStore` + `SqliteNpcMemoryStore` (migration `0002`) + `SqliteRoomMemoryStore` (migration `0003`). World/room stores are consumed by the Node API; the memory stores are exercised by tests only in v0. Never by the browser. | Domain contracts/ports, Logger **types**, `node:sqlite` | React, Three.js, Renderer, UI, Generation, World session, Interactions, Encounters, Dialogue, **Memory app layer**, App, Server |
| ✅ **Backend / HTTP API v0** | Native `node:http` session/room edge over `WorldSession` and SQLite stores. Browser-excluded; no generation hosting or frontend client yet. | Domain, World session, Persistence, Platform | React, Three.js, UI, Renderer |

The current code already honors the top three rows: `Engine` is pure Three.js
with no React import; the React host talks to it through methods and callbacks;
`loadRoomSpec` is pure and dependency-light. See [BOUNDARIES](./BOUNDARIES.md)
for the exact allowed/forbidden import rules.

## The trust boundary: data-only RoomSpec → trusted renderer

This is the most important property in the system and the reason the future AI
slice can be safe. It is captured formally in
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md).

```
  author (hardcoded today, 🔜 an LLM later)
        │
        ▼
   RoomSpec  ── pure JSON-shaped data: numbers, strings, enums. ──┐
        │       No functions. No scripts. No code. Never eval'd.   │
        ▼                                                          │
   loadRoomSpec(raw)   ◄── THE BOUNDARY ──►  zod validation        │  TRUST
        │   envelope: strict (throws on bad required fields)       │  BOUNDARY
        │   objects:  lenient (bad object skipped, room survives)  │
        ▼                                                          │
   trusted, hand-written builders  (type string → fixed registry) ─┘
        │
        ▼
   Three.js scene
```

Two rules make this safe:

1. **A RoomSpec is data, never behavior.** It selects from a *fixed registry of
   known `type` strings* (including the generated-room visual vocabulary such as
   `scroll`, `book`, `paper`, `map`, `chest`, `corpse`, `table`, `altar`,
   `statue`, `machine`, `artifact`, and `candle`). It can never introduce new
   executable behavior. The mapping from `type` → 3D objects is hand-written,
   reviewed, trusted code.
2. **Validation happens at the boundary.** `loadRoomSpec` validates everything
   crossing into the renderer. Unknown or malformed objects degrade to a visible,
   non-interactive mystery marker; they never crash the renderer and never
   execute.

Because of this, a *hostile or garbage* generation (later) is just data that
either validates — and is rendered by trusted code — or fails validation and is
skipped. There is no code path from "model output" to "executed JavaScript".

## Current data flow (v0)

```
App.tsx
  ├─ playerHud: PlayerHudView | null    ✅ App-owned read-only render cache (seeded at session start)
  ├─ <StatusHud view={playerHud} />     ✅ App-level overlay (sibling of RoomViewer)
  ├─ quest: QuestView | null            ✅ App-owned read-only quest cache; null for prompt-generated sessions
  ├─ <QuestTracker view={quest} />      ✅ App-level overlay; hidden when quest === null (pointer-events:none; aria-live)
  ├─ journal: JournalView | null        ✅ App-owned read-only journal cache; null for prompt-generated sessions
  ├─ <JournalPanel view={journal} />    ✅ App-level overlay; hidden when journal === null; collapsed by default (pointer-events:none for text; aria-live)
  ├─ <SaveLoadBar .../>                 ✅ App-level save/load control (sibling of RoomViewer)
  ├─ usageCount / usageStatus           ✅ App-owned guardrail state (real provider only; in-memory, never persisted)
  ├─ <UsageMeter .../>                  ✅ App-level overlay; null for fake provider (role="status"; aria-live)
  ├─ <AppRoomEntryOverlay room sessionId entrySeq notice onDismissNotice />  ✅ per-room-entry overlays
  │    ├─ <RoomIntroPanel summary roomKey />  ✅ dismissible intro; null when no text or dismissed; resetKey resets on new room entry
  │    └─ repaired/fallback notice (static, dismissible; shown for provenance repaired | fallback)
  └─ RoomViewer.tsx                     (React host — owns the engine lifecycle)
       ├─ loadRoomSpec(throneRoom)       ✅ validation boundary (today: static data)
       ├─ new Engine(container)          ✅ pure Three.js
       │    ├─ buildLighting(room)        ambient + optional hemisphere
       │    ├─ buildShell(room)           floor + walls (north exit split; iso cutaway curbs)
       │    ├─ buildObjects(room)         type→builder registry, mystery-marker fallback
       │    ├─ buildPlayerMarker()        renderer-internal player object (not RoomSpec data)
       │    ├─ IsometricCameraController  orthographic iso camera; follows the player
       │    └─ MovementControls           screen-relative WASD/arrows → player (AABB clamp)
       │       (LookControls retained but NOT instantiated — future free-camera mode)
       ├─ engine.onActiveInteractionChange → React state → <Hud/>
       └─ engine.onRequestOpenInteraction  → RoomViewer id lookup
            ├─ exit? → NavigationService → existing moved-to-room
            ├─ encounter? → present choices → EncounterService (on choose)
            │    applied/already-resolved → onWorldStateChange(result.state)
            │                               → App: refreshDerivedViews(state)
            ├─ dialogue? → NPCDialogueService.getWorldState → fake provider
            │    → component-only history → <NPCDialoguePanel/>
            └─ else effect? → InteractionService
                 → WorldSession.appendEvent (shared applyCommands)
                 → typed result message → <DialoguePanel/>
                 applied/already-resolved → onWorldStateChange(result.state)
                                            → App: refreshDerivedViews(state)
```

The React ↔ engine seam is **callbacks + imperative methods**, not shared
mutable state and not React reaching into Three.js objects. That seam is the
"approved host interface" referenced in [BOUNDARIES](./BOUNDARIES.md).

### Generated-room data flow (Generation Foundation v0)

Submitting a prompt swaps the room source; the host path is otherwise identical:

```
PromptBar.onSubmit(prompt)                    (app chrome — not renderer UI)
  └─ App.handlePrompt
       ├─ FakeWorldBibleSeeder.seed(prompt)   → validated WorldBibleSeed
       │    └─ failure → raw prompt seed + no worldBible
       ├─ worldBibleToGeneratorSeed(bible)    → compact title-first generatorSeed
       └─ GeneratedRoomSource(FakeRoomGenerator, generatorSeed, logger, fallbackRoom)
            ├─ FakeRoomGenerator.generate(generatorSeed) → raw untrusted JSON text
            │     └─ throw/reject → RoomLoadResult unavailable (retry path)
            ├─ assembleRoom(rawText, fallbackRoom) ✅ pure domain pipeline
            │     JSON.parse
            │     → repairGeneratedAliases → repairGeneratedObjectTransforms
            │     → loadRoomSpec
            │     → clampGeneratedShell (2.5) → repairGeneratedObjects (2.6)
            │     → composeGeneratedRoom (2.7) → repairGeneratedSpawn (2.8)
            │     → repairGeneratedExits (2.9)
            │     → validateRoom → repairRoom → re-validate → fallback
            │     └─ ALWAYS { room (zero-fatal), diagnostics }
            └─ RoomLoadResult { ok:true, room, provenance } (generated | repaired | fallback)
                 ├─ start unchanged WorldSession; keep optional bible in ActivePlay
                 ├─ static notice if repaired | fallback
                 └─ RoomViewer/engine receive only the validated room
```

`RoomViewer` and the engine are **unchanged**: they still consume a `RoomSource`
and a validated `LoadedRoom`. Only composition knows the prompt, world bible,
generator seed, fakes, or fallback exists. Logs contain safe enums/counts/codes/
lengths only—never prompt/bible/seed/generated JSON/error text. Bad room content
yields a repaired or fallback room (`ok:true`); world-bible failure degrades to
the raw-prompt seed, and only a room-generator throw/reject is `unavailable`.

## Renderer Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/roomSpec.ts` | `RoomSpecSchema` (envelope) + `RoomObjectSchema` (discriminated union on `type`); inferred `RoomSpec` / `RoomObject` types. Schema/types only, no behavior. |
| `domain/loadRoomSpec.ts` | `loadRoomSpec` (strict envelope, lenient objects) + the `LoadedRoom` result type. |
| `domain/ports/interaction.ts` | The neutral interaction view-model shared by the engine and UI, including an optional passive object id for composition lookup and a derived `Affordance` used only for presentation. Also owns pure validated-object projection helpers for `Interactable[]` and affordance lookup. |
| `domain/examples/throneRoom.ts` | The single hardcoded demo room — pure data literal. |
| `renderer/engine/Engine.ts` | Owns renderer/scene, the **player object** + a `CameraController` (isometric), render loop, **player-position** proximity, interaction keys, and **total `dispose()`**. No React. |
| `renderer/engine/camera/` | `CameraController` interface + `IsometricCameraController` (orthographic true-isometric, follows the player) over a pure, WebGL-free `isometric.ts` math module (offset / pose / screen-relative move / clamp / frustum). |
| `renderer/engine/playerMarker.ts` | `buildPlayerMarker` — the minimal **renderer-internal** player marker (capsule + facing nose). Presentation, **not** RoomSpec data. |
| `renderer/engine/builders/` | `buildShell` (floor + walls, with isometric **cutaway curbs** on the camera-facing walls), `buildLighting`, and the object `registry` + `buildObjects` with mystery-marker fallback and trusted procedural builders for every current `RoomObject["type"]` ([ADR-0033](./decisions/ADR-0033-generated-room-visual-vocabulary-v0.md)). Interactable objects keep one `interactable-indicator` floor ring; its material color comes from the fixed `AFFORDANCE_RING_COLOR` map ([ADR-0036](./decisions/ADR-0036-generated-room-interaction-affordances-v0.md)). |
| `renderer/engine/controls/` | `MovementControls` (screen-relative WASD/arrows driving the **player**, room-clamped); `LookControls` (drag-look) **retained but not instantiated** in isometric mode. |
| `renderer/engine/disposables.ts` | `Disposables` + `disposeObject` — explicit GPU teardown (Three.js does not GC geometries/materials/textures). |
| `renderer/ui/` | Presentational React overlays: `Hud` (interaction key + deterministic affordance verb chip + existing prompt); `DialoguePanel` (result messages); `StatusHud` (read-only player health/inventory/status HUD; `pointer-events:none`; `aria-live`); `playerHud.ts` (pure `projectPlayerHud(WorldState) → PlayerHudView` projection + `PlayerHudView`/`PlayerHudHealth`/`PlayerHudItem` types); `SaveLoadBar.tsx` (save/load bar; receives `{ canSave, hasSave, busy, error, onSave, onContinue }`; calm `role="alert"` errors; no save content shown); `QuestTracker.tsx` (read-only quest tracker; receives `{ view: QuestView }`; renders title + objective done markers; `pointer-events:none`; `role="status"` + `aria-live="polite"`; no service or engine import); `JournalPanel.tsx` (collapsible read-only journal; receives `{ view: JournalView }`; collapsed by default; empty state "Nothing of consequence yet."; `pointer-events:none` for text; interactive collapse toggle; `role="status"` + `aria-live="polite"`; no service or engine import); `UsageMeter.tsx` (local session-cap guardrail overlay; receives `{ count, cap, status, onGenerateAnyway, onReset }`; rendered only when `guardEnabled`; returns `null` when `status === 'inert'`; `role="status"` + `aria-live="polite"`; no `three`, engine internals, or services); `RoomIntroPanel.tsx` (dismissible room intro panel — see module summary row below); `roomIntroPanelState.ts` (pure dismiss-state helpers). |
| `renderer/RoomViewer.tsx` | The composition seam: constructs/disposes the engine, bridges engine callbacks to React state. StrictMode-safe (mount → dispose → mount leaks nothing). |
| `domain/quests/questSpec.ts` | `QuestSpec`/`QuestSpecSchema` — zod-validated authored data descriptor; closed condition vocabulary (`room-flag`, `room-visited`, `has-item`, `has-status`). Imports only `zod`; exports no command/event-producing function. |
| `domain/quests/evaluateQuest.ts` | Pure `evaluateQuest(spec: QuestSpec, state: WorldState) → QuestView` and the exported pure `evaluateCondition(condition, state): boolean` (shared with the journal projector — previously private, now a one-line export with no behavior change). Total, deterministic, no I/O; reads defensively (optional chaining); missing rooms/flags/visited → `false`, never throws. Covered by co-located `evaluateQuest.test.ts` (pure Vitest, no DOM). |
| `domain/examples/demoQuest.ts` | Hand-authored `demoQuestSpec` literal ("The Steward's Toll"): three objectives wired to the existing `throne-room` interaction/encounter flags and `ruined-safehouse` visited mark. |
| `domain/journal/journalSpec.ts` | `JournalSpec`/`JournalEntrySpec`/`JournalSpecSchema` — zod-validated authored data descriptor; reuses `ObjectiveCondition` from `questSpec.ts`. Imports only `zod` and domain types; exports no command/event-producing function. |
| `domain/journal/projectJournal.ts` | Pure `projectJournal(spec: JournalSpec, state: WorldState) → JournalView`. Total, deterministic, no I/O; reads defensively via the shared `evaluateCondition` (optional chaining); missing rooms/flags/statuses/items → `false`, never throws; emits only true entries in authored order. Covered by co-located `projectJournal.test.ts` (pure Vitest, no DOM). |
| `domain/examples/demoJournal.ts` | Hand-authored `demoJournalSpec` literal: six entries wired to existing `WorldState` conditions — `throne-room` interaction/encounter flags, `ruined-safehouse` visited, `infected` status, `encounter:walker-encounter` flag, and `royal-writ` inventory. |
| `domain/usage/usageGuard.ts` | Pure `UsageGuardConfig` / `UsageGuardState` / `UsageGuardStatus` types and four pure helpers: `initialUsageState`, `recordAttempt`, `resetUsage`, `evaluate(state, config) → UsageGuardStatus`. Total, deterministic, no I/O, no mutation; imports nothing. Covered by co-located `usageGuard.test.ts` (pure Vitest, no DOM). |
| `domain/roomSummary.ts` | Pure `buildRoomSummary(room: LoadedRoom) → RoomSummary \| null` + `RoomSummary`/`RoomSummaryDirection`/`RoomSummaryMention` types. Selects a focal object (reusing `selectGeneratedStoryAnchorIndex`; fallback to first non-exit interactable or NPC), up to two support objects, and composes summary text from a closed hand-written `NOUNS` table + inferred cardinal directions. Never reads `object.name`, `interaction.title/body/prompt`, skipped objects, or raw generated JSON. Returns `null` when no focal object qualifies. Covered by co-located `roomSummary.test.ts` (pure Vitest, no DOM). ([ADR-0035](./decisions/ADR-0035-room-inspect-summary-v0.md)) |
| `renderer/ui/roomIntroPanelState.ts` | Pure state helpers for panel dismiss tracking: `RoomIntroPanelState` type, `dismissRoomIntroPanel(resetKey) → RoomIntroPanelState`, `isRoomIntroPanelDismissed(state, resetKey) → boolean`. No I/O, no React, no domain import. |
| `renderer/ui/RoomIntroPanel.tsx` | Presentational dismissible room intro panel. Receives `{ summary: RoomSummary \| null, roomKey?: string }`. Returns `null` when text is empty or the panel is dismissed for the current `resetKey`. Renders summary text and a dismiss button; `role="status"` + `aria-live="polite"`. Imports no engine internals or services. Covered by co-located `RoomIntroPanel.test.tsx` (Vitest + `@testing-library/react`). |
| `app/roomIntro.ts` | Pure helper: `buildRoomIntroView(room: LoadedRoom, sessionId: string, entrySeq: number) → RoomIntroView`. Derives `summary` via `buildRoomSummary` and `roomKey` as `sessionId:room.id:entrySeq`. Imports no store/service/React. |

## Generation Foundation v0 — module summary

| Module | Role |
| --- | --- |
| `domain/ports/RoomGenerator.ts` | The `RoomGenerator` port: `generate(prompt) → Promise<string>` of **raw, untrusted JSON text**. Domain-pure contract; the trust-boundary rules live in its doc comment. |
| `domain/ports/WorldBibleSeeder.ts` | Domain-safe `WorldBibleSeeder` port: prompt → validated `WorldBibleSeed`. |
| `domain/worldBible/worldBibleSeed.ts` | Strict, versioned, bounded initial-canon schema/types, including the bounded opening arc. Not event/current-state data. |
| `domain/worldBible/worldBibleToSeed.ts` | Pure deterministic title-first projection to a generator seed capped at 160 characters. |
| `domain/generatedRoomThemeVocabulary.ts` | Pure generated-room theme vocabulary resolver ([ADR-0044](./decisions/ADR-0044-generated-room-theme-vocabulary-v0.md)) for the existing `fantasy-keep` and `post-apoc` theme packs. Returns deterministic object pools, prop shapes, palette, NPC names, and `neverAppear` suppressions for fake/generated rooms. Missing theme falls back to default fantasy behavior; no sci-fi/spaceship support. |
| `generation/FakeWorldBibleSeeder.ts` | Browser-local deterministic seeder over the shared PRNG and two theme packs; validates internally, has no real model/I/O/logger. |
| `generation/prng.ts` | Deterministic seeded PRNG (`xmur3` + `mulberry32`) and a small `Rng` helper. Pure — no I/O, no `Math.random`/`Date.now`. |
| `generation/FakeRoomGenerator.ts` | A deterministic `RoomGenerator`: prompt -> seeded PRNG -> RoomSpec **data**, serialized with `JSON.stringify`. Consumes optional `GeneratedRoomThemeVocabulary` by constructor DI; missing vocabulary uses default fantasy behavior. Emits only the published vocabulary; same prompt -> byte-identical output. No real model. |
| `generation/OpenAICompatibleRoomGenerator.ts` | The opt-in **real** `RoomGenerator` ([ADR-0023](./decisions/ADR-0023-real-room-generator-provider-v0.md)): one generic adapter for any OpenAI-compatible endpoint (OpenAI/DeepSeek). One non-streaming `fetch` POST over an injected transport seam, hard `AbortController` timeout, no retry, no SDK; returns `choices[0].message.content` **verbatim**. Imports no logger; throws only fixed safe codes (`llm-request-failed`/`llm-timeout`/`llm-empty-response`). No parse/validate/repair here. |
| `generation/llmRoomPrompt.ts` | Pure, side-effect-free prompt builder for the real provider: a static system message (published vocabulary, exact `object.type` allowlist, synonym guidance, story-anchor guidance, RoomSpec shape, conventions) + one user message carrying the seed clamped to a hard `MAX_SEED_CHARS`. Data-only; no renderer/builders/assets/code instructions. No I/O, no logger; bounds are unit-tested. |
| `app/llmConfig.ts` | The **only** browser module that reads `import.meta.env`. Parses a typed `LlmConfig` (provider/model/key/`maxTokens`/`timeoutMs`), holds the provider → built-in base-URL map, and the `isRealProviderComplete` check. `generation/**` never reads env. |
| `app/selectRoomGenerator.ts` | Composition factory: returns the real `OpenAICompatibleRoomGenerator` only when the config is complete, else `FakeRoomGenerator` with reason `config-disabled`. Pure (no I/O at selection time); also returns a log-safe selection summary (provider/model/numbers or the fixed reason). |
| `domain/validateRoom.ts` | Pure semantic validator: `validateRoom(room) → RoomValidationResult` of severity-tagged issues. Checks *playability* (dimensions, spawn-in-bounds, object/light budgets, usable interactions) over a loaded room — a domain peer of `loadRoomSpec`. No I/O, no logger, no React/Three ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)). |
| `domain/repairRoom.ts` | Pure deterministic repair: `repairRoom(room) → LoadedRoom`. Non-mutating; only clamps spawn into the walkable AABB and truncates over-hard-budget objects/torches — never resizes rooms or invents content. Code peer of `validateRoom` ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). |
| `domain/generatedRoomLayout.ts` | Generated-room layout contract ([ADR-0031](./decisions/ADR-0031-generated-room-layout-contract-v0.md)): `GENERATED_ROOM` constants (default 18, min 14, max 24, max objects 30); four benign normalizers in `assembleRoom` — `clampGeneratedShell` (2.5; width/depth → `[14..24]`), `repairGeneratedObjects` (2.6; X/Z bounds + count cap ≤ 30, drops decorative first), `repairGeneratedSpawn` (2.8; clamp + deterministic nudge away from blocking objects), `repairGeneratedExits` (2.9; snap to nearest wall face). Pure, no I/O, no logger, no mutation. Never applied to authored/static/fallback rooms. |
| `domain/generatedRoomComposition.ts` | Generated-room composition and story-anchor selection ([ADR-0032](./decisions/ADR-0032-generated-room-composition-v0.md), [ADR-0034](./decisions/ADR-0034-generated-room-story-anchors-v0.md), [ADR-0044](./decisions/ADR-0044-generated-room-theme-vocabulary-v0.md)): pure role classification, zone computation, `selectGeneratedStoryAnchorIndex`, and `composeGeneratedRoom` stage 2.7. Relocates existing objects only to clear the central corridor and foreground one derived anchor/NPC/interactable/clutter placement; preserves count and non-position fields; missing roles are diagnostic-only. Accepts optional structured `themePack`: `post-apoc` prefers `machine`/`corpse`; missing theme and `fantasy-keep` preserve default priority. Safe booleans: `composed`, `lacksAnchor`, `lacksInteractable`. Never applied to authored/static/fallback rooms. |
| `domain/generatedRoomAliases.ts` / `domain/generatedRoomObjectTransforms.ts` | Generated-room visual vocabulary normalizers ([ADR-0033](./decisions/ADR-0033-generated-room-visual-vocabulary-v0.md)): allowlisted type-only alias repair and optional transform repair before `loadRoomSpec`. They never repair required fields, interactions, positions, or arbitrary/fuzzy nouns; direct `loadRoomSpec` behavior stays strict. |
| `domain/assembleRoom.ts` | Pure assembly pipeline: `assembleRoom(rawText, fallbackRoom, options) -> { room, diagnostics }`. Composes `JSON.parse` -> `repairGeneratedAliases` -> `repairGeneratedObjectTransforms` -> `loadRoomSpec` -> `clampGeneratedShell` (2.5) -> `repairGeneratedObjects` (2.6) -> `composeGeneratedRoom` (2.7, optional structured `themePack`) -> `repairGeneratedSpawn` (2.8) -> `repairGeneratedExits` (2.9) -> `validateRoom` -> `repairRoom` -> re-validate -> fallback; **always** returns a zero-fatal room plus safe diagnostics (provenance/stage/codes/counts/booleans/normalization flags). Synchronous, no I/O, never logs ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md), [ADR-0031](./decisions/ADR-0031-generated-room-layout-contract-v0.md), [ADR-0032](./decisions/ADR-0032-generated-room-composition-v0.md), [ADR-0033](./decisions/ADR-0033-generated-room-visual-vocabulary-v0.md), [ADR-0034](./decisions/ADR-0034-generated-room-story-anchors-v0.md), [ADR-0044](./decisions/ADR-0044-generated-room-theme-vocabulary-v0.md)). |
| `domain/examples/fallbackRoom.ts` | The trusted, data-only fallback room (the `throneRoom` authoring pattern): a small in-bounds stone antechamber, zero fatal/zero warning, no prompt or story text. Injected by the host as `assembleRoom`'s last resort. |
| `room/GeneratedRoomSource.ts` | A `RoomSource` adapter (composition layer) that runs the generator, then `assembleRoom`. A generator throw/reject → `unavailable`; otherwise **always** `ok:true` with `provenance` (`generated`/`repaired`/`fallback`). Logs one safe line (provenance/stage/codes/counts/boolean diagnostics, including count-only vocabulary diagnostics) — never prompt/raw JSON/story text/object names. |
| `app/AdjacentRoomPregenerator.ts` | Composition-layer room-acquisition seam ([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)). `resolveRoom(id)` is cache-first, in-flight-aware, and total (authored → `RoomRegistry`; non-authored → `GeneratedRoomSource → assembleRoom`, id-normalized; never throws). `warmAdjacent(room)` warms the current room's exits in the background, capped at `maxJobs` (default 3), depth-1. Implements the narrow `RoomResolver` that `NavigationService` depends on. |
| `app/PromptBar.tsx` | Presentational prompt input + Generate button — app composition chrome, **not** renderer UI. Trims/validates; emits `onSubmit(prompt)`. |
| `app/worldBible.ts` | Prompt-path composition helper: seed + project + safe enum/count/length logging; on failure return the raw prompt and no bible. |
| `app/fallbackNotice.ts` | The static, prompt-free notice copy + the pure `shouldShowFallbackNotice(provenance)` decision (show for `repaired`/`fallback`). |
| `App.tsx` | Composition root: selects the prompt-path generator once via `selectRoomGenerator(readLlmConfig())` (real provider when configured, else fake) and logs the safe selection summary; keeps a separate default `FakeRoomGenerator` for authored/example adjacent pre-generation. PromptBar submit seeds/projects a bible, resolves `themeVocabulary(prepared.worldBible?.themePack)`, passes the compact seed to `GeneratedRoomSource`, and stores the optional bible on generated `ActivePlay`. When the prompt path is fake, it constructs `FakeRoomGenerator(vocabulary)` for the primary room and for that generated play's adjacent generator; generated adjacents also pass the structured `themePack` into `assembleRoom`. Authored bootstrap/pregeneration remain bible-free/default. Constructs `SaveGameService` + `LocalStorageSaveSlotStore`; owns `handleSave`/`handleLoad` with `requestVersion` guarding and renders `<SaveLoadBar>`. Derives `guardEnabled` (provider !== `'fake'`) and `guardCap` (`llmConfig.sessionCap`, default 10) once at module level; holds `usageCountRef`/`usageCount` and `inFlightRef`/`inFlight` pairs for guardrail state; count increments before `getRoom()` resolves so failures/fallbacks still count; in-flight lock drives `PromptBar disabled={inFlight}`; at-cap gate stores prompt until `handleGenerateAnyway` grants confirm; renders `<UsageMeter>` only when `guardEnabled`. |
| `app/saveSlotStore.ts` | `SaveSlotStore` interface + `KeyValueStore` seam + read/write/has/clear slot logic + `LocalStorageSaveSlotStore` browser binding (key `aigm.save.slot`). Reads return parsed `SlotWrapper \| null`; writes JSON-stringify the full wrapper. All `localStorage` access wrapped in try/catch; never throws into the render cycle. Tested over an in-memory `KeyValueStore` fake (key round-trips, absence, throwing fake for unavailable/quota). |
| `app/buildRestoredPlay.ts` | Pure helper: `buildRestoredPlay(state, resolveResult, fallbackRoom) → { play: ActivePlay; degraded: boolean }`. Wraps the resolved room (or fallback under `currentRoomId`) into `roomSource`; sets `navigation = exampleNavigation`, `initialPlayer = projectPlayerHud(state)`, `degraded = !ok \|\| source !== 'registry'`. Imports no store/service; never mutates inputs. Tested (authored/generated/failed-resolve cases; purity/no-mutation). |

Tested with **Vitest**: the PRNG (determinism/divergence/ranges), the fake
room generator, `WorldBibleSeed` schema/projection, `FakeWorldBibleSeeder`
(determinism, two-way theme mapping, bounds, data-only/no side effects), the
generated-room theme vocabulary resolver and FakeRoomGenerator vocabulary DI,
non-blocking app helper and its leakage guard, `validateRoom`, repair/fallback,
the generated-room layout normalizers (`generatedRoomLayout.ts`: shell clamp,
object bounds + count cap, spawn repair, exit snapping — same-reference optimization,
no mutation), generated-room composition (classification/zones/relocation,
same-reference optimization, no mutation), all `assembleRoom` pipeline paths
including stages 2.5–2.9,
and all `GeneratedRoomSource` paths. Log-safety tests cover raw prompts, derived
seeds, bible/story/opening-arc text, keywords, generated JSON, and error details.
`buildRestoredPlay` (authored/generated/failed-resolve, purity/no-mutation) and
`saveSlotStore` (write→read round-trips, absence, throwing-fake for unavailable/quota)
are covered by pure Vitest tests over in-memory fakes; no DOM/`jsdom` dependency was added.
`buildRoomSummary` (focal selection, support selection, direction inference, null for
empty rooms, nouns/text templates, purity/no raw-text reads) is covered by
`roomSummary.test.ts` (pure Vitest, no DOM). `RoomIntroPanel` (renders summary text,
hides on dismiss, resets on key change, null for empty/absent summary) is covered by
`RoomIntroPanel.test.tsx` (Vitest + `@testing-library/react`).

## Object & entity system (compositional builders)

🔜 **Direction for future object/character work.** v0's per-type primitive
builders are fine as-is; this section governs how the object system *grows*. Full
rationale in
[ADR-0006](./decisions/ADR-0006-compositional-entity-builders.md).

**Anti-pattern (avoid):** a separate one-off builder per entity type —
`buildSoldier`, `buildWoman`, `buildMan`, `buildZombie`, `buildGiant`,
`buildKing`, `buildMerchant`, … This explodes combinatorially, duplicates limb
and posture logic, and is unmaintainable. It violates SRP / OCP / DRY.

**Preferred: compositional builders.** The renderer assembles an entity from a
trusted **part library** along fixed dimensions:

```
entity = base body type (e.g. humanoid)
       + appearance parts
       + clothing / outfit
       + equipment
       + size / scale modifiers
       + material / color palette
       + role / preset      (a named bundle of the above)
       + interaction / behavior metadata
```

| Entity | Composition |
| --- | --- |
| soldier | humanoid + armor + helmet + weapon |
| zombie | humanoid + damaged posture + pale skin + torn clothes |
| giant | humanoid + large scale + heavy limbs + monster traits |
| merchant | humanoid + robe + bag/wares |

**The trust boundary still holds.** RoomSpec stays **data-only**: it selects a
preset and/or lists parts + parameters. The LLM may choose *safe presets and
parts* from the published vocabulary, but **never generates geometry or builder
code**. The renderer owns the trusted part library and assembles the final
object safely — the data-only → trusted-renderer rule of
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md) applied
at part granularity. A new entity is usually a new *data combination*;
occasionally a new *part* is added (and reviewed); almost never a new bespoke
builder. Unknown parts/presets should degrade to an intentional safe marker,
like unknown object types today (see [FAILURE-MODES](./FAILURE-MODES.md)).

## Future plug-in points

These seams include both implemented foundations and future adapters. The point
is to keep each replacement local to its port.

### ✅ Generation Foundation v0  ·  🔜 real LLM

- ✅ A `RoomSource` **port** in the domain answers "give me a room". Two
  implementations exist: `StaticRoomSource` (the hardcoded `throneRoom`) and
  `GeneratedRoomSource` (prompt-driven).
- ✅ A `RoomGenerator` **port** in the domain turns a seed string into **raw,
  untrusted JSON text**. Its v0 implementation is deterministic
  `FakeRoomGenerator`; `GeneratedRoomSource` runs the text through `assembleRoom`.
  The generator emits **data, never code**
  ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0010](./decisions/ADR-0010-generation-foundation-v0.md)).
- ✅ A `WorldBibleSeeder` **port** turns the PromptBar prompt into validated,
  bounded initial canon. `FakeWorldBibleSeeder` + `WorldBibleSeedSchema` +
  `worldBibleToGeneratorSeed` provide the deterministic local implementation;
  authored bootstrap and adjacent pre-generation remain bible-free
  ([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)).
- ✅ A **real** `RoomGenerator` now exists behind the unchanged port: the opt-in,
  dev-only `OpenAICompatibleRoomGenerator` (OpenAI/DeepSeek via one generic
  `fetch`-based adapter; off by default, prompt-path only). Its raw text still flows
  through `assembleRoom`; the schema/assembly boundaries, authority model, and
  renderer do not move ([ADR-0023](./decisions/ADR-0023-real-room-generator-provider-v0.md)).
- 🔜 A real `WorldBibleSeeder`, an Anthropic adapter, a multi-provider router /
  fallback chain, and server-side hosting may follow behind the same ports; model
  output remains validated data only, never renderer code.
- ✅ Because `RoomSource.getRoom()` is async by contract, loading/error states and
  the React error boundary (see [FAILURE-MODES](./FAILURE-MODES.md)) are the same
  whether the room is static, generated, or fetched.
- ✅ Generation is more than one model call: a prompt becomes a *validated,
  playable* room through a multi-stage pipeline with bounded repair and a safe
  fallback. v0 now implements stage 1 (generate) + schema validation, the
  **deterministic semantic validator**
  ([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)), and the
  **deterministic repair + trusted fallback room**
  ([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)) — so the
  renderer always gets a valid room. 🔜 The LLM reviewer and the bounded
  multi-attempt repair/re-prompt loop remain future. See
  **[Generation pipeline](#generation-pipeline-planned)** below and
  [ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md).
- ✅ Rooms are pre-generated ahead of the player so transitions feel instant — the
  **browser/session-cache subset** now ships (background frontier warming +
  safe on-demand door resolution through the shared `assembleRoom` pipeline;
  [ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)). 🔜 the
  backend, real-LLM, per-room status lifecycle, and parallel-job shape remain
  future. See **[Adjacent-room pre-generation](#adjacent-room-pre-generation-browser-subset-shipped)**
  below and [ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md).

### ✅ World State & Event Log v0  ·  ✅ SQLite + Node HTTP API  ·  🔜 PostgreSQL

- ✅ `CanonSeed`, `WorldEvent`, `WorldCommand`, `WorldState`, and `SaveGame` are
  versioned neutral-JSON domain schemas. The event log is authoritative; the
  snapshot must equal `projectWorldState(log)`.
- ✅ `WorldStore`, `Clock`, and `IdGenerator` are domain ports. `WorldSession`
  depends on them by constructor injection and returns typed expected failures.
- ✅ `InMemoryWorldStore` atomically appends an event and replaces its projected
  snapshot under an optimistic revision check. It exposes no event mutation or
  deletion path.
- ✅ Save/load revalidates schemas, log shape, seed identity, and snapshot
  integrity. Unknown versions and tampering are rejected, never silently fixed.
- ✅ A server-side **SQLite** adapter now implements the same `WorldStore` port
  with **no domain change** (`SqliteWorldStore`, headless and Node-only,
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)): append-only
  events behind `UNIQUE(session_id, seq)` + DB triggers, atomic snapshot commit,
  and `revision` compare-and-set concurrency.
- ✅ The native Node HTTP edge exposes session create/state/events/move over
  `WorldSession` + `SqliteWorldStore` with typed safe errors ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
- ✅ The first **NPC memory** layer now ships behind its own `NpcMemoryStore` port
  with the same headless, Node/SQLite-only cadence and a pure firewall that keeps
  memory supporting-context-only (NPC Memory Persistence v0,
  [ADR-0024](./decisions/ADR-0024-npc-memory-persistence-v0.md), below). It adds no
  new `WorldEvent` and has no path to truth.
- 🔜 A **PostgreSQL** dialect, hosted deployment, and a browser API client remain
  future. Browser gameplay still uses the in-memory adapters.

### ✅ Object Interactions v0  ·  🔜 richer gameplay effects

- ✅ `InteractionEffect` is a closed, data-only domain union. RoomSpec may attach
  an optional effect to an interaction; presentation-only interactions remain
  valid.
- ✅ `planInteraction` deterministically produces existing `WorldCommand`s or a
  typed no-op/rejection. One-shot effects require a stable idempotency key and
  record it in the current room's flags.
- ✅ `InteractionService` threads revisions through `WorldSession.appendEvent`.
  The composition root uses the persistent example-world session across room
  navigation and sends a plain result message to the existing dialogue panel;
  prompt-generated rooms still start fresh single-room sessions.
- ✅ The renderer remains intent-only: it passes a passive object id through the
  neutral host callback and never imports the interaction service or world state.
- 🔜 Cooldowns, random loot, quest gates, combat, dialogue trees, persistence,
  and cross-event transactional commits remain future work.

### ✅ Encounter System v0  ·  🔜 richer threat outcomes

- ✅ `EncounterSpec` is a closed, data-only domain descriptor (genre-neutral
  `action` enum + six generic effect atoms). RoomSpec may attach an optional
  `encounter` to the shared `Interaction`; an encounter takes precedence over an
  `effect` when both are present.
- ✅ `planEncounter` deterministically maps the chosen choice to existing
  `WorldCommand`s (no new event type) behind an optional `requires` gate and a
  stable one-shot resolution flag; `EncounterService` executes them through the
  shared `world-session/applyCommands` helper, which `InteractionService` also
  uses.
- ✅ The composition root routes an E/F open to a two-phase encounter panel
  (description + choice buttons) when the object has an encounter; the renderer
  still only emits intent.
- 🔜 Randomness/dice via a seeded `Rng` port, death/downed state, richer cross-room
  consequences, cooldowns/escalation, and LLM-authored encounter data remain
  future work.

### ✅ Multi-Room Navigation & Cache v0  ·  ✅ durable room API  ·  🔜 browser wiring

- ✅ `RoomRegistry` resolves the two authored rooms through `loadRoomSpec`, while
  `SessionRoomCache` holds identical `LoadedRoom` references for one session.
- ✅ `NavigationService` is cache-first and resolves before appending the existing
  `moved-to-room`; unknown/invalid targets and self-navigation append nothing.
- ✅ `App` keeps the session/cache alive while `RoomViewer` rebuilds the unchanged
  engine for each active room. Return visits preserve visited and resolution
  flags, with exit → encounter → dialogue → effect precedence at composition.
- ✅ A headless **`RoomStore` port + `SqliteRoomStore`** persist validated
  RoomSpec data documents by stable `roomId` (upsert, last-writer-wins), loaded
  back through `loadRoomSpec` — the durable analog of `RoomRegistry.resolve`
  ([ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md)). The Node
  API exposes validated `PUT/GET /rooms/:roomId` routes ([ADR-0019](./decisions/ADR-0019-backend-world-session-api-v0.md)).
- ✅ Browser navigation resolves rooms through `AdjacentRoomPregenerator` — one
  seam shared by background frontier warming and on-demand door resolution over
  `RoomRegistry`/`SessionRoomCache`; `NavigationService` depends only on the narrow
  `RoomResolver` ([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md)).
- 🔜 Wiring it to durable rooms, more than two rooms, entry-aligned spawn,
  transition animation, a minimap, and the backend/real-LLM/status-lifecycle
  shape of pre-generation remain future work.

### ✅ NPC Dialogue Foundation v0  ·  🔜 real provider

- ✅ `NPCDialogueSpec` is validated display/seed data on the shared Interaction;
  `buildDialogueContext` is a pure projection of current authoritative facts.
- ✅ `RoomDialogueContext` is an optional compact packet derived from validated
  `LoadedRoom` data only. It carries closed focus/feature/direction/affordance
  enums and capped `npcCount`, never names, prompts, generated descriptions, raw
  JSON, provider output, or user prompt text.
- ✅ `NPCDialogueProvider` is the external-provider seam. The v0 fake is
  deterministic, static, performs no network I/O, and uses room focus only as a
  generic fallback after prompt/persona lines.
- ✅ `NPCDialogueService` injects only the `getWorldState` read path and returns
  typed replies/failures. Repeated turns leave the event log unchanged.
- ✅ `NPCDialoguePanel` is presentational; canned prompts/Continue and conversation
  history live only in component state. The renderer still emits intent only.
- ✅ **Generated Room NPC Objective Awareness v1** — a pure `buildNPCObjectiveContext`
  projection nests a closed `NPCObjectiveContext` (`kind` + `status` enums) into the
  existing `QuestDialogueContext.objective` field, giving generated-room NPCs safe generic
  nudge lines keyed on objective kind without surfacing ids, names, or generated text, and
  without mutating world state, objectives, or memory
  ([ADR-0056](./decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md)).
- 🔜 A real validated LLM adapter, free-text input, relationship state,
  summaries/vector recall, speech, and quests remain future work. The first
  **persistent NPC memory** layer now exists headlessly (below), but is **not yet
  wired** into dialogue or prompts.

### ✅ NPC Memory Persistence v0  ·  🔜 dialogue/LLM wiring

- ✅ `NpcMemoryStore` is a domain port (mirrors `WorldStore`/`RoomStore`: typed
  results, insert-only, no update/delete). `domain/memory` holds the pure contracts
  and the firewall (`validateMemoryDraft`/`filterMemoriesForScope`/`selectRecallMemories`).
- ✅ The headless `NpcMemoryService` (`remember`/`recall`) injects only the store,
  `Clock`, `IdGenerator`, and `Logger` — **no `WorldSession`** and no append path, so
  memory cannot become truth. `InMemoryNpcMemoryStore` and `SqliteNpcMemoryStore`
  (migration `0002_npc_memories`, FK to `world_sessions`, no-update trigger) implement
  the port; the SQLite read boundary re-validates and re-asserts scope, skipping
  corrupt/scope-divergent rows.
- ✅ Strict `(worldId, sessionId, npcId)` scope, closed kind/source enums (no
  `system` source), informational-only `confidence`, deterministic `seq`-desc recall,
  280-char bounded inert text, and content-free logging.
- 🔜 API endpoints, dialogue integration, an LLM memory writer, memory injection into
  NPC prompts, a summarizer, vector/embedding search, cross-session/global memory,
  forgetting/eviction, and a memory UI remain future work
  ([ADR-0024](./decisions/ADR-0024-npc-memory-persistence-v0.md)).

### ✅ Living-World Room Memory v0  ·  🔜 dialogue/generation/API wiring

- ✅ `RoomMemoryStore` is a domain port (mirrors `NpcMemoryStore`: typed results,
  insert-only, no update/delete). `domain/memory` holds the pure room contracts
  (`roomContracts.ts`) and the room firewall (`roomFirewall.ts`:
  `validateRoomMemoryDraft`/`filterRoomMemoriesForScope`/`selectRecallRoomMemories`).
- ✅ The headless `RoomMemoryService` (`remember`/`recall`) injects only the store,
  `Clock`, `IdGenerator`, and `Logger` — **no `WorldSession`** and no append path, so
  room memory cannot become truth. `InMemoryRoomMemoryStore` and
  `SqliteRoomMemoryStore` (migration `0003_room_memories`, FK to `world_sessions`,
  no-update trigger) implement the port; the SQLite read boundary re-validates and
  re-asserts scope, skipping corrupt/scope-divergent rows.
- ✅ Strict `(worldId, sessionId, roomId)` scope, closed kind/source enums (no
  `system` source), informational-only `confidence`, deterministic `seq`-desc recall,
  280-char bounded inert text, and content-free logging. `roomId` is a plain
  non-empty string — not FK'd to the `rooms` table.
- ✅ **Room memory is not room truth.** `WorldState.roomStates` (`.visited`, `.flags`)
  remains the authoritative per-room state. Player claims, `room_observation`, and
  `room_note`/`room_summary` are inert supporting context; `source:'llm'` memories
  cannot apply state changes. The structural no-append-path makes this provable.
- 🔜 API endpoints, room-generation injection, adjacent-room pregeneration wiring,
  dialogue integration, an LLM memory writer, a summarizer, vector/embedding search,
  cross-session/global room memory, forgetting/eviction, and a memory UI remain
  future work ([ADR-0025](./decisions/ADR-0025-living-world-room-memory-v0.md)).

### ✅ Backend / API v0  ·  🔜 generation hosting and browser client

- ✅ A browser-excluded native `node:http` server exposes health, durable world
  session, move, and room endpoints over SQLite.
- ✅ Requests are validated at the HTTP boundary; RoomSpecs reuse the domain
  schema/loader and responses expose safe typed envelopes.
- ✅ The MVP backend path is Node/TypeScript (`tsx` for local development), not
  FastAPI/Python.
- 🔜 Real generation hosting, credentials, CORS/proxy configuration, a browser
  fetch client, auth, and hosted deployment remain future.

### ✅ Persistence (SQLite, headless v0)  ·  🔜 PostgreSQL later

- ✅ Repository **ports** live in the domain (`WorldStore`, `RoomStore`, and the new
  `NpcMemoryStore`); the SQLite adapters (`SqliteWorldStore`, `SqliteRoomStore`,
  `SqliteNpcMemoryStore`) live in the Node-only `src/persistence/**` build unit. UI
  and renderer **never** touch SQL or a DB driver — enforced by tsconfig
  exclusion, Vite reachability, and the reciprocal ESLint wall.
- ✅ SQLite is a *server-side*, Node-only store (`node:sqlite`), **not** an
  in-browser database. The Node API consumes it; browser gameplay remains on
  in-memory adapters.
- 🔜 The dual-dialect query layer and the PostgreSQL migration remain future shape
  only. See [ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md),
  [ADR-0018](./decisions/ADR-0018-backend-sqlite-persistence-v0.md).

## Generation pipeline (planned)

🔜 **Designed, not built** — except the deterministic stages, which now ship: the
**World Bible seed/projection**
([ADR-0022](./decisions/ADR-0022-world-bible-seed-v0.md)), the **code validator**
([ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)), and the
**deterministic repair + safe fallback room**
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)). The
**real LLM**, the **LLM reviewer**, and the **bounded multi-attempt repair/regenerate
loop** remain future. Full rationale and the retry/repair policy live in
[ADR-0007](./decisions/ADR-0007-generated-room-validation-and-repair.md);
per-case failure handling is in [FAILURE-MODES](./FAILURE-MODES.md).

A user prompt does not become a room in a single model call. It flows through a
pipeline whose job is to produce a room that is **both safe and good**, with
bounded cost and a guaranteed safe outcome:

```
  user prompt
      │
      ▼
  WorldBibleSeeder ──► validated initial canon  ✅ deterministic fake today
      │
      ▼
  compact seed projection                       ✅ bounded/title-first today
      │
      ▼
  fast LLM  ──►  RoomSpec JSON            cheap, quick first draft
      │
      ▼
  schema validation     ── JSON shape/types (zod = the loadRoomSpec boundary)
      │
      ▼
  code validator        ── DETERMINISTIC code (not an LLM): reachable exit?
      │                    NPCs/objects not in walls? quest items placed?
      │                    object/light budget? spawn inside room?
      ▼
  LLM reviewer (optional)── creative/story quality: coherent, on-prompt, fun
      │
      ▼
  repair / regenerate   ── bounded loop (max 3 attempts, ~60s hard cap)
      │
      ▼
  trusted renderer      ── only ever sees a validated, accepted spec
      │
      ▼
  safe fallback room    ── if no acceptable room can be produced
```

**Four distinct checks — keep them separate:**

- **Schema validation** checks **JSON/shape** (the existing trust boundary).
- **Code validator** is **deterministic code, not an LLM** — it checks semantic
  playability. ✅ A v0 slice ships now (sane dimensions, spawn inside the walkable
  bounds, anchors within the footprint, object/light budgets, usable interactions;
  [ADR-0011](./decisions/ADR-0011-semantic-room-validator-v0.md)); 🔜 deeper
  reachability, object↔object collision, and quest consistency remain future.
- **LLM reviewer** checks **creative/story quality** — taste, not shape; it
  returns a verdict that feeds the repair loop, it does not edit the spec.
- **Valid JSON does not mean the room is playable or good.** Schema validation is
  necessary but not sufficient; the code validator and reviewer cover the gap.

**Retry/repair policy (v1):** fast model first → one fast repair attempt →
slow/better model fallback only if needed; **no infinite retries, max 3
attempts**; target **10–30s** for the first room, **~60s** hard cap; after a hard
failure, a **safe error with a retry button or a fallback demo room** — never an
unvalidated or known-bad room. The renderer's contract is unchanged: generation
adds checks *before* the `loadRoomSpec` boundary, it never weakens it.

✅ The **deterministic** subset of "repair → fallback" now ships
([ADR-0020](./decisions/ADR-0020-room-generation-repair-fallback-v0.md)): a pure
`assembleRoom` runs a **single** deterministic `repairRoom` pass (clamp spawn,
truncate over-budget objects/lights — no resizing) and re-validates, then returns
a trusted **fallback room** if any JSON/schema/semantic/repair failure remains, so
the renderer always gets a valid room. The multi-attempt loop, the corrective
re-prompt, the slow-model fallback, and the LLM reviewer remain future — they need
a real, non-deterministic model.

## Adjacent-room pre-generation (browser subset shipped)

✅ **Browser/session-cache subset shipped**
([ADR-0021](./decisions/ADR-0021-adjacent-room-pregeneration-v0.md), summarized in
[Adjacent-Room Pre-generation v0](#adjacent-room-pre-generation-v0) above) ·
🔜 **the backend/real-LLM shape below is still future**
([ADR-0009](./decisions/ADR-0009-adjacent-room-pre-generation.md)). v0 ships the
deterministic browser core — one `AdjacentRoomPregenerator` seam that warms the
current room's exits in the background (capped, depth-1) and resolves rooms safely
on demand at the door through the shared `assembleRoom` pipeline. The parallel-job
system, the per-room status lifecycle, the "Opening the way…" wait, priority
ordering, and a backend remain the future shape described here.

The first room may cost up to ~60s once. To avoid that wait on every transition —
and because the world is effectively infinite, so it can't be generated up
front — the backend **pre-generates adjacent rooms in parallel while the player
explores the current room**. After the first room, the player should rarely wait.

**Generate the frontier, not the world.** Pre-generate only nearby reachable
rooms, by priority:

1. visible exits,
2. player-facing / nearest exit,
3. quest-critical path,
4. optional / secret exits — only after discovery.

**Limit parallel jobs** (e.g. **1–3 rooms** at a time) to bound cost and load.

**Room status lifecycle** — each room carries an explicit status:
`not_started → generating → validating → repairing → ready`, or `failed` if the
pipeline exhausts its attempts.

**At a door, behavior depends on status:**

| Status | Behavior |
| --- | --- |
| `ready` | instant transition |
| `generating` / `validating` / `repairing` | short "Opening the way…" wait |
| `failed` | retry / fallback room |
| `not_started` | generate on demand (the un-prefetched case) |

## Renderer portability (engine strategy)

🔜 **Direction.** Three.js is the v1 renderer and does not change. Full rationale
in [ADR-0008](./decisions/ADR-0008-renderer-portability-strategy.md).

The valuable core of this product is the **`RoomSpec`/`WorldSpec` contract,
validation, the generation pipeline, memory, persistence, and the renderer
adapter boundary — not the specific renderer.** To keep that core portable:

- **Three.js remains the correct renderer for browser-first v1.**
- **`RoomSpec`/domain stay renderer-agnostic.** Neutral data (positions, types,
  parameters), never one engine's API.
- **Never store Three.js objects in the domain or the DB** — no `Mesh`,
  `Material`, `Vector3`, or scene-graph node in domain types or stored rows.
  Persist the validated data spec only (see
  [ADR-0004](./decisions/ADR-0004-persistence-sqlite-to-postgres.md)).
- **Renderers are adapters over the same data contract.** A Three.js adapter
  today; **Babylon.js** possible later for richer web-engine features;
  **Unity/Godot** possible much later for native/desktop/mobile clients.
- **A non-web engine fits only by consuming the spec through trusted engine
  code.** A Unity client would have **trusted C#** load `RoomSpec` JSON and
  instantiate prefabs; a Godot client would have **trusted GDScript/C#** load it
  and instantiate nodes/resources — the same data-only → trusted-renderer rule as
  the Three.js builder registry.
- **The LLM must never generate** Three.js code, Unity C#, Godot GDScript, or any
  executable scene script. It emits `RoomSpec`/`WorldSpec` **data** only — same
  rule on every engine ([ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md)).

## Packaging decision

The domain/renderer/UI/server boundaries are real **today**, enforced by folder
structure, these docs, and lint rules — not by separate npm packages. A shared `packages/contracts` package is extracted only when a second
genuine cross-package consumer exists. The in-package `src/server/**` consumer
does not trigger extraction. See
[ADR-0005](./decisions/ADR-0005-defer-shared-package-extraction.md).
