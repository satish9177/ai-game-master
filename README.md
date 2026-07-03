# AI Game Master

A browser-based controlled 3D / isometric solo RPG engine. The world is described
by validated, data-only **RoomSpec** JSON and rendered entirely by trusted,
hand-written **Three.js** code — the AI (real or fake) emits only schema-validated
data that flows through a fixed safety pipeline before anything reaches the
renderer.

A working demo ships immediately: an authored two-room world with a live quest,
a consequence journal, a player HUD, and browser save/load. Generation is
**offline and deterministic by default** — no API key or network needed. An
optional dev-only real LLM provider (OpenAI / DeepSeek, bring-your-own-key) can
generate rooms from a text prompt.

## Architecture & engineering standards

This repo follows documented architecture boundaries and engineering standards.
Start with **[AGENTS.md](./AGENTS.md)** (rules for contributors and AI coding
agents), then the architecture docs in
**[`docs/architecture/`](./docs/architecture/ARCHITECTURE.md)**:

- [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) — layers, feature status,
  the data-only RoomSpec → trusted-renderer trust boundary, and future plug-in
  points.
- [BOUNDARIES.md](./docs/architecture/BOUNDARIES.md) — allowed/forbidden imports.
- [CONVENTIONS.md](./docs/architecture/CONVENTIONS.md) — coordinates & RoomSpec
  authoring.
- [FAILURE-MODES.md](./docs/architecture/FAILURE-MODES.md) — failure detection &
  handling.
- [decisions/](./docs/architecture/decisions/) — architecture decision records
  (ADRs).
- [Generated room manual evaluation suite](./docs/evaluation/generated-room-manual-evaluation-suite-v0.md)
  — human checklist for generated-room demo review.
- [Release readiness check v0](./docs/release/release-readiness-check-v0.md) —
  historical point-in-time audit from 2026-06-24, not a current release status.

## How to run

The app lives in `apps/web/`.

```bash
cd apps/web
npm install
npm run dev      # start the Vite dev server (prints a localhost URL)
npm run build    # type-check (tsc -b) + production build
```

Open the printed URL (e.g. `http://localhost:5173`). The authored demo loads
immediately — no API key or network needed.

> Stack: React 19 + TypeScript + Vite, vanilla Three.js (not react-three-fiber),
> zod for RoomSpec validation. Node.js + SQLite power a headless backend; browser
> gameplay uses in-memory adapters.

## First-run experience

On first load you'll see an authored throne room in an isometric 3D view. The
following overlays are visible immediately:

- **Status HUD** — player health bar, inventory list, and status chips.
- **Quest tracker** — "The Steward's Toll" with three authored objectives that
  check off live as you play.
- **Journal** (collapsible) — six authored consequence entries that unlock as you
  explore and make choices.
- **Save / Load bar** — save your session to `localStorage` and resume it after a
  page reload.
- **Prompt bar** — type a scene description and hit Generate to build a new room
  (offline by default; see Generation modes below).

## Try the demo in 60 seconds

1. **Move** with WASD; the isometric camera follows.
2. **Walk near the throne** and press **E** to offer the tribute coin (quest
   objective 1 — watch the tracker).
3. **Walk near Malik** (the steward) and press **F** to trigger the encounter;
   pick a choice (quest objective 2).
4. **Walk into the north arch** to enter the ruined safehouse (quest objective 3
   flips done immediately on entry).
5. Watch the **journal** entries unlock as you hit each condition.
6. Press **Save**, reload the page, then **Continue** — your quest progress and
   inventory are restored.
