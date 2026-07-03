# Implementation Plan — `feature/open-source-launch-polish-v0`

> Status: **Implemented / closed for approved docs-only slices.**
> This plan defines a docs/repo-readiness pass for open-source/demo launch,
> after `generated-room-demo-polish-pass-v0`
> ([closeout](./generated-room-demo-polish-pass-v0.md)). It touches
> **documentation and repo-hygiene files only** — no runtime code, no tests,
> no generated media. Shipped slices: README cross-links/drift fixes,
> `CONTRIBUTING.md`, README troubleshooting, root `.gitignore`, README
> screenshot/GIF placeholder instructions, and this closeout update.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md).
>
> Direct precedents this plan builds on:
> - [`generated-room-demo-polish-pass-v0`](./generated-room-demo-polish-pass-v0.md)
>   — its §13 explicitly deferred README/license/screenshots/onboarding/repo-hygiene
>   work to *this* feature. This plan is that hand-off.
> - [`generated-room-manual-evaluation-suite-v0`](./generated-room-manual-evaluation-suite-v0.md)
>   and the shipped suite at
>   [`docs/evaluation/generated-room-manual-evaluation-suite-v0.md`](../../evaluation/generated-room-manual-evaluation-suite-v0.md)
>   — the reference this plan links from a "manual evaluation" README/docs
>   pointer; it is not re-run or modified here.
> - [`docs/release/release-readiness-check-v0.md`](../../release/release-readiness-check-v0.md)
>   — a prior point-in-time readiness audit (base commit `82cfbeb`) that already
>   verified README links, BYOK docs, and log-safety. Its "Follow-ups (not
>   blocking)" table is a direct input to this plan's gaps (§2, §12).
>
> Global invariants for THIS feature (expanded in §5): no runtime behavior
> change; no `RoomSpec`/`LoadedRoom`/`WorldState`/`WorldEvent`/save-load/schema
> change; no provider/LLM behavior change; no memory writes; no
> gameplay/navigation/NPC movement change; no new dependencies; no generated
> assets or screenshots unless explicitly approved; no marketing exaggeration
> or false production-readiness claims; no hidden provider calls; no
> keys/secrets; no raw prompt/provider/memory/log leakage in any doc example.

---

## 1. Goal and non-goals

### Goal

Make the repository **legible and trustworthy to a first-time outside
reader** (an open-source visitor, a demo audience, or a future contributor)
by tightening existing docs and closing small, low-risk repo-hygiene gaps —
without touching any runtime code, schema, provider behavior, or gameplay
system.

Concretely, this pass may:

- Clarify and tighten the existing root `README.md` (it is already
  substantial — see §2) rather than rewrite it from scratch.
- Add a small number of missing launch-readiness documents (`LICENSE`,
  `CONTRIBUTING.md`, a root `.gitignore`) if the maintainer approves each.
- Add a short **troubleshooting** section/doc for common local-setup failure
  modes.
- Add explicit **pointers** (not new content duplication) from the README to
  already-shipped docs: `docs/evaluation/generated-room-manual-evaluation-suite-v0.md`,
  `docs/release/release-readiness-check-v0.md`, `docs/architecture/FAILURE-MODES.md`,
  known-limitations content.
- Add a **repo hygiene checklist** doc/section (stray files, tracked
  artifacts, gitignore completeness) and act on any finding the maintainer
  approves.
- Add **placeholders/instructions** for where a screenshot/GIF would go —
  never the media itself, per the hard invariant.

### Non-goals

- ❌ **Not gameplay polish.** No renderer, builder, composition, or NPC
  presentation change — that was `generated-room-demo-polish-pass-v0`.
- ❌ **Not `room-memory-debug-viewer-v0`** or any memory/debug-viewer feature.
- ❌ **Not NPC relationship/state work.**
- ❌ **Not FTS/memory retrieval work.**
- ❌ **Not structured dialogue effects.**
- ❌ **Not a rewrite.** The root `README.md` is already thorough (architecture
  links, quickstart, controls, generation modes, BYOK, trust boundary, known
  limitations — see §2). This pass edits/extends it; it does not replace it
  wholesale.
- ❌ **No committed screenshots, GIFs, recorded walkthroughs, or trailers**
  unless the maintainer explicitly approves specific media in §14 and a later
  slice adds it deliberately.
