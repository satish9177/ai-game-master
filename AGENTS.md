# AGENTS.md — Coding Agent Rules

Rules for AI coding agents and contributors. Read this before coding.

This file is the always-on constitution for the repo. Keep it short, strict, and task-focused. Detailed architecture/status lives in `docs/architecture/` and related ADRs.

---

## Core workflow

* Design first. Do not implement until the maintainer approves.
* One small feature slice at a time.
* Do not expand scope.
* Do not commit automatically.
* Keep changes small, reviewable, and independently testable.
* When unsure about a boundary, ask before coding.
* For feature work, the approved implementation plan is the task-specific source of truth.
* Do not mix refactors with feature work unless explicitly approved.
* Prefer targeted verification over running unrelated expensive checks, unless the change is broad or safety-sensitive.

---

## Project identity

AI Game Master is a browser-based controlled 3D / isometric solo RPG engine.

A room is described by validated data-only `RoomSpec` JSON and rendered by trusted, hand-written Three.js code.

Current app:

* `apps/web`
* React
* TypeScript
* Vite
* Three.js
* zod
* Node
* SQLite

FastAPI/Python are not part of the MVP backend path.

---

## Minimum Safe Change Rule

Before writing code, choose the smallest safe solution.

Use this ladder before creating new files, abstractions, services, schemas, or systems:

1. Does this change actually need to exist for the approved feature slice?
2. Is the behavior already present in the codebase?
3. Can an existing `RoomSpec`, `RoomViewer`, room source, validation, renderer, hook, service, store, projection, or test helper be reused?
4. Can TypeScript, React, Three.js, browser APIs, Node, or SQLite already do this simply?
5. Can an already-installed dependency solve it without adding a new dependency?
6. Can this be solved with a small local change instead of a new abstraction?
7. Only then add the minimum new code required.

This rule is about reducing unnecessary code, not removing safety.

Never reduce, bypass, or weaken:

* `RoomSpec` / `SceneSpec` validation
* trusted renderer boundaries
* raw prompt / generated text / provider output leakage protection
* deterministic repair/fallback behavior
* authoritative `WorldSession` / event-log / SQLite boundaries
* memory firewall rules
* tests for safety-sensitive behavior
* architecture docs / ADRs when the feature changes boundaries
* no-executable-code-from-LLM constraints
* logging redaction and secret safety

Prefer:

* small diffs
* local changes near the existing flow
* pure functions for generation/safety/domain logic
* deterministic tests
* existing fixtures/builders/helpers
* boring code over clever code
* explicit feature-slice boundaries

Avoid:

* new global state unless required
* new service layers for v0 features
* schema changes unless explicitly approved
* broad refactors mixed with feature work
* future-proof abstractions without current use
* changing unrelated files to make the solution look cleaner
* adding dependencies for small problems

For every implementation plan, include a short **Minimum Safe Change Check**:

* What existing code is reused?
* What new code is actually necessary?
* What safety boundaries remain unchanged?
* What targeted tests prove the change?

---

## Ponytail usage

Ponytail-style rules are allowed as an advisory anti-overengineering aid.

Ponytail or any similar agent skill/plugin must never override:

1. this `AGENTS.md`
2. the maintainer-approved implementation plan
3. `docs/architecture/ARCHITECTURE.md`
4. `docs/architecture/BOUNDARIES.md`
5. the relevant ADR for the current feature

Allowed Ponytail-style usage:

* ask the agent to find unnecessary abstractions
* ask the agent to reduce diff size
* ask the agent to reuse existing code
* ask the agent to avoid new dependencies
* ask the agent to review whether a feature was overbuilt

Not allowed:

* removing validation to reduce code
* removing tests to reduce code
* weakening safety boundaries to reduce code
* replacing explicit architecture with clever shortcuts
* changing unrelated code because Ponytail suggests a smaller global design
* using plugin hooks that edit files without maintainer review

The correct rule for this project is:

> minimum safe code, not minimum code.

---

## Non-negotiable architecture rules

