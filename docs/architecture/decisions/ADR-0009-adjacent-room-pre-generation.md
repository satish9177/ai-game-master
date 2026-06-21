# ADR-0009: Parallel adjacent-room pre-generation

- **Status:** Accepted — **future shape only, nothing built**
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

The generation pipeline ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md))
targets 10–30 seconds for the first room, with a ~60-second hard cap. Waiting
that long on *every* room transition would ruin the experience. The world is
effectively infinite, so we also cannot generate it all up front.

The fix is to hide latency behind exploration: while the player is busy in the
current room, the backend pre-generates the rooms they are likely to enter next.

## Decision

### UX intent

- The **first** room may take up to ~60 seconds (one-time cost).
- While the player explores the current room, the backend **pre-generates
  adjacent rooms in parallel**.
- After the first room, the player should **rarely wait**.

### Generate the frontier, not the world

Pre-generate only the **nearby frontier** — the rooms immediately reachable from
where the player is — never the whole infinite world. Priority order:

1. **Visible exits** from the current room.
2. **Player-facing / nearest exit** (where they seem to be heading).
3. **Quest-critical path.**
4. **Optional / secret exits** — only *after* discovery.

**Limit parallel jobs** (e.g. **1–3 rooms** at a time) to bound cost and load.

### Room status model

Each room moves through an explicit lifecycle:

```
  not_started ──► generating ──► validating ──► repairing ──► ready
                                      │             │
                                      └──────┬──────┘
                                             ▼
                                          failed
```

| Status | Meaning |
| --- | --- |
| `not_started` | no work begun |
| `generating` | LLM drafting the spec |
| `validating` | schema + code validator + optional reviewer running |
| `repairing` | a bounded repair/regenerate attempt in flight |
| `ready` | validated and accepted; safe to render |
| `failed` | exhausted attempts (see [ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)) |

### Behavior when the player reaches an exit

| Status at the door | Behavior |
| --- | --- |
| `ready` | **instant transition** |
| `generating` (or `validating`/`repairing`) | short **"Opening the way…"** wait |
| `failed` | **retry / fallback** room |
| `not_started` | **generate on demand** (the on-demand path is just the un-prefetched case) |

## Consequences

- Perceived latency collapses to "first room only" for the common path, while
  cost stays bounded by the parallel-job limit and the frontier-only rule.
- The status model gives the UI a precise contract for what to show at a door,
  and reuses the same generation/validation/repair pipeline per room — no special
  cases.
- Prioritization needs a lightweight notion of "where the player is heading";
  v1 can start with visible + nearest exits and refine later.
- Speculative generation can be wasted if the player backtracks; the parallel-job
  cap and frontier-only scope keep that waste small and predictable.

## Alternatives considered

- **Generate every room on demand at the door** — rejected: a 10–60s wait at
  every transition. (Kept only as the `not_started` fallback.)
- **Pre-generate the whole world** — rejected: the world is effectively infinite;
  unbounded cost and storage.
- **Unlimited parallel pre-generation of all frontier exits** — rejected:
  unbounded concurrent cost/load; the 1–3 job cap with priority ordering captures
  almost all the benefit for a fraction of the spend.