- ❌ **No hosted deployment, CI pipeline, badges service, or docs site.** Out
  of scope for a docs/repo-readiness pass.
- ❌ **No claim that the project is production-ready.** Existing "Current
  limitations (by design for v0)" framing in the README must be preserved and,
  where extended, kept equally honest.

---

## 2. Current repo facts to verify before implementation

Re-verify all of these at implementation time — docs and repo state can drift.

- **Root `README.md` already exists and is substantial** (`README.md:1-152`):
  project description, trust-boundary summary, architecture doc links, "How to
  run" (`cd apps/web && npm install && npm run dev`/`npm run build`),
  first-run experience, a "Try the demo in 60 seconds" walkthrough, a controls
  table, "Generation modes" (offline fake default + optional BYOK real
  provider with the browser-key caveat), the data-only RoomSpec / trusted
  renderer boundary, and a "Current limitations (by design for v0)" list. Any
  new content added by this plan must **not duplicate** this — it should
  tighten wording, fix drift, or add the small number of genuinely missing
  pieces (§3).
- **`apps/web/README.md` exists** and is a two-line pointer to the root
  README and `.env.example` (`apps/web/README.md:1-8`). No change expected
  unless a link target moves.
- **`apps/web/.env.example` exists and is well-documented**
  (`apps/web/.env.example:1-30`): default `fake` provider, dev-only/BYOK
  caveat, all `VITE_AIGM_LLM_*` / `VITE_OPENAI_API_KEY` / `VITE_DEEPSEEK_API_KEY`
  vars documented, no real key present. This is the BYOK/provider-setup
  explanation the task asks for — it already exists; this plan should link to
  it more prominently rather than duplicate its content.
- **`apps/web/.gitignore` exists** and excludes `.env.local`, `*.local`,
  `node_modules`, `dist`, `data/*.db`, `.data` (`apps/web/.gitignore:1-20`).
  `.env.local` is confirmed present on disk but **correctly gitignored**
  (`git check-ignore -v apps/web/.env.local` confirms match); it is not
  tracked (`git ls-files` returns nothing for it).
- **No root-level `.gitignore` exists.** The root `node_modules/` directory is
  present on disk but is **not** tracked by git (`git ls-files | grep
  node_modules` returns zero root-level matches) — verify at implementation
  time whether this is from a global gitignore, an untracked-but-present
  directory, or something else; do not assume a root `.gitignore` is
  strictly required, but it is a plausible hygiene gap (§9/§12).
- **No `LICENSE` file exists** at the repo root (confirmed via directory
  listing). No open-source license is currently declared anywhere in the repo.
- **No `CONTRIBUTING.md` exists.** `AGENTS.md` covers *agent*/workflow rules
  thoroughly but there is no separate human-facing contribution doc.
- **`docs/release/release-readiness-check-v0.md` already exists**
  (dated 2026-06-24, base commit `82cfbeb`) — a **prior, point-in-time**
  audit: build/lint/test pass, README links resolve, BYOK docs verified,
  log-safety reviewed "PASS", and a non-blocking follow-ups table (manual
  browser smoke test, WebGL-unavailable fallback, log-level filtering,
  `max_completion_tokens` mapping for newer OpenAI models). This plan should
  **link** to it as a known-limitations/manual-review reference, not
  duplicate or re-run it. Its findings are stale relative to `main` today
  (several features have shipped since that commit) — do not present its pass
  results as current without re-verification (§12).
- **`docs/evaluation/generated-room-manual-evaluation-suite-v0.md` already
  exists** — the manual evaluation reference this task asks to be linked from
  launch docs. It is a human checklist; unaffected by this plan.
- **No `docs/status/SHIPPED-FEATURES.md`** exists yet, despite `AGENTS.md`
  suggesting that location for long shipped-feature notes (`AGENTS.md:309-313`).
  Out of scope to create here unless the maintainer explicitly wants a
  launch-facing feature summary distinct from `ARCHITECTURE.md`'s status
  legend (§14 decision).
- **`apps/web/package.json` scripts** (`apps/web/package.json:6-13`): `dev`,
  `dev:api` (headless Node API, separate from the browser app), `build`
  (`tsc -b && vite build`), `lint`, `test` (`vitest run --passWithNoTests`),
  `preview`. Any quickstart doc must match these exactly — do not invent
  scripts that do not exist.
