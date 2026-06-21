# ADR-0001: Data-only RoomSpec, trusted hand-written renderer

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

The product's direction is AI-authored 3D rooms. The single biggest risk in
letting a model drive a 3D scene is **arbitrary code execution**: if generated
output can become executable JavaScript/Three.js, a model error or a prompt
injection becomes a security hole in the user's browser.

We need a way for *untrusted authors* (an LLM later; hand-authored data today)
to describe rooms that the browser can render **without ever running
author-supplied code**.

## Decision

1. **A room is described by a `RoomSpec`, which is pure data** — JSON-shaped:
   numbers, strings, enums, arrays, objects. It contains **no functions, no
   expressions, no code, and is never `eval`'d**.
2. **The renderer is trusted, hand-written code.** It maps a fixed set of known
   object `type` strings to hand-written builders via a **registry**
   (`throne`, `pillar`, `rug`, `torch`, `arch`, `scroll`, `npc`, `prop`). A
   RoomSpec selects and parameterizes existing builders; it can never introduce
   new behavior.
3. **Validation happens at the boundary.** `loadRoomSpec` validates all data
   crossing into the renderer (zod). The room envelope is validated strictly;
   each object is validated independently and, if invalid/unknown, skipped and
   rendered as a visible placeholder.
4. **This holds for every author.** When generation arrives, model output is a
   RoomSpec that flows through the *same* `loadRoomSpec` and the *same* registry.
   The model emits **data, never code**.

## Consequences

- A hostile or malformed generation is just data that either validates (and is
  rendered by reviewed code) or fails validation (and is skipped/rejected).
  There is no path from author output to executed JS.
- New content capability = a new schema variant **plus** a new trusted builder,
  added and reviewed by us — a deliberate, auditable step.
- The same trust boundary must be re-asserted server-side once a backend exists
  (validate again at the HTTP edge; never trust a stored or transmitted spec
  blindly).
- Slight verbosity: everything renderable must be expressible as data and have a
  builder. This is the intended trade-off.

## Alternatives considered

- **Let the model emit Three.js / JS** — rejected: arbitrary code execution.
- **A scripting DSL** the model emits — rejected: a DSL is still a language to
  sandbox and evolve; pure data with a fixed registry is simpler and safer.
