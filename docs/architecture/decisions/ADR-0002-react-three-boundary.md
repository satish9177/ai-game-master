# ADR-0002: React ↔ Three.js boundary

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

The app has two very different runtimes in one page: a **React** UI (declarative,
re-render-driven) and a **Three.js** engine (imperative, frame-driven, owns GPU
resources that must be manually disposed). Mixing them — React components reaching
into the scene graph, or the engine importing components — produces lifecycle
bugs, leaks, and untestable code. (Note: we deliberately use **vanilla Three.js**,
not react-three-fiber, to keep the engine independent of React's render cycle.)

## Decision

1. **The renderer is pure Three.js and imports no React.** `Engine` owns the
   renderer, scene, camera, render loop, controls, and a **total `dispose()`**.
2. **React hosts the engine through a small, explicit interface:**
   - React → engine via **imperative methods** (`setRoom`, `setInteractionLock`).
   - engine → React via **callbacks** carrying plain view data
     (`onActiveInteractionChange`, `onRequestOpenInteraction`).
3. **Wiring happens only at the composition root** (`RoomViewer.tsx` today): it
   constructs the engine, bridges callbacks to React state, and disposes on
   unmount. This is the **only** approved coupling point.
4. **UI components are presentational** and never import Three.js or engine
   internals. Shared view-model types are part of the host contract and live in
   a neutral module (`domain/ports/interaction.ts`), not inside the engine.

## Consequences

- The engine is independently testable and replaceable; React StrictMode's dev
  double-mount (mount → dispose → mount) is safe because lifecycle is explicit.
- A clear, narrow surface to reason about: anything outside methods + callbacks
  is a boundary violation (see [BOUNDARIES](../BOUNDARIES.md)).
- The interaction view-model type lives in the neutral
  `domain/ports/interaction.ts`, imported by both the engine and the UI, so
  neither imports the other's internals. This is backed by lint:
  `renderer/ui/**` may not import `renderer/engine/**` (`no-restricted-imports`).

## Alternatives considered

- **react-three-fiber** — rejected for the foundation: couples the engine to
  React's reconciler and re-render model, blurring exactly the boundary we want
  sharp and complicating manual disposal.
- **Everything in React state** — rejected: per-frame scene mutation does not
  belong in React's render cycle.