- **No root `package.json`.** The repo is a single-app layout (`apps/web`),
  not an npm workspace; quickstart docs must always `cd apps/web` first, as
  the README already does.
- **`AGENTS.md`, `docs/architecture/ARCHITECTURE.md`,
  `docs/architecture/BOUNDARIES.md`, `docs/architecture/CONVENTIONS.md`,
  `docs/architecture/FAILURE-MODES.md`, and `docs/architecture/decisions/`**
  all exist and are the authoritative architecture-doc set the README already
  links to correctly (per the prior release-readiness check, §above).
- **Run/verify.** From `apps/web`: `npm run build`, `npm run lint`,
  `npm run test`. For a docs-only slice, the smallest relevant check is a
  markdown/link sanity pass (§8) — no build/lint/test is expected to be
  affected, but report explicitly if any is skipped per `AGENTS.md`'s
  "Build and verify" rule.

**To confirm at implementation time:** exact current ADR count/highest ADR
number (`docs/architecture/decisions/` — `ADR-0074` was the highest at time of
writing this plan) if a launch-polish ADR is added (§14 decision); current
test count if the README/release-readiness doc is asked to state one (prefer
*not* stating a specific test count in launch-facing docs, since it drifts —
say "the full suite" instead, see §5).

---

## 3. Launch-readiness target areas

Mapped to what already exists vs. what is a genuine gap, so slices (§6) fix
gaps rather than re-litigate settled content.

| Task's target area | Current state | Gap? |
| --- | --- | --- |
| README clarity | Already thorough (§2) | Tighten only — fix any drift, no rewrite |
| Project positioning | Already stated (opening 3 paragraphs) | Verify still accurate; no change expected |
| Quickstart instructions | Already present, matches `package.json` scripts | Verify accuracy only |
| Local setup instructions | Same as quickstart | Verify accuracy only |
| BYOK/provider setup explanation | Already thorough in README + `.env.example` | Add a clearer cross-link only |
| Demo flow instructions | "Try the demo in 60 seconds" already exists | Verify still matches current controls/flow |
| Screenshots/GIF placeholders | **None exist** | Gap — add an instructional placeholder only, no media (§7, §14 decision) |
| Contribution/development notes | **`CONTRIBUTING.md` does not exist** | Gap — small new doc (§6 Slice 3) |
| Architecture overview links | Already present and verified correct (prior release-readiness check) | Verify only |
| Known limitations | Already present, detailed and honest | Verify still accurate; extend only if drifted |
| Safety boundaries | Covered via `AGENTS.md`/`BOUNDARIES.md` links | Verify link freshness only |
| Manual evaluation references | **Not yet linked from README/launch docs** | Gap — add a pointer (§6 Slice 2) |
| Troubleshooting notes | **Do not exist** | Gap — small new section/doc (§6 Slice 4) |
| Repo hygiene checklist | **Does not exist**; `LICENSE` and root `.gitignore` are missing | Gap — checklist doc + maintainer-approved fixes (§6 Slice 5) |

---

## 4. What is allowed to change

Only documentation and repo-hygiene files, and only within the invariants
(§5):

- `README.md` (root) — wording tightening, new cross-links, a troubleshooting
  section, a screenshot/GIF placeholder note. No removal of existing accurate
  content.
- `apps/web/README.md` — link updates only if a target path changes.
- New `CONTRIBUTING.md` (root) — development workflow notes, pointing to
  `AGENTS.md` as the authoritative agent/contributor rule set rather than
  duplicating it.