7. **Type a scene** in the prompt bar (e.g. "a flooded cellar with a locked
   chest") and hit **Generate** — a room is built offline from the description,
   deterministically, with no spend.
8. *(Optional)* Set up a real API key to try live LLM generation — see
   **Generation modes** below.

## Screenshot / GIF placeholder

No screenshot or GIF is committed yet. A future capture should use the
60-second demo flow above with offline/fake mode, or with no real API key
active. Avoid showing secrets, env files, browser console output, raw provider
responses, prompts, generated JSON, memory text, or private local paths.

## Controls

| Input | Action |
| --- | --- |
| **W / A / S / D** | Move on the floor plane (screen-relative; delta-time scaled) |
| **E** | Interact when the prompt shows "Press E …" |
| **F** | Interact when the prompt shows "Press F …" |
| **Walk into an arch** | Navigate to the next room |
| **Esc** / Close button / backdrop | Close the open dialogue or encounter panel |

Movement is screen-relative: W moves away from the camera (into the scene), S
moves toward it, A/D strafe left/right. Diagonals are normalized. Movement and
E/F are disabled while a panel is open.

## Generation modes

### Offline demo — no key required (default)

By default the app uses a **deterministic fake generator**: your prompt is seeded
into a PRNG that produces a valid `RoomSpec` with no API key, no network call, and
no cost. The same prompt always produces the same room.

### Optional dev-only real provider (BYOK)

You can switch to a real LLM provider (OpenAI or DeepSeek) for live generation:

1. Copy `apps/web/.env.example` → `apps/web/.env.local`.
2. Set `VITE_AIGM_LLM_PROVIDER`, the matching API key, and a model id.
3. Restart `npm run dev`.

See `apps/web/.env.example` for all options and the safety caveat.

**Browser-key caveat:** Vite inlines `VITE_*` values into the built browser
bundle. A real API key compiled into a production build is exposed to every
visitor. Use real keys only with `npm run dev` in a gitignored `.env.local` file.
Never `npm run build` and deploy a bundle compiled with a real key. Hosted
production must move the provider server-side.

**Usage guardrail:** When a real provider is active the app counts generation
attempts against a per-session cap and asks you to confirm before continuing at
the cap.

## Troubleshooting

- **Commands fail from the repo root:** the app is under `apps/web`, so run
  `npm install`, `npm run dev`, `npm run build`, `npm run lint`, and
  `npm run test` from that directory.
- **PowerShell blocks `npm.ps1`:** use `npm.cmd` instead, for example
  `npm.cmd run dev`.
- **Real provider does not activate:** missing or incomplete BYOK env vars fall
  back to fake/offline behavior. Confirm `VITE_AIGM_LLM_PROVIDER`, the matching
  key, and `VITE_AIGM_LLM_MODEL` in `apps/web/.env.local`, then restart the dev
  server.
- **The 3D view is blank or unstable:** try a current browser with WebGL enabled
  and updated graphics drivers. See
  [FAILURE-MODES.md](./docs/architecture/FAILURE-MODES.md) for the project's
  failure-handling notes.
- **Need diagnostics:** check the browser console for safe high-level status,
  enums, booleans, or counts. Do not paste raw logs that include prompts,
  provider bodies, generated JSON, memory text, dialogue, secrets, or personal
  data into issues or PRs.

## Data-only RoomSpec / trusted-renderer trust boundary

`RoomSpec` is **pure data** — validated with zod and mapped to trusted builders by
`type` string. Nothing in a RoomSpec is ever executed as code. The LLM (real or
fake) returns raw text; the assembly pipeline parses, schema-validates,
semantically validates, repairs, or falls back to a safe authored room before
anything reaches the renderer. The renderer executes only trusted, hand-written
Three.js builders — this boundary holds regardless of what the LLM outputs.

## Current limitations (by design for v0)

- **Dev-only real provider** — browser-direct BYOK only; no hosted production
  path with server-side key management yet.
- **No real collision** — movement is clamped to the room AABB; no per-object
  collision detection.
- **No death / game-over state** — player health can reach 0 but no end-state is
  shown.
- **In-memory browser gameplay** — the Node/SQLite backend exists headless but the
  browser is unwired; gameplay state lives in-memory and `localStorage` only.
- **Fake NPC dialogue remains the default** — offline NPC replies are canned and
  zero-cost; real LLM NPC dialogue exists only as an opt-in dev/BYOK provider
  path when configured.
- **Adjacent-room warming uses the fake generator only** — background pre-generation
  makes no real LLM calls and costs nothing.
- **Primitives only** — no GLTF / imported models, no textures; rooms are built
  from hand-constructed Three.js shapes.
- **Single save slot** — one named `localStorage` slot; no file export/import or
  multiple slots.
