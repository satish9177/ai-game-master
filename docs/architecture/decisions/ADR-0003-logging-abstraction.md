# ADR-0003: Logging abstraction

- **Status:** Accepted — **implemented** (Logger port + browser console adapter, Commit 3)
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

Today there are two stray `console.*` calls (`Engine.ts`, `builders/index.ts`).
That is harmless now but does not scale: once generation, a backend, and
persistence add many log sites, scattered `console.log` gives no levels, no
structure, no correlation, and nowhere to route logs (e.g. to a sink) without
editing call sites. A long-term product needs one logging seam from the start.

## Decision

1. **One `Logger` interface** with level methods `debug | info | warn | error`,
   each taking a message plus an optional **structured context object**
   (`{ roomId, objectIndex, … }`). Structured from day one — never string-built.
2. **`console.*` is allowed in exactly one place:** the browser logger adapter.
   Everywhere else (enforced by the `no-console` lint rule) logs through the interface.
3. **Loggers are injected** (constructor parameters), not imported as a global —
   e.g. `new Engine(container, logger)`. No service locator, no DI framework.
4. **Pure code returns problems as data; the caller logs.** `loadRoomSpec`
   already returns `warnings[]` rather than logging — that stays. The domain
   never logs.
5. **The interface is shared; adapters differ per runtime.** Browser adapter →
   level-filtered console (debug in dev, warn+ in prod). Future server adapter →
   structured JSON with a correlation/request id. Same interface, swappable sink.
6. **Never log secrets, API keys, full prompts, or PII.**

## Consequences

- Call sites are stable; routing/format changes happen in one adapter.
- Levels and structure make logs queryable and safe to ship.
- Implemented in Commit 3: the `Logger` interface, the browser console adapter,
  injection into the engine, and removal of the two `console.*` calls (new ones
  outside the adapter now fail lint). Environment-based level filtering (point 5)
  is deferred to the composition root / a future server adapter.

## Alternatives considered

- **Keep `console.*`** — rejected: no levels/structure/routing; violates the
  project's stated standards.
- **A logging framework (winston/pino) in the browser now** — deferred: the
  interface is what matters; a minimal console adapter suffices until the backend
  exists, where a server adapter (e.g. pino) can implement the same interface.
