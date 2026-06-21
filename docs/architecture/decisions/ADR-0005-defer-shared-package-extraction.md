# ADR-0005: Defer shared-package / workspace extraction

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

The RoomSpec contract (schema + `loadRoomSpec` + types) is the natural shared
kernel between the renderer (today) and a future backend/generation layer. A
tempting move is to extract it now into `packages/contracts` and set up npm
workspaces so the contract is *physically* shared from day one.

But today there is exactly **one** consumer (the web app), the whole repo is a
handful of files, and there is no backend. Setting up workspaces now adds tooling
and ceremony for a boundary that can be enforced more cheaply.

## Decision

- **Keep the current `apps/web` structure.** Do **not** introduce npm workspaces
  or a `packages/contracts` package yet.
- **Enforce the boundaries by other means now:** folder structure, these
  architecture docs, code review, and TypeScript `strict` + ESLint
  `no-restricted-imports`. The *dependency direction* is correct today;
  the physical packaging is the only thing deferred.
- **Extract a real shared package only when both are true:** (a) the backend
  exists, and (b) there is a genuine second consumer of the RoomSpec contract.
  At that point the move is mechanical because the module boundary already holds.

## Consequences

- Less tooling now; faster iteration on a small codebase.
- The contract module must be written as if it were already a separate package:
  pure, dependency-light, no imports from renderer/UI. (This is already true and
  is enforced by [BOUNDARIES](../BOUNDARIES.md).)
- A future extraction is a folder move + workspace setup, not a redesign — the
  cost is paid once, when it's actually justified.

## Alternatives considered

- **Extract `packages/contracts` + workspaces now** — rejected as premature for
  a single-consumer, few-file repo; conflicts with "don't over-engineer".
- **Never extract** — rejected: once the backend validates the same schema,
  duplicating it would cause drift; one source of truth wins then.
