# ADR-0010: Generation Foundation v0 — deterministic fake generator

- **Status:** Accepted — **implemented** (Generation Foundation v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

## Context

The renderer ([Renderer Foundation v0](../ARCHITECTURE.md)) proves that a
**RoomSpec** (pure data) becomes a walkable room rendered by trusted Three.js. The
next milestone is generation: turning a user *prompt* into a room. The full
pipeline ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)) is large
— a real LLM, a deterministic code validator, an optional LLM reviewer, a bounded
repair loop — and it depends on a backend to host model credentials
([ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)).

Before paying for any of that, we want to prove the **seam** end-to-end and
de-risk the parts that are easy to get wrong: the trust boundary
([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)), the async,
result-typed `RoomSource` contract, and the wiring at the composition root. None
of that needs a real model. A deterministic fake lets us build and **test** the
whole path now, deterministically, with no API key, network, cost, or flakiness.

## Decision

Ship **Generation Foundation v0**: the first generation seam, end-to-end, with a
deterministic *fake* generator standing in for the LLM.

```
User prompt
  → PromptBar              (app composition chrome — not renderer UI)
  → App composition root
  → FakeRoomGenerator      (behind the RoomGenerator port; seeded by the prompt)
  → raw, untrusted JSON text
  → GeneratedRoomSource    (owns JSON.parse + loadRoomSpec)
  → loadRoomSpec           the trust boundary, unchanged
  → RoomLoadResult         (typed ok / invalid-room / unavailable)
  → existing trusted Three.js renderer
```

### What v0 is

- **A `RoomGenerator` port** in the domain: `generate(prompt) → Promise<string>`
  of **raw, untrusted JSON text** — the exact shape a future LLM completion has.
  Domain-pure; no I/O, React, Three.js, or logger.
- **A deterministic `FakeRoomGenerator`** (generation layer): prompt → seeded PRNG
  (`xmur3` + `mulberry32`) → RoomSpec **data**, serialized with `JSON.stringify`.
  The same prompt yields **byte-identical** output. It emits only the published
  vocabulary (`throne`, `pillar`, `rug`, `torch`, `arch`, `scroll`, `npc`,
  `prop`) and is pure — no `Math.random`, `Date.now`, I/O, or logging.
- **A `GeneratedRoomSource`** (composition-layer `RoomSource` adapter) that **owns
  parse + validation**: `JSON.parse` (never `eval`) → the **same** `loadRoomSpec`
  every source uses → a typed `RoomLoadResult`. Failures map to `invalid-room`
  (bad JSON / bad envelope) or `unavailable` (generator threw).
- **A presentational `PromptBar`** (app chrome, **not** renderer UI) wired at the
  **composition root** (`App.tsx`): submitting a prompt swaps the `RoomSource`
  state to a new `GeneratedRoomSource(FakeRoomGenerator, prompt, logger)`; its new
  identity makes the existing host re-load. `RoomViewer` and the engine are
  unchanged and never learn that prompts or generators exist.
- **Logging is length-only.** The prompt *text* is never logged — only its length
  and safe result counts/codes ([ADR-0003](./ADR-0003-logging-abstraction.md)).
- **Tested with Vitest:** the PRNG, the fake generator (determinism,
  known-vocabulary-only, passes `loadRoomSpec`, data-only round-trip), and the
  `GeneratedRoomSource` failure paths (bad JSON, bad envelope, generator throws,
  lenient object-skip), including a check that the prompt text never leaks to logs.

### What v0 is **not** (deliberately deferred)

- **No real LLM / API / API key**, and **no backend** to host one.
- **No database, persistence, or memory.**
- **No deterministic code validator, no LLM reviewer, no repair/regenerate loop,
  no safe-fallback room** — i.e. only **stage 1 (generate) + schema validation**
  of [ADR-0007](./ADR-0007-generated-room-validation-and-repair.md) exists.
- **No adjacent-room pre-generation** ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md)).
- **No slow/fast model routing.**

### Invariants this preserves

- **The trust boundary is unchanged.** Generated text is **data, never code**: it
  is `JSON.parse`d and `loadRoomSpec`-validated before anything reaches the
  renderer, which still executes only trusted, hand-written builders
  ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)). The LLM (later)
  must never emit JS/Three.js/React — nor Unity C# or Godot GDScript
  ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).
- **Boundaries hold.** Generation depends only on the domain (and is lint-enforced
  against importing React/Three.js/renderer/platform); the prompt bar is
  presentational; only the composition root names a concrete generator.

## Consequences

- The whole generation **seam** is proven and regression-tested **without a model**.
  Swapping `FakeRoomGenerator` for a real LLM client is a **one-line change at the
  composition root** — the port, the parse/validate boundary, `RoomSource`, and
  the renderer do not move.
- The async, result-typed `RoomSource` path (loading, typed `invalid-room` /
  `unavailable`, the host's safe-failure screen) is exercised now, so the real
  client inherits a tested failure surface (FAILURE-MODES case 4).
- The fake is a useful fixture beyond v0: deterministic rooms for tests, demos,
  and offline development.
- v0 intentionally produces *safe but not necessarily good* rooms — quality
  (playability, coherence) is the job of the still-future validator/reviewer/repair
  stages ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)).

## Alternatives considered

- **Wait for a real LLM + backend before building the seam** — rejected: couples
  the first generation slice to credentials, network, cost, and flakiness, and
  delays proving the trust boundary and wiring that don't need a model.
- **Have `FakeRoomGenerator` return a parsed object or a typed `RoomSpec`** —
  rejected: returning **text** models the real LLM honestly and keeps `JSON.parse`
  + `loadRoomSpec` as explicit steps at the trust boundary, where they belong.
- **Put generation behind the prompt bar in the UI / renderer layer** — rejected:
  generation is a domain-portted concern wired at the composition root; the prompt
  bar stays presentational chrome so the renderer never learns about prompts.
- **Implement part of the validator/repair loop now** — rejected: out of scope for
  a foundation slice; it belongs with a real model that can actually produce
  bad-but-valid rooms ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)).
