# Ruined Kingdom Survival Visual Pack - Manual Smoke

This is the human acceptance checklist for ADR-0091. It verifies presentation,
interaction feedback, regression safety, weighted performance, and failure
behavior. It does not change generation or make showcase rooms authoritative.

## Preconditions

1. From `apps/web`, run the focused automated checks, then `npm run dev`.
2. Use the dev-only showcase queries:
   - `?showcase=village-square`
   - `?showcase=ruined-tavern`
   - `?showcase=crypt-entrance`
3. Confirm the same query is ignored in a production build.
4. Test at 1280x720, 1440x900, and 1920x1080, at DPR 1 and 2.
5. Record only fixed diagnostic codes, counts, timings, and screenshots. Do not
   paste raw prompts, generated JSON, names, dialogue, object ids, paths, provider
   content, save blobs, or memory text into findings.
6. Run real-provider generation only with the maintainer's local BYOK setup. It
   is optional; never put keys in docs, logs, screenshots, or CI.

Pass means the supported production path has no blue capsule, blue/purple debug
seal, or primitive box/cylinder/cone/sphere fallback.

## Common control and UI pass

Run once in each showcase:

- WASD and arrow movement is screen-relative, diagonals normalize, and the camera
  follows without rotation or jitter.
- The character faces velocity and returns cleanly to idle; NPC walk/talk/pause/
  resume and zombie shamble do not moonwalk.
- Collision slides around walls/furniture rather than sticking or tunnelling.
- Every declared exit side has a visible and passable opening.
- The interaction indicator is legible without obscuring the prop.
- Dialogue/HUD/status overlays do not collide at any target resolution.
- Keyboard focus, Enter/Space, Escape, `aria-live`, free-text dialogue input,
  usage cap, and save/load controls remain usable.
- Interaction precedence is unchanged: exit, then encounter, then dialogue, then
  effect.
- No interaction produces only a purposeless Inspected. outcome when a visible
  gameplay result is expected.
- No console/log message contains a raw path, prompt, room/object/NPC name,
  generated JSON, dialogue, provider response, save blob, or memory text.

## Showcase 1 - Village square

Open `?showcase=village-square`.

Expected composition:

- timber/stone facades, roofs, corners, doors/windows, paving, fences, signs;
- market stalls, well, furniture, containers, tableware, vegetation and clutter;
- at least 100 inexpensive static pieces retained;
- six visually distinct shared-rig humans, including merchant/guard/villager
  presentation;
- merchant dialogue, a readable notice, and an actual take-item supply.

Checks:

1. Inspect from the default isometric view: architecture reads as a village, not
   four room boxes; silhouettes and palette remain coherent.
2. Walk a full loop around the square, well, stalls, and fences. Verify sliding
   collision, clear paths, and no invisible blocker.
3. Approach each human. Confirm deterministic variation, correct interaction
   indicator, stable proximity selection, and no shared-bone pose contamination.
4. Start merchant dialogue. The merchant enters talk/gesture presentation,
   movement pauses as before, and resumes after closing.
5. Read the notice. Confirm the existing effect resolves and the document visibly
   changes to read without disappearing.
6. Take the supply. Confirm inventory/state behavior is unchanged and the
   container visibly opens/empties.
7. Leave and return, then save/reload/continue. Read/looted visuals reconstruct
   from existing authoritative flags.
8. Inspect renderer diagnostics. Cheap repeated pieces should be instanced;
   unique/stateful props must not be in an instance batch.
9. Confirm at least 100 cheap objects remain; no first N objects truncation is
   visible.

Pass evidence: one wide screenshot, object/draw-call/triangle/instance counts,
and a yes/no result for dialogue pause, notice state, supply state, revisit, and
save/load.

## Showcase 2 - Ruined tavern

Open `?showcase=ruined-tavern`.

Expected composition:

- burned beams, broken walls/roof sections, fireplace, cellar elements;
- damaged tables/chairs/benches/shelves, bottles, mugs, sacks and debris;
- one survivor, one shared-rig zombie, one footlocker, one ledger;
- static burned/damaged conditions coexisting with dynamic interaction states.

Checks:

1. Confirm this reads as a damaged tavern rather than generic ruins. Burned,
   damaged, and weathered treatment must not collapse everything to one tint.
2. Walk through doorway, furniture gaps, and cellar approach. Verify collision
   matches visible shapes and never blocks the exit.
3. Observe survivor idle/walk/talk and zombie idle/shamble. They must use the
   same base rig contract with distinct posture/palette/infection/clothing.
4. Take the bandage from the footlocker. The lid opens, contents/occupancy read
   as looted, the interaction result remains authoritative, and no second take
   is possible.
5. Read the ledger. The visible read state updates live without remounting the
   engine or resetting character positions.
6. Leave/return and save/load. Footlocker remains looted/open and ledger remains
   read solely because existing flags restore.
7. Confirm burned condition persists alongside open/looted state rather than
   being overwritten by it.
8. Force the animation-mixer budget below the visible character count. The
   nearest/interactive characters stay animated; distant mixers suspend
   deterministically without removing identities.
9. Confirm no combat controls, attacks, hit physics, weapon pickup, or zombie
   hostility was added.

Pass evidence: before/after footlocker and ledger screenshots, plus yes/no for
state coexistence, revisit, save/load, mixer degradation, and no combat.