- New `LICENSE` (root) — **only after the maintainer picks a license**
  (§14 decision — this is not this plan's call to make).
- New root `.gitignore` — **only after confirming** (§2) it closes a real gap
  and does not change what is currently tracked in a surprising way.
- New `docs/architecture/implementation-plans/open-source-launch-polish-v0.md`
  — this file itself, and its closeout updates.
- Small additions to existing docs that already invite launch-facing links —
  e.g., a "Manual evaluation" or "Release readiness" pointer near the README's
  existing "Architecture & engineering standards" section.
- A documentation-only `docs/architecture/decisions/ADR-00XX-open-source-launch-polish-v0.md`
  **only if** the maintainer wants one at closeout (§14 decision) — ADRs are
  normally reserved for architecture/behavior decisions, and this feature
  makes none; default is **no ADR**.

---

## 5. What is explicitly NOT allowed to change

Hard invariants for every slice (violating any one rejects the change in
review, even if a check passes):

- ❌ **No runtime behavior change** — no edits to any file under
  `apps/web/src/**` except doc comments are out of scope entirely; this
  feature does not touch source code.
- ❌ **No `RoomSpec` / `LoadedRoom` / `WorldState` / `WorldEvent` / save-load /
  schema change** of any kind.
- ❌ **No provider/LLM behavior change** — `.env.example`, `llmConfig.ts`,
  `selectRoomGenerator.ts`, and the real provider adapter are not touched by
  this feature; only *documentation about* the existing BYOK setup may be
  clarified.
- ❌ **No memory writes** and no memory-firewall change.
- ❌ **No gameplay/navigation/NPC movement change.**
- ❌ **No new dependencies** — no `package.json` edit, no new devDependency for
  markdown linting, link-checking, or doc generation unless the maintainer
  explicitly approves one (default: use manual link verification, §8).
- ❌ **No generated assets or screenshots** committed to the repo unless the
  maintainer explicitly approves specific media in §14 and a dedicated later
  slice adds it — this plan may add only a placeholder *instruction* (e.g., "a
  screenshot/GIF can go here — none is committed yet").
- ❌ **No marketing exaggeration** — no unverifiable superlatives ("blazing
  fast", "production-grade", "enterprise-ready"). Keep the README's existing
  plain, technical, honest tone.
- ❌ **No false claims about production readiness** — the README's existing
  "Current limitations (by design for v0)" framing must be preserved and
  never contradicted by new marketing copy.
- ❌ **No hidden provider calls** — no doc may instruct a reader to run
  anything that silently calls a real LLM provider; every BYOK step must
  stay opt-in and explicit, matching the existing README/`.env.example`
  caveats.
- ❌ **No keys/secrets** — no real API key, token, or credential in any new or
  edited doc, example, or script snippet. Example values must stay obviously
  fake (e.g., `sk-...` placeholders already used elsewhere in the repo, never
  a real-looking key).
- ❌ **No raw prompt/provider/memory/log leakage** — no doc may reproduce a
  raw generated `RoomSpec` JSON blob, a real provider request/response body,
  memory record text, or a full application log line as an example; if a log
  example is useful for troubleshooting, it must use the same safe
  enum/count/boolean shape the app itself logs (per `AGENTS.md`'s logging
  rules), never invented realistic-looking sensitive content.
- ❌ **No test file added or edited in this plan's slices** — the task
  explicitly says "do not create tests yet." Any later verification step is a
  manual doc/link check (§8), not an automated test suite.
- ❌ **No CI/workflow file added** (e.g., `.github/workflows/*`) — out of
  scope; a badges/CI slice would need its own approval and is not implied by
  "launch polish."
- ❌ **No architecture/ADR content is overridden or weakened** — any new
  troubleshooting/limitations text must be consistent with
  `ARCHITECTURE.md`/`BOUNDARIES.md`/`AGENTS.md`, never contradict them.

---

## 6. Smallest safe implementation slices

Each slice is independently reviewable and revertable. Slice 1 is this
document. The maintainer may approve a subset; slices are ordered
lowest-risk-first.

- **Slice 1 — Docs plan (this file).** Design/approval checkpoint. No other
  file changes.
  Commit: `docs: plan open source launch polish v0`.
- **Slice 2 — README cross-links + drift check.** Verify every existing
  README claim against current code (quickstart scripts, controls, generation
  modes, limitations); fix any drift found; add pointers to
  `docs/evaluation/generated-room-manual-evaluation-suite-v0.md` and
  `docs/release/release-readiness-check-v0.md` near the existing
  "Architecture & engineering standards" section. No content removed, no new
  claims invented.
  Commit: `docs: verify and cross-link launch-facing README content`.
- **Slice 3 — CONTRIBUTING.md.** Small new root doc: how to propose a change
  (design-first per `AGENTS.md`), how to run build/lint/test, how to file an
  issue/PR, and an explicit pointer to `AGENTS.md` as the binding rule set
  (no duplication of its content).
  Commit: `docs: add CONTRIBUTING.md pointing to AGENTS.md workflow rules`.
- **Slice 4 — Troubleshooting notes.** A short new README section (or a small
  `docs/TROUBLESHOOTING.md` if the maintainer prefers a separate file — §14
  decision) covering the handful of known/likely local-setup failure modes:
  Node version mismatch, `npm install` from the wrong directory (must be
  `apps/web`), missing/incomplete BYOK env vars silently falling back to fake
  (this is correct/safe behavior, not a bug — document it as such), WebGL
  unavailable (per `FAILURE-MODES.md`), and where to look (browser console
  safe diagnostics) without ever pasting real console output.
  Commit: `docs: add troubleshooting notes for local setup`.
- **Slice 5 — Repo hygiene checklist + approved fixes.** A short checklist
  (in this plan's §9, and/or a small standalone note) covering: root
  `.gitignore` presence/correctness, `LICENSE` presence, no stray/generated
  files tracked, `.env.local` never tracked, no dead links. Apply only the
  fixes the maintainer explicitly approves in §14 (e.g., add root
  `.gitignore` if confirmed necessary; add `LICENSE` only once a license is
  chosen).
  Commit: `docs: repo hygiene checklist` (+ `chore: add root .gitignore` /
  `chore: add LICENSE` as separate commits if approved, per `AGENTS.md`'s
  "include only relevant files" commit rule).
- **Slice 6 — Screenshot/GIF placeholder instructions (approval-gated, no
  media).** Add a short README note describing *where* a screenshot/GIF would
  go and *how* a future contributor should capture one (e.g., "capture the
  60-second demo flow at 1280×720, no real API key active"), without
  committing any actual image/video file. Only proceed if the maintainer
  confirms they want the placeholder text at all (§14) — skip entirely
  otherwise.
  Commit: `docs: add screenshot/GIF placeholder instructions (no media)`.
- **Slice 7 — Closeout.** Update this plan's status, record what shipped vs.
  was deferred/skipped, confirm the safety/boundary checklist (§10), and
  decide whether an ADR is warranted (§14 — default no).
  Commit: `docs: close out open source launch polish v0`.

---

## 7. Files likely to be touched per slice

Docs and repo-hygiene files only. **No file under `apps/web/src/**` is
touched by any slice.**

| Slice | Files (likely) |
| --- | --- |
| 1 | `docs/architecture/implementation-plans/open-source-launch-polish-v0.md` (this file) |
| 2 | `README.md` |
| 3 | `CONTRIBUTING.md` (new) |
| 4 | `README.md` (new section) or `docs/TROUBLESHOOTING.md` (new, if split out) |
| 5 | This plan (§9 checklist); possibly `.gitignore` (new, root); possibly `LICENSE` (new, root) — each as its own commit, only if approved |
| 6 | `README.md` (placeholder note only — no media file added anywhere) |
| 7 | This plan (status/closeout section); optionally `docs/architecture/decisions/ADR-00XX-open-source-launch-polish-v0.md` and one `ARCHITECTURE.md` status line, only if §14 approves |

**Explicitly NOT touched by any slice:** anything under `apps/web/src/**`;
`apps/web/package.json` / `package-lock.json`; `apps/web/vite.config.ts`;
`apps/web/eslint.config.js`; any `tsconfig*.json`; `apps/web/.env.example`
(content frozen — only a README *link* to it may change);
`docs/architecture/decisions/` existing ADRs; `docs/architecture/ARCHITECTURE.md`
/ `BOUNDARIES.md` / `CONVENTIONS.md` / `FAILURE-MODES.md` (read/linked, not
edited, unless the maintainer separately approves a status-line addition at
closeout); `docs/evaluation/**`; `docs/release/**` (linked, not edited); any
test file (`*.test.ts`/`*.test.tsx`).

### Minimum Safe Change Check

- **Reused:** the existing, already-thorough root `README.md`; the existing
  `apps/web/.env.example` BYOK documentation; the existing
  `docs/evaluation/generated-room-manual-evaluation-suite-v0.md` and
  `docs/release/release-readiness-check-v0.md` as link targets;
  `AGENTS.md`/`ARCHITECTURE.md`/`BOUNDARIES.md`/`FAILURE-MODES.md` as the
  authoritative source of truth for any safety/limitation claim.
- **Minimum new code:** zero runtime code. New content is limited to a
  `CONTRIBUTING.md`, a troubleshooting section/doc, a repo-hygiene checklist,
  cross-links, and — only if separately approved — a root `.gitignore`,
  a `LICENSE` file, and screenshot/GIF placeholder text (never the media
  itself).
- **Safety boundaries unchanged:** every boundary in `AGENTS.md`/
  `BOUNDARIES.md` (trusted renderer, data-only RoomSpec, memory firewall,
  authoritative world-session/event-log, logging redaction, provider opt-in
  BYOK) is described, never altered, weakened, or contradicted.
- **Targeted tests:** none required — this is a docs-only feature per the
  task. §8 defines a manual doc/link verification procedure instead.

---

## 8. Tests/checks required per slice

No automated tests are added or run against source code, per the task's
explicit "do not create tests yet." Each slice instead gets a manual doc
check:

- **Slice 1 (docs):** none. Report build/test as *skipped* (docs-only),
  per `AGENTS.md`'s "For docs-only changes, run the smallest relevant check
  and report if a check was skipped."
- **Slice 2:** manually click/verify every link the README references
  (relative doc paths, `apps/web/.env.example`); manually re-run the
  documented commands (`npm install`, `npm run dev`, `npm run build`) once
  from a clean shell to confirm they still work as written; confirm the
  "Try the demo in 60 seconds" steps still match current controls
  (WASD/E/F, arch navigation, Save/Continue) by inspection of
  `apps/web/src/app/**` — no gameplay change is made, only claims are
  checked.
- **Slice 3:** confirm `CONTRIBUTING.md` does not restate/contradict
  `AGENTS.md`; confirm any command it documents (`npm run build`/`lint`/`test`)
  matches `apps/web/package.json` exactly.
- **Slice 4:** confirm every troubleshooting item is real and currently
  accurate (e.g., re-check `selectRoomGenerator`'s fallback-to-fake behavior
  by reading `apps/web/src/app/selectRoomGenerator.ts` rather than assuming
  the earlier architecture-doc description still holds); confirm no example
  log line resembles real leaked content.
- **Slice 5:** run `git ls-files` to confirm no unexpected file is tracked;
  run `git check-ignore -v` against `.env.local` and any local DB file
  (`apps/web/.data`, `apps/web/data/*.db`) to confirm they stay ignored after
  any `.gitignore` change; confirm `LICENSE` (if added) contains only
  standard license text, no project-specific claims.
- **Slice 6:** confirm the placeholder text does not reference a file path
  that doesn't exist and does not imply a screenshot is already present.
- **Slice 7:** re-run the full link/command check from Slice 2 once more
  after all approved slices land; report `npm run build`/`lint`/`test` status
  honestly — expected **unaffected** (no source file touched), but confirm by
  running them if any slice touched a file `tsc`/ESLint would parse (it
  should not, but verify per `AGENTS.md`: "Do not claim checks passed unless
  they were actually run").

---

## 9. Manual review procedure

1. From the repo root, read the current `README.md` top-to-bottom as a
   first-time visitor would; note anything unclear, stale, or overstated.
2. From `apps/web`, run `npm install` (only if `node_modules` is absent or
   `package-lock.json` changed) then `npm run dev`; open the printed URL and
   walk the README's "Try the demo in 60 seconds" steps exactly as written,
   confirming each step still works as described.
3. Confirm the offline/fake path needs **no** env var and makes **no**
   network call (watch the browser Network tab briefly) — this is the
   project's central safety/cost claim and must never silently regress in
   docs.
4. If reviewing BYOK docs, confirm `.env.example` still lists every var the
   code actually reads (cross-check `apps/web/src/app/llmConfig.ts`) and that
   no step in the README contradicts the dev-only/browser-key caveat.
5. Click every relative link added or touched by this feature; confirm each
   resolves to a real file at its stated path.
6. Read any new doc (`CONTRIBUTING.md`, troubleshooting section, hygiene
   checklist) looking specifically for: marketing language, unverifiable
   claims, production-readiness overstatement, real-looking secrets, or a
   contradiction with `AGENTS.md`/`BOUNDARIES.md`.
7. Run `git status --short` and `git diff --stat` before requesting sign-off;
   confirm only the files listed in §7 for the shipped slices appear.
8. Record the review outcome in this plan's closeout section (§11/§13).

---

## 10. Safety/boundary checklist

Every item holds for every slice in this feature:

- ✅ No file under `apps/web/src/**` changed.
- ✅ No `RoomSpec`/`LoadedRoom`/`WorldState`/`WorldEvent`/save-load/schema
  change.
- ✅ No provider/LLM behavior change; `.env.example`/`llmConfig.ts`/
  `selectRoomGenerator.ts` content untouched (only doc *links* to them may
  change).
- ✅ No memory write; memory firewall untouched.
- ✅ No gameplay/navigation/NPC movement change.
- ✅ No new dependency; `package.json`/`package-lock.json` untouched.
- ✅ No generated/committed screenshot, GIF, or media file.
- ✅ No marketing exaggeration; tone matches the existing README.
- ✅ No production-readiness overstatement; "Current limitations" framing
  preserved or extended honestly.
- ✅ No doc instructs a hidden/implicit real provider call.
- ✅ No real API key, token, or credential anywhere in any new/edited file.
- ✅ No raw prompt, generated JSON, provider body, memory text, dialogue text,
  or realistic-looking log line reproduced in any doc.
- ✅ No test file added/edited.
- ✅ No CI/workflow file added.
- ✅ No contradiction with `AGENTS.md`/`ARCHITECTURE.md`/`BOUNDARIES.md`.

---

## 11. Acceptance criteria

The pass is accepted when:

- A first-time reader can go from cloning the repo to seeing the offline demo
  running, using only the README, with zero ambiguity and zero required env
  var.
- BYOK setup is fully explained in one place (README + `.env.example`
  cross-linked), with the dev-only/browser-key caveat impossible to miss.
- `CONTRIBUTING.md` exists and correctly routes contributors to `AGENTS.md`'s
  binding workflow rules without duplicating or contradicting them.
- A short, accurate troubleshooting section/doc exists for the known local
  setup failure modes.
- A repo-hygiene checklist exists and every item on it is either satisfied or
  explicitly deferred with a stated reason (§13).
- `git diff --stat` for the shipped slices shows **only** documentation/
  repo-hygiene files — zero `apps/web/src/**`, zero `package.json`, zero test
  files, zero binary/media files.
- No new marketing claim, production-readiness claim, secret, or leakage
  example survives review (§9, §10).
- `npm run build`, `npm run lint`, and `npm run test` are unaffected — run at
  least once after all shipped slices land and reported honestly, even though
  no source file changed.

---

## 12. What must be deferred to later gameplay/memory/NPC features

Explicitly out of scope here; this feature does not start, plan, or imply any
of the following (they remain fully separate future features requiring their
own approval):

- `room-memory-debug-viewer-v0` or any memory/debug-viewer feature.
- NPC relationship/state systems.
- FTS/memory retrieval work.
- Structured dialogue effects.
- Any gameplay, quest, objective, combat, navigation, or NPC-movement change.
- Any provider/LLM behavior, prompt, or adapter change.
- Any `RoomSpec`/`SceneSpec`/`WorldState`/save-load schema change.
- A real screenshot/GIF/recorded walkthrough/trailer (only *placeholder
  instructions* are in scope here, and only if §14 approves even that).
- A hosted deployment, CI pipeline, or docs-site build.
- A `docs/status/SHIPPED-FEATURES.md` long-form feature history (may be a
  separate future docs feature; not created here unless §14 approves).
- Re-running or updating `docs/release/release-readiness-check-v0.md` itself
  — this plan links to it as a historical record; a fresh readiness check
  against current `main` would be its own follow-up, not part of this pass.

---

## 13. Closeout checklist

Closeout completed for the maintainer-approved batched docs-only pass.

- [x] Every slice the maintainer approved (§14) shipped; skipped items are
      recorded below.
- [x] `git diff --stat` across shipped slices shows only documentation/
      repo-hygiene files (§11): `README.md`, `CONTRIBUTING.md`, `.gitignore`,
      and this plan.
- [x] README links touched by this feature were verified with `Test-Path`;
      claims were checked against `.env.example` and architecture docs during
      implementation.
- [x] `CONTRIBUTING.md` is present and points to `AGENTS.md` without duplicating
      it heavily.
- [x] README troubleshooting content is present and avoids raw logs, prompts,
      provider bodies, generated JSON, memory text, secrets, and PII.
- [x] Repo hygiene checklist completed for this batch: root `.gitignore` added;
      root `node_modules/` ignored; `apps/web/.env.local` remains ignored;
      tracked `node_modules` entries remain absent; `LICENSE` is explicitly
      deferred.
- [x] No screenshot/GIF/media file committed anywhere in the diff; Slice 6 is
      README text only.
- [x] `npm.cmd run lint`, `npm.cmd run test`, and `npm.cmd run build` were run
      after the docs batch and are reported honestly:
      - `npm.cmd run lint`: passed.
      - `npm.cmd run test`: did not pass cleanly; 155/160 test files and
        2778/2778 tests passed, then Vitest reported worker/fork errors
        including `spawn EPERM` for
        `apps/web/src/platform/system/system.test.ts` after the long-running
        test process had to be stopped.
      - `npm.cmd run build`: failed on existing TypeScript errors in
        `apps/web/src/domain/assembleRoom.test.ts`,
        `apps/web/src/domain/ensureGeneratedNpcPresence.ts`,
        `apps/web/src/domain/npcMovementContract.test.ts`, and
        `apps/web/src/generation/OpenAICompatibleNPCDialogueProvider.test.ts`.
        No touched file is involved.
- [x] Safety/boundary checklist (§10) re-confirmed.
- [x] Status blockquote at the top of this plan updated to reflect what
      actually shipped.
- [x] Confirmed no gameplay/memory/NPC feature (§12) was started by this work.
- [x] Decision recorded: no ADR and no `ARCHITECTURE.md` status line were added.

Shipped in this feature:

- Slice 2: README cross-links and stale NPC-dialogue limitation fix.
- Slice 3: root `CONTRIBUTING.md`.
- Slice 4: README troubleshooting section.
- Slice 5: root `.gitignore` plus this closeout's repo-hygiene checklist.
- Slice 6: README screenshot/GIF placeholder instructions only; no media.
- Slice 7: this closeout update.

Deferred or skipped by maintainer decision:

- `LICENSE` deferred because no license choice was approved in this batch.
- `docs/status/SHIPPED-FEATURES.md` deferred; no status doc created.
- ADR and `ARCHITECTURE.md` status line skipped.
- `docs/release/release-readiness-check-v0.md` not updated or re-run; it remains
  a historical point-in-time audit.

---

## 14. Decisions needing maintainer approval before implementation

1. **License choice.** No `LICENSE` file exists today. Which license (MIT,
   Apache-2.0, other) — or explicitly none for now? This plan cannot add
   `LICENSE` content without this decision; recommend **MIT** for an
   open-source demo repo with no patent-sensitive dependencies, but this is
   the maintainer's call.
2. **Root `.gitignore`.** Add one? If so, confirm its scope (likely
   `node_modules/`, editor files, OS files at minimum) and confirm it doesn't
   change what's currently tracked in a surprising way (§2/§8 verification
   first).
3. **Troubleshooting location.** A new README section (recommended — keeps
   discovery simple) vs. a standalone `docs/TROUBLESHOOTING.md` (better if it
   grows long). Default: README section unless the maintainer prefers a
   separate file.
4. **Screenshot/GIF placeholder (Slice 6).** Include placeholder
   *instructions* only (recommended, zero media risk) vs. skip this slice
   entirely vs. defer until real media is separately approved and captured.
   No media is committed under any option in this plan.
5. **`docs/status/SHIPPED-FEATURES.md`.** `AGENTS.md` suggests this location
   for long shipped-feature notes but it doesn't exist yet. Create a
   launch-facing short version here (recommended: **no**, keep this feature
   narrowly scoped to launch-readiness docs) vs. defer entirely to a separate
   future docs feature.
6. **ADR at closeout?** Recommended: **no** — this feature makes no
   architecture or runtime-behavior decision, only documentation changes. An
   ADR would be unusual overhead for a docs-only pass; skip unless the
   maintainer specifically wants one recorded for historical/audit purposes.
7. **Re-running `docs/release/release-readiness-check-v0.md` against
   current `main`.** Its findings are from an earlier commit and are now
   stale. Recommend treating a fresh readiness check as a **separate,
   later** follow-up rather than folding it into this docs-polish pass —
   confirm.
8. **Slice subset & order.** Confirm which of Slices 2–6 to authorize and in
   what order (default: 2 → 3 → 4 → 5 → 6, lowest-risk-first, matching §6).
