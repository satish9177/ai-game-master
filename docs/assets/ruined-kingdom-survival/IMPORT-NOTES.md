# Ruined Kingdom Survival import notes

These rules define the controlled offline asset-curation process. They do not authorize runtime downloads, generated assets, arbitrary paths, custom shaders, or model-selected renderer instructions.

## Current status

Acquisition and curation are complete for the fifteen committed GLB bundles.
ASSET-SOURCES.json records the official source, acquisition date, original or
selection checksum, per-item modifications, output checksum, and byte length.

Do not commit source archives, unpacked vendor trees, Blender autosaves, paid/source-only content, or an unverified GLB. The application must never fetch these source URLs at runtime.

## Controlled acquisition

1. Follow the exact `officialPageUrl` or `downloadPageUrl` in `ASSET-SOURCES.json`.
2. Select only the free Standard/official-free archive recorded for the source. Do not assume that Pro or Source-only meshes, collisions, variants, shaders, or `.blend` files belong to the free subset.
3. Save the untouched archive in a temporary acquisition directory outside `apps/web/public`.
4. Before extraction, record:
   - acquisition date in `YYYY-MM-DD` form;
   - exact response/archive filename;
   - SHA-256 of the untouched archive;
   - the free tier/version shown by the official page.
5. On Windows, calculate the archive checksum with `Get-FileHash -Algorithm SHA256 -LiteralPath <archive>` and copy the lowercase hexadecimal value into the manifest.
6. Extract to an untracked working directory. Preserve the untouched archive until the curated output has passed review.

Automated mirroring is intentionally not part of the repository. Itch.io free downloads use an interactive handoff and older Quaternius pages do not expose a durable archive filename in their public metadata. A transient download URL is not acceptable provenance.

## Selection and provenance

Maintain a per-output inventory in `includedNodes` and `includedAnimations`:

- `name`: the final unique GLB node or clip name reviewed by the registry;
- `sourceId`: one of the closed source IDs in the manifest;
- `sourceName`: the exact original mesh, armature, or clip name;
- `modifications`: concise factual transformations applied to that item.

Every final node, including armatures, bones, sockets, LOD nodes, state variants, and collider nodes, must be listed. Every final animation must be listed. Do not copy a filename from an online catalog and assume the free archive contains it; inspect the acquired archive.

## Geometry and coordinate normalization

- Units: meters.
- Up axis: `+Y`.
- Authored semantic forward: `+Z`; renderer adapters may rotate the visual child without changing logical movement roots.
- Ground contact: base at `y = 0`.
- Origins: stable interaction/state pivots, not arbitrary scene origins.
- Transforms: apply scale and rotation before export unless a reviewed rig requires otherwise.
- Names: stable ASCII registry names, unique within each GLB, with no paths, URLs, creator workstation names, or narrative text.
- Remove hidden prototypes, preview scenes, unused nodes, empty helpers, cameras, authored lights, audio, constraints not required after bake, and unsupported metadata.
- Create simple authored collision profiles separately from visible detail. Collision must preserve door/exit openings and must not derive from high-detail render meshes at runtime.

## Humanoid and animation normalization

- Player, human NPCs, guards, villagers, merchants, nobles, raiders, zombies, and compatible bipedal monsters use one reviewed humanoid skeleton contract.
- Normalize bone names, rest pose, bind transforms, skin weights, and sockets before export.
- Keep geometry, textures, and animation clips shareable; bones and mixers must remain independently cloneable per instance.
- Select only the approved non-combat intents: idle, walk, run, talk, gesture, inspect, pick-up, sit, carry, hurt, zombie-idle, and zombie-walk.
- Prefer the reviewed in-place source export. Remove residual root translation/rotation from locomotion clips and document the operation.
- Trim clips, set deterministic loop mode, remove unused tracks, and record final sample rate and duration.
- Do not add attack, weapon, death, ragdoll, or combat-system behavior merely because a source archive contains those clips.
- Non-humanoid creatures are excluded. They require separate future rigs.

## Materials, textures, LOD, and states

- Use standard glTF metallic-roughness PBR materials only. `KHR_texture_transform` is the sole currently approved extension.
- No custom/runtime-downloaded shaders, external texture references, data fetched by URL, cameras, or lights.
- Prefer shared palette/atlas textures. Maximum texture dimension is `1024 × 1024` unless the manifest records and the architecture review approves a measured exception.
- Prefer opaque or alpha-test materials. Blended transparency is exceptional and counts against the runtime budget.
- Use coherent grounded low-poly palettes across all sources; record recoloring, atlas changes, UV edits, material merging, and texture compression.
- Build lower-cost LODs for expensive architecture, vegetation, props, and static humanoid representations.
- Author visible condition/state variants only where gameplay or environment projection uses them: intact, weathered, damaged, burned, overgrown, closed, open, locked, looted, read, and activated.
- A stateful or interactable object must retain an independently addressable instance; do not design it solely for static instancing.

## GLB export requirements

Each final file must:

- be a self-contained binary glTF 2.0 file;
- contain exactly the reviewed node and animation names recorded in the manifest;
- contain no external URI, remote reference, camera, light, script-like metadata, or unapproved extension;
- use embedded PNG or JPEG images no larger than the recorded maximum dimension;
- contain only assets from source archives with completed provenance;
- remain inside the approved 20 MiB core and 50 MiB complete-pack budgets;
- have `status: "ready"`, build date, byte length, and lowercase SHA-256 recorded only after the final export is immutable.

The final public paths are closed by `ASSET-SOURCES.json`; do not add another binary or rename one without a reviewed plan amendment and corresponding registry change.

## Verification and manual review

Manifest-only validation remains useful when reviewing metadata without reading the binaries:

```powershell
cd apps/web
npm.cmd run verify:visual-pack -- --manifest-only
```

The strict release gate validates all required GLBs, provenance records, checksums, reviewed names, extensions, embedded resources, and byte budgets:

```powershell
cd apps/web
npm.cmd run verify:visual-pack
```

After the automated gate passes, manually verify:

- silhouettes and palettes in the existing isometric camera at target resolutions;
- animation retargeting, foot contact, loops, transitions, and independent skeleton clones;
- all visible interaction/condition states and pivots;
- collision footprints, exit gaps, player sliding, and NPC exclusion;
- selective shadows, emissive-only lighting fallback, transparency, and instancing eligibility;
- exact/family/environment/neutral fallback coverage with no production debug geometry;
- repeated room navigation, cache leases, disposal, and GPU-resource stability;
- the three showcase fixtures and rich 100–500-piece stress rooms.

Any failed check returns the artifact to `pending-build`; do not waive the verifier by weakening the manifest or renaming an unreviewed node.