## Showcase 3 - Crypt entrance

Open `?showcase=crypt-entrance`.

Expected composition:

- crypt masonry, stairs, iron gate, statues, bone niches, rubble/vegetation;
- braziers or equivalent emissive fixtures;
- rune/altar interaction, generated-gate presentation, and zombie shamble.

Checks:

1. Confirm stairs, masonry, niches, statues, and gate read clearly from the
   isometric camera.
2. Before satisfying the existing rune/altar flag, the relevant gate must look
   locked and navigation must report the existing locked outcome.
3. Activate/inspect the satisfiable rune/altar interaction. The altar changes to
   activated; the same authoritative gate evaluates open; the gate visibly opens.
4. Traverse the opening. Collision must update to the passable state with no
   invisible gate body.
5. Return, save, reload, and continue. Gate and altar visuals reconstruct from
   existing flags/gate evaluation with no persisted Three.js or animation state.
6. Walk each available north/south/east/west exit fixture. Shell visuals and
   collision gaps must agree on all sides.
7. Exceed the local-light budget. Extra braziers become emissive-only in stable
   priority order; they do not disappear and never gain local shadows.
8. Confirm the zombie shambling nearby cannot force combat or change the gate.

Pass evidence: locked/open screenshots and yes/no for authority match,
collision transition, revisit, save/load, four-side exits, and light degradation.

## Rich generated-room stress

Generate or load deterministic fixtures with 100, 250, and 500 inexpensive
static pieces plus a controlled set of expensive resources.

For every fixture:

- object semantics and story anchors are retained;
- no raw truncation or small object-count warning fires;
- repeated static pieces instance;
- draw calls/triangles/textures remain within or deterministically below budget;
- interactions, exits, and NPC identity are preserved;
- over-budget resources degrade in this exact order: instancing, LOD, distant
  humanoid static LOD, mixer suspension, emissive-only lights, particle removal,
  transparency downgrade, shadow removal, lower-cost production fallback;
- the 4,096 abuse ceiling, if exercised separately, rejects/degrades the
  pathological envelope explicitly rather than masquerading as render cost.

Reference performance target: 55-60 FPS on the maintainer's normal 1080p system,
with a playable 30 FPS low-quality fallback on integrated graphics. Record
hardware/browser, resolution/DPR, median FPS, frame-time spikes, draw calls,
triangles, textures, mixers, lights, and collision bodies.

## Navigation, cache, and disposal stress

1. Navigate through 20 rooms and return repeatedly.
2. Repeat under React StrictMode mount -> dispose -> mount behavior.
3. Open/close dialogue and perform state updates throughout.
4. Capture counters after room 1, 10, and 20.

Pass when canvas, listeners, cache leases, source bundles, cloned skeletons,
mixers, geometries, materials, textures, and GPU estimates plateau as expected.
A room release must not dispose cache-owned shared assets; final cache teardown
must dispose each shared resource once. No stale asynchronous load may populate a
superseded room.

## Failure injection

### Exact variant missing

Remove/disable one exact mapping in the test harness.

Expected: family default, then environment default if needed. Interaction,
collision, and semantic identity survive. No debug asset appears.

### Environment bundle unavailable

Inject a rejected environment-bundle load.

Expected: neutral production assets cover the room; diagnostic output is a fixed
code/count only. No exception text or URL/path appears.

### Neutral production bundle unavailable

Inject failure after exact/family/environment resolution is unavailable.

Expected in development: explicitly labelled debug fallback is allowed for
diagnosis. Expected in production: fixed asset-unavailable surface, no seal,
capsule, primitive geometry, raw path, stack, or provider content.

### Animation clip missing

Disable a nonessential clip and then a locomotion clip.

Expected: documented safe intent fallback, no crash, no stuck input, no invented
gameplay. Skeleton/mixer release remains correct.

### WebGL context loss

Trigger context loss/restore if the browser supports the test extension.

Expected: existing calm renderer failure behavior; no authoritative state
change, no duplicate canvas/listener/cache lease after recovery/remount.

## Production build invariant

Run the production build and inspect all three showcases plus one generated
room. Search scene diagnostics/tests for the debug seal, primitive debug builder,
and blue capsule identifiers.

Pass only when:

- supported content resolves at exact/family/environment/neutral tier;
- no production resolution result is `debug`;
- showcase query parameters are ignored outside development;
- the fixed fatal asset-unavailable surface is the only response to total
  production asset failure;
- first-room transfer is at most 20 MB and complete lazy pack is at most 50 MB,
  unless a measured exception is approved in the manifest.

## Automated commands before sign-off

From `apps/web`:

```powershell
npm.cmd run test -- roomSpec
npm.cmd run test -- generatedRoomAliases
npm.cmd run test -- visual
npm.cmd run test -- objectPresentationState
npm.cmd run test -- CollisionWorld2D
npm.cmd run test -- HumanoidCharacterFactory
npm.cmd run test -- CharacterAnimationController
npm.cmd run test -- RoomViewer
npm.cmd run test -- saveGame
npm.cmd run verify:visual-pack
npm.cmd run lint
npm.cmd run build
npm.cmd run test
```

Do not report a check as passed unless it was run. Any failure involving
authority, asset/path injection, production debug fallback, cache disposal, exit
collision, or lost interaction state blocks release.
