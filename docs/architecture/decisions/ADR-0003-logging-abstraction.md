# ADR-0003: Logging abstraction

- **Status:** Accepted — **not yet implemented** (planned commit)
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
   Everywhere else (`no-console` lint, planned) logs through the interface.
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
- Small up-front cost: define the interface, write the console adapter, inject
  it, and remove the two `console.*` calls. This is a later, isolated commit;
  this ADR records the decision so nobody adds new `console.*` in the meantime.

## Alternatives considered

- **Keep `console.*`** — rejected: no levels/structure/routing; violates the
  project's stated standards.
- **A logging framework (winston/pino) in the browser now** — deferred: the
  interface is what matters; a minimal console adapter suffices until the backend
  exists, where a server adapter (e.g. pino) can implement the same interface.
