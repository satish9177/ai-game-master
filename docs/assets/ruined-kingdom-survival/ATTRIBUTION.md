# Ruined Kingdom Survival asset attribution

The Ruined Kingdom Survival visual pack curates and modifies selected low-poly assets by **Quaternius**. Quaternius publishes the source packs below under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). CC0 does not require attribution, but this project keeps voluntary credit and exact provenance as a matter of good stewardship.

The curated Ruined Kingdom Survival pack contains fifteen reviewed GLB bundles built from the free CC0 sources below. [ASSET-SOURCES.json](./ASSET-SOURCES.json) is authoritative for acquisition checksums, per-node and per-animation provenance, applied modifications, output checksums, and byte lengths. The Zombie Apocalypse and Ultimate Stylized Nature sources were officially distributed as individual files, so their manifest entries record a deterministic selection-inventory checksum instead of claiming an archive that did not exist.

## Source packs

| ID | Source pack | Intended contribution | Official source |
|---|---|---|---|
| UBC | Universal Base Characters | Shared humanoid bodies, heads, hair, and rig | [Quaternius](https://quaternius.com/packs/universalbasecharacters.html) |
| FO | Modular Character Outfits - Fantasy | Clothing, armour, role silhouettes, and accessories | [Quaternius](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) |
| UAL | Universal Animation Library | General humanoid locomotion and action clips | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) |
| UAL2 | Universal Animation Library 2 | Zombie locomotion and supplemental action clips | [Quaternius](https://quaternius.com/packs/universalanimationlibrary2.html) |
| MV | Medieval Village MegaKit | Modular village, tavern, palace, and ruin architecture | [Quaternius](https://quaternius.com/packs/medievalvillagemegakit.html) |
| FP | Fantasy Props MegaKit | Furniture, containers, documents, clutter, fixtures, and anchors | [Quaternius](https://quaternius.com/packs/fantasypropsmegakit.html) |
| MD | Modular Dungeons Pack | Crypt, dungeon, and ruined masonry | [Quaternius](https://quaternius.com/packs/modulardungeon.html) |
| ZA | Zombie Apocalypse Kit | Infection treatment, survival props, and damage references | [Quaternius](https://quaternius.com/packs/zombieapocalypsekit.html) |
| USN | Ultimate Stylized Nature Pack | Trees, rocks, bushes, grass, and other vegetation | [Quaternius](https://quaternius.com/packs/ultimatestylizednature.html) |

The official Universal Animation Library pages additionally thank animator **Gonzalo Furnier** for contributions. This project carries that acknowledgement forward voluntarily.

## License scope

The curated asset outputs are derived only from files whose official source page identifies them as CC0. A repository copy of the legal tool is in [CC0-1.0.txt](../licenses/CC0-1.0.txt), with the canonical legal code maintained by [Creative Commons](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en).

CC0 permits copying, modification, redistribution, and commercial use, subject to its limitations and disclaimers. It does not waive third-party trademark, patent, privacy, or publicity rights, and it does not imply endorsement by Quaternius, Gonzalo Furnier, or Creative Commons.

This notice applies only to the asset material identified in the manifest. It does **not** declare the AI Game Master source code or the whole repository to be CC0.

## Release checklist

Before distributing any visual-pack binary:

1. Acquire it from the official source or the official itch.io download page recorded in the manifest.
2. Record the original archive filename, acquisition date, and SHA-256 before extraction.
3. Record every included output node and clip with its source ID and original source name.
4. Record every modification and the resulting GLB byte length and SHA-256.
5. Run `npm run verify:visual-pack` from `apps/web`.
6. Complete the visual, collision, animation, fallback, and performance review in `IMPORT-NOTES.md`.