* LLM/generation may produce only data or proposals, never executable JS, Three.js, React, Unity, Godot, or scene scripts.
* Raw generated output must be parsed, schema-validated, semantically validated, repaired/fallback-handled where applicable, and only then rendered.
* The renderer must stay hand-written and trusted.
* `RoomSpec` and domain models must remain renderer-agnostic.
* SQLite/world-session current state plus append-only event log are authoritative.
* Summaries, memories, retrieval, dialogue, and LLM text never override authoritative state.
* The browser must not access SQLite or Node-only persistence directly.
* The frontend remains intentionally in-memory unless the maintainer explicitly approves backend wiring.
* Browser `localStorage`, where used, is byte parking only and never authoritative truth.
* The renderer must not import React, DB, network, server, or persistence code.
* React UI must not import Three.js engine internals except through approved host/composition seams.
* Persistence stays Node-only and browser-excluded.
* Use the logger abstraction. Do not add scattered `console.log`.
* Never log secrets, API keys, raw prompts, generated JSON, provider request/response bodies, player text, NPC dialogue, room/object names, narrative content, or PII.
* Keep DI simple through constructor/function parameters.
* Do not add heavy frameworks, Redux, Nest, heavy ORMs, or new package/workspace structure without approval.
* `WorldSession` current state plus append-only event log are authoritative; SQLite is authoritative where backend persistence is wired.

---

## LLM and generation safety

Generation boundaries are strict.

Allowed from LLM/generation:

* data-only `RoomSpec`-like proposals
* text proposals that are parsed and validated before use
* safe booleans/enums/counts where explicitly designed
* provider-agnostic diagnostics that do not expose content

Never allow from LLM/generation:

* executable code
* renderer code
* React components
* Three.js objects
* SQL
* migrations
* event-log mutations
* world-state mutations
* direct memory writes unless routed through approved firewall/service
* raw prompt replay
* raw provider output replay

Generated rooms must pass the trusted pipeline before render. Failed, invalid, or unsafe generation must repair, fallback, or degrade safely.

---

## Memory rules

Memory is supporting context only. It is never world truth.

Current memory layers are headless and Node/SQLite-only unless explicitly approved otherwise:

* NPC memory
* room memory

Memory layers must not import or mutate:

* `WorldSession`
* `WorldStore`
* `WorldCommand`
* `WorldEvent`
* `WorldState`
* interactions
* encounters
* dialogue paths unless an approved feature explicitly wires a read-only recall path

Memory writes must pass the relevant firewall and store boundary.

Memory text is inert. Player claims are claims. NPC beliefs can be wrong. Room observations are not authoritative truth. `source:'llm'` memories cannot apply state changes.

Do not log memory text, player lines, NPC names, room names, generated content, prompts, provider bodies, keys, or PII.

---

## UI projection rules

HUDs, quest trackers, journals, meters, save/load bars, and similar UI panels are read-only projections unless the approved feature explicitly says otherwise.

Read-only projections:

* may read authoritative state
* may project view models
* may render UI
* must not become truth
* must not write back into domain state
* must not create events/commands unless explicitly approved
* must not import Three.js engine internals unless through approved seams

Existing examples:

* Inventory & Health HUD
* Demo Quest Tracker
* Consequence Journal
* Usage Meter
* Save/Load Bar

Keep UI components presentational where possible.

---

## Persistence rules

SQLite persistence is Node-only.

The browser must not directly access:

* SQLite
* Node persistence adapters
* server-only stores
* migrations
* filesystem-backed persistence

`localStorage` save/load is manual browser save parking only. It is not authoritative truth. Loads must re-validate through the full save/load boundary before state changes.

Do not add backend/API/browser persistence wiring unless the approved implementation plan explicitly requires it.

---

## Renderer and React boundaries

Renderer rules:

* trusted hand-written Three.js only
* no generated executable renderer code
* no React imports inside renderer internals unless already approved
* no DB/network/server/persistence imports
* no direct memory or world-session mutation

React rules:

* React owns composition and UI
* React may host renderer through approved seams
* React must not reach into Three.js internals except through approved host/composition APIs
* React overlays should be presentational and read-only unless explicitly approved

---

## Current implemented feature map

This section is a quick orientation only. For details, read the relevant ADR.

Implemented or shipped areas include:

* NPC dialogue foundation
* multi-room navigation/cache
* backend SQLite persistence
* backend world-session API
* room-generation repair/fallback
* adjacent-room pregeneration
* NPC memory persistence v0
* living-world room memory v0
* inventory & health UI v0
* session save/load v0
* demo quest loop v0
* demo quest mechanical reactivity v0
* consequence journal v0
* cost/usage guardrails v0
* generated room layout contract v0
* generated room composition and visual vocabulary foundations
* NPC dialogue room-context grounding
* generated-room NPC presence
* generated-room bidirectional links v0
* real generated objective provider v0

Do not paste full shipped-feature tables into this file. Detailed shipped notes should live in ADRs, architecture docs, or a dedicated status file.

