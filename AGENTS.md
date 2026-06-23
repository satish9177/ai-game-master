# AGENTS.md — Coding Agent Rules

Rules for AI coding agents and contributors. Read this before coding.

## Core workflow

* Design first. Do not implement until the maintainer approves.
* One small feature slice at a time.
* Do not expand scope.
* Do not commit automatically.
* Keep changes small, reviewable, and independently testable.
* When unsure about a boundary, ask before coding.
* For feature work, the approved implementation plan is the task-specific source of truth.

## Project identity

AI Game Master is a browser-based controlled 3D / isometric solo RPG engine.

A room is described by validated data-only `RoomSpec` JSON and rendered by trusted, hand-written Three.js code.

Current app: `apps/web` using React, TypeScript, Vite, Three.js, zod, Node, and SQLite.

FastAPI/Python are not part of the MVP backend path.

## Non-negotiable architecture rules

* LLM/generation may produce only data or proposals, never executable JS, Three.js, React, Unity, Godot, or scene scripts.
* Raw generated output must be parsed, schema-validated, semantically validated, repaired/fallback-handled where applicable, and only then rendered.
* The renderer must stay hand-written and trusted.
* `RoomSpec` and domain models must remain renderer-agnostic.
* SQLite/world-session current state plus append-only event log are authoritative.
* Summaries, memories, retrieval, and LLM text never override authoritative state.
* The browser must not access SQLite or Node-only persistence directly.
* The frontend remains intentionally in-memory unless the maintainer explicitly approves backend wiring.
* The renderer must not import React, DB, network, server, or persistence code.
* React UI must not import Three.js engine internals except through approved host/composition seams.
* Persistence stays Node-only and browser-excluded.
* Use the logger abstraction. Do not add scattered `console.log`.
* Never log secrets, API keys, raw prompts, generated JSON, provider request/response bodies, or PII.
* Keep DI simple through constructor/function parameters. Do not add heavy frameworks, Redux, Nest, heavy ORMs, or new package/workspace structure without approval.
* WorldSession current state plus append-only event log are authoritative; SQLite is authoritative where backend persistence is wired.

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

## What to read before planning

Always read:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/architecture/BOUNDARIES.md`

Read only if relevant:

* `docs/architecture/ARCHITECTURE.md`
* `docs/architecture/FAILURE-MODES.md`
* `docs/architecture/CONVENTIONS.md`
* the ADR directly related to the requested feature

Do not read every ADR unless the task requires it.

## Build and verify

From `apps/web`:

```bash
npm run build
npm run lint
npm run test
```

For docs-only changes, run the smallest relevant check and report if a check was skipped.
