# Review — Memory Layer Plan Assessment (Fable, 2026-07-02)

> **Status: advisory review record — NOT an ADR.** Companion to the
> [architecture + roadmap review](./2026-07-02-fable-architecture-roadmap-review.md)
> from the same session. Assesses the memory/DB design
> (external doc `ai_game_master_memory_design_v1`) plus the memory layer
> already implemented in this repo. Advisory input only; implementation still
> follows the normal design → plan → approval → ADR flow.

## Verdict

**The memory plan is sound and will hold.** It will not fail because of the
design itself; the parts already built prove the pattern. The realistic
failure risks are in three specific places, all about **execution order**,
not architecture.

## Why the design is sound

1. **Truth separation is structural, not behavioral.** Memory *cannot* write
   world state: lint rules ban the imports (`memory/**` may not import
   `world-session`/`interactions`/`encounters`/`dialogue`), and
   `domain/memory` exports no event/command producers. A design that relies
   on a validator catching bad writes decays over time; a design where the
   write path does not compile does not. This is the strongest property the
   system has.
2. **Deterministic-first retrieval.** Hard scope filters → deterministic
   ranking → FTS later → vectors last (optional, flagged off). Most projects
   do this backwards (vector DB first) and end up with ghost memories and
   cross-world leaks; this ordering avoids that whole failure class.
3. **Promotion from committed events, not raw text.** "One meaningful memory
   = one chunk," dedupe keys, display-name snapshots, provenance/scope/
   authority on every row. The shipped `promoteWorldEvent` +
   `DisplayNameResolver` already implement this in miniature.
4. **Bounded, labeled prompts.** The AUTHORITATIVE vs NON-AUTHORITATIVE
   section split from the design doc is already live in
   `generation/llmDialoguePrompt.ts` with hedged per-line prefixes and hard
   caps (3 entries × 160 chars).

## Future failure risks (all sequencing, not design)

### Risk 1 — the structured dialogue proposal path (design doc §10/§26)

The one genuinely dangerous unbuilt part. Today dialogue is safe because
output is display-only — there is **no** write path to protect. The moment
`proposed_events`/`proposed_effects` ship, protection changes from
"structurally impossible" to "a validator must catch it," and validators fail
in ways import bans do not.

- One check in the design doc — "is the proposal supported by the player
  message?" — cannot be done deterministically (an LLM judging an LLM). Drop
  it or make it advisory in v1; keep only deterministic checks (allowlist,
  IDs exist, text bounded, caps clamped, backend assigns severity).
- Build the memory-poisoning red-team suite **before** this feature, not
  after, and write a dedicated reducer/allowlist/caps ADR that supersedes the
  current "dialogue never parsed back into truth" rule narrowly and
  deliberately — never by free-text sniffing.
- If this ships early or loosely, that is the failure scenario.

### Risk 2 — the two-store split never merges

The design doc says "SQLite is the brain," but browser gameplay runs on
in-memory stores plus localStorage byte-parking; the SQLite memory stores are
headless/test-only. That is a deliberate parallel lane (design doc §27), but
every memory feature built browser-side widens the gap, and the eventual
backend wiring becomes a big-bang migration. Containment:

- Ship `runtime-room-memory-persistence-v0` soon (sidecar parking consistent
  with the ADR-0059/0060 pattern, re-validated through the firewall on load,
  never authoritative).
- **Subtle trap:** memory scope is `(worldId, sessionId, roomId)`. If
  save/load ever produces a different `sessionId` than the one saved, every
  memory orphans silently. Add a test for scope-triple stability across a
  save/load cycle when persistence lands.

### Risk 3 — retrieval quality plateaus at scale

Deterministic ranking with kind-proxies is right for v1, but at ~1000 events
the recall set becomes recency/importance-dominated and can miss the relevant
memory (no semantic match; summaries not built yet). This degrades gracefully
— NPCs feel less aware, never *wrong* — so it is a quality ceiling, not a
correctness failure. The design doc itself flags that weights need tuning.

- Build the long-session evaluation gate early ("1000 events → prompt still
  small and relevant") so the plateau is visible when it arrives.
- FTS5 is the V1.5 fix — but **verify `node:sqlite` in the pinned Node
  version actually ships FTS5** before committing to
  `sqlite-fts-memory-retrieval-v0`.

## Smaller notes

- **V1 binary `event_visibility` will be replaced** by `facts`/
  `fact_visibility` in V1.5. Keep its consumption behind one context-builder
  function so the swap does not touch dialogue code everywhere.
- **`npc_relationships` is truth, not memory.** It must be built on the
  WorldState/event-log side (reducer-applied, delta caps, clamps), never
  inside the firewalled `memory/` layer. The design doc says this (§16), but
  the feature name sits in a "memory features" list where it could drift by
  habit.
- **Memory flood / rate limiting** (design doc §17/§25): dedupe keys exist;
  per-scope rate limits do not. This becomes real the moment free-text input
  plus any `player_claim` promotion exists — build it with that feature, not
  after.

## Bottom line

The design will hold. The implemented half already validates it. Keep the
sequencing discipline — red-team and a reducer/allowlist ADR before
structured effects, persistence merged before memory features multiply, the
long-session eval built early — and the failure modes above stay theoretical.
If sequencing breaks, Risk 1 is the one that actually bites.