Suggested location for long status notes:

* `docs/status/SHIPPED-FEATURES.md`

Read detailed shipped notes only when the current task touches that feature area.

---

## Current guardrails

Do not add unless explicitly requested by the maintainer or by the approved implementation plan for the current feature:

* hosted/cloud deployment
* server-side LLM provider
* browser API client/CORS proxy
* browser DB access
* second backend
* Anthropic adapter
* provider router/fallback chain
* real-provider adjacent-room pregeneration
* streaming
* multi-attempt LLM repair loop
* deeper validator rules
* new memory/living-world systems outside the approved memory feature
* complex combat
* mobile/touch controls
* free-camera/first-person mode
* minimap
* GLTF asset pipeline
* npm workspaces or extracted packages
* Redux
* NestJS
* heavy ORM
* new package manager
* broad folder/package restructuring

---

## What to read before planning

Always read:

1. `AGENTS.md`
2. `docs/architecture/ARCHITECTURE.md`
3. `docs/architecture/BOUNDARIES.md`

Read only if relevant:

* `docs/architecture/FAILURE-MODES.md`
* `docs/architecture/CONVENTIONS.md`
* the ADR directly related to the requested feature
* the files in the code path being changed
* focused tests for the touched modules

Do not read every ADR unless the task requires it.

---

## Planning requirements

Before implementation, provide a short plan with:

1. Goal of the feature slice
2. Files likely to change
3. Existing code to reuse
4. Minimum new code needed
5. Safety boundaries that remain unchanged
6. Tests to add or update
7. Verification commands

For safety-sensitive features, also include:

* failure modes
* fallback/degradation behavior
* logging/redaction impact
* schema impact
* whether any authoritative state can change

Do not implement until the maintainer approves the plan.

---

## Implementation rules

During implementation:

* Keep the diff small.
* Stay inside the approved files/areas.
* Do not opportunistically refactor.
* Do not rename/move files unless needed for the approved feature.
* Do not change public schemas without approval.
* Do not add dependencies without approval.
* Do not weaken tests.
* Do not update snapshots blindly.
* Do not change generated/provider safety behavior unless explicitly part of the task.
* Prefer pure functions for domain logic.
* Prefer deterministic tests over brittle UI tests.
* Prefer existing helpers and fixtures.

---

## Logging and diagnostics

Use the logger abstraction.

Logs may include:

* safe enums
* booleans
* counts
* stable diagnostic codes
* provenance flags
* high-level status

Logs must not include:

* API keys
* secrets
* raw prompts
* player text
* generated JSON
* provider request bodies
* provider response bodies
* generated descriptions
* room names
* object names
* NPC names
* dialogue text
* memory text
* SaveGame JSON
* event payload narrative content
* PII

When in doubt, log less.

---

## Build and verify

From `apps/web`:

```bash
npm run build
npm run lint
npm run test
```

For docs-only changes, run the smallest relevant check and report if a check was skipped.

For targeted code changes, prefer targeted tests first, then broader verification if the touched area is central or safety-sensitive.

Examples:

```bash
npm run test -- generatedRoomLayout
npm run test -- saveGame
npm run test -- memory
npm run lint
npm run build
```

Do not claim checks passed unless they were actually run.

---

## Commit rules

Do not commit automatically.

When the maintainer asks for a commit:

* include only relevant files
* run `git diff --check`
* use a clear message
* mention verification performed
* do not amend/rebase unless asked

Suggested commit style:

```bash
git commit -m "feat: add generated room exit navigation v0"
git commit -m "test: cover room exit projection"
git commit -m "docs: record generated room exit navigation decision"
```

---

## Review checklist

Before handing off, verify:

* The approved slice is complete.
* Scope did not expand.
* No unrelated files changed.
* No new dependency was added without approval.
* No schema changed without approval.
* No generated executable code path was introduced.
* No browser-to-SQLite path was introduced.
* No renderer trust boundary was weakened.
* No memory firewall was weakened.
* No authoritative state rule was bypassed.
* No unsafe logging was added.
* Tests cover the important behavior.
* Build/lint/test status is reported honestly.

---

## When in doubt

Ask before coding when the question affects:

* schema design
* persistence
* backend/API wiring
* memory truth boundaries
* world-state/event-log authority
* renderer boundaries
* generated content safety
* provider behavior
* new dependencies
* major UI behavior
* scope expansion

For minor local implementation choices, prefer the smallest safe change and proceed within the approved plan.
