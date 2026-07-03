# Generated Room Manual Evaluation Suite v0

This suite is a human checklist for evaluating generated rooms before demo
polish. It evaluates generated rooms; it does not improve, repair, tune, or
polish them. Any fix found here belongs in `generated-room-demo-polish-pass-v0`
or a later approved feature.

## Purpose

Use this suite to decide whether generated rooms are good enough to show and to
record the specific weak or broken areas. The suite covers subjective quality
signals a person must judge, plus safety checks around room validity, exits,
NPC movement, persistence, leakage, and authoritative-state boundaries.

This is documentation only. It changes no runtime behavior, generation behavior,
schemas, logging, memory, save/load, renderer, NPC movement, or provider path.

## Local Manual Session

1. From `apps/web`, run `npm run dev`.
2. Open the local Vite URL in a browser.
3. Start a generated-room session from the PromptBar.
4. For each scenario below, generate the room, walk it, interact with at least
   one object, talk to the NPC if present, try each exit, and record findings.
5. For save/load scenarios, use the existing in-app Save/Load flow, then reload
   or return to the room as instructed.
6. Watch the dev console during the run. Record only whether leakage appears;
   do not paste raw prompts, generated JSON, names, dialogue, memory text, or
   provider output into findings.

Real-provider checks are optional and manual only. Use only the maintainer's
local BYOK setup, never CI, never committed keys, and never provider calls from
this docs artifact.

## Scenario Set

Run the deterministic/local scenarios first. Run real-provider prompts only when
the maintainer wants an extra subjective pass against current model output.

| ID | Scenario / prompt intent | What it stresses |
| --- | --- | --- |
| S1 | `a ruined fantasy keep with one useful object and one guarded exit` | Baseline visual quality, anchor, interactable, NPC, exit |
| S2 | `an abandoned research lab with a machine objective` | Composition, object placement, objective clarity |
| S3 | `a flooded shrine with a single guardian and a visible way out` | NPC presence, idle/wander, exit readability |
| S4 | `a cramped salvage room with scattered debris and a clear path` | Overlap, blocked exits, reachable interactables |
| S5 | `a quiet archive with one important item and one return path` | Objective target, interaction availability, reload/return consistency |
| S6 | Generate one adjacent room, navigate there, then return | Exits/navigation, bidirectional return, room consistency |
| S7 | Save in a generated room, load, reload the page, then return again | Save/load persistence, notice state, objective persistence where relevant |

Optional real-provider prompts:

| ID | Prompt intent | Use |
| --- | --- | --- |
| R1 | `a flooded throne room with a wary keeper` | Real-output visual and composition quality |
| R2 | `an abandoned reactor chapel with one critical repair` | Objective clarity and object placement |
| R3 | `a market cellar after an ambush, with one survivor` | NPC presence, interaction clarity, leakage spot-check |

## Scoring Rubric

Score each row per room: `0` = fail/broken, `1` = weak but usable, `2` = good.
Use the failure labels below when recording problems.

| Area | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Visual quality | Placeholder-heavy, unreadable, or visually broken | Understandable but bland or awkward | Intentional, readable, showable |
| Object placement | Critical clipping, floating, wall clipping, or confusing overlap | Minor awkward spacing or clutter | Props sit cleanly and support the scene |
| Room composition | No readable focal point or path | Some focal intent, but weak zones/path | Clear focal anchor, zones, and walkable center |
| NPC presence | Missing, clipped, off-floor, or in wall/exit | Present but awkwardly placed | Present, legible, safely placed |
| NPC idle/wander behavior | Darts, jitters, blocks exit, loses talkability | Moves safely but feels stiff or odd | Calm idle/wander, pauses, remains talkable |
| Objective clarity | Objective cannot be inferred or UI conflicts with room | Objective exists but needs guesswork | Objective is clear from room and UI |
| Interaction availability | No usable interactable or NPC prompt when expected | Usable but hard to discover | At least one clear interaction, NPC prompt works |
| Exits/navigation | Missing, blocked, unreachable, or navigation fails | Reachable but visually unclear | Clear wall exit; navigation works |
| Save/load persistence where relevant | Load fails or restores wrong/generated state | Restores with minor notice/UI confusion | Same room/objective returns cleanly |
| Reload/return consistency | Return/reload changes room unexpectedly | Minor expected reset only, such as wander start | Same room and objective; return path consistent |
| No broken/overlapping critical objects | NPC/objective/exit/interactable broken or merged | Non-critical overlap only | Critical objects distinct and intact |
| No blocked exits | Prop or NPC blocks an exit footprint | Exit feels cramped but usable | Exit fully clear |
| No unreachable NPC/interactable | Cannot approach or trigger required target | Reachable with awkward positioning | Easy to approach and trigger |
| No provider/log/memory leakage | Console/UI exposes prompt, JSON, names, dialogue, memory, provider body, or PII | Unclear safe diagnostic needs review | Only safe enums/counts/booleans or no logs |
| No unsafe `RoomSpec`/`LoadedRoom`/`WorldState` mutation | Unexpected state/event/schema behavior observed | Ambiguous behavior needs investigation | No unsafe mutation observed |
| No NPC movement-stack regression | Exit blocking, teleporting, talk prompt desync, or state mutation | Safe but visually rough | Movement remains presentation-only and safe |

## Screenshot / Observation Checklist

Capture or inspect these views per room:

| Item | Required observation |
| --- | --- |
| Entry view | First view from spawn shows readable room, path, and props |
| Anchor close-up | Focal object or area is visible, grounded, and not broken |
| NPC at rest | NPC is on the floor and not inside wall, prop, or exit |
| NPC mid-wander | NPC moves calmly, stays in bounds, and remains talkable |
| Exit view | Every visible exit is unobstructed and navigates when used |
| Objective UI | Objective text/status is understandable and matches the room |
| Interaction open | At least one object or NPC interaction opens successfully |
| Notice state | Fallback/repair notice, if shown, is expected and static |
| Save/load/reload | Same generated room and objective return where relevant |
| Console tail | No prompt, generated JSON, names, dialogue, memory text, provider body, or PII |

## Pass / Fail Criteria

Per room:

| Result | Criteria |
| --- | --- |
| PASS | No `0` scores; all safety-critical rows score `2`; weak rows are acceptable only if logged as polish candidates |
| WEAK | No safety-critical failure, but one or more subjective rows score `1` or a non-critical row scores `0` |
| FAIL | Any safety-critical row scores `0`, navigation/save-load breaks, leakage appears, or unsafe mutation is suspected |

Safety-critical rows are: no broken/overlapping critical objects, no blocked
exits, no unreachable NPC/interactable, no provider/log/memory leakage, no unsafe
`RoomSpec`/`LoadedRoom`/`WorldState` mutation, and no NPC movement-stack
regression.

Suite-level acceptance for a manual pass:

- All required local scenarios have zero `FAIL`.
- Any `WEAK` rows are recorded with labels and are acceptable to defer.
- Save/load/reload/return smoke passes for the scenarios where it applies.
- No findings require changing this evaluation suite to hide or relax a problem.

## Failure Labels

Use exactly one primary label per finding:

| Label | Meaning | Destination |
| --- | --- | --- |
| BLOCKER | Safety, navigation, persistence, leakage, mutation, or movement-stack failure | Fix before accepting generated-room quality |
| WEAK | Usable but below demo quality | Candidate for `generated-room-demo-polish-pass-v0` |
| POLISH | Nice-to-have visual/readability improvement | Defer unless included in an approved polish slice |

## Manual Finding Record

Copy this template into the run notes for each room:

```markdown
## Generated Room Evaluation Run

- Date:
- Branch:
- Scenario ID:
- Prompt / seed intent:
- Provider mode: fake / real-provider manual
- Room provenance or notice state:
- Save/load/reload/return covered: yes / no / not relevant

| Area | Score 0/1/2 | Label | Notes |
| --- | --- | --- | --- |
| Visual quality |  |  |  |
| Object placement |  |  |  |
| Room composition |  |  |  |
| NPC presence |  |  |  |
| NPC idle/wander behavior |  |  |  |
| Objective clarity |  |  |  |
| Interaction availability |  |  |  |
| Exits/navigation |  |  |  |
| Save/load persistence where relevant |  |  |  |
| Reload/return consistency |  |  |  |
| No broken/overlapping critical objects |  |  |  |
| No blocked exits |  |  |  |
| No unreachable NPC/interactable |  |  |  |
| No provider/log/memory leakage |  |  |  |
| No unsafe RoomSpec/LoadedRoom/WorldState mutation |  |  |  |
| No NPC movement-stack regression |  |  |  |

- Screenshots captured:
- Console leakage observed: no / yes
- Unexpected state, event, schema, memory, or provider behavior observed: no / yes
- Final result: PASS / WEAK / FAIL
- Follow-up target: blocker fix / generated-room-demo-polish-pass-v0 / none
```

Keep notes content-safe. Do not paste raw provider responses, generated JSON,
raw prompts beyond short scenario intent, NPC dialogue, room/object/NPC names,
memory text, player text, secrets, keys, or PII.

## Save / Load / Reload / Return Smoke

Run this after at least one generated room and one adjacent generated room:

| Step | Expected result |
| --- | --- |
| Save inside generated room | Save completes through existing UI |
| Load saved session | Same generated room restores; no schema or state error |
| Check objective | Objective state is present and consistent where relevant |
| Interact after load | Existing NPC/interactable still opens normally |
| Use exit to adjacent room | Navigation succeeds without blocked exit |
| Return to previous room | Previous generated room remains consistent |
| Reload browser page if applicable | Reload does not create unsafe state or leakage |
| Watch console | No raw prompt, JSON, provider body, memory text, names, dialogue, secrets, or PII |

Expected non-failure: NPC wander may restart from its spec position after reload
because movement is presentation-only and not authoritative state.

## Safety Checklist Before Accepting Quality

Before marking the suite result acceptable, confirm:

- The suite evaluated generated rooms only; no polish or generation fix was made.
- No runtime code, schemas, save/load shape, memory path, logs, provider behavior,
  renderer behavior, or NPC movement code changed.
- Every generated room reached the trusted renderer through the existing validated
  room pipeline.
- No browser-to-SQLite, memory-write, provider-call-in-CI, or generated-code path
  was introduced.
- No unsafe logging or screenshot note captures raw generated content, prompt
  bodies, names, dialogue, memory text, secrets, keys, or PII.
- All `BLOCKER` findings are treated as bugs, not polish.
- All `WEAK` and `POLISH` findings are deferred to an approved follow-up.

## Belongs In `generated-room-demo-polish-pass-v0`

Do not fix these in this feature:

- Better prop art, materials, lighting, visual vocabulary, or placeholder cleanup.
- Object spacing, decluttering, anti-overlap tuning, or composition improvements.
- Focal-anchor selection, layout readability, and in-room signposting changes.
- NPC animation, walk-cycle, facing, greeting, idle polish, or richer behavior.
- Objective UI wording, in-world hinting, interaction affordance polish, or exit
  visual treatment.
- Diagnostics overlays, screenshot diff tooling, browser automation, dashboards,
  telemetry, new tests, or any runtime evaluation harness.

This suite produces the prioritized findings that a later polish pass may use.
