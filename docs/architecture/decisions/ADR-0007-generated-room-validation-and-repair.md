# ADR-0007: Generated-room validation and repair pipeline

- **Status:** Accepted — **future shape only, nothing built**
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

When generation arrives, a user prompt becomes a `RoomSpec` authored by an LLM.
[ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) guarantees the
output is *data, never code*, so there is no arbitrary-code-execution risk. But
**safe is not the same as good**: a spec can be valid JSON, pass the schema, and
still describe an unplayable or boring room — an NPC inside a wall, no reachable
exit, a quest that references an item that was never placed.

We need a documented pipeline that turns a prompt into a room that is *both* safe
*and* acceptable, with bounded cost and a guaranteed safe outcome even when the
model cannot produce a good room.

## Decision

### The generation pipeline (planned flow)

```
  user prompt
      │
      ▼
  fast LLM  ──►  RoomSpec JSON            (cheap, quick first draft)
      │
      ▼
  schema validation        ── JSON shape / types (zod, the loadRoomSpec boundary)
      │
      ▼
  code validator           ── DETERMINISTIC code, not an LLM:
      │                       reachable exit? NPCs/objects not clipping walls?
      │                       quest items present? lights/objects within budget?
      ▼
  LLM reviewer (optional)  ── creative/story quality: coherent, on-prompt, fun
      │
      ▼
  repair / regenerate loop ── bounded; see retry policy below
      │
      ▼
  trusted renderer         ── ONLY ever sees a validated, accepted spec
      │
      ▼
  (if no acceptable room)  ──►  safe fallback room
```

### Four distinct checks — do not conflate them

1. **Schema validation** — checks **JSON/shape**: required fields, types, enums.
   This is `loadRoomSpec` (zod) and is the existing trust boundary. *Passing it
   means the data is well-formed, not that the room is playable.*
2. **Code validator** — **deterministic, hand-written code, not an LLM.** Checks
   semantic playability: reachable exit, no NPC/object inside a wall, quest items
   actually placed, object/light counts within budget, spawn inside the room.
3. **LLM reviewer (optional)** — checks **creative/story quality**: is the room
   coherent, on-prompt, and interesting? This is the only check that uses a model
   to *judge*, and it never edits the spec directly — it returns a verdict that
   feeds the repair loop.
4. The headline rule: **valid JSON does not mean the room is playable or good.**
   Schema validation is necessary but not sufficient; the code validator and the
   reviewer exist precisely to cover the gap.

### Retry / repair policy (v1)

- **Fast model first** for the initial draft.
- **One fast repair attempt** with a corrective prompt that names the specific
  validator/reviewer failures.
- **Slow/better model fallback** only if the fast repair still fails.
- **No infinite retries. Max attempts: 3.**
- **Target first-room generation: 10–30 seconds.**
- **Hard max generation window: ~60 seconds for v1.**
- **After hard failure:** a safe error with a *retry button* **or** a fallback
  demo room. Never ship an unvalidated or known-bad room to the renderer.

### Failure classes and handling

| Class | Examples | Handling |
| --- | --- | --- |
| **Object-level** (room still playable) | one NPC clipping a wall, a single overlapping prop, an extra light over budget | skip / replace with placeholder / log a warning and keep the room |
| **Room-level** (room not playable) | no reachable exit, spawn outside the room, quest item missing, impossible encounter | repair or regenerate within the attempt budget |
| **Repeated failure** | still unacceptable after max attempts | safe fallback room / retry — never a broken room |

Concrete quality cases this pipeline is designed to catch: valid `RoomSpec` but
bad room; NPC inside a wall; no reachable exit; quest mentions an item that is
missing; too many overlapping objects/lights; room too empty/boring; output that
does not match the prompt; impossible danger/encounter. Full per-case treatment
lives in [FAILURE-MODES](../FAILURE-MODES.md).

## Consequences

- The renderer's contract is unchanged: it only ever receives a spec that passed
  the **same** `loadRoomSpec` boundary — generation adds checks *before* that
  boundary, it does not weaken it.
- Bounded attempts and a hard time budget cap cost and latency; the safe fallback
  guarantees the user is never stuck.
- The deterministic code validator is the highest-leverage, lowest-cost gate and
  should be built before the (optional, more expensive) LLM reviewer.
- The validator/reviewer split keeps responsibilities clean: deterministic rules
  in code, taste in the reviewer, shape in the schema.

## Alternatives considered

- **Schema validation only** — rejected: lets valid-but-unplayable rooms reach
  the renderer (NPC-in-wall, no exit).
- **LLM-only validation** — rejected: non-deterministic, slower, costlier, and
  weaker than code for hard invariants like reachability and collision.
- **Unbounded retry until success** — rejected: unbounded cost and latency; no
  guaranteed outcome. A capped loop with a safe fallback is predictable.
